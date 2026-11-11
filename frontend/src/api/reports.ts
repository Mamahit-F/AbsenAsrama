import { apiDownloadBlob, apiRequest, buildQuery } from "./client";
import type {
  AttendanceRecordHistoryDto,
  AttendanceStatus,
  AuditLogDto,
  PeriodRecapReportDto,
  ValidationLogDto,
  ValidationResult,
} from "./types";

export interface ReportFilterParams {
  from?: string;
  to?: string;
  sessionId?: string;
  status?: AttendanceStatus;
}

export const reportsApi = {
  async getAttendanceReport(params: ReportFilterParams = {}): Promise<PeriodRecapReportDto> {
    const q = buildQuery({
      from: params.from,
      to: params.to,
      sessionId: params.sessionId,
      status: params.status,
    });
    return apiRequest<PeriodRecapReportDto>(`/reports/attendance${q}`, { method: "GET" });
  },

  async exportAttendanceCsv(params: ReportFilterParams = {}): Promise<Blob> {
    const q = buildQuery({
      from: params.from,
      to: params.to,
      sessionId: params.sessionId,
      status: params.status,
    });
    return apiDownloadBlob(`/reports/attendance/export-csv${q}`);
  },

  async getAuditLogs(
    params: { entityType?: string; limit?: number; offset?: number } = {},
  ): Promise<AuditLogDto[]> {
    const q = buildQuery({
      entityType: params.entityType,
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    });
    return apiRequest<AuditLogDto[]>(`/reports/logs/audit${q}`, { method: "GET" });
  },

  async getValidationLogs(
    params: { sessionId?: string; result?: ValidationResult; limit?: number; offset?: number } = {},
  ): Promise<ValidationLogDto[]> {
    const q = buildQuery({
      sessionId: params.sessionId,
      result: params.result,
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    });
    return apiRequest<ValidationLogDto[]>(`/reports/logs/validation${q}`, { method: "GET" });
  },

  async getAttendanceHistory(
    params: { recordId?: string; limit?: number; offset?: number } = {},
  ): Promise<AttendanceRecordHistoryDto[]> {
    const q = buildQuery({
      recordId: params.recordId,
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    });
    return apiRequest<AttendanceRecordHistoryDto[]>(`/reports/logs/attendance-history${q}`, {
      method: "GET",
    });
  },
};
