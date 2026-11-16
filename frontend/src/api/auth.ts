import { apiRequest, clearTokens, getRefreshToken, setTokens } from "./client";
import type {
  AuthTokenResponse,
  ChangePasswordRequest,
  LoginRequest,
  UserSessionDto,
} from "./types";

export const authApi = {
  async login(payload: LoginRequest): Promise<AuthTokenResponse> {
    const data = await apiRequest<AuthTokenResponse>("/auth/login", {
      method: "POST",
      body: payload,
      skipAuth: true,
    });
    setTokens(data.accessToken, data.refreshToken);
    return data;
  },

  async refresh(refreshToken?: string): Promise<AuthTokenResponse> {
    const token = refreshToken ?? getRefreshToken();
    const data = await apiRequest<AuthTokenResponse>("/auth/refresh", {
      method: "POST",
      body: { refreshToken: token },
      skipAuth: true,
      skipRefresh: true,
    });
    setTokens(data.accessToken, data.refreshToken);
    return data;
  },

  async logout(): Promise<void> {
    const refreshToken = getRefreshToken();
    try {
      await apiRequest<void>("/auth/logout", {
        method: "POST",
        body: refreshToken ? { refreshToken } : {},
        skipRefresh: true,
      });
    } finally {
      clearTokens();
    }
  },

  async me(): Promise<UserSessionDto> {
    return apiRequest<UserSessionDto>("/auth/me", { method: "GET" });
  },

  async changePassword(payload: ChangePasswordRequest): Promise<void> {
    const body = {
      old_password: payload.old_password ?? payload.currentPassword,
      new_password: payload.new_password ?? payload.newPassword,
      confirm_password: payload.confirm_password ?? payload.new_password ?? payload.newPassword,
    };
    return apiRequest<void>("/auth/change-password", {
      method: "POST",
      body,
    });
  },
};
