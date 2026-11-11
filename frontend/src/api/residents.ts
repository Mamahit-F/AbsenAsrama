import { apiRequest, buildQuery } from "./client";
import type {
  ConsentDto,
  ConsentRequest,
  EmergencyContactDto,
  EmergencyContactRequest,
  ResidenceCategory,
  ResidentProfileDto,
  ResidentStatus,
} from "./types";

export interface ListResidentsParams {
  status?: ResidentStatus;
  category?: ResidenceCategory;
  search?: string;
  limit?: number;
  offset?: number;
}

export const residentsApi = {
  async getMyProfile(): Promise<ResidentProfileDto> {
    return apiRequest<ResidentProfileDto>("/residents/me", { method: "GET" });
  },

  async listResidents(params: ListResidentsParams = {}): Promise<ResidentProfileDto[]> {
    const q = buildQuery({
      status: params.status,
      category: params.category,
      search: params.search,
      limit: params.limit ?? 200,
      offset: params.offset ?? 0,
    });
    return apiRequest<ResidentProfileDto[]>(`/residents${q}`, { method: "GET" });
  },

  async getById(residentId: string): Promise<ResidentProfileDto> {
    return apiRequest<ResidentProfileDto>(`/residents/${residentId}`, { method: "GET" });
  },

  async getConsents(residentId: string): Promise<ConsentDto[]> {
    return apiRequest<ConsentDto[]>(`/residents/${residentId}/consents`, { method: "GET" });
  },

  async giveConsent(residentId: string, payload: ConsentRequest): Promise<ConsentDto> {
    return apiRequest<ConsentDto>(`/residents/${residentId}/consents`, {
      method: "POST",
      body: payload,
    });
  },

  async revokeConsent(residentId: string): Promise<void> {
    return apiRequest<void>(`/residents/${residentId}/consents/revoke`, {
      method: "POST",
    });
  },

  async getEmergencyContacts(residentId: string): Promise<EmergencyContactDto[]> {
    return apiRequest<EmergencyContactDto[]>(`/residents/${residentId}/emergency-contacts`, {
      method: "GET",
    });
  },

  async addEmergencyContact(
    residentId: string,
    payload: EmergencyContactRequest,
  ): Promise<EmergencyContactDto> {
    return apiRequest<EmergencyContactDto>(`/residents/${residentId}/emergency-contacts`, {
      method: "POST",
      body: payload,
    });
  },
};
