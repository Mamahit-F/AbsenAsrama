import { apiRequest, buildQuery } from "./client";
import type {
  CreateResidentRequest,
  CreateStaffUserRequest,
  CsvImportSummaryDto,
  ResidentProfileDto,
  ResidentStatus,
  UpdateResidentRequest,
  UserAccountDto,
  UserRole,
} from "./types";

export const adminApi = {
  async createResident(payload: CreateResidentRequest): Promise<ResidentProfileDto> {
    return apiRequest<ResidentProfileDto>("/admin/residents", {
      method: "POST",
      body: payload,
    });
  },

  async updateResident(
    residentId: string,
    payload: UpdateResidentRequest,
  ): Promise<ResidentProfileDto> {
    return apiRequest<ResidentProfileDto>(`/admin/residents/${residentId}`, {
      method: "PUT",
      body: payload,
    });
  },

  async changeResidentStatus(
    residentId: string,
    status: ResidentStatus,
  ): Promise<ResidentProfileDto> {
    return apiRequest<ResidentProfileDto>(`/admin/residents/${residentId}/status`, {
      method: "PATCH",
      body: { status },
    });
  },

  async deleteResident(residentId: string): Promise<void> {
    return apiRequest<void>(`/admin/residents/${residentId}`, {
      method: "DELETE",
    });
  },

  async importResidentsCsv(fileOrBlob: Blob, filename = "residents.csv"): Promise<CsvImportSummaryDto> {
    const form = new FormData();
    form.append("file", fileOrBlob, filename);
    return apiRequest<CsvImportSummaryDto>("/admin/residents/import-csv", {
      method: "POST",
      body: form,
    });
  },

  async purgeExpiredBiometrics(): Promise<{ purgedCount: number }> {
    return apiRequest<{ purgedCount: number }>("/admin/retention/purge-biometrics", {
      method: "POST",
    });
  },

  async listUsers(
    params: { role?: UserRole; search?: string; limit?: number; offset?: number } = {},
  ): Promise<UserAccountDto[]> {
    const q = buildQuery({
      role: params.role,
      search: params.search,
      limit: params.limit ?? 200,
      offset: params.offset ?? 0,
    });
    return apiRequest<UserAccountDto[]>(`/admin/users${q}`, { method: "GET" });
  },

  async createStaffUser(payload: CreateStaffUserRequest): Promise<UserAccountDto> {
    return apiRequest<UserAccountDto>("/admin/users", {
      method: "POST",
      body: payload,
    });
  },

  async setUserActive(userId: string, isActive: boolean): Promise<UserAccountDto> {
    return apiRequest<UserAccountDto>(`/admin/users/${userId}/active`, {
      method: "PATCH",
      body: { isActive },
    });
  },

  async updateUserRole(userId: string, role: UserRole): Promise<UserAccountDto> {
    return apiRequest<UserAccountDto>(`/admin/users/${userId}/role`, {
      method: "PATCH",
      body: { role },
    });
  },

  async resetUserPassword(userId: string, newPassword: string): Promise<void> {
    return apiRequest<void>(`/admin/users/${userId}/reset-password`, {
      method: "POST",
      body: { newPassword },
    });
  },
};
