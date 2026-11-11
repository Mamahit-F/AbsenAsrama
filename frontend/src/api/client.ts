import type { ApiEnvelope, AuthTokenResponse } from "./types";

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "/api/v1";
export const API_BASE_URL = RAW_BASE.endsWith("/") ? RAW_BASE.slice(0, -1) : RAW_BASE;

const ACCESS_TOKEN_KEY = "unklab_access_token";
const REFRESH_TOKEN_KEY = "unklab_refresh_token";

let memoryAccessToken: string | null = null;
let memoryRefreshToken: string | null = null;

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // Abaikan jika sessionStorage diblokir browser
  }
}

export function getAccessToken(): string | null {
  if (memoryAccessToken) return memoryAccessToken;
  const stored = readStorage(ACCESS_TOKEN_KEY);
  if (stored) memoryAccessToken = stored;
  return memoryAccessToken;
}

export function getRefreshToken(): string | null {
  if (memoryRefreshToken) return memoryRefreshToken;
  const stored = readStorage(REFRESH_TOKEN_KEY);
  if (stored) memoryRefreshToken = stored;
  return memoryRefreshToken;
}

export function setTokens(accessToken: string | null, refreshToken: string | null): void {
  memoryAccessToken = accessToken;
  memoryRefreshToken = refreshToken;
  writeStorage(ACCESS_TOKEN_KEY, accessToken);
  writeStorage(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  setTokens(null, null);
  try {
    window.localStorage.removeItem("unklab_user");
  } catch {
    // Abaikan
  }
}

type AuthExpiredListener = () => void;
let onAuthExpired: AuthExpiredListener | null = null;

export function setAuthExpiredHandler(handler: AuthExpiredListener | null): void {
  onAuthExpired = handler;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;
  readonly timestamp?: string;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown> | null;
    timestamp?: string;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details ?? null;
    this.timestamp = opts.timestamp;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/**
 * Memetakan error validasi field dari backend (400 VALIDATION_ERROR) ke objek { [field]: message }.
 */
export function mapFieldErrors(err: unknown): Record<string, string> {
  if (!isApiError(err) || !err.details) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(err.details)) {
    if (typeof val === "string" && val.trim()) {
      out[key] = val;
    }
  }
  return out;
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      sp.set(k, String(v));
    }
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

// Single-flight refresh token promise agar request paralel tidak me-refresh berkali-kali
let refreshInFlight: Promise<string | null> | null = null;

async function performSingleFlightRefresh(): Promise<string | null> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  const currentRefresh = getRefreshToken();
  if (!currentRefresh) {
    clearTokens();
    return null;
  }

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ refreshToken: currentRefresh }),
      });

      if (!res.ok) {
        clearTokens();
        return null;
      }

      const payload = (await res.json()) as ApiEnvelope<AuthTokenResponse>;
      if (!payload.success || !payload.data?.accessToken) {
        clearTokens();
        return null;
      }

      setTokens(payload.data.accessToken, payload.data.refreshToken ?? currentRefresh);
      return payload.data.accessToken;
    } catch {
      clearTokens();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  skipAuth?: boolean;
  skipRefresh?: boolean;
}

function isAuthPublicEndpoint(path: string): boolean {
  return (
    path.startsWith("/auth/login") ||
    path.startsWith("/auth/register") ||
    path.startsWith("/auth/refresh")
  );
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message =
    res.status === 401
      ? "Sesi autentikasi berakhir atau kredensial tidak valid."
      : res.status === 403
        ? "Akses ditolak: Anda tidak memiliki izin untuk aksi ini."
        : res.status === 404
          ? "Data yang diminta tidak ditemukan."
          : res.status === 429
            ? "Terlalu banyak percobaan. Silakan tunggu beberapa saat."
            : res.status === 503
              ? "Layanan sedang tidak tersedia sementara waktu."
              : "Terjadi kesalahan saat menghubungi server.";
  let details: Record<string, unknown> | null = null;
  let timestamp: string | undefined;

  try {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = (await res.json()) as Partial<ApiEnvelope<unknown>>;
      if (json.code) code = json.code;
      if (json.message) message = json.message;
      details = (json.metadata ?? json.details ?? null) as Record<string, unknown> | null;
      timestamp = json.timestamp;
    } else {
      const text = await res.text();
      if (text && text.length < 300) {
        message = text;
      }
    }
  } catch {
    // Gunakan pesan default jika body gagal di-parse
  }

  return new ApiError({ status: res.status, code, message, details, timestamp });
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE_URL}${normalizedPath}`;
  const { body, skipAuth = false, skipRefresh = false, headers: customHeaders, ...rest } = options;

  const buildFetchInit = (token: string | null): RequestInit => {
    const headers = new Headers(customHeaders);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }

    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    if (!isFormData && body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    if (!skipAuth && token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return {
      ...rest,
      headers,
      body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    };
  };

  let res: Response;
  try {
    res = await fetch(url, buildFetchInit(getAccessToken()));
  } catch {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "Tidak dapat terhubung ke server backend. Periksa koneksi jaringan atau pastikan server aktif.",
    });
  }

  if (
    res.status === 401 &&
    !skipAuth &&
    !skipRefresh &&
    !isAuthPublicEndpoint(normalizedPath) &&
    getRefreshToken()
  ) {
    const newAccessToken = await performSingleFlightRefresh();
    if (newAccessToken) {
      try {
        res = await fetch(url, buildFetchInit(newAccessToken));
      } catch {
        throw new ApiError({
          status: 0,
          code: "NETWORK_ERROR",
          message: "Tidak dapat terhubung ke server backend saat memuat ulang sesi.",
        });
      }
    } else {
      onAuthExpired?.();
      throw await parseErrorResponse(res);
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !isAuthPublicEndpoint(normalizedPath) && !skipAuth) {
      clearTokens();
      onAuthExpired?.();
    }
    throw await parseErrorResponse(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const envelope = (await res.json()) as ApiEnvelope<T>;
  if (envelope && typeof envelope === "object" && "success" in envelope) {
    if (!envelope.success) {
      throw new ApiError({
        status: res.status,
        code: envelope.code || "API_ERROR",
        message: envelope.message || "Permintaan ditolak oleh server.",
        details: (envelope.metadata ?? envelope.details ?? null) as Record<string, unknown> | null,
        timestamp: envelope.timestamp,
      });
    }
    return envelope.data;
  }

  return envelope as unknown as T;
}

export async function apiDownloadBlob(path: string): Promise<Blob> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE_URL}${normalizedPath}`;

  const doFetch = async (token: string | null) => {
    const headers = new Headers();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(url, { method: "GET", headers });
  };

  let res: Response;
  try {
    res = await doFetch(getAccessToken());
  } catch {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "Tidak dapat mengunduh berkas dari server backend.",
    });
  }

  if (res.status === 401 && getRefreshToken()) {
    const newAccessToken = await performSingleFlightRefresh();
    if (newAccessToken) {
      res = await doFetch(newAccessToken);
    } else {
      onAuthExpired?.();
      throw await parseErrorResponse(res);
    }
  }

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.blob();
}
