// Tipe data domain & DTO sesuai kontrak Java Backend Spring Boot (id.ac.unklab.asrama.*)

export type UserRole = "PENGHUNI" | "MONITOR" | "ADMIN" | "VILLAGE_DEAN";
export type ResidentStatus = "AKTIF" | "NONAKTIF";
export type ResidenceCategory = "ASRAMA" | "LUAR_DEKAT" | "LUAR_JAUH";
export type EnrollmentStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type FacePose = "LURUS" | "KIRI" | "KANAN" | "ATAS" | "BAWAH";
export type ScheduleKind = "ONE_TIME" | "RECURRING";
export type ScheduleStatus = "ACTIVE" | "INACTIVE" | "CANCELLED";
export type SessionStatus = "OPEN" | "CLOSED" | "CANCELLED";
export type AttendanceStatus = "HADIR" | "TIDAK_HADIR";
export type AttendanceMethod = "SCAN" | "MANUAL" | "DIBANTU_PENJAGA";
export type ValidationResult = "SUCCESS" | "REJECTED";
export type ViolationStatus = "ACTIVE" | "VOID";
export type ViolationSource = "AUTO" | "MANUAL";
export type RequestType = "PERMINTAAN_BANTUAN" | "LAPORAN_TINDAK_LANJUT";
export type CaseStatus = "BARU" | "DIPROSES" | "SELESAI" | "DITUTUP";

export interface ApiEnvelope<T> {
  success: boolean;
  code: string;
  message: string;
  data: T;
  metadata?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
  timestamp: string;
}

// 01. AuthDtos
export interface RegisterResidentRequest {
  nim: string;
  fullName: string;
  password: string;
  email?: string;
}

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UserSessionDto {
  userId: string;
  username: string;
  email: string | null;
  role: UserRole;
  residentId: string | null;
  residentStatus: ResidentStatus | null;
  isActive: boolean;
}

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresInSeconds: number;
  user: UserSessionDto;
}

// 02. ResidentDtos
export interface ResidentProfileDto {
  id: string;
  nim: string;
  fullName: string;
  status: ResidentStatus;
  residenceCategory: ResidenceCategory;
  building: string | null;
  roomNumber: string | null;
  hasActiveFaceProfile: boolean;
  faceEnrolledAt: string | null;
  hasActiveConsent: boolean;
  activeConsentVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentRequest {
  consentVersion: string;
  evidencePath?: string;
}

export interface ConsentDto {
  id: string;
  residentId: string;
  consentVersion: string;
  consentedAt: string;
  revokedAt: string | null;
  evidencePath: string | null;
}

export interface EmergencyContactRequest {
  fullName: string;
  relationship: string;
  phone: string;
  isPrimary: boolean;
}

export interface EmergencyContactDto {
  id: string;
  residentId: string;
  fullName: string;
  relationship: string;
  phone: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

// 03. EnrollmentDtos
export interface StartEnrollmentRequest {
  residentId?: string | null;
  consentId?: string | null;
}

export interface EnrollmentPhotoDto {
  id: string;
  enrollmentId: string;
  pose: FacePose;
  bucketId: string;
  storagePath: string;
  qualityScore: number | null;
  livenessScore: number | null;
  qualityPassed: boolean;
  livenessPassed: boolean;
  rejectionReason: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
}

export interface EnrollmentDetailDto {
  id: string;
  residentId: string;
  status: EnrollmentStatus;
  modelVersion: string | null;
  failureReason: string | null;
  consentId: string | null;
  startedAt: string;
  completedAt: string | null;
  supersededAt: string | null;
  validPoseCount: number;
  photos: EnrollmentPhotoDto[];
}

export interface PoseUploadResponse {
  enrollmentId: string;
  pose: FacePose;
  accepted: boolean;
  qualityScore: number;
  qualityPassed: boolean;
  livenessScore: number;
  livenessPassed: boolean;
  rejectionReason: string | null;
  totalValidPoses: number;
  readyToComplete: boolean;
  latencyMs: number;
}

export interface CompleteEnrollmentResponse {
  enrollmentId: string;
  residentId: string;
  status: EnrollmentStatus;
  modelVersion: string;
  promotedToActiveProfile: boolean;
  completedAt: string;
  latencyMs: number;
}

export interface ActiveFaceProfileMetadataDto {
  id: string;
  residentId: string;
  modelVersion: string;
  sourceEnrollmentId: string;
  enrolledAt: string;
  updatedAt: string;
}

// 04. ScheduleDtos
export interface ActivityTypeDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface CreateScheduleRequest {
  name: string;
  activityTypeId?: string | null;
  scheduleKind: ScheduleKind;
  startsAt?: string | null;
  endsAt?: string | null;
  repeatDays?: number[] | null;
  startTime?: string | null;
  endTime?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  description?: string | null;
}

export interface UpdateScheduleRequest {
  name: string;
  activityTypeId?: string | null;
  scheduleKind: ScheduleKind;
  startsAt?: string | null;
  endsAt?: string | null;
  repeatDays?: number[] | null;
  startTime?: string | null;
  endTime?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  status?: ScheduleStatus | null;
  description?: string | null;
}

export interface ScheduleDto {
  id: string;
  name: string;
  activityTypeId: string | null;
  activityTypeCode: string | null;
  activityTypeName: string | null;
  scheduleKind: ScheduleKind;
  startsAt: string | null;
  endsAt: string | null;
  repeatDays: number[] | null;
  startTime: string | null;
  endTime: string | null;
  validFrom: string | null;
  validTo: string | null;
  status: ScheduleStatus;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRequest {
  scheduleId: string;
  startsAt: string;
  endsAt: string;
}

export interface MaterializeSessionsRequest {
  fromDate: string;
  toDate: string;
}

export interface GeofenceConfigRequest {
  locationName?: string;
  isEnabled: boolean;
  latitude: number;
  longitude: number;
  radiusM: number;
  maxAccuracyM?: number | null;
}

export interface GeofenceDto {
  id: string;
  sessionId: string;
  locationName: string | null;
  isEnabled: boolean;
  latitude: number;
  longitude: number;
  radiusM: number;
  maxAccuracyM: number | null;
}

export interface SessionDto {
  id: string;
  scheduleId: string;
  scheduleName: string;
  activityTypeCode: string | null;
  startsAt: string;
  endsAt: string;
  status: SessionStatus;
  createdBy: string | null;
  closedAt: string | null;
  geofence: GeofenceDto | null;
  isGeoEnabled?: boolean | null;
  geoLatitude?: number | null;
  geoLongitude?: number | null;
  geoRadiusMeters?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExemptionRequest {
  title: string;
  startsOn: string;
  endsOn: string;
  residenceCategory?: ResidenceCategory | null;
  activityTypeId?: string | null;
  residentId?: string | null;
  reason: string;
}

export interface ExemptionDto {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string;
  residenceCategory: ResidenceCategory | null;
  activityTypeId: string | null;
  residentId: string | null;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ScheduleHistoryEntryDto {
  id: string;
  scheduleId: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  oldDataJson: string | null;
  newDataJson: string | null;
  description: string | null;
  createdAt: string;
}

// 05. AttendanceDtos
export interface ManualAttendanceRequest {
  sessionId: string;
  residentId: string;
  status: AttendanceStatus;
  reason: string;
}

export interface CorrectAttendanceRequest {
  status: AttendanceStatus;
  correctionReason: string;
}

export interface AttendanceRecordDto {
  id: string;
  sessionId: string;
  residentId: string | null;
  residentNim: string;
  residentName: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
  reason: string | null;
  recordedBy: string | null;
  recordedByUsername: string | null;
  faceMatch: boolean | null;
  livenessPassed: boolean | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  distanceM: number | null;
  locationValid: boolean | null;
  correctedBy: string | null;
  correctionReason: string | null;
  correctedAt: string | null;
  recordedAt: string;
}

export interface AttendanceScanResultResponse {
  recordId: string;
  sessionId: string;
  residentId: string;
  residentNim: string;
  residentName: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
  faceMatch: boolean;
  similarityScore: number;
  livenessPassed: boolean;
  livenessScore: number;
  locationValid: boolean | null;
  distanceM: number | null;
  distanceMeters?: number | null;
  recordedAt: string;
  stageLatenciesMs: Record<string, number> | null;
}

export interface SessionRecapDto {
  sessionId: string;
  scheduleName: string;
  startsAt: string;
  endsAt: string;
  totalRequiredResidents: number;
  totalHadir: number;
  totalTidakHadir: number;
  totalBelumPresensi: number;
  scanCount: number;
  guardAssistedCount: number;
  manualCount: number;
  records: AttendanceRecordDto[];
}

export interface SessionRecapSummaryItem {
  sessionId: string;
  scheduleName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  hadirCount: number;
  tidakHadirCount: number;
}

export interface DashboardStatsDto {
  totalActiveResidents: number;
  totalEnrolledFaces: number;
  totalOpenSessions: number;
  todayTotalHadir: number;
  todayTotalTidakHadir: number;
  overallAttendanceRatePercent: number;
  recentSessions: SessionRecapSummaryItem[];
}

export interface AiStatusDto {
  available: boolean;
  healthy: boolean;
  service: string;
  status: string;
}

// 06. AdminDtos
export interface CreateResidentRequest {
  nim: string;
  fullName: string;
  status?: ResidentStatus;
  residenceCategory?: ResidenceCategory;
  building?: string;
  roomNumber?: string;
}

export interface UpdateResidentRequest {
  nim: string;
  fullName: string;
  status: ResidentStatus;
  residenceCategory: ResidenceCategory;
  building?: string;
  roomNumber?: string;
}

export interface CsvRowValidationError {
  rowNumber: number;
  nim: string | null;
  errorMessage: string;
}

export interface CsvImportSummaryDto {
  totalRowsProcessed: number;
  insertedCount: number;
  updatedCount: number;
  rejectedCount: number;
  errors: CsvRowValidationError[];
}

export interface CreateStaffUserRequest {
  username: string;
  email?: string;
  password: string;
  role: UserRole;
}

export interface UserAccountDto {
  id: string;
  residentId: string | null;
  residentNim: string | null;
  residentName: string | null;
  username: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// 07. Violation & HelpRequestDtos
export interface CreateHelpRequestDto {
  residentId?: string | null;
  requestType: RequestType;
  subject: string;
  description: string;
}

export interface UpdateHelpRequestStatusDto {
  status: CaseStatus;
  note?: string;
}

export interface HelpRequestDto {
  id: string;
  residentId: string | null;
  residentNim: string | null;
  residentName: string | null;
  requestType: RequestType;
  subject: string;
  description: string;
  status: CaseStatus;
  handledBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HelpRequestUpdateHistoryDto {
  id: string;
  requestId: string;
  oldStatus: CaseStatus | null;
  newStatus: CaseStatus;
  note: string | null;
  updatedBy: string | null;
  createdAt: string;
}

// 08. ReportDtos
export interface AttendanceReportRowDto {
  recordId: string;
  sessionId: string;
  scheduleName: string;
  activityCode: string | null;
  sessionStartsAt: string;
  sessionEndsAt: string;
  residentId: string | null;
  residentNim: string;
  residentName: string;
  residenceCategory: string | null;
  building: string | null;
  roomNumber: string | null;
  status: AttendanceStatus;
  method: AttendanceMethod;
  reason: string | null;
  recordedBy: string | null;
  recordedByUsername: string | null;
  faceMatch: boolean | null;
  livenessPassed: boolean | null;
  locationValid: boolean | null;
  distanceM: number | null;
  distanceMeters?: number | null;
  isGeoEnabled?: boolean | null;
  userLatitude?: number | null;
  userLongitude?: number | null;
  userAccuracyM?: number | null;
  sessionLatitude?: number | null;
  sessionLongitude?: number | null;
  sessionRadiusM?: number | null;
  correctionReason: string | null;
  recordedAt: string;
}

export interface PeriodRecapReportDto {
  from: string;
  to: string;
  totalRecords: number;
  hadirCount: number;
  tidakHadirCount: number;
  scanCount: number;
  guardAssistedCount: number;
  manualCount: number;
  rows: AttendanceReportRowDto[];
}

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  oldDataJson: string | null;
  newDataJson: string | null;
  description: string | null;
  createdAt: string;
}

export interface ValidationLogDto {
  id: string;
  sessionId: string | null;
  residentId: string | null;
  residentNim: string | null;
  residentName: string | null;
  method: AttendanceMethod | null;
  result: ValidationResult;
  faceScore: number | null;
  livenessScore: number | null;
  faceMatch: boolean | null;
  livenessPassed: boolean | null;
  locationValid: boolean | null;
  distanceM: number | null;
  accuracyM: number | null;
  locationReason: string | null;
  rejectionReason: string | null;
  attemptedAt: string;
}

export interface AttendanceRecordHistoryDto {
  id: string;
  recordId: string;
  oldStatus: AttendanceStatus | null;
  newStatus: AttendanceStatus;
  oldMethod: AttendanceMethod | null;
  newMethod: AttendanceMethod;
  oldReason: string | null;
  newReason: string | null;
  changedBy: string | null;
  changedByUsername: string | null;
  correctionReason: string | null;
  changedAt: string;
}
