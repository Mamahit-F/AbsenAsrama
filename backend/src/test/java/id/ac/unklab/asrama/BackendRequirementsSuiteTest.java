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

        // Perubahan 2 (J-06, K-05): Penjaga bebas menghapus sesi presensi kapan saja tanpa batasan
        UUID sessionId = UUID.randomUUID();
        when(scheduleRepo.findSessionById(sessionId)).thenReturn(Optional.of(new SessionDto(
                sessionId, UUID.randomUUID(), "Ibadah", "IBADAH_RUTIN",
                now.minusHours(2), now.minusHours(1), SessionStatus.CLOSED,
                adminId, now.minusHours(1), null, now, now
        )));

        // Even with records, delete succeeds without error (cascading in database)
        scheduleService.deleteOrCancelSession(sessionId);
        verify(scheduleRepo).deleteSession(sessionId);

        // Case D: Monitor cannot create overlapping or identical-time schedules in their Hall,
        // unless the conflicting schedule is removed first
        SecurityUtils monitorSec = mock(SecurityUtils.class);
        UUID monitorId = UUID.randomUUID();
        when(monitorSec.getCurrentUserId()).thenReturn(monitorId);
        when(monitorSec.hasRole("ROLE_MONITOR")).thenReturn(true);
        when(monitorSec.getCurrentHallName()).thenReturn("Hall A1");
        ScheduleService monitorScheduleService = new ScheduleService(scheduleRepo, monitorSec);

        UUID existingSchedId = UUID.randomUUID();
        LocalDate validFrom = LocalDate.now();
        LocalDate validTo = validFrom.plusDays(30);
        ScheduleDto existingMorning = new ScheduleDto(
                existingSchedId, "Apel Pagi", null, "IBADAH_RUTIN", "Ibadah Rutin",
                ScheduleKind.RECURRING, null, null,
                List.of((short) 1, (short) 2, (short) 3, (short) 4, (short) 5, (short) 6, (short) 7),
                LocalTime.of(10, 0), LocalTime.of(10, 5), validFrom, validTo,
                ScheduleStatus.ACTIVE, null, monitorId, now, now, "Hall A1"
        );
        when(scheduleRepo.findAllSchedules(ScheduleStatus.ACTIVE, "Hall A1"))
                .thenReturn(List.of(existingMorning));

        // 1) Exact same time (10:00 - 10:05) -> rejected
        CreateScheduleRequest sameTimeReq = new CreateScheduleRequest(
                "Apel Pagi Duplikat", null, ScheduleKind.RECURRING,
                null, null, List.of((short) 1),
                LocalTime.of(10, 0), LocalTime.of(10, 5), validFrom, validTo, null, "Hall A1"
        );
        assertThatThrownBy(() -> monitorScheduleService.createSchedule(sameTimeReq))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("SCHEDULE_OVERLAP"));

        // 2) Partial overlap (10:02 - 10:06) -> rejected
        CreateScheduleRequest tailOverlapReq = new CreateScheduleRequest(
                "Sesi Bertumpuk 1", null, ScheduleKind.RECURRING,
                null, null, List.of((short) 1),
                LocalTime.of(10, 2), LocalTime.of(10, 6), validFrom, validTo, null, "Hall A1"
        );
        assertThatThrownBy(() -> monitorScheduleService.createSchedule(tailOverlapReq))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("SCHEDULE_OVERLAP"));

        // 3) Enclosing overlap (09:59 - 10:10) -> rejected
        CreateScheduleRequest enclosingOverlapReq = new CreateScheduleRequest(
                "Sesi Bertumpuk 2", null, ScheduleKind.RECURRING,
                null, null, List.of((short) 1),
                LocalTime.of(9, 59), LocalTime.of(10, 10), validFrom, validTo, null, "Hall A1"
        );
        assertThatThrownBy(() -> monitorScheduleService.createSchedule(enclosingOverlapReq))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("SCHEDULE_OVERLAP"));

        // 4) Non-overlapping slot (10:06 - 10:15) -> allowed
        CreateScheduleRequest afterSlotReq = new CreateScheduleRequest(
                "Sesi Berikutnya", null, ScheduleKind.RECURRING,
                null, null, List.of((short) 1),
                LocalTime.of(10, 6), LocalTime.of(10, 15), validFrom, validTo, null, "Hall A1"
        );
        UUID createdAfterId = UUID.randomUUID();
        ScheduleDto createdAfterDto = new ScheduleDto(
                createdAfterId, "Sesi Berikutnya", null, "IBADAH_RUTIN", "Ibadah Rutin",
                ScheduleKind.RECURRING, null, null, List.of((short) 1),
                LocalTime.of(10, 6), LocalTime.of(10, 15), validFrom, validTo,
                ScheduleStatus.ACTIVE, null, monitorId, now, now, "Hall A1"
        );
        when(scheduleRepo.insertSchedule(any(), eq(monitorId))).thenReturn(createdAfterId);
        when(scheduleRepo.findScheduleById(createdAfterId)).thenReturn(Optional.of(createdAfterDto));
        assertThat(monitorScheduleService.createSchedule(afterSlotReq).id()).isEqualTo(createdAfterId);

        // 5) Once existing conflicting schedule is deleted, overlapping time can be added
        when(scheduleRepo.findScheduleById(existingSchedId)).thenReturn(Optional.of(existingMorning));
        monitorScheduleService.deleteSchedule(existingSchedId);
        verify(scheduleRepo).deleteSchedule(existingSchedId);

        when(scheduleRepo.findAllSchedules(ScheduleStatus.ACTIVE, "Hall A1")).thenReturn(List.of());
        when(scheduleRepo.insertSchedule(any(), eq(monitorId))).thenReturn(createdAfterId);
        assertThat(monitorScheduleService.createSchedule(tailOverlapReq).id()).isEqualTo(createdAfterId);

        // Case E: Past date rejected (PAST_SCHEDULE_TIME), while same-day past hours ARE allowed
        java.time.ZoneId witaZone = java.time.ZoneId.of("Asia/Makassar");
        LocalDate todayWita = OffsetDateTime.now(witaZone).toLocalDate();
        CreateScheduleRequest pastOneTimeDateReq = new CreateScheduleRequest(
                "Jadwal Kemarin", null, ScheduleKind.ONE_TIME,
                todayWita.minusDays(2).atTime(10, 0).atZone(witaZone).toOffsetDateTime(),
                todayWita.minusDays(2).atTime(11, 0).atZone(witaZone).toOffsetDateTime(),
                null, null, null, null, null, null, "Hall A1"
        );
        assertThatThrownBy(() -> monitorScheduleService.createSchedule(pastOneTimeDateReq))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("PAST_SCHEDULE_TIME"));

        OffsetDateTime todayPastStart = todayWita.atTime(0, 1).atZone(witaZone).toOffsetDateTime();
        OffsetDateTime todayPastEnd = todayWita.atTime(0, 15).atZone(witaZone).toOffsetDateTime();
        CreateScheduleRequest sameDayPastHoursReq = new CreateScheduleRequest(
                "Jadwal Hari Ini Jam Lewat", null, ScheduleKind.ONE_TIME,
                todayPastStart, todayPastEnd,
                null, null, null, null, null, null, "Hall A1"
        );
        UUID sameDayId = UUID.randomUUID();
        when(scheduleRepo.findNonCancelledSessionsOnDate(todayWita, "Hall A1")).thenReturn(List.of());
        when(scheduleRepo.insertSchedule(any(), eq(monitorId))).thenReturn(sameDayId);
        when(scheduleRepo.findScheduleById(sameDayId)).thenReturn(Optional.of(new ScheduleDto(
                sameDayId, "Jadwal Hari Ini Jam Lewat", null, "IBADAH_RUTIN", "Ibadah Rutin",
                ScheduleKind.ONE_TIME, todayPastStart, todayPastEnd, null,
                null, null, todayWita, todayWita,
                ScheduleStatus.ACTIVE, null, monitorId, now, now, "Hall A1"
        )));
        assertThat(monitorScheduleService.createSchedule(sameDayPastHoursReq).id()).isEqualTo(sameDayId);

        CreateScheduleRequest pastRecurringFromReq = new CreateScheduleRequest(
                "Jadwal Berulang Mulai Kemarin", null, ScheduleKind.RECURRING,
                null, null, List.of((short) 1, (short) 2),
                LocalTime.of(20, 0), LocalTime.of(21, 0),
                LocalDate.now().minusDays(2), LocalDate.now().plusDays(10), null, "Hall A1"
        );
        assertThatThrownBy(() -> monitorScheduleService.createSchedule(pastRecurringFromReq))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("PAST_SCHEDULE_TIME"));
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
                .contains("10502211001,Budi Santoso")
                .contains("ASRAMA,Crystal,101,HADIR,SCAN")
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
        GeofenceConfigRequest updateGeoReq = new GeofenceConfigRequest("Pusat Ibadah", true, unklabLat, unklabLon, 50, 15.0);
        when(scheduleRepo.upsertGeofence(eq(sessionId), any())).thenReturn(
                new GeofenceDto(UUID.randomUUID(), sessionId, "Pusat Ibadah", true, unklabLat, unklabLon, 50, 15.0)
        );
        GeofenceDto configured = scheduleService.configureSessionGeofence(sessionId, updateGeoReq);
        assertThat(configured).isNotNull();
        verify(scheduleRepo).upsertGeofence(sessionId, updateGeoReq);

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

    @Test
    @DisplayName("SRS Upgrade: Akun Otomatis 11111111, Ubah Sandi 3 Field, Sesi Tanpa Batas, & Isolasi 4 Hall")
    void testSrsMajorUpgradesComprehensiveFlow() {
        // 1. Admin Service: Pembuatan Akun Penghuni Otomatis dengan Password Default "11111111" (A-02)
        AdminRepository mockAdminRepo = mock(AdminRepository.class);
        ResidentRepository mockAdminResRepo = mock(ResidentRepository.class);
        EnrollmentRepository mockEnrollRepo = mock(EnrollmentRepository.class);
        SupabaseStorageService mockAdminStorage = mock(SupabaseStorageService.class);

        AdminService adminService = new AdminService(
                mockAdminRepo, mockAdminResRepo, mockEnrollRepo, mockAdminStorage, passwordEncoder, jwtTokenService
        );

        UUID newResidentId = UUID.randomUUID();
        when(mockAdminResRepo.findByNim("10502221001")).thenReturn(Optional.empty());
        when(mockAdminRepo.insertResident(any(), any(), any(), any(), any(), any(), any())).thenReturn(newResidentId);
        when(mockAdminResRepo.findById(newResidentId)).thenReturn(Optional.of(new ResidentProfileDto(
                newResidentId, "10502221001", "Mahasiswa Baru", ResidentStatus.AKTIF,
                ResidenceCategory.ASRAMA, "Crystal", "201", false, null, true, null,
                OffsetDateTime.now(), OffsetDateTime.now()
        )));

        ResidentProfileDto createdRes = adminService.createResident(new id.ac.unklab.asrama.admin.AdminDtos.CreateResidentRequest(
                "10502221001", "Mahasiswa Baru", ResidentStatus.AKTIF, ResidenceCategory.ASRAMA, "Crystal", "201"
        ));
        assertThat(createdRes).isNotNull();
        // Verify resident user account is created with default password hash
        verify(mockAdminRepo).insertResidentUserAccount(eq(newResidentId), eq("10502221001"), anyString());

        // 2. Auth Service: Fitur Ubah Kata Sandi 3 Field (P-01)
        AuthRepository mockAuthRepo = mock(AuthRepository.class);
        SecurityUtils mockSec = mock(SecurityUtils.class);
        AuthService authService = new AuthService(mockAuthRepo, passwordEncoder, jwtTokenService, mockSec);

        UUID residentUserId = UUID.randomUUID();
        String currentHash = passwordEncoder.encode("11111111");

        when(mockSec.getCurrentPrincipal()).thenReturn(
                new AppPrincipal(residentUserId, "10502221001", UserRole.PENGHUNI, residentUserId, "Hall A1")
        );
        when(mockAuthRepo.findUserById(residentUserId)).thenReturn(Optional.of(
                new UserLoginLookupRow(residentUserId, "10502221001", "res@unklab.ac.id", currentHash,
                        UserRole.PENGHUNI, newResidentId, ResidentStatus.AKTIF, true, 0, null, false, "Hall A1")
        ));

        // 2a. Confirm password mismatch -> Throws PASSWORD_MISMATCH
        assertThatThrownBy(() -> authService.changeOwnPassword(
                new ChangePasswordRequest("11111111", "NewSecret123", "WrongSecret123")))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("PASSWORD_MISMATCH"));

        // 2b. New password same as old password -> Throws SAME_PASSWORD
        assertThatThrownBy(() -> authService.changeOwnPassword(
                new ChangePasswordRequest("11111111", "11111111", "11111111")))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("SAME_PASSWORD"));

        // 2c. Successful password change
        authService.changeOwnPassword(new ChangePasswordRequest("11111111", "Baru12345", "Baru12345"));
        verify(mockAuthRepo).updatePasswordHash(eq(residentUserId), anyString());

        // 3. Schedule Service: Penjaga Bebas Mengubah & Menghapus Sesi Tanpa Batasan (J-06, K-05)
        ScheduleRepository mockScheduleRepo = mock(ScheduleRepository.class);
        when(mockSec.getCurrentHallName()).thenReturn("Hall A1");
        when(mockSec.getCurrentUserId()).thenReturn(UUID.randomUUID());

        ScheduleService scheduleService = new ScheduleService(mockScheduleRepo, mockSec);

        UUID activeSessionId = UUID.randomUUID();
        SessionDto openSession = new SessionDto(
                activeSessionId, UUID.randomUUID(), "Sesi Aktif", "IBADAH_RUTIN",
                OffsetDateTime.now().minusMinutes(5), OffsetDateTime.now().plusMinutes(55),
                SessionStatus.OPEN, UUID.randomUUID(), null, null,
                OffsetDateTime.now(), OffsetDateTime.now(), "Hall A1"
        );
        when(mockScheduleRepo.findSessionById(activeSessionId)).thenReturn(Optional.of(openSession));

        // Update session time & name while active
        UpdateSessionRequest updateReq = new UpdateSessionRequest(
                "Sesi Diperpanjang", OffsetDateTime.now().minusMinutes(5), OffsetDateTime.now().plusHours(2),
                SessionStatus.OPEN, "Hall A1", null
        );
        scheduleService.updateSession(activeSessionId, updateReq);
        verify(mockScheduleRepo).updateSession(eq(activeSessionId), any(), any(), eq(SessionStatus.OPEN), eq("Hall A1"));

        // Delete active session freely
        scheduleService.deleteOrCancelSession(activeSessionId);
        verify(mockScheduleRepo).deleteSession(activeSessionId);

        // 4. Resident Service: Klaim Penghuni ke Hall (J-09, P-06, K-07)
        ResidentRepository mockResRepo = mock(ResidentRepository.class);
        id.ac.unklab.asrama.resident.ResidentService residentService =
                new id.ac.unklab.asrama.resident.ResidentService(mockResRepo, mockSec);

        // 4a. NIM tidak ditemukan -> NIM_NOT_FOUND
        when(mockResRepo.findByNim("99999999999")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> residentService.claimResidentToGuardHall("99999999999"))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("NIM_NOT_FOUND"));

        // 4b. Sudah di Hall penjaga sendiri (Hall A1) -> info already in hall
        when(mockResRepo.findByNim("10502221001")).thenReturn(Optional.of(
                new ResidentProfileDto(newResidentId, "10502221001", "Mahasiswa", ResidentStatus.AKTIF,
                        ResidenceCategory.ASRAMA, "Crystal", "201", false, null, true, "v1",
                        OffsetDateTime.now(), OffsetDateTime.now(), "Hall A1")
        ));
        ResidentProfileDto sameHallClaim = residentService.claimResidentToGuardHall("10502221001");
        assertThat(sameHallClaim).isNotNull();

        // 4c. Sudah terdaftar di Hall lain (Hall B1) -> Rejection ALREADY_IN_OTHER_HALL
        when(mockResRepo.findByNim("10502221002")).thenReturn(Optional.of(
                new ResidentProfileDto(UUID.randomUUID(), "10502221002", "Mahasiswa B", ResidentStatus.AKTIF,
                        ResidenceCategory.ASRAMA, "Genset", "101", false, null, true, "v1",
                        OffsetDateTime.now(), OffsetDateTime.now(), "Hall B1")
        ));
        assertThatThrownBy(() -> residentService.claimResidentToGuardHall("10502221002"))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getErrorCode()).isEqualTo("ALREADY_IN_OTHER_HALL");
                    assertThat(be.getMessage()).contains("sudah terdaftar di Hall B1");
                });

        // 4d. Penghuni belum punya Hall (hall == null) -> Berhasil masuk ke Hall A1
        UUID unclaimedId = UUID.randomUUID();
        when(mockResRepo.findByNim("10502221003")).thenReturn(Optional.of(
                new ResidentProfileDto(unclaimedId, "10502221003", "Mahasiswa C", ResidentStatus.AKTIF,
                        ResidenceCategory.ASRAMA, "Genset", "102", false, null, true, "v1",
                        OffsetDateTime.now(), OffsetDateTime.now(), null)
        ));
        when(mockResRepo.findById(unclaimedId)).thenReturn(Optional.of(
                new ResidentProfileDto(unclaimedId, "10502221003", "Mahasiswa C", ResidentStatus.AKTIF,
                        ResidenceCategory.ASRAMA, "Genset", "102", false, null, true, "v1",
                        OffsetDateTime.now(), OffsetDateTime.now(), "Hall A1")
        ));
        ResidentProfileDto claimed = residentService.claimResidentToGuardHall("10502221003");
        assertThat(claimed).isNotNull();
        verify(mockResRepo).updateResidentHall(unclaimedId, "Hall A1");

        // 5. Attendance Service: Isolasi Presensi Antar-Hall (P-07)
        AttendanceRepository mockAttRepo = mock(AttendanceRepository.class);
        SupabaseStorageService mockStorage = mock(SupabaseStorageService.class);
        FastApiAiClient mockAi = mock(FastApiAiClient.class);
        AttendanceService attendanceService = new AttendanceService(
                mockAttRepo, mockResRepo, mockScheduleRepo, mockStorage, mockAi, appProperties, mockSec
        );

        // Session di Hall B2, tapi Resident di Hall A1 -> ditolak HALL_MISMATCH
        UUID sessionB2Id = UUID.randomUUID();
        SessionDto sessionB2 = new SessionDto(
                sessionB2Id, UUID.randomUUID(), "Sesi Hall B2", "IBADAH_RUTIN",
                OffsetDateTime.now().minusMinutes(5), OffsetDateTime.now().plusMinutes(55),
                SessionStatus.OPEN, UUID.randomUUID(), null, null,
                OffsetDateTime.now(), OffsetDateTime.now(), "Hall B2"
        );
        when(mockScheduleRepo.findSessionById(sessionB2Id)).thenReturn(Optional.of(sessionB2));
        when(mockResRepo.findById(newResidentId)).thenReturn(Optional.of(new ResidentProfileDto(
                newResidentId, "10502221001", "Mahasiswa", ResidentStatus.AKTIF,
                ResidenceCategory.ASRAMA, "Crystal", "201", true, OffsetDateTime.now(), true, "v1",
                OffsetDateTime.now(), OffsetDateTime.now(), "Hall A1"
        )));

        ManualAttendanceRequest manualReq = new ManualAttendanceRequest(
                sessionB2Id, newResidentId, AttendanceStatus.HADIR, "Sakit"
        );
        assertThatThrownBy(() -> attendanceService.recordManualAttendance(manualReq))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getErrorCode()).isEqualTo("HALL_MISMATCH");
                    assertThat(be.getMessage()).contains("terdaftar di Hall A1");
                });
    }

    @Test
    @DisplayName("19. Blackbox Fix: Anti-Enumerasi Login Akun Nonaktif & Validasi Manual Attendance Sesi/Hall")
    void testBlackboxLoginEnumerationAndManualAttendanceGuards() {
        // 1. Login dengan password salah pada akun NONAKTIF harus menghasilkan INVALID_CREDENTIALS (401), bukan ACCOUNT_INACTIVE
        AuthRepository mockAuthRepo = mock(AuthRepository.class);
        SecurityUtils mockSec = mock(SecurityUtils.class);
        AuthService authService = new AuthService(mockAuthRepo, passwordEncoder, jwtTokenService, mockSec);

        UUID userId = UUID.randomUUID();
        UUID residentId = UUID.randomUUID();
        String validHash = passwordEncoder.encode("SecretPass123");

        when(mockAuthRepo.findUserForLogin("10502229999")).thenReturn(Optional.of(
                new UserLoginLookupRow(userId, "10502229999", "res99@unklab.ac.id", validHash,
                        UserRole.PENGHUNI, residentId, ResidentStatus.NONAKTIF, false, 0, null, false, "Hall A1")
        ));

        assertThatThrownBy(() -> authService.login(new LoginRequest("10502229999", "SalahPassword")))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
                    assertThat(be.getErrorCode()).isEqualTo("INVALID_CREDENTIALS");
                });

        // Password benar pada akun nonaktif tetap mengembalikan ACCOUNT_INACTIVE (403)
        assertThatThrownBy(() -> authService.login(new LoginRequest("10502229999", "SecretPass123")))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(be.getErrorCode()).isEqualTo("ACCOUNT_INACTIVE");
                });

        // 2. Manual attendance menolak sesi lebih dari 7 hari ke belakang (HISTORY_EDIT_EXPIRED)
        //    dan penghuni tanpa Hall pada sesi khusus Hall (HALL_UNASSIGNED), namun MENGIZINKAN sesi CLOSED <= 7 hari
        AttendanceRepository mockAttRepo = mock(AttendanceRepository.class);
        ResidentRepository mockResRepo = mock(ResidentRepository.class);
        ScheduleRepository mockSchedRepo = mock(ScheduleRepository.class);
        SupabaseStorageService mockStorage = mock(SupabaseStorageService.class);
        FastApiAiClient mockAi = mock(FastApiAiClient.class);
        SecurityUtils guardSec = mock(SecurityUtils.class);
        AttendanceService attendanceService = new AttendanceService(
                mockAttRepo, mockResRepo, mockSchedRepo, mockStorage, mockAi, appProperties, guardSec
        );

        UUID guardUserId = UUID.randomUUID();
        when(guardSec.getCurrentPrincipal()).thenReturn(
                new AppPrincipal(guardUserId, "guardA1", UserRole.MONITOR, null, "Hall A1")
        );
        when(guardSec.hasRole("ROLE_MONITOR")).thenReturn(true);
        when(guardSec.getCurrentHallName()).thenReturn("Hall A1");

        UUID expiredHistorySessionId = UUID.randomUUID();
        when(mockSchedRepo.findSessionById(expiredHistorySessionId)).thenReturn(Optional.of(
                new SessionDto(expiredHistorySessionId, UUID.randomUUID(), "Ibadah Minggu Lalu", "IBADAH_SORE",
                        OffsetDateTime.now().minusDays(8), OffsetDateTime.now().minusDays(8).plusHours(1),
                        SessionStatus.CLOSED, guardUserId, OffsetDateTime.now().minusDays(8).plusHours(1),
                        null, OffsetDateTime.now(), OffsetDateTime.now(), "Hall A1")
        ));
        assertThatThrownBy(() -> attendanceService.recordManualAttendance(
                new ManualAttendanceRequest(expiredHistorySessionId, residentId, AttendanceStatus.HADIR, "Terlambat tercatat")))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("HISTORY_EDIT_EXPIRED"));

        UUID closedSessionId = UUID.randomUUID();
        when(mockSchedRepo.findSessionById(closedSessionId)).thenReturn(Optional.of(
                new SessionDto(closedSessionId, UUID.randomUUID(), "Ibadah Hari Ini Ditutup", "IBADAH_SORE",
                        OffsetDateTime.now().minusHours(2), OffsetDateTime.now().minusHours(1),
                        SessionStatus.CLOSED, guardUserId, OffsetDateTime.now().minusHours(1),
                        null, OffsetDateTime.now(), OffsetDateTime.now(), "Hall A1")
        ));
        when(mockResRepo.findById(residentId)).thenReturn(Optional.of(
                new ResidentProfileDto(residentId, "10502229999", "Penghuni Tanpa Hall", ResidentStatus.AKTIF,
                        ResidenceCategory.ASRAMA, "Crystal", "105", false, null, true, "v1",
                        OffsetDateTime.now(), OffsetDateTime.now(), null)
        ));
        assertThatThrownBy(() -> attendanceService.recordManualAttendance(
                new ManualAttendanceRequest(closedSessionId, residentId, AttendanceStatus.HADIR, "Izin")))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("HALL_UNASSIGNED"));
    }

    @Test
    @DisplayName("20. User Management: Perlindungan Hapus Akun Sendiri, Admin Terakhir, dan Penghapusan Akun Petugas")
    void testDeleteUserGuards() {
        AdminRepository mockAdminRepo = mock(AdminRepository.class);
        ResidentRepository mockResRepo = mock(ResidentRepository.class);
        EnrollmentRepository mockEnrollRepo = mock(EnrollmentRepository.class);
        SupabaseStorageService mockStorage = mock(SupabaseStorageService.class);
        AdminService adminService = new AdminService(
                mockAdminRepo, mockResRepo, mockEnrollRepo, mockStorage, passwordEncoder, jwtTokenService
        );

        UUID actorId = UUID.randomUUID();
        UUID monitorId = UUID.randomUUID();
        UUID adminId = UUID.randomUUID();

        when(mockAdminRepo.findUserAccountById(actorId)).thenReturn(Optional.of(
                new id.ac.unklab.asrama.admin.AdminDtos.UserAccountDto(
                        actorId, null, null, null, "admin01", "admin@unklab.ac.id", UserRole.ADMIN,
                        true, 0, null, null, OffsetDateTime.now(), OffsetDateTime.now(), null
                )
        ));
        assertThatThrownBy(() -> adminService.deleteUser(actorId, actorId))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("CANNOT_DELETE_SELF"));

        when(mockAdminRepo.findUserAccountById(adminId)).thenReturn(Optional.of(
                new id.ac.unklab.asrama.admin.AdminDtos.UserAccountDto(
                        adminId, null, null, null, "admin02", "admin2@unklab.ac.id", UserRole.ADMIN,
                        true, 0, null, null, OffsetDateTime.now(), OffsetDateTime.now(), null
                )
        ));
        when(mockAdminRepo.countActiveAdmins()).thenReturn(1);
        assertThatThrownBy(() -> adminService.deleteUser(adminId, actorId))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("CANNOT_DELETE_LAST_ADMIN"));

        when(mockAdminRepo.findUserAccountById(monitorId)).thenReturn(Optional.of(
                new id.ac.unklab.asrama.admin.AdminDtos.UserAccountDto(
                        monitorId, null, null, null, "penjaga.a1", "penjaga@unklab.ac.id", UserRole.MONITOR,
                        true, 0, null, null, OffsetDateTime.now(), OffsetDateTime.now(), "Hall A1"
                )
        ));
        adminService.deleteUser(monitorId, actorId);
        verify(mockAdminRepo).deleteUser(monitorId);

        assertThat(UserRole.fromDatabase("VILLAGE_DEAN")).isEqualTo(UserRole.ADMIN);
        assertThat(UserRole.fromDatabase("monitor")).isEqualTo(UserRole.MONITOR);
    }

    @Test
    @DisplayName("21. Guard Rules: Sesi Jam Lewat Hari Ini Auto-Close, Max 1 Sesi/Hari, Scan Ditolak, Manual/Edit Maksimal 7 Hari")
    void testGuardDailyLimitAutoCloseAndOneWeekHistoryRules() {
        ScheduleRepository mockSchedRepo = mock(ScheduleRepository.class);
        SecurityUtils guardSec = mock(SecurityUtils.class);
        UUID guardId = UUID.randomUUID();
        when(guardSec.getCurrentUserId()).thenReturn(guardId);
        when(guardSec.hasRole("ROLE_MONITOR")).thenReturn(true);
        when(guardSec.getCurrentHallName()).thenReturn("Hall B1");
        ScheduleService guardScheduleService = new ScheduleService(mockSchedRepo, guardSec);

        java.time.ZoneId witaZone = java.time.ZoneId.of("Asia/Makassar");
        OffsetDateTime nowWita = OffsetDateTime.now(witaZone);
        LocalDate todayWita = nowWita.toLocalDate();
        OffsetDateTime todayMidnight = todayWita.atStartOfDay(witaZone).toOffsetDateTime();
        OffsetDateTime pastEnd = nowWita.minusMinutes(1).isAfter(todayMidnight)
                ? nowWita.minusMinutes(1)
                : todayMidnight.plusSeconds(2);
        OffsetDateTime pastStart = pastEnd.minusMinutes(1).isAfter(todayMidnight)
                ? pastEnd.minusMinutes(1)
                : todayMidnight;
        UUID schedId = UUID.randomUUID();
        UUID sessId = UUID.randomUUID();

        ScheduleDto todayPastSched = new ScheduleDto(
                schedId, "Presensi Pagi Lewat", null, "IBADAH_RUTIN", "Ibadah Rutin",
                ScheduleKind.ONE_TIME, pastStart, pastEnd, null,
                null, null, todayWita, todayWita, ScheduleStatus.ACTIVE, null, guardId,
                OffsetDateTime.now(), OffsetDateTime.now(), "Hall B1"
        );
        when(mockSchedRepo.findScheduleById(schedId)).thenReturn(Optional.of(todayPastSched));
        when(mockSchedRepo.findNonCancelledSessionsOnDate(todayWita, "Hall B1")).thenReturn(List.of());
        when(mockSchedRepo.insertSession(eq(schedId), eq(pastStart), eq(pastEnd), eq(SessionStatus.CLOSED), eq(guardId), eq("Hall B1")))
                .thenReturn(sessId);
        SessionDto autoClosedSession = new SessionDto(
                sessId, schedId, "Presensi Pagi Lewat", "IBADAH_RUTIN",
                pastStart, pastEnd, SessionStatus.CLOSED, guardId, pastEnd, null,
                OffsetDateTime.now(), OffsetDateTime.now(), "Hall B1"
        );
        when(mockSchedRepo.findSessionById(sessId)).thenReturn(Optional.of(autoClosedSession));

        // 1) Creating a session with past hours today auto-creates it in CLOSED status
        SessionDto created = guardScheduleService.createSession(new CreateSessionRequest(schedId, pastStart, pastEnd, "Hall B1"));
        assertThat(created.status()).isEqualTo(SessionStatus.CLOSED);
        verify(mockSchedRepo).insertSession(schedId, pastStart, pastEnd, SessionStatus.CLOSED, guardId, "Hall B1");

        // 2) Creating a second schedule/session on the SAME day is blocked (DAILY_SESSION_LIMIT)
        when(mockSchedRepo.findNonCancelledSessionsOnDate(todayWita, "Hall B1")).thenReturn(List.of(autoClosedSession));
        CreateScheduleRequest secondSameDay = new CreateScheduleRequest(
                "Sesi Kedua Hari Ini", null, ScheduleKind.ONE_TIME,
                todayWita.atTime(20, 0).atZone(witaZone).toOffsetDateTime(),
                todayWita.atTime(21, 0).atZone(witaZone).toOffsetDateTime(),
                null, null, null, null, null, null, "Hall B1"
        );
        assertThatThrownBy(() -> guardScheduleService.createSchedule(secondSameDay))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("DAILY_SESSION_LIMIT"));

        // 3) Deleting first session permanently also cleans up orphaned ONE_TIME schedule and unblocks that day
        when(mockSchedRepo.findSessions(null, schedId, null)).thenReturn(List.of());
        guardScheduleService.deleteOrCancelSession(sessId);
        verify(mockSchedRepo).deleteSession(sessId);
        verify(mockSchedRepo).deleteSchedule(schedId);

        // 4) Face scan is rejected on CLOSED session (SESSION_CLOSED)
        AttendanceRepository mockAttRepo = mock(AttendanceRepository.class);
        ResidentRepository mockResRepo = mock(ResidentRepository.class);
        SupabaseStorageService mockStorage = mock(SupabaseStorageService.class);
        FastApiAiClient mockAi = mock(FastApiAiClient.class);
        AttendanceService guardAttService = new AttendanceService(
                mockAttRepo, mockResRepo, mockSchedRepo, mockStorage, mockAi, appProperties, guardSec
        );
        UUID resId = UUID.randomUUID();
        org.springframework.mock.web.MockMultipartFile frame = new org.springframework.mock.web.MockMultipartFile(
                "file", "face.jpg", "image/jpeg", "fake-jpg".getBytes()
        );
        assertThatThrownBy(() -> guardAttService.scanGuardAssistedAttendance(
                sessId, resId, "Bantu scan", frame, null, null, null, null
        ))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("SESSION_CLOSED"));

        // 5) Guard manual & edit allowed on CLOSED session within 7 days, blocked beyond 7 days
        when(mockResRepo.findById(resId)).thenReturn(Optional.of(
                new ResidentProfileDto(resId, "10502221001", "Penghuni Hall B1", ResidentStatus.AKTIF,
                        ResidenceCategory.ASRAMA, "Crystal", "201", false, null, true, "v1",
                        OffsetDateTime.now(), OffsetDateTime.now(), "Hall B1")
        ));
        UUID recId = UUID.randomUUID();
        when(mockAttRepo.findBySessionAndResident(sessId, resId)).thenReturn(Optional.empty());
        when(mockAttRepo.insertAttendanceRecord(any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), any(), any())).thenReturn(recId);
        AttendanceRecordDto dto = new AttendanceRecordDto(
                recId, sessId, resId, "10502221001", "Penghuni Hall B1", AttendanceStatus.HADIR,
                AttendanceMethod.MANUAL, "Kamera rusak", guardId, "guardB1",
                null, null, null, null, null, null, null, null, null, null, OffsetDateTime.now()
        );
        when(mockAttRepo.findById(recId)).thenReturn(Optional.of(dto));

        AttendanceRecordDto manualSaved = guardAttService.recordManualAttendance(
                new ManualAttendanceRequest(sessId, resId, AttendanceStatus.HADIR, "Kamera rusak")
        );
        assertThat(manualSaved.status()).isEqualTo(AttendanceStatus.HADIR);
        verify(mockAttRepo).insertAttendanceRecord(
                eq(sessId), eq(resId), anyString(), anyString(),
                eq(AttendanceStatus.HADIR), eq(AttendanceMethod.MANUAL), anyString(), eq(guardId),
                isNull(), isNull(), isNull(), isNull(), isNull(), isNull(), isNull()
        );

        UUID absentResId = UUID.randomUUID();
        UUID absentRecId = UUID.randomUUID();
        when(mockResRepo.findById(absentResId)).thenReturn(Optional.of(
                new ResidentProfileDto(absentResId, "10502221002", "Penghuni Alpa Hall B1", ResidentStatus.AKTIF,
                        ResidenceCategory.ASRAMA, "Crystal", "202", false, null, true, "v1",
                        OffsetDateTime.now(), OffsetDateTime.now(), "Hall B1")
        ));
        when(mockAttRepo.findBySessionAndResident(sessId, absentResId)).thenReturn(Optional.empty());
        when(mockAttRepo.insertAttendanceRecord(
                eq(sessId), eq(absentResId), anyString(), anyString(),
                eq(AttendanceStatus.TIDAK_HADIR), isNull(), anyString(), eq(guardId),
                isNull(), isNull(), isNull(), isNull(), isNull(), isNull(), isNull()
        )).thenReturn(absentRecId);
        when(mockAttRepo.findById(absentRecId)).thenReturn(Optional.of(new AttendanceRecordDto(
                absentRecId, sessId, absentResId, "10502221002", "Penghuni Alpa Hall B1", AttendanceStatus.TIDAK_HADIR,
                null, "Tanpa keterangan", guardId, "guardB1",
                null, null, null, null, null, null, null, null, null, null, OffsetDateTime.now()
        )));
        AttendanceRecordDto manualAbsent = guardAttService.recordManualAttendance(
                new ManualAttendanceRequest(sessId, absentResId, AttendanceStatus.TIDAK_HADIR, "Tanpa keterangan")
        );
        assertThat(manualAbsent.status()).isEqualTo(AttendanceStatus.TIDAK_HADIR);
        assertThat(manualAbsent.method()).isNull();

        AttendanceRecordDto editedWithin7Days = guardAttService.correctAttendance(
                recId, new CorrectAttendanceRequest(AttendanceStatus.TIDAK_HADIR, "Koreksi izin")
        );
        assertThat(editedWithin7Days).isNotNull();
        verify(mockAttRepo).updateAttendanceRecord(recId, AttendanceStatus.TIDAK_HADIR, "Koreksi izin", guardId);

        // Face-scan attendance (SCAN and DIBANTU_PENJAGA) cannot be edited by guard
        UUID scanRecId = UUID.randomUUID();
        when(mockAttRepo.findById(scanRecId)).thenReturn(Optional.of(new AttendanceRecordDto(
                scanRecId, sessId, resId, "10502221001", "Penghuni Hall B1", AttendanceStatus.HADIR,
                AttendanceMethod.SCAN, null, resId, "10502221001",
                true, true, null, null, null, 5.0, true, null, null, null, OffsetDateTime.now()
        )));
        assertThatThrownBy(() -> guardAttService.correctAttendance(
                scanRecId, new CorrectAttendanceRequest(AttendanceStatus.TIDAK_HADIR, "Coba ubah scan")
        ))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("FACE_SCAN_ATTENDANCE_LOCKED"));

        UUID assistedRecId = UUID.randomUUID();
        when(mockAttRepo.findById(assistedRecId)).thenReturn(Optional.of(new AttendanceRecordDto(
                assistedRecId, sessId, resId, "10502221001", "Penghuni Hall B1", AttendanceStatus.HADIR,
                AttendanceMethod.DIBANTU_PENJAGA, "Kamera penghuni buram", guardId, "guardB1",
                true, true, null, null, null, 4.0, true, null, null, null, OffsetDateTime.now()
        )));
        assertThatThrownBy(() -> guardAttService.correctAttendance(
                assistedRecId, new CorrectAttendanceRequest(AttendanceStatus.TIDAK_HADIR, "Coba ubah bantu scan")
        ))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("FACE_SCAN_ATTENDANCE_LOCKED"));

        UUID oldSessId = UUID.randomUUID();
        UUID oldRecId = UUID.randomUUID();
        OffsetDateTime eightDaysAgo = todayWita.minusDays(8).atTime(10, 0).atZone(witaZone).toOffsetDateTime();
        when(mockSchedRepo.findSessionById(oldSessId)).thenReturn(Optional.of(new SessionDto(
                oldSessId, UUID.randomUUID(), "Sesi 8 Hari Lalu", "IBADAH_RUTIN",
                eightDaysAgo, eightDaysAgo.plusHours(1), SessionStatus.CLOSED, guardId, eightDaysAgo.plusHours(1),
                null, OffsetDateTime.now(), OffsetDateTime.now(), "Hall B1"
        )));
        when(mockAttRepo.findById(oldRecId)).thenReturn(Optional.of(new AttendanceRecordDto(
                oldRecId, oldSessId, resId, "10502221001", "Penghuni Hall B1", AttendanceStatus.TIDAK_HADIR,
                AttendanceMethod.MANUAL, "Alpha", guardId, "guardB1",
                null, null, null, null, null, null, null, null, null, null, eightDaysAgo
        )));
        assertThatThrownBy(() -> guardAttService.correctAttendance(
                oldRecId, new CorrectAttendanceRequest(AttendanceStatus.HADIR, "Terlambat edit")
        ))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("HISTORY_EDIT_EXPIRED"));
    }

    @Test
    @DisplayName("22. Admin Schedule Policy: Batas Sesi Harian Dapat Diatur 1..3 Sesi/Hari & Menolak Nilai Di Luar Rentang")
    void testAdminConfigurableDailySessionLimitOneToThree() {
        ScheduleRepository mockSchedRepo = mock(ScheduleRepository.class);
        SecurityUtils adminSec = mock(SecurityUtils.class);
        UUID adminId = UUID.randomUUID();
        when(adminSec.getCurrentUserId()).thenReturn(adminId);
        ScheduleService svc = new ScheduleService(mockSchedRepo, adminSec);

        // Out-of-range settings rejected
        assertThatThrownBy(() -> svc.updateMaxDailySessions(0))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("INVALID_DAILY_SESSION_LIMIT"));
        assertThatThrownBy(() -> svc.updateMaxDailySessions(4))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("INVALID_DAILY_SESSION_LIMIT"));

        when(mockSchedRepo.updateMaxDailySessions(2, adminId)).thenReturn(2);
        assertThat(svc.updateMaxDailySessions(2).maxDailySessions()).isEqualTo(2);

        // When configured to 2 sessions/day, 1 existing session allows creating a 2nd non-overlapping session on the same day,
        // while 2 existing sessions block the 3rd with DAILY_SESSION_LIMIT.
        java.time.ZoneId witaZone = java.time.ZoneId.of("Asia/Makassar");
        LocalDate futureDate = LocalDate.now(witaZone).plusDays(1);
        UUID firstSchedId = UUID.randomUUID();
        UUID secondSchedId = UUID.randomUUID();
        SessionDto morningSession = new SessionDto(
                UUID.randomUUID(), firstSchedId, "Presensi Subuh", "IBADAH_RUTIN",
                futureDate.atTime(5, 0).atZone(witaZone).toOffsetDateTime(),
                futureDate.atTime(6, 0).atZone(witaZone).toOffsetDateTime(),
                SessionStatus.OPEN, adminId, null, null, OffsetDateTime.now(), OffsetDateTime.now(), "Hall A1"
        );
        SessionDto nightSession = new SessionDto(
                UUID.randomUUID(), secondSchedId, "Presensi Malam", "IBADAH_RUTIN",
                futureDate.atTime(20, 0).atZone(witaZone).toOffsetDateTime(),
                futureDate.atTime(21, 0).atZone(witaZone).toOffsetDateTime(),
                SessionStatus.OPEN, adminId, null, null, OffsetDateTime.now(), OffsetDateTime.now(), "Hall A1"
        );
        when(mockSchedRepo.getMaxDailySessions()).thenReturn(2);
        when(mockSchedRepo.findNonCancelledSessionsOnDate(futureDate, "Hall A1")).thenReturn(List.of(morningSession));
        when(mockSchedRepo.findAllSchedules(ScheduleStatus.ACTIVE, "Hall A1")).thenReturn(List.of());
        UUID createdId = UUID.randomUUID();
        when(mockSchedRepo.insertSchedule(any(), eq(adminId))).thenReturn(createdId);
        when(mockSchedRepo.findScheduleById(createdId)).thenReturn(Optional.of(new ScheduleDto(
                createdId, "Presensi Malam", null, "IBADAH_RUTIN", "Ibadah Rutin",
                ScheduleKind.ONE_TIME,
                futureDate.atTime(20, 0).atZone(witaZone).toOffsetDateTime(),
                futureDate.atTime(21, 0).atZone(witaZone).toOffsetDateTime(),
                null, null, null, futureDate, futureDate, ScheduleStatus.ACTIVE, null, adminId,
                OffsetDateTime.now(), OffsetDateTime.now(), "Hall A1"
        )));

        ScheduleDto secondCreated = svc.createSchedule(new CreateScheduleRequest(
                "Presensi Malam", null, ScheduleKind.ONE_TIME,
                futureDate.atTime(20, 0).atZone(witaZone).toOffsetDateTime(),
                futureDate.atTime(21, 0).atZone(witaZone).toOffsetDateTime(),
                null, null, null, null, null, null, "Hall A1"
        ));
        assertThat(secondCreated.id()).isEqualTo(createdId);

        when(mockSchedRepo.findNonCancelledSessionsOnDate(futureDate, "Hall A1"))
                .thenReturn(List.of(morningSession, nightSession));
        CreateScheduleRequest thirdSameDay = new CreateScheduleRequest(
                "Presensi Siang", null, ScheduleKind.ONE_TIME,
                futureDate.atTime(12, 0).atZone(witaZone).toOffsetDateTime(),
                futureDate.atTime(13, 0).atZone(witaZone).toOffsetDateTime(),
                null, null, null, null, null, null, "Hall A1"
        );
        assertThatThrownBy(() -> svc.createSchedule(thirdSameDay))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("DAILY_SESSION_LIMIT"));
    }

    @Test
    @DisplayName("23. Monitor ONE_TIME Schedule Locked to Today (1 Day Only) & Auto-Creates Today's Session While Recurring Remains Allowed")
    void testMonitorOneTimeScheduleTodayOnlyAndAutoMaterialize() {
        ScheduleRepository mockSchedRepo = mock(ScheduleRepository.class);
        SecurityUtils guardSec = mock(SecurityUtils.class);
        UUID guardId = UUID.randomUUID();
        when(guardSec.getCurrentUserId()).thenReturn(guardId);
        when(guardSec.hasRole("ROLE_MONITOR")).thenReturn(true);
        when(guardSec.getCurrentHallName()).thenReturn("Hall B1");
        ScheduleService guardSvc = new ScheduleService(mockSchedRepo, guardSec);

        java.time.ZoneId witaZone = java.time.ZoneId.of("Asia/Makassar");
        LocalDate todayWita = LocalDate.now(witaZone);
        LocalDate tomorrowWita = todayWita.plusDays(1);
        when(mockSchedRepo.getMaxDailySessions()).thenReturn(2);
        when(mockSchedRepo.findAllSchedules(ScheduleStatus.ACTIVE, "Hall B1")).thenReturn(List.of());

        // 1) Monitor creating ONE_TIME for tomorrow is rejected with ONE_TIME_MUST_BE_TODAY
        CreateScheduleRequest tomorrowOneTime = new CreateScheduleRequest(
                "Jadwal Besok", null, ScheduleKind.ONE_TIME,
                tomorrowWita.atTime(20, 0).atZone(witaZone).toOffsetDateTime(),
                tomorrowWita.atTime(21, 0).atZone(witaZone).toOffsetDateTime(),
                null, null, null, tomorrowWita, tomorrowWita, null, "Hall B1"
        );
        assertThatThrownBy(() -> guardSvc.createSchedule(tomorrowOneTime))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("ONE_TIME_MUST_BE_TODAY"));

        // 2) Monitor creating ONE_TIME for today normalizes validFrom/validTo to today..today and auto-inserts today's session
        OffsetDateTime todayStart = todayWita.atTime(23, 0).atZone(witaZone).toOffsetDateTime();
        OffsetDateTime todayEnd = todayWita.atTime(23, 55).atZone(witaZone).toOffsetDateTime();
        UUID todaySchedId = UUID.randomUUID();
        when(mockSchedRepo.findNonCancelledSessionsOnDate(todayWita, "Hall B1")).thenReturn(List.of());
        when(mockSchedRepo.insertSchedule(any(), eq(guardId))).thenReturn(todaySchedId);
        when(mockSchedRepo.findScheduleById(todaySchedId)).thenReturn(Optional.of(new ScheduleDto(
                todaySchedId, "Apel Hari Ini", null, "IBADAH_RUTIN", "Ibadah Rutin",
                ScheduleKind.ONE_TIME, todayStart, todayEnd, null, null, null,
                todayWita, todayWita, ScheduleStatus.ACTIVE, null, guardId,
                OffsetDateTime.now(), OffsetDateTime.now(), "Hall B1"
        )));

        CreateScheduleRequest todayReqWithWideValidity = new CreateScheduleRequest(
                "Apel Hari Ini", null, ScheduleKind.ONE_TIME,
                todayStart, todayEnd, null, null, null,
                todayWita, todayWita.plusDays(90), null, "Hall B1"
        );
        ScheduleDto created = guardSvc.createSchedule(todayReqWithWideValidity);
        assertThat(created.id()).isEqualTo(todaySchedId);
        verify(mockSchedRepo).insertSchedule(argThat(req ->
                todayWita.equals(req.validFrom()) && todayWita.equals(req.validTo())
        ), eq(guardId));
        verify(mockSchedRepo).insertSession(eq(todaySchedId), eq(todayStart), eq(todayEnd), any(SessionStatus.class), eq(guardId), eq("Hall B1"));

        // 3) Monitor updating ONE_TIME to tomorrow is also rejected with ONE_TIME_MUST_BE_TODAY
        UpdateScheduleRequest updateToTomorrow = new UpdateScheduleRequest(
                "Apel Besok", null, ScheduleKind.ONE_TIME,
                tomorrowWita.atTime(20, 0).atZone(witaZone).toOffsetDateTime(),
                tomorrowWita.atTime(21, 0).atZone(witaZone).toOffsetDateTime(),
                null, null, null, tomorrowWita, tomorrowWita,
                ScheduleStatus.ACTIVE, null, "Hall B1"
        );
        assertThatThrownBy(() -> guardSvc.updateSchedule(todaySchedId, updateToTomorrow))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode()).isEqualTo("ONE_TIME_MUST_BE_TODAY"));

        // 4) Monitor creating RECURRING schedule with custom validFrom..validTo still works
        UUID recId = UUID.randomUUID();
        LocalDate recTo = todayWita.plusDays(30);
        when(mockSchedRepo.insertSchedule(any(), eq(guardId))).thenReturn(recId);
        when(mockSchedRepo.findScheduleById(recId)).thenReturn(Optional.of(new ScheduleDto(
                recId, "Rutin Malam", null, "IBADAH_RUTIN", "Ibadah Rutin",
                ScheduleKind.RECURRING, null, null, List.of((short) 1, (short) 3),
                LocalTime.of(20, 0), LocalTime.of(21, 0), todayWita, recTo,
                ScheduleStatus.ACTIVE, null, guardId,
                OffsetDateTime.now(), OffsetDateTime.now(), "Hall B1"
        )));
        ScheduleDto recurringCreated = guardSvc.createSchedule(new CreateScheduleRequest(
                "Rutin Malam", null, ScheduleKind.RECURRING,
                null, null, List.of((short) 1, (short) 3),
                LocalTime.of(20, 0), LocalTime.of(21, 0),
                todayWita, recTo, null, "Hall B1"
        ));
        assertThat(recurringCreated.id()).isEqualTo(recId);
        assertThat(recurringCreated.validTo()).isEqualTo(recTo);
    }
}
