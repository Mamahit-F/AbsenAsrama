import { apiRequest, buildQuery, isApiError } from "./client";
import type {
  ActivityTypeDto,
  CreateExemptionRequest,
  CreateScheduleRequest,
  CreateSessionRequest,
  ExemptionDto,
  GeofenceConfigRequest,
  GeofenceDto,
  MaterializeSessionsRequest,
  ScheduleDto,
  ScheduleHistoryEntryDto,
  ScheduleStatus,
  SessionDto,
  SessionStatus,
  UpdateScheduleRequest,
} from "./types";

export const schedulesApi = {
  async listActivityTypes(): Promise<ActivityTypeDto[]> {
    return apiRequest<ActivityTypeDto[]>("/schedules/activity-types", { method: "GET" });
  },

  async listSchedules(status?: ScheduleStatus): Promise<ScheduleDto[]> {
    const q = buildQuery({ status });
    return apiRequest<ScheduleDto[]>(`/schedules${q}`, { method: "GET" });
  },

  async getSchedule(scheduleId: string): Promise<ScheduleDto> {
    return apiRequest<ScheduleDto>(`/schedules/${scheduleId}`, { method: "GET" });
  },

  async getScheduleHistory(scheduleId: string): Promise<ScheduleHistoryEntryDto[]> {
    return apiRequest<ScheduleHistoryEntryDto[]>(`/schedules/${scheduleId}/history`, {
      method: "GET",
    });
  },

  async createSchedule(payload: CreateScheduleRequest): Promise<ScheduleDto> {
    return apiRequest<ScheduleDto>("/schedules", {
      method: "POST",
      body: payload,
    });
  },

  async updateSchedule(scheduleId: string, payload: UpdateScheduleRequest): Promise<ScheduleDto> {
    return apiRequest<ScheduleDto>(`/schedules/${scheduleId}`, {
      method: "PUT",
      body: payload,
    });
  },

  async materializeSessions(
    scheduleId: string,
    payload: MaterializeSessionsRequest,
  ): Promise<{
    scheduleId: string;
    fromDate: string;
    toDate: string;
    createdSessionsCount: number;
  }> {
    return apiRequest(`/schedules/${scheduleId}/materialize`, {
      method: "POST",
      body: payload,
    });
  },

  async listSessions(params: { status?: SessionStatus; scheduleId?: string } = {}): Promise<SessionDto[]> {
    const q = buildQuery({ status: params.status, scheduleId: params.scheduleId });
    return apiRequest<SessionDto[]>(`/schedules/sessions${q}`, { method: "GET" });
  },

  async getActiveSession(): Promise<SessionDto | null> {
    try {
      return await apiRequest<SessionDto>("/schedules/sessions/active", { method: "GET" });
    } catch (err) {
      if (isApiError(err) && (err.code === "NO_ACTIVE_SESSION" || err.status === 404)) {
        return null;
      }
      throw err;
    }
  },

  async createSession(payload: CreateSessionRequest): Promise<SessionDto> {
    return apiRequest<SessionDto>("/schedules/sessions", {
      method: "POST",
      body: payload,
    });
  },

  async getGeofence(sessionId: string): Promise<GeofenceDto | null> {
    try {
      return await apiRequest<GeofenceDto>(`/schedules/sessions/${sessionId}/geofence`, {
        method: "GET",
      });
    } catch {
      return null;
    }
  },

  async configureGeofence(sessionId: string, payload: GeofenceConfigRequest): Promise<GeofenceDto> {
    return apiRequest<GeofenceDto>(`/schedules/sessions/${sessionId}/geofence`, {
      method: "PUT",
      body: payload,
    });
  },

  async closeSession(
    sessionId: string,
  ): Promise<{ sessionId: string; status: SessionStatus; generatedAbsencesCount: number }> {
    return apiRequest(`/schedules/sessions/${sessionId}/close`, {
      method: "POST",
    });
  },

  async deleteSession(sessionId: string): Promise<void> {
    return apiRequest<void>(`/schedules/sessions/${sessionId}/delete`.replace("/delete", ""), {
      method: "DELETE",
    });
  },

  async listExemptions(): Promise<ExemptionDto[]> {
    return apiRequest<ExemptionDto[]>("/schedules/exemptions", { method: "GET" });
  },

  async createExemption(payload: CreateExemptionRequest): Promise<ExemptionDto> {
    return apiRequest<ExemptionDto>("/schedules/exemptions", {
      method: "POST",
      body: payload,
    });
  },
};
