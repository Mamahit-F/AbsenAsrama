import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  authApi,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isApiError,
  residentsApi,
  setAuthExpiredHandler,
  type RegisterResidentRequest,
  type ResidentProfileDto,
  type UserRole,
  type UserSessionDto,
} from "../api";

export type Role = "penghuni" | "penjaga" | "admin";

export interface User {
  id: string;
  role: Role;
  backendRole: UserRole;
  name: string;
  nim?: string;
  username?: string;
  email?: string | null;
  residentId?: string;
  room?: string;
  building?: string;
}

export function mapBackendRole(role: UserRole): Role {
  switch (role) {
    case "PENGHUNI":
      return "penghuni";
    case "ADMIN":
      return "admin";
    case "MONITOR":
    case "VILLAGE_DEAN":
    default:
      return "penjaga";
  }
}

export function roleHomePath(role: Role): string {
  if (role === "penghuni") return "/penghuni";
  if (role === "penjaga") return "/penjaga";
  return "/admin";
}

function buildUserFromSession(
  session: UserSessionDto,
  residentProfile?: ResidentProfileDto | null,
): User {
  const uiRole = mapBackendRole(session.role);
  const displayName =
    residentProfile?.fullName ||
    session.username
      .split(/[._-]/)
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ") ||
    session.username;

  return {
    id: session.residentId ?? session.userId,
    role: uiRole,
    backendRole: session.role,
    name: displayName,
    nim: residentProfile?.nim ?? (session.role === "PENGHUNI" ? session.username : undefined),
    username: session.username,
    email: session.email,
    residentId: session.residentId ?? residentProfile?.id,
    room: residentProfile?.roomNumber ?? undefined,
    building: residentProfile?.building ?? undefined,
  };
}

export type LoginResult =
  | { ok: true; role: Role; user: User }
  | { ok: false; error: string; code?: string; lockedUntil?: number };

export type RegisterResult =
  | { ok: true; user: User }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

interface AuthCtx {
  user: User | null;
  initializing: boolean;
  login: (identifier: string, password: string) => Promise<LoginResult>;
  registerResident: (payload: RegisterResidentRequest) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export interface Toast {
  id: number;
  text: string;
  tone?: "ok" | "error" | "info";
}

const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState<boolean>(() => {
    return Boolean(getAccessToken() || getRefreshToken());
  });
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.floor(performance.now() * 1000);
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const hydrateFromSession = useCallback(async (session: UserSessionDto): Promise<User> => {
    let residentProfile: ResidentProfileDto | null = null;
    if (session.role === "PENGHUNI") {
      try {
        residentProfile = await residentsApi.getMyProfile();
      } catch {
        // Gunakan fallback data session bila profil belum dapat dimuat
      }
    }
    const built = buildUserFromSession(session, residentProfile);
    setUser(built);
    return built;
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const session = await authApi.me();
      await hydrateFromSession(session);
    } catch {
      clearTokens();
      setUser(null);
    }
  }, [hydrateFromSession]);

  useEffect(() => {
    setAuthExpiredHandler(() => {
      setUser(null);
    });
    return () => setAuthExpiredHandler(null);
  }, []);

  useEffect(() => {
    let active = true;
    const hasToken = Boolean(getAccessToken() || getRefreshToken());
    if (!hasToken) {
      setInitializing(false);
      return;
    }

    (async () => {
      try {
        const session = await authApi.me();
        if (!active) return;
        await hydrateFromSession(session);
      } catch {
        if (!active) return;
        clearTokens();
        setUser(null);
      } finally {
        if (active) setInitializing(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [hydrateFromSession]);

  const login = useCallback(
    async (identifier: string, password: string): Promise<LoginResult> => {
      const id = identifier.trim();
      if (!id || !password) {
        return { ok: false, error: "Masukkan NIM/username dan kata sandi." };
      }

      try {
        const tokenResp = await authApi.login({ identifier: id, password });
        const built = await hydrateFromSession(tokenResp.user);
        return { ok: true, role: built.role, user: built };
      } catch (err) {
        if (isApiError(err)) {
          let lockedUntilMs: number | undefined;
          const rawLocked = err.details?.lockedUntil;
          if (typeof rawLocked === "string" && rawLocked.trim()) {
            const parsed = Date.parse(rawLocked);
            if (!Number.isNaN(parsed)) {
              lockedUntilMs = parsed;
            }
          }
          return {
            ok: false,
            error: err.message,
            code: err.code,
            lockedUntil: lockedUntilMs,
          };
        }
        return {
          ok: false,
          error: "Gagal melakukan autentikasi ke server.",
        };
      }
    },
    [hydrateFromSession],
  );

  const registerResident = useCallback(
    async (payload: RegisterResidentRequest): Promise<RegisterResult> => {
      try {
        await authApi.register(payload);
        const tokenResp = await authApi.login({
          identifier: payload.nim.trim(),
          password: payload.password,
        });
        const built = await hydrateFromSession(tokenResp.user);
        return { ok: true, user: built };
      } catch (err) {
        if (isApiError(err)) {
          const fieldErrors: Record<string, string> = {};
          if (err.details) {
            for (const [k, v] of Object.entries(err.details)) {
              if (typeof v === "string") fieldErrors[k] = v;
            }
          }
          return {
            ok: false,
            error: err.message,
            fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
          };
        }
        return { ok: false, error: "Terjadi kesalahan saat mendaftarkan akun penghuni." };
      }
    },
    [hydrateFromSession],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        await authApi.changePassword({ currentPassword, newPassword });
        return { ok: true };
      } catch (err) {
        if (isApiError(err)) {
          return { ok: false, error: err.message };
        }
        return { ok: false, error: "Gagal memperbarui kata sandi." };
      }
    },
    [],
  );

  return (
    <Ctx.Provider
      value={{
        user,
        initializing,
        login,
        registerResident,
        logout,
        refreshProfile,
        changePassword,
      }}
    >
      <ToastCtx.Provider value={toast}>
        {children}
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex max-w-[400px] flex-col items-center gap-2 px-5"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={`glass pointer-events-auto flex items-center gap-2.5 rounded-full px-4 py-2.5 text-xs font-semibold shadow-lg ${
                t.tone === "error"
                  ? "text-danger"
                  : t.tone === "info"
                    ? "text-primary"
                    : "text-ink"
              }`}
            >
              <span
                className={`size-2 rounded-full ${
                  t.tone === "error"
                    ? "bg-danger"
                    : t.tone === "info"
                      ? "bg-primary"
                      : "bg-success"
                }`}
              />
              {t.text}
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </Ctx.Provider>
  );
}
