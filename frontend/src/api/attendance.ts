import { apiRequest, buildQuery } from "./client";
import type {
  AiStatusDto,
  AttendanceRecordDto,
  AttendanceScanResultResponse,
  CorrectAttendanceRequest,
  DashboardStatsDto,
  ManualAttendanceRequest,
  SessionRecapDto,
} from "./types";

export interface ScanSelfParams {
  photoBlob: Blob;
  sessionId?: string;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  idempotencyKey?: string;
}

export interface ScanGuardAssistedParams extends ScanSelfParams {
  residentId: string;
  reason?: string;
}

export interface HistoryQueryParams {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const attendanceApi = {
  async getAiStatus(): Promise<AiStatusDto> {
    return apiRequest<AiStatusDto>("/attendance/ai-status", { method: "GET" });
  },

  async scanSelf(params: ScanSelfParams): Promise<AttendanceScanResultResponse> {
    const form = new FormData();
    form.append("file", params.photoBlob, "scan-self.jpg");
    if (params.sessionId) form.append("sessionId", params.sessionId);
    if (params.latitude !== undefined) form.append("latitude", String(params.latitude));
    if (params.longitude !== undefined) form.append("longitude", String(params.longitude));
    if (params.accuracyM !== undefined) form.append("accuracyM", String(params.accuracyM));

    const headers: Record<string, string> = {};
    if (params.idempotencyKey) {
      headers["Idempotency-Key"] = params.idempotencyKey;
    }

    return apiRequest<AttendanceScanResultResponse>("/attendance/scan", {
      method: "POST",
      body: form,
      headers,
    });
  },

  async scanGuardAssisted(params: ScanGuardAssistedParams): Promise<AttendanceScanResultResponse> {
    const form = new FormData();
    form.append("file", params.photoBlob, "scan-assisted.jpg");
    form.append("residentId", params.residentId);
    if (params.sessionId) form.append("sessionId", params.sessionId);
    if (params.reason) form.append("reason", params.reason);
    if (params.latitude !== undefined) form.append("latitude", String(params.latitude));
    if (params.longitude !== undefined) form.append("longitude", String(params.longitude));
    if (params.accuracyM !== undefined) form.append("accuracyM", String(params.accuracyM));

    const headers: Record<string, string> = {};
    if (params.idempotencyKey) {
      headers["Idempotency-Key"] = params.idempotencyKey;
    }

    return apiRequest<AttendanceScanResultResponse>("/attendance/scan/guard-assisted", {
      method: "POST",
      body: form,
      headers,
    });
  },

  async recordManual(payload: ManualAttendanceRequest): Promise<AttendanceRecordDto> {
    return apiRequest<AttendanceRecordDto>("/attendance/manual", {
      method: "POST",
      body: payload,
    });
  },

  async correctAttendance(
    recordId: string,
    payload: CorrectAttendanceRequest,
  ): Promise<AttendanceRecordDto> {
    return apiRequest<AttendanceRecordDto>(`/attendance/${recordId}/correct`, {
      method: "PATCH",
      body: payload,
    });
  },

  async getSessionRecap(sessionId: string): Promise<SessionRecapDto> {
    return apiRequest<SessionRecapDto>(`/attendance/sessions/${sessionId}/recap`, {
      method: "GET",
    });
  },

  async getMyHistory(params: HistoryQueryParams = {}): Promise<AttendanceRecordDto[]> {
    const q = buildQuery({
      from: params.from,
      to: params.to,
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    });
    return apiRequest<AttendanceRecordDto[]>(`/attendance/me${q}`, { method: "GET" });
  },

  async getResidentHistory(
    residentId: string,
    params: HistoryQueryParams = {},
  ): Promise<AttendanceRecordDto[]> {
    const q = buildQuery({
      from: params.from,
      to: params.to,
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    });
    return apiRequest<AttendanceRecordDto[]>(`/attendance/residents/${residentId}${q}`, {
      method: "GET",
    });
  },

  async getDashboardStats(): Promise<DashboardStatsDto> {
    return apiRequest<DashboardStatsDto>("/attendance/dashboard", { method: "GET" });
  },
};
