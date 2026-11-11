package id.ac.unklab.asrama;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import id.ac.unklab.asrama.admin.AdminDtos.CsvImportSummaryDto;
import id.ac.unklab.asrama.admin.AdminRepository;
import id.ac.unklab.asrama.admin.AdminService;
import id.ac.unklab.asrama.ai.AiDtos.*;
import id.ac.unklab.asrama.ai.FastApiAiClient;
import id.ac.unklab.asrama.attendance.AttendanceDtos.*;
import id.ac.unklab.asrama.attendance.AttendanceRepository;
import id.ac.unklab.asrama.attendance.AttendanceService;
import id.ac.unklab.asrama.auth.AuthDtos.*;
import id.ac.unklab.asrama.auth.AuthRepository;
import id.ac.unklab.asrama.auth.AuthService;
import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.*;
import id.ac.unklab.asrama.config.AppProperties;
import id.ac.unklab.asrama.enrollment.EnrollmentDtos.*;
import id.ac.unklab.asrama.enrollment.EnrollmentRepository;
import id.ac.unklab.asrama.enrollment.EnrollmentService;
import id.ac.unklab.asrama.report.ReportDtos.AttendanceReportRowDto;
import id.ac.unklab.asrama.report.ReportRepository;
import id.ac.unklab.asrama.report.ReportService;
import id.ac.unklab.asrama.resident.ResidentDtos.ConsentDto;
import id.ac.unklab.asrama.resident.ResidentDtos.ResidentProfileDto;
import id.ac.unklab.asrama.resident.ResidentRepository;
import id.ac.unklab.asrama.schedule.ScheduleDtos.*;
import id.ac.unklab.asrama.schedule.ScheduleRepository;
import id.ac.unklab.asrama.schedule.ScheduleService;
import id.ac.unklab.asrama.security.AppPrincipal;
import id.ac.unklab.asrama.security.JwtTokenService;
import id.ac.unklab.asrama.security.RlsContextManager;
import id.ac.unklab.asrama.security.SecurityUtils;
import id.ac.unklab.asrama.storage.SupabaseStorageService;
import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class BackendRequirementsSuiteTest {

    private AppProperties appProperties;
    private JwtTokenService jwtTokenService;
    private PasswordEncoder passwordEncoder;
    private SecurityUtils securityUtils;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        appProperties = new AppProperties(
                "Asia/Makassar",
                new AppProperties.RlsProperties(true),
                new AppProperties.JwtProperties(
                        "TestSecretKeyAtLeast32BytesLongForAsramaPresensiJwt2026!",
                        "asrama-presensi-backend",
                        900_000L,
                        604_800_000L
                ),
                new AppProperties.CorsProperties(List.of("http://localhost:5173")),
                new AppProperties.RateLimitProperties(20, 30),
                new AppProperties.FaceProperties(0.65, 0.70, 0.70, 0.65, "ArcFace-r100", 90),
                new AppProperties.AiProperties("http://localhost:8000", "test-ai-key", 1000, 2200),
                new AppProperties.StorageProperties("https://tjgttljfdlcwxbregzqs.supabase.co", "CHANGE_ME", "face-enrollments", 120)
        );
        jwtTokenService = new JwtTokenService(appProperties);
        passwordEncoder = new BCryptPasswordEncoder(10);
        securityUtils = new SecurityUtils();
        objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        if (TransactionSynchronizationManager.hasResource("ASRAMA_RLS_CONTEXT_APPLIED")) {
            TransactionSynchronizationManager.unbindResource("ASRAMA_RLS_CONTEXT_APPLIED");
        }
        TransactionSynchronizationManager.setActualTransactionActive(false);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    private void authenticateAs(UUID userId, String username, UserRole role, UUID residentId) {
        AppPrincipal principal = new AppPrincipal(userId, username, role, residentId, UUID.randomUUID().toString());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities())
        );
    }

    private static final byte[] VALID_JPEG_BYTES = new byte[]{
            (byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01
    };

    private List<Double> dummyEmbedding512(double firstVal) {
        List<Double> list = new ArrayList<>(512);
        list.add(firstVal);
        for (int i = 1; i < 512; i++) {
            list.add(0.0);
        }
        return list;
    }

    @Test
    @DisplayName("1. JWT Generation, Validation, Refresh & Logout Revocation")
    void testJwtLifecycleAndRevocation() {
        UUID userId = UUID.randomUUID();
        UUID residentId = UUID.randomUUID();

        String accessToken = jwtTokenService.generateAccessToken(userId, "10502211001", UserRole.PENGHUNI, residentId);
        Claims claims = jwtTokenService.parseAndValidateToken(accessToken, "ACCESS");
        AppPrincipal principal = jwtTokenService.toPrincipal(claims);

        assertThat(principal.userId()).isEqualTo(userId);
        assertThat(principal.role()).isEqualTo(UserRole.PENGHUNI);
        assertThat(principal.residentId()).isEqualTo(residentId);

        // Revoke token on logout
        jwtTokenService.revokeToken(claims.getId(), claims.getExpiration().toInstant());
        assertThatThrownBy(() -> jwtTokenService.parseAndValidateToken(accessToken, "ACCESS"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("dicabut");
    }

    @Test
    @DisplayName("2. RlsContextManager Transaction-Scoped SET LOCAL ROLE app_backend & set_app_context()")
    void testRlsContextManagerTransactionScoping() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForObject(anyString(), eq(String.class), any(), any())).thenReturn("{}");
        RlsContextManager rlsManager = new RlsContextManager(jdbcTemplate, appProperties, objectMapper);

        UUID userId = UUID.randomUUID();
        UUID residentId = UUID.randomUUID();
        authenticateAs(userId, "10502211001", UserRole.PENGHUNI, residentId);

        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);

        rlsManager.ensureRlsContextForCurrentTransaction();
        // Second call in same transaction should be a no-op (bound resource)
        rlsManager.ensureRlsContextForCurrentTransaction();

        verify(jdbcTemplate, times(1)).execute("SET LOCAL ROLE app_backend");
        verify(jdbcTemplate, times(1)).queryForObject(
                eq("SELECT public.set_app_context(?::uuid, ?::jsonb)::text"),
                eq(String.class),
                eq(userId.toString()),
                contains("\"role\":\"PENGHUNI\"")
        );
    }

    @Test
    @DisplayName("3. AuthService: Registration (P-01) and 5x Failed Login Lockout for 5 Minutes (A-01, A-04)")
    void testAuthRegistrationAndFiveFailedAttemptsLockout() {
        AuthRepository authRepo = mock(AuthRepository.class);
        AuthService authService = new AuthService(authRepo, passwordEncoder, jwtTokenService, securityUtils);

        UUID userId = UUID.randomUUID();
        UUID residentId = UUID.randomUUID();
        String correctHash = passwordEncoder.encode("SecretPass123!");

        UserLoginLookupRow activeRow = new UserLoginLookupRow(
                userId, "10502211001", "res@unklab.ac.id", correctHash,
                UserRole.PENGHUNI, residentId, ResidentStatus.AKTIF,
                true, 4, null, false
        );
        when(authRepo.findUserForLogin("10502211001")).thenReturn(Optional.of(activeRow));
        OffsetDateTime lockUntil = OffsetDateTime.now().plusMinutes(5);
        when(authRepo.registerLoginFailure(userId)).thenReturn(lockUntil);

        // 5th wrong password triggers 423 LOCKED
        assertThatThrownBy(() -> authService.login(new LoginRequest("10502211001", "WrongPassword")))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getStatus()).isEqualTo(HttpStatus.LOCKED);
                    assertThat(be.getErrorCode()).isEqualTo("ACCOUNT_LOCKED");
                });

        // Correct password succeeds and resets failure count
        AuthTokenResponse loginOk = authService.login(new LoginRequest("10502211001", "SecretPass123!"));
        assertThat(loginOk.accessToken()).isNotBlank();
        assertThat(loginOk.user().role()).isEqualTo(UserRole.PENGHUNI);
        verify(authRepo).registerLoginSuccess(userId);
    }

    @Test
    @DisplayName("4. Ownership Protection: PENGHUNI Cannot Access Another Resident's Data")
    void testResidentOwnershipIsolation() {
        UUID myResidentId = UUID.randomUUID();
        UUID otherResidentId = UUID.randomUUID();
        authenticateAs(UUID.randomUUID(), "10502211001", UserRole.PENGHUNI, myResidentId);

        assertThatCode(() -> securityUtils.assertResidentOwnershipOrStaff(myResidentId))
                .doesNotThrowAnyException();

        assertThatThrownBy(() -> securityUtils.assertResidentOwnershipOrStaff(otherResidentId))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getStatus()).isEqualTo(HttpStatus.FORBIDDEN));
    }

    @Test
    @DisplayName("5. Enrollment 5 Poses, Liveness/PAD, Duplicate Face Detection (S-05) & Atomic Promotion (P-02..P-10)")
    void testEnrollmentFlowAndDuplicateFaceRejection() {
        EnrollmentRepository enrollmentRepo = mock(EnrollmentRepository.class);
        ResidentRepository residentRepo = mock(ResidentRepository.class);
        RestClient storageClient = mock(RestClient.class);
        SupabaseStorageService storageService = new SupabaseStorageService(storageClient, appProperties);
        FastApiAiClient aiClient = mock(FastApiAiClient.class);

        EnrollmentService enrollmentService = new EnrollmentService(
                enrollmentRepo, residentRepo, storageService, aiClient, appProperties, securityUtils
        );

        UUID residentId = UUID.randomUUID();
        UUID enrollmentId = UUID.randomUUID();
        UUID consentId = UUID.randomUUID();
        authenticateAs(UUID.randomUUID(), "10502211001", UserRole.PENGHUNI, residentId);

        EnrollmentDetailDto pendingDetail = new EnrollmentDetailDto(
                enrollmentId, residentId, EnrollmentStatus.PENDING, null, null,
                consentId, OffsetDateTime.now(), null, null, 0, List.of()
        );
        when(enrollmentRepo.findEnrollmentById(enrollmentId)).thenReturn(Optional.of(pendingDetail));

        // Upload 1 pose (LURUS) -> AI passes quality & liveness
        when(aiClient.validateEnrollmentPose(any())).thenReturn(new AiPoseCheckResponse(
                true, 1, true, FacePose.LURUS, 0.92, true, 0.95, true, Map.of("sharpness", 0.9), null, 120L
        ));
        when(enrollmentRepo.countValidPoses(enrollmentId)).thenReturn(1);

        MockMultipartFile jpegFile = new MockMultipartFile(
                "file", "front.jpg", "image/jpeg", VALID_JPEG_BYTES
        );
        PoseUploadResponse poseResp = enrollmentService.uploadAndValidatePose(enrollmentId, FacePose.LURUS, jpegFile);
        assertThat(poseResp.accepted()).isTrue();
        assertThat(poseResp.qualityPassed()).isTrue();
        assertThat(poseResp.livenessPassed()).isTrue();

        // Try completing when only 4 poses valid -> rejected
        when(enrollmentRepo.countValidPoses(enrollmentId)).thenReturn(4);
        assertThatThrownBy(() -> enrollmentService.completeAndActivateEnrollment(enrollmentId))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("5 pose wajah");

        // Now 5 poses valid, test S-05 duplicate face detection -> rejected with 409 CONFLICT "Wajah sudah terdaftar"
        when(enrollmentRepo.countValidPoses(enrollmentId)).thenReturn(5);
        when(aiClient.extractEnrollmentEmbedding(any())).thenReturn(new AiEnrollmentEmbeddingResponse(
                true, dummyEmbedding512(1.0), "ArcFace-r100", Map.of("avgQuality", 0.91), null, 210L
        ));
        when(enrollmentRepo.findSimilarFaces(anyString(), anyDouble(), eq(residentId), eq(1)))
                .thenReturn(List.of(new SimilarFaceMatchDto(UUID.randomUUID(), 0.88)));

        assertThatThrownBy(() -> enrollmentService.completeAndActivateEnrollment(enrollmentId))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(be.getMessage()).isEqualTo("Wajah sudah terdaftar");
                });

        // No duplicate -> completes and calls promoteEnrollment atomically
        when(enrollmentRepo.findSimilarFaces(anyString(), anyDouble(), eq(residentId), eq(1)))
                .thenReturn(List.of());
        EnrollmentDetailDto completedDetail = new EnrollmentDetailDto(
                enrollmentId, residentId, EnrollmentStatus.COMPLETED, "ArcFace-r100", null,
                consentId, OffsetDateTime.now(), OffsetDateTime.now(), null, 5, List.of()
        );
        when(enrollmentRepo.findEnrollmentById(enrollmentId))
                .thenReturn(Optional.of(pendingDetail))
                .thenReturn(Optional.of(completedDetail));

        CompleteEnrollmentResponse completeResp = enrollmentService.completeAndActivateEnrollment(enrollmentId);
        assertThat(completeResp.promotedToActiveProfile()).isTrue();
        assertThat(completeResp.status()).isEqualTo(EnrollmentStatus.COMPLETED);
        verify(enrollmentRepo).promoteEnrollment(enrollmentId, 90);
    }

    @Test
    @DisplayName("6. Attendance Scan: Liveness First, Guard-Assisted Selected Resident Match (J-05), Manual Reason (J-03) & Concurrency/Idempotency (P-09)")
    void testAttendanceScanGuardAssistedManualAndConcurrency() throws Exception {
        AttendanceRepository attendanceRepo = mock(AttendanceRepository.class);
        ResidentRepository residentRepo = mock(ResidentRepository.class);
        ScheduleRepository scheduleRepo = mock(ScheduleRepository.class);
        SupabaseStorageService storageService = new SupabaseStorageService(mock(RestClient.class), appProperties);
        FastApiAiClient aiClient = mock(FastApiAiClient.class);

        AttendanceService attendanceService = new AttendanceService(
                attendanceRepo, residentRepo, scheduleRepo, storageService, aiClient, appProperties, securityUtils
        );

        UUID sessionId = UUID.randomUUID();
        UUID residentId = UUID.randomUUID();
        UUID monitorUserId = UUID.randomUUID();
        authenticateAs(monitorUserId, "monitor1", UserRole.MONITOR, null);

        SessionDto openSession = new SessionDto(
                sessionId, UUID.randomUUID(), "Ibadah Malam", "IBADAH_RUTIN",
                OffsetDateTime.now().minusMinutes(10), OffsetDateTime.now().plusMinutes(20),
                SessionStatus.OPEN, monitorUserId, null, null, OffsetDateTime.now(), OffsetDateTime.now()
        );
        when(scheduleRepo.findSessionById(sessionId)).thenReturn(Optional.of(openSession));

        ResidentProfileDto activeResident = new ResidentProfileDto(
                residentId, "10502211009", "Mahasiswa Asrama", ResidentStatus.AKTIF,
                ResidenceCategory.ASRAMA, "Crystal", "201", true, OffsetDateTime.now(),
                true, "v1.0", OffsetDateTime.now(), OffsetDateTime.now()
        );
        when(residentRepo.findById(residentId)).thenReturn(Optional.of(activeResident));
        when(attendanceRepo.findBySessionAndResident(sessionId, residentId)).thenReturn(Optional.empty());
        when(attendanceRepo.hasSessionGeofenceConfigured(sessionId)).thenReturn(false);

        MockMultipartFile frameFile = new MockMultipartFile(
                "file", "scan.jpg", "image/jpeg", VALID_JPEG_BYTES
        );

        // Case A: Liveness fails -> must reject BEFORE face matching
        when(aiClient.analyzeAttendanceFrame(any())).thenReturn(new AiAttendanceScanResponse(
                true, 1, 0.35, false, 0.85, dummyEmbedding512(1.0), "ArcFace-r100", "Spoof attack detected", 90L
        ));
        assertThatThrownBy(() -> attendanceService.scanGuardAssistedAttendance(
                sessionId, residentId, "Kamera HP penghuni rusak", frameFile, null, null, null, null
        ))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("LIVENESS_FAILED"));
        verify(attendanceRepo, never()).computeFaceSimilarity(any(), anyString());

        // Case B: Guard-assisted scan where face does NOT match the selected resident (J-05) -> rejected
        when(aiClient.analyzeAttendanceFrame(any())).thenReturn(new AiAttendanceScanResponse(
                true, 1, 0.94, true, 0.90, dummyEmbedding512(1.0), "ArcFace-r100", null, 95L
        ));
        when(attendanceRepo.computeFaceSimilarity(eq(residentId), anyString())).thenReturn(0.42); // below 0.65

        assertThatThrownBy(() -> attendanceService.scanGuardAssistedAttendance(
                sessionId, residentId, "Dibantu penjaga", frameFile, null, null, null, null
        ))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getErrorCode()).isEqualTo("FACE_MISMATCH");
                    assertThat(be.getMessage()).contains("penghuni yang dipilih penjaga");
                });

        // Case C: Guard-assisted scan matches selected resident + Concurrent / Idempotent request
        UUID newRecordId = UUID.randomUUID();
        when(attendanceRepo.computeFaceSimilarity(eq(residentId), anyString())).thenReturn(0.89);
        when(attendanceRepo.insertAttendanceRecord(
                eq(sessionId), eq(residentId), anyString(), anyString(),
                eq(AttendanceStatus.HADIR), eq(AttendanceMethod.DIBANTU_PENJAGA),
                anyString(), eq(monitorUserId), eq(true), eq(true),
                any(), any(), any(), any(), any()
        )).thenReturn(newRecordId);
        when(attendanceRepo.findById(newRecordId)).thenReturn(Optional.of(new AttendanceRecordDto(
                newRecordId, sessionId, residentId, "10502211009", "Mahasiswa Asrama",
                AttendanceStatus.HADIR, AttendanceMethod.DIBANTU_PENJAGA, "Dibantu penjaga",
                monitorUserId, "monitor1", true, true, null, null, null, null, true,
                null, null, null, OffsetDateTime.now()
        )));

        AttendanceScanResultResponse scanOk = attendanceService.scanGuardAssistedAttendance(
                sessionId, residentId, "Dibantu penjaga", frameFile, null, null, null, "IDEMP-KEY-001"
        );
        assertThat(scanOk.faceMatch()).isTrue();
        assertThat(scanOk.method()).isEqualTo(AttendanceMethod.DIBANTU_PENJAGA);

        // Retry with same Idempotency-Key returns cached response without inserting duplicate row
        AttendanceScanResultResponse cachedRetry = attendanceService.scanGuardAssistedAttendance(
                sessionId, residentId, "Dibantu penjaga", frameFile, null, null, null, "IDEMP-KEY-001"
        );
        assertThat(cachedRetry.recordId()).isEqualTo(newRecordId);
        verify(attendanceRepo, times(1)).insertAttendanceRecord(
                any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        );

        // Case D: Manual attendance requires non-blank reason (J-03)
        assertThatThrownBy(() -> attendanceService.recordManualAttendance(
                new ManualAttendanceRequest(sessionId, residentId, AttendanceStatus.HADIR, "   ")
        ))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("REASON_REQUIRED"));
    }

    @Test
    @DisplayName("7. Schedule Validation (J-06) & Session Deletion Protection When Attendance Exists (K-05)")
    void testScheduleValidationAndSessionDeletionProtection() {
        ScheduleRepository scheduleRepo = mock(ScheduleRepository.class);
        ScheduleService scheduleService = new ScheduleService(scheduleRepo, securityUtils);

        UUID adminId = UUID.randomUUID();
        authenticateAs(adminId, "admin", UserRole.ADMIN, null);

        // Invalid time range: endsAt before startsAt
        OffsetDateTime now = OffsetDateTime.now();
        CreateScheduleRequest invalidOneTime = new CreateScheduleRequest(
                "Ibadah Sore", UUID.randomUUID(), ScheduleKind.ONE_TIME,
                now.plusHours(2), now.plusHours(1), null, null, null, null, null, null
        );
        assertThatThrownBy(() -> scheduleService.createSchedule(invalidOneTime))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("INVALID_SCHEDULE_TIME"));

        // Invalid recurring schedule: endTime before startTime
        CreateScheduleRequest invalidRecurring = new CreateScheduleRequest(
                "Ibadah Rutin Pagi", UUID.randomUUID(), ScheduleKind.RECURRING,
                null, null, List.of((short) 1, (short) 3),
                LocalTime.of(7, 0), LocalTime.of(6, 0),
                LocalDate.now(), LocalDate.now().plusMonths(1), null
        );
        assertThatThrownBy(() -> scheduleService.createSchedule(invalidRecurring))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("INVALID_SCHEDULE_TIME"));

        // K-05: Deleting session with existing attendance records is blocked with 409 CONFLICT
        UUID sessionId = UUID.randomUUID();
        when(scheduleRepo.findSessionById(sessionId)).thenReturn(Optional.of(new SessionDto(
                sessionId, UUID.randomUUID(), "Ibadah", "IBADAH_RUTIN",
                now.minusHours(2), now.minusHours(1), SessionStatus.CLOSED,
                adminId, now.minusHours(1), null, now, now
        )));
        when(scheduleRepo.countAttendanceRecordsForSession(sessionId)).thenReturn(12);

        assertThatThrownBy(() -> scheduleService.deleteOrCancelSession(sessionId))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(be.getErrorCode()).isEqualTo("SESSION_HAS_ATTENDANCE_RECORDS");
                });
        verify(scheduleRepo, never()).deleteSession(any());
    }

    @Test
    @DisplayName("8. CSV Import Validation Per Row (A-02) & CSV Report Export With Complete Columns (J-08)")
    void testCsvImportAndCsvExport() {
        AdminRepository adminRepo = mock(AdminRepository.class);
        ResidentRepository residentRepo = mock(ResidentRepository.class);
        EnrollmentRepository enrollmentRepo = mock(EnrollmentRepository.class);
        SupabaseStorageService storageService = new SupabaseStorageService(mock(RestClient.class), appProperties);
        AdminService adminService = new AdminService(adminRepo, residentRepo, enrollmentRepo, storageService, passwordEncoder);

        String csvInput = """
                nim,full_name,status,residence_category,building,room_number
                10502211001,Budi Santoso,AKTIF,ASRAMA,Crystal,101
                10502211002,Siti Aminah,AKTIF,LUAR_DEKAT,,
                BAD,Nama Terlalu Pendek NIM,AKTIF,ASRAMA,Crystal,102
                10502211001,Duplikat Di File,AKTIF,ASRAMA,Crystal,103
                10502211005,Kategori Salah,AKTIF,KATEGORI_ILEGAL,,
                """;
        MockMultipartFile csvFile = new MockMultipartFile(
                "file", "residents.csv", "text/csv", csvInput.getBytes(StandardCharsets.UTF_8)
        );

        when(residentRepo.findByNim(anyString())).thenReturn(Optional.empty());
        when(adminRepo.insertResident(anyString(), anyString(), any(), any(), any(), any()))
                .thenReturn(UUID.randomUUID());

        CsvImportSummaryDto importResult = adminService.importResidentsFromCsv(csvFile);
        assertThat(importResult.totalRowsProcessed()).isEqualTo(5);
        assertThat(importResult.insertedCount()).isEqualTo(2);
        assertThat(importResult.rejectedCount()).isEqualTo(3);
        assertThat(importResult.errors()).hasSize(3);

        // Test CSV Export (J-08)
        ReportRepository reportRepo = mock(ReportRepository.class);
        ReportService reportService = new ReportService(reportRepo);

        OffsetDateTime now = OffsetDateTime.now();
        when(reportRepo.queryAttendanceReportRows(any(), any(), any(), any())).thenReturn(List.of(
                new AttendanceReportRowDto(
                        UUID.randomUUID(), UUID.randomUUID(), "Ibadah Jumat Malam", "JUMAT_MALAM",
                        now.minusHours(1), now, UUID.randomUUID(), "10502211001", "Budi Santoso",
                        "ASRAMA", "Crystal", "101", AttendanceStatus.HADIR, AttendanceMethod.SCAN,
                        null, UUID.randomUUID(), "10502211001", true, true, true, 12.5,
                        true, 1.4170, 124.9830, 5.0, 1.4172, 124.9835, 50,
                        null, now.minusMinutes(45)
                )
        ));

        String exportedCsv = reportService.exportAttendanceReportCsv(null, null, null, null);
        assertThat(exportedCsv)
                .contains("record_id,session_id,schedule_name,activity_code,session_starts_at_wita")
                .contains("10502211001,Budi Santoso,ASRAMA,Crystal,101,HADIR,SCAN")
                .contains("WITA");
    }

    @Test
    @DisplayName("9. Concurrency Control on Simultaneous Attendance Scan Requests (P-09)")
    void testConcurrentDuplicateScanRequests() throws Exception {
        AttendanceRepository attendanceRepo = mock(AttendanceRepository.class);
        ResidentRepository residentRepo = mock(ResidentRepository.class);
        ScheduleRepository scheduleRepo = mock(ScheduleRepository.class);
        SupabaseStorageService storageService = new SupabaseStorageService(mock(RestClient.class), appProperties);
        FastApiAiClient aiClient = mock(FastApiAiClient.class);

        AttendanceService attendanceService = new AttendanceService(
                attendanceRepo, residentRepo, scheduleRepo, storageService, aiClient, appProperties, securityUtils
        );

        UUID sessionId = UUID.randomUUID();
        UUID residentId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        SessionDto openSession = new SessionDto(
                sessionId, UUID.randomUUID(), "Ibadah Pagi", "IBADAH_RUTIN",
                OffsetDateTime.now().minusMinutes(5), OffsetDateTime.now().plusMinutes(25),
                SessionStatus.OPEN, userId, null, null, OffsetDateTime.now(), OffsetDateTime.now()
        );
        when(scheduleRepo.findSessionById(sessionId)).thenReturn(Optional.of(openSession));
        when(residentRepo.findById(residentId)).thenReturn(Optional.of(new ResidentProfileDto(
                residentId, "10502211088", "Mahasiswa Uji Concurrency", ResidentStatus.AKTIF,
                ResidenceCategory.ASRAMA, "Crystal", "108", true, OffsetDateTime.now(),
                true, "v1.0", OffsetDateTime.now(), OffsetDateTime.now()
        )));
        when(attendanceRepo.hasSessionGeofenceConfigured(sessionId)).thenReturn(false);
        when(aiClient.analyzeAttendanceFrame(any())).thenReturn(new AiAttendanceScanResponse(
                true, 1, 0.96, true, 0.92, dummyEmbedding512(1.0), "ArcFace-r100", null, 80L
        ));
        when(attendanceRepo.computeFaceSimilarity(eq(residentId), anyString())).thenReturn(0.91);

        // Simulate PostgreSQL unique_resident_session constraint allowing only the first concurrent insert
        AtomicInteger insertCount = new AtomicInteger(0);
        UUID recordId = UUID.randomUUID();
        when(attendanceRepo.insertAttendanceRecord(
                any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        )).thenAnswer(inv -> {
            if (insertCount.incrementAndGet() == 1) {
                return recordId;
            }
            throw new org.springframework.dao.DuplicateKeyException("ERROR: duplicate key value violates unique constraint \"unique_resident_session\"");
        });
        when(attendanceRepo.findById(recordId)).thenReturn(Optional.of(new AttendanceRecordDto(
                recordId, sessionId, residentId, "10502211088", "Mahasiswa Uji Concurrency",
                AttendanceStatus.HADIR, AttendanceMethod.SCAN, null, userId, "10502211088",
                true, true, null, null, null, null, true, null, null, null, OffsetDateTime.now()
        )));

        MockMultipartFile frame = new MockMultipartFile("file", "f.jpg", "image/jpeg", VALID_JPEG_BYTES);
        int threads = 5;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch startLatch = new CountDownLatch(1);
        List<Future<Boolean>> futures = new ArrayList<>();

        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                authenticateAs(userId, "10502211088", UserRole.PENGHUNI, residentId);
                startLatch.await();
                try {
                    attendanceService.scanSelfAttendance(sessionId, frame, null, null, null, null);
                    return true;
                } catch (org.springframework.dao.DuplicateKeyException | BusinessException ex) {
                    return false;
                } finally {
                    SecurityContextHolder.clearContext();
                }
            }));
        }

        startLatch.countDown();
        int successCount = 0;
        int rejectedCount = 0;
        for (Future<Boolean> f : futures) {
            if (f.get(5, TimeUnit.SECONDS)) {
                successCount++;
            } else {
                rejectedCount++;
            }
        }
        pool.shutdown();

        assertThat(successCount).isEqualTo(1);
        assertThat(rejectedCount).isEqualTo(threads - 1);
    }

    @Test
    @DisplayName("10. Audit Fix: Anonymous Transaction SET LOCAL ROLE app_backend, Context Upgrade & REQUIRES_NEW Suspend/Resume")
    void testRlsAnonymousTransactionUpgradeAndSuspendResume() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForObject(anyString(), eq(String.class), any(), any())).thenReturn("{}");
        RlsContextManager rlsManager = new RlsContextManager(jdbcTemplate, appProperties, objectMapper);

        SecurityContextHolder.clearContext();
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);

        // 1. Unauthenticated transaction still executes SET LOCAL ROLE app_backend
        rlsManager.ensureRlsContextForCurrentTransaction();
        verify(jdbcTemplate, times(1)).execute("SET LOCAL ROLE app_backend");

        // 2. Upgrading context inside refreshToken applies set_app_context
        UUID userId = UUID.randomUUID();
        UUID residentId = UUID.randomUUID();
        rlsManager.applyUserContext(userId, UserRole.PENGHUNI, residentId);
        verify(jdbcTemplate, times(2)).execute("SET LOCAL ROLE app_backend");
        verify(jdbcTemplate, times(1)).queryForObject(
                eq("SELECT public.set_app_context(?::uuid, ?::jsonb)::text"),
                eq(String.class),
                eq(userId.toString()),
                contains("\"role\":\"PENGHUNI\"")
        );

        // 3. Simulate REQUIRES_NEW suspension and inner transaction
        TransactionSynchronizationManager.getSynchronizations().forEach(org.springframework.transaction.support.TransactionSynchronization::suspend);
        authenticateAs(userId, "10502211001", UserRole.PENGHUNI, residentId);
        rlsManager.ensureRlsContextForCurrentTransaction();
        verify(jdbcTemplate, times(3)).execute("SET LOCAL ROLE app_backend");
    }

    @Test
    @DisplayName("11. Audit Fix: Storage Magic-Byte Validation & Service-Role Ownership Enforcement")
    void testStorageMagicByteValidationAndOwnershipEnforcement() {
        SupabaseStorageService storageService = new SupabaseStorageService(mock(RestClient.class), appProperties, securityUtils);

        // Spoofed Content-Type image/jpeg with HTML/text payload is rejected
        byte[] spoofedBytes = "<html><script>alert(1)</script></html>".getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> storageService.validateImageFile(spoofedBytes, "image/jpeg"))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("INVALID_IMAGE_SIGNATURE"));

        // PENGHUNI attempting to upload to another resident's folder is blocked with 403 FORBIDDEN
        UUID myResidentId = UUID.randomUUID();
        UUID otherResidentId = UUID.randomUUID();
        UUID enrollmentId = UUID.randomUUID();
        authenticateAs(UUID.randomUUID(), "10502211001", UserRole.PENGHUNI, myResidentId);

        assertThatThrownBy(() -> storageService.uploadEnrollmentPhoto(
                otherResidentId, enrollmentId, FacePose.LURUS, VALID_JPEG_BYTES, "image/jpeg"
        ))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(be.getErrorCode()).isEqualTo("STORAGE_ACCESS_DENIED");
                });
    }

    @Test
    @DisplayName("12. Audit Fix: Negative Cosine Similarity Clamping [0, 1] & GPS Bounds Validation")
    void testNegativeCosineSimilarityClampingAndGpsValidation() {
        AttendanceRepository attendanceRepo = mock(AttendanceRepository.class);
        ResidentRepository residentRepo = mock(ResidentRepository.class);
        ScheduleRepository scheduleRepo = mock(ScheduleRepository.class);
        SupabaseStorageService storageService = new SupabaseStorageService(mock(RestClient.class), appProperties, securityUtils);
        FastApiAiClient aiClient = mock(FastApiAiClient.class);

        AttendanceService attendanceService = new AttendanceService(
                attendanceRepo, residentRepo, scheduleRepo, storageService, aiClient, appProperties, securityUtils
        );

        UUID sessionId = UUID.randomUUID();
        UUID residentId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        authenticateAs(userId, "10502211001", UserRole.PENGHUNI, residentId);

        when(scheduleRepo.findSessionById(sessionId)).thenReturn(Optional.of(new SessionDto(
                sessionId, UUID.randomUUID(), "Ibadah", "IBADAH_RUTIN",
                OffsetDateTime.now().minusMinutes(5), OffsetDateTime.now().plusMinutes(20),
                SessionStatus.OPEN, userId, null, null, OffsetDateTime.now(), OffsetDateTime.now()
        )));
        when(residentRepo.findById(residentId)).thenReturn(Optional.of(new ResidentProfileDto(
                residentId, "10502211001", "Mahasiswa", ResidentStatus.AKTIF,
                ResidenceCategory.ASRAMA, "Crystal", "101", true, OffsetDateTime.now(),
                true, "v1.0", OffsetDateTime.now(), OffsetDateTime.now()
        )));
        when(attendanceRepo.findBySessionAndResident(sessionId, residentId)).thenReturn(Optional.empty());
        when(attendanceRepo.hasSessionGeofenceConfigured(sessionId)).thenReturn(false);

        MockMultipartFile frame = new MockMultipartFile("file", "f.jpg", "image/jpeg", VALID_JPEG_BYTES);

        // Invalid GPS latitude (> 90) rejected before DB call
        assertThatThrownBy(() -> attendanceService.scanSelfAttendance(sessionId, frame, 95.5, 124.98, 10.0, null))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("INVALID_GPS_COORDINATES"));

        // Negative cosine similarity (-0.25) is clamped to 0.0 when logged in attendance_validation_logs
        when(aiClient.analyzeAttendanceFrame(any())).thenReturn(new AiAttendanceScanResponse(
                true, 1, 0.95, true, 0.90, dummyEmbedding512(-1.0), "ArcFace-r100", null, 85L
        ));
        when(attendanceRepo.computeFaceSimilarity(eq(residentId), anyString())).thenReturn(-0.25);

        assertThatThrownBy(() -> attendanceService.scanSelfAttendance(sessionId, frame, null, null, null, null))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("FACE_MISMATCH"));

        verify(attendanceRepo).insertValidationLog(
                eq(sessionId), eq(residentId), eq(AttendanceMethod.SCAN), eq(ValidationResult.REJECTED),
                eq(0.0), eq(0.95), eq(false), eq(true), anyBoolean(), any(), any(), any(), any(),
                anyString(), anyString()
        );
    }

    @Test
    @DisplayName("13. Audit Fix: CSV Formula Injection Protection & User Token Mass Revocation on Password Change")
    void testCsvFormulaInjectionAndUserTokenMassRevocation() {
        ReportRepository reportRepo = mock(ReportRepository.class);
        ReportService reportService = new ReportService(reportRepo);

        OffsetDateTime now = OffsetDateTime.now();
        when(reportRepo.queryAttendanceReportRows(any(), any(), any(), any())).thenReturn(List.of(
                new AttendanceReportRowDto(
                        UUID.randomUUID(), UUID.randomUUID(), "=CMD|' /C calc'!A0", "JUMAT_MALAM",
                        now.minusHours(1), now, UUID.randomUUID(), "10502211001", "+SUM(A1:A10)",
                        "ASRAMA", "-1+1", "@import", AttendanceStatus.HADIR, AttendanceMethod.MANUAL,
                        "=HYPERLINK(\"http://evil\")", UUID.randomUUID(), "monitor1", null, null, null, null,
                        false, null, null, null, null, null, null,
                        "@malicious", now
                )
        ));

        String csv = reportService.exportAttendanceReportCsv(null, null, null, null);
        assertThat(csv)
                .contains("'=CMD|' /C calc'!A0")
                .contains("'+SUM(A1:A10)")
                .contains("'-1+1")
                .contains("'@import")
                .contains("'=HYPERLINK(\"\"http://evil\"\")")
                .contains("'@malicious");

        // Mass revocation of all tokens for a user when password changes or account is deactivated
        UUID userId = UUID.randomUUID();
        String access1 = jwtTokenService.generateAccessToken(userId, "10502211001", UserRole.PENGHUNI, UUID.randomUUID());
        String refresh1 = jwtTokenService.generateRefreshToken(userId, "10502211001", UserRole.PENGHUNI, UUID.randomUUID());

        jwtTokenService.revokeAllUserTokens(userId);

        assertThatThrownBy(() -> jwtTokenService.parseAndValidateToken(access1, "ACCESS"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("dicabut");
        assertThatThrownBy(() -> jwtTokenService.parseAndValidateToken(refresh1, "REFRESH"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("dicabut");
    }

    @Test
    @DisplayName("14. Production Readiness: Account Deactivation Rejects Existing Access Tokens & AI Health Check")
    void testAccountDeactivationRejectsActiveTokensAndAiHealthCheck() {
        UUID userId = UUID.randomUUID();
        String validToken = jwtTokenService.generateAccessToken(userId, "10502211099", UserRole.PENGHUNI, UUID.randomUUID());

        // Token is initially valid
        Claims validClaims = jwtTokenService.parseAndValidateToken(validToken, "ACCESS");
        assertThat(validClaims.getSubject()).isEqualTo(userId.toString());

        // Administrator deactivates user account -> token immediately rejected
        jwtTokenService.setUserDisabled(userId, true);
        assertThatThrownBy(() -> jwtTokenService.parseAndValidateToken(validToken, "ACCESS"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("dinonaktifkan");

        // FastApiAiClient health check returns true on 2xx, false on exception
        RestClient restClient = mock(RestClient.class);
        FastApiAiClient aiClient = new FastApiAiClient(restClient);

        RestClient.RequestHeadersUriSpec uriSpec = mock(RestClient.RequestHeadersUriSpec.class);
        RestClient.ResponseSpec responseSpec = mock(RestClient.ResponseSpec.class);
        when(restClient.get()).thenReturn(uriSpec);
        when(uriSpec.uri("/health")).thenReturn(uriSpec);
        when(uriSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.toBodilessEntity()).thenReturn(org.springframework.http.ResponseEntity.ok().build());

        assertThat(aiClient.checkHealth()).isTrue();

        // When AI endpoint fails with connection error, returns false gracefully
        when(responseSpec.toBodilessEntity()).thenThrow(new org.springframework.web.client.ResourceAccessException("Connection refused"));
        assertThat(aiClient.checkHealth()).isFalse();
    }

    @Test
    @DisplayName("15. Security & Isolation: Direct Ownership Verification (assertResidentOwnershipOrStaff) Blocks Cross-Resident Access")
    void testDirectOwnershipVerificationBlocksCrossAccess() {
        UUID residentA = UUID.randomUUID();
        UUID residentB = UUID.randomUUID();

        // 1. PENGHUNI accessing their own resident data -> PASS
        AppPrincipal principalA = new AppPrincipal(UUID.randomUUID(), "penghuniA", UserRole.PENGHUNI, residentA, "jtiA");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principalA, null, List.of())
        );
        assertThatCode(() -> securityUtils.assertResidentOwnershipOrStaff(residentA))
                .doesNotThrowAnyException();

        // 2. PENGHUNI accessing another resident's data -> THROW FORBIDDEN_OWNERSHIP
        assertThatThrownBy(() -> securityUtils.assertResidentOwnershipOrStaff(residentB))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(be.getErrorCode()).isEqualTo("FORBIDDEN_OWNERSHIP");
                });

        // 3. MONITOR accessing any resident's data -> PASS
        AppPrincipal monitorPrincipal = new AppPrincipal(UUID.randomUUID(), "monitor01", UserRole.MONITOR, null, "jtiM");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(monitorPrincipal, null, List.of())
        );
        assertThatCode(() -> securityUtils.assertResidentOwnershipOrStaff(residentB))
                .doesNotThrowAnyException();

        // 4. ADMIN accessing any resident's data -> PASS
        AppPrincipal adminPrincipal = new AppPrincipal(UUID.randomUUID(), "admin01", UserRole.ADMIN, null, "jtiAdmin");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(adminPrincipal, null, List.of())
        );
        assertThatCode(() -> securityUtils.assertResidentOwnershipOrStaff(residentB))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("16. S-07: Storage Signed URL Generation & Access Control Verification")
    void testStorageSignedUrlGenerationAndAccessControl() {
        RestClient restClient = mock(RestClient.class);
        SupabaseStorageService storageService = new SupabaseStorageService(restClient, appProperties, securityUtils);

        UUID residentA = UUID.randomUUID();
        UUID residentB = UUID.randomUUID();
        UUID enrollmentId = UUID.randomUUID();
        String pathA = storageService.buildEnrollmentPhotoPath(residentA, enrollmentId, FacePose.LURUS);

        // 1. PENGHUNI accessing their own signed URL -> PASS
        AppPrincipal principalA = new AppPrincipal(UUID.randomUUID(), "penghuniA", UserRole.PENGHUNI, residentA, "jtiA");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principalA, null, List.of())
        );
        String signedUrl = storageService.createSignedUrl(residentA, pathA, 120);
        assertThat(signedUrl).contains("expiresIn=120");
        assertThat(signedUrl).contains(pathA);

        // 2. PENGHUNI accessing another resident's signed URL -> 403 STORAGE_ACCESS_DENIED
        assertThatThrownBy(() -> storageService.createSignedUrl(residentB, pathA, 120))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(be.getErrorCode()).isEqualTo("STORAGE_ACCESS_DENIED");
                });

        // 3. MONITOR accessing resident's signed URL for inspection -> PASS
        AppPrincipal monitorPrincipal = new AppPrincipal(UUID.randomUUID(), "monitor01", UserRole.MONITOR, null, "jtiM");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(monitorPrincipal, null, List.of())
        );
        String monitorSignedUrl = storageService.createSignedUrl(residentA, pathA, 60);
        assertThat(monitorSignedUrl).contains("expiresIn=60");

        // 4. ADMIN accessing resident's signed URL -> PASS
        AppPrincipal adminPrincipal = new AppPrincipal(UUID.randomUUID(), "admin01", UserRole.ADMIN, null, "jtiAdmin");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(adminPrincipal, null, List.of())
        );
        String adminSignedUrl = storageService.createSignedUrl(residentA, pathA, 0);
        assertThat(adminSignedUrl).contains("expiresIn=120");
    }

    @Test
    @DisplayName("16. Geofencing Verification (P-11, J-06, S-04, K-05, K-06, T-05, T-06)")
    void testGeofencingPipelineAndSessionIntegrity() {
        // 1. Verifikasi Haversine Distance di GeoUtils (K-06)
        // Koordinat UNKLAB Hall: 1.41720, 124.98350
        double unklabLat = 1.41720;
        double unklabLon = 124.98350;

        // Titik berjarak ~35 meter (dalam radius 50m)
        double insideLat = 1.41740;
        double insideLon = 124.98365;
        double distInside = id.ac.unklab.asrama.common.GeoUtils.haversineDistanceMeters(unklabLat, unklabLon, insideLat, insideLon);
        assertThat(distInside).isLessThan(50.0);

        // Titik berjarak ~180 meter (di luar radius 50m)
        double outsideLat = 1.41850;
        double outsideLon = 124.98450;
        double distOutside = id.ac.unklab.asrama.common.GeoUtils.haversineDistanceMeters(unklabLat, unklabLon, outsideLat, outsideLon);
        assertThat(distOutside).isGreaterThan(50.0);

        // 2. Verifikasi validasi akurasi GPS (K-06)
        assertThatThrownBy(() -> id.ac.unklab.asrama.common.GeoUtils.validateGps(unklabLat, unklabLon, 250.0, true))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("GPS_ACCURACY_TOO_LOW"));

        // 3. Verifikasi Proteksi Sesi Berisi Presensi (K-05): tidak boleh diubah titik geofencenya
        ScheduleRepository scheduleRepo = mock(ScheduleRepository.class);
        SecurityUtils secUtils = mock(SecurityUtils.class);
        ScheduleService scheduleService = new ScheduleService(scheduleRepo, secUtils);

        UUID sessionId = UUID.randomUUID();
        when(scheduleRepo.findSessionById(sessionId)).thenReturn(Optional.of(
                new SessionDto(sessionId, UUID.randomUUID(), "Ibadah", "IBADAH_RUTIN",
                        OffsetDateTime.now().minusMinutes(10), OffsetDateTime.now().plusMinutes(20),
                        SessionStatus.OPEN, UUID.randomUUID(), null, null, OffsetDateTime.now(), OffsetDateTime.now())
        ));
        when(scheduleRepo.countAttendanceRecordsForSession(sessionId)).thenReturn(5);

        GeofenceConfigRequest updateGeoReq = new GeofenceConfigRequest("Pusat Ibadah", true, unklabLat, unklabLon, 50, 15.0);
        assertThatThrownBy(() -> scheduleService.configureSessionGeofence(sessionId, updateGeoReq))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(be.getErrorCode()).isEqualTo("SESSION_HAS_ATTENDANCE_RECORDS");
                });

        // 4. Verifikasi Pipeline S-04: Geofence aktif & berada di luar radius ditolak SEBELUM AI dipanggil
        AttendanceRepository attRepo = mock(AttendanceRepository.class);
        ResidentRepository resRepo = mock(ResidentRepository.class);
        SupabaseStorageService storageService = mock(SupabaseStorageService.class);
        FastApiAiClient aiClient = mock(FastApiAiClient.class);

        AttendanceService attendanceService = new AttendanceService(
                attRepo, resRepo, scheduleRepo, storageService, aiClient, appProperties, secUtils
        );

        UUID residentId = UUID.randomUUID();
        SessionDto sessionWithGeofence = new SessionDto(
                sessionId, UUID.randomUUID(), "Ibadah Pagi", "IBADAH_RUTIN",
                OffsetDateTime.now().minusMinutes(5), OffsetDateTime.now().plusMinutes(25),
                SessionStatus.OPEN, UUID.randomUUID(), null,
                new GeofenceDto(UUID.randomUUID(), sessionId, "Hall", true, unklabLat, unklabLon, 50, 20.0),
                OffsetDateTime.now(), OffsetDateTime.now()
        );
        when(scheduleRepo.findSessionById(sessionId)).thenReturn(Optional.of(sessionWithGeofence));
        when(resRepo.findById(residentId)).thenReturn(Optional.of(new ResidentProfileDto(
                residentId, "10502211005", "Mahasiswa", ResidentStatus.AKTIF, ResidenceCategory.ASRAMA,
                "Edelweiss", "102", true, OffsetDateTime.now(), true, "v1", OffsetDateTime.now(), OffsetDateTime.now()
        )));
        when(attRepo.findBySessionAndResident(sessionId, residentId)).thenReturn(Optional.empty());
        when(attRepo.hasSessionGeofenceConfigured(sessionId)).thenReturn(true);

        MockMultipartFile dummyPhoto = new MockMultipartFile("file", "test.jpg", "image/jpeg", VALID_JPEG_BYTES);

        // Scan dengan lokasi di luar radius -> Ditolak OUTSIDE_GEOFENCE sebelum memanggil AI
        assertThatThrownBy(() -> attendanceService.scanGuardAssistedAttendance(
                sessionId, residentId, "Dibantu", dummyPhoto, outsideLat, outsideLon, 5.0, null
        ))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getErrorCode()).isEqualTo("OUTSIDE_GEOFENCE");
                    assertThat(be.getMessage()).contains("di luar radius presensi");
                });
        verify(aiClient, never()).analyzeAttendanceFrame(any());
    }
}
