import { apiRequest, buildQuery } from "./client";
import type {
  CaseStatus,
  CreateHelpRequestDto,
  HelpRequestDto,
  HelpRequestUpdateHistoryDto,
  UpdateHelpRequestStatusDto,
} from "./types";

export const helpRequestsApi = {
  async list(
    params: { status?: CaseStatus; limit?: number; offset?: number } = {},
  ): Promise<HelpRequestDto[]> {
    const q = buildQuery({
      status: params.status,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    });
    return apiRequest<HelpRequestDto[]>(`/help-requests${q}`, { method: "GET" });
  },

  async create(payload: CreateHelpRequestDto): Promise<HelpRequestDto> {
    return apiRequest<HelpRequestDto>("/help-requests", {
      method: "POST",
      body: payload,
    });
  },

  async updateStatus(
    requestId: string,
    payload: UpdateHelpRequestStatusDto,
  ): Promise<HelpRequestDto> {
    return apiRequest<HelpRequestDto>(`/help-requests/${requestId}/status`, {
      method: "PATCH",
      body: payload,
    });
  },

  async getHistory(requestId: string): Promise<HelpRequestUpdateHistoryDto[]> {
    return apiRequest<HelpRequestUpdateHistoryDto[]>(`/help-requests/${requestId}/history`, {
      method: "GET",
    });
  },
};
