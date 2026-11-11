import { apiRequest, isApiError } from "./client";
import type {
  ActiveFaceProfileMetadataDto,
  CompleteEnrollmentResponse,
  ConsentDto,
  ConsentRequest,
  EnrollmentDetailDto,
  FacePose,
  PoseUploadResponse,
  StartEnrollmentRequest,
} from "./types";

export const enrollmentApi = {
  async getMyConsents(): Promise<ConsentDto[]> {
    return apiRequest<ConsentDto[]>("/enrollments/consent", { method: "GET" });
  },

  async giveMyConsent(payload: ConsentRequest): Promise<ConsentDto> {
    return apiRequest<ConsentDto>("/enrollments/consent", {
      method: "POST",
      body: payload,
    });
  },

  async getMyStatus(): Promise<ActiveFaceProfileMetadataDto | null> {
    try {
      return await apiRequest<ActiveFaceProfileMetadataDto>("/enrollments/status", {
        method: "GET",
      });
    } catch (err) {
      if (isApiError(err) && (err.status === 404 || err.code === "FACE_PROFILE_NOT_FOUND")) {
        return null;
      }
      throw err;
    }
  },

  async getActiveProfileMetadata(residentId: string): Promise<ActiveFaceProfileMetadataDto | null> {
    try {
      return await apiRequest<ActiveFaceProfileMetadataDto>(
        `/enrollments/residents/${residentId}/active-profile`,
        { method: "GET" },
      );
    } catch (err) {
      if (isApiError(err) && (err.status === 404 || err.code === "FACE_PROFILE_NOT_FOUND")) {
        return null;
      }
      throw err;
    }
  },

  async start(payload: StartEnrollmentRequest = {}): Promise<EnrollmentDetailDto> {
    return apiRequest<EnrollmentDetailDto>("/enrollments/start", {
      method: "POST",
      body: payload,
    });
  },

  async uploadPose(
    enrollmentId: string,
    pose: FacePose,
    photoBlob: Blob,
    filename = `pose-${pose.toLowerCase()}.jpg`,
  ): Promise<PoseUploadResponse> {
    const form = new FormData();
    form.append("file", photoBlob, filename);
    return apiRequest<PoseUploadResponse>(`/enrollments/${enrollmentId}/poses/${pose}`, {
      method: "POST",
      body: form,
    });
  },

  async complete(enrollmentId: string): Promise<CompleteEnrollmentResponse> {
    return apiRequest<CompleteEnrollmentResponse>(`/enrollments/${enrollmentId}/complete`, {
      method: "POST",
    });
  },

  async getDetail(enrollmentId: string): Promise<EnrollmentDetailDto> {
    return apiRequest<EnrollmentDetailDto>(`/enrollments/${enrollmentId}`, {
      method: "GET",
    });
  },
};
