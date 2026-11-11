package id.ac.unklab.asrama;

import com.fasterxml.jackson.databind.ObjectMapper;
import id.ac.unklab.asrama.admin.AdminService;
import id.ac.unklab.asrama.attendance.AttendanceDtos.DashboardStatsDto;
import id.ac.unklab.asrama.attendance.AttendanceService;
import id.ac.unklab.asrama.auth.AuthDtos.LoginRequest;
import id.ac.unklab.asrama.auth.AuthService;
import id.ac.unklab.asrama.common.DomainEnums.ResidenceCategory;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import id.ac.unklab.asrama.enrollment.EnrollmentService;
import id.ac.unklab.asrama.report.ReportService;
import id.ac.unklab.asrama.resident.ResidentDtos.ResidentProfileDto;
import id.ac.unklab.asrama.resident.ResidentService;
import id.ac.unklab.asrama.schedule.ScheduleService;
import id.ac.unklab.asrama.security.JwtTokenService;
import id.ac.unklab.asrama.security.RateLimitFilter;
import id.ac.unklab.asrama.violation.ViolationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:asramatest;DB_CLOSE_DELAY=-1;MODE=PostgreSQL",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "app.rls.enabled=false",
        "app.rate-limit.auth-requests-per-minute=5"
})
class SecurityAndRestIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtTokenService jwtTokenService;

    @Autowired
    private RateLimitFilter rateLimitFilter;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AuthService authService;

    @MockBean
    private ResidentService residentService;

    @MockBean
    private EnrollmentService enrollmentService;

    @MockBean
    private AttendanceService attendanceService;

    @MockBean
    private ScheduleService scheduleService;

    @MockBean
    private AdminService adminService;

    @MockBean
    private ViolationService violationService;

    @MockBean
    private ReportService reportService;

    @BeforeEach
    void resetRateLimit() {
        rateLimitFilter.resetAllCounters();
        rateLimitFilter.setMinuteWindowSupplier(() -> 1000L);
    }

    @Test
    @DisplayName("1. Unauthenticated Request to Protected Endpoint Returns 401 UNAUTHORIZED")
    void testUnauthenticatedRequestBlocked() throws Exception {
        mockMvc.perform(get("/api/v1/residents/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    @DisplayName("2. Role-Based Authorization: PENGHUNI Blocked From /api/v1/admin/** and /api/v1/attendance/dashboard (403 FORBIDDEN)")
    void testRoleBasedAccessControl() throws Exception {
        String penghuniToken = jwtTokenService.generateAccessToken(
                UUID.randomUUID(), "10502211001", UserRole.PENGHUNI, UUID.randomUUID()
        );

        mockMvc.perform(get("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + penghuniToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        mockMvc.perform(get("/api/v1/attendance/dashboard")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + penghuniToken))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("3. Authorized Roles Can Access Their Respective Endpoints & Never Expose Embeddings")
    void testAuthorizedEndpointsForPenghuniAndMonitor() throws Exception {
        UUID residentId = UUID.randomUUID();
        String penghuniToken = jwtTokenService.generateAccessToken(
                UUID.randomUUID(), "10502211001", UserRole.PENGHUNI, residentId
        );

        when(residentService.getMyResidentProfile()).thenReturn(new ResidentProfileDto(
                residentId, "10502211001", "Mahasiswa Satu", ResidentStatus.AKTIF,
                ResidenceCategory.ASRAMA, "Crystal", "101", true, OffsetDateTime.now(),
                true, "v1.0", OffsetDateTime.now(), OffsetDateTime.now()
        ));

        mockMvc.perform(get("/api/v1/residents/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + penghuniToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.nim").value("10502211001"))
                .andExpect(jsonPath("$.data.embedding").doesNotExist())
                .andExpect(jsonPath("$.data.candidateEmbedding").doesNotExist());

        String monitorToken = jwtTokenService.generateAccessToken(
                UUID.randomUUID(), "monitor01", UserRole.MONITOR, null
        );
        when(attendanceService.getDashboardStats()).thenReturn(new DashboardStatsDto(
                120, 115, 1, 98, 22, 81.67, List.of()
        ));

        mockMvc.perform(get("/api/v1/attendance/dashboard")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + monitorToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalActiveResidents").value(120));
    }

    @Test
    @DisplayName("4. Rate Limiting on Sensitive Login Endpoint Returns 429 TOO_MANY_REQUESTS When Exceeded")
    void testRateLimitingOnAuthEndpoint() throws Exception {
        String body = objectMapper.writeValueAsString(new LoginRequest("10502211001", "Password123"));

        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/v1/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isOk());
        }

        // 6th request in the same minute exceeds test limit (5 RPM) -> 429
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("RATE_LIMIT_EXCEEDED"));
    }

    @Test
    @DisplayName("5. OpenAPI / Swagger UI Endpoints Are Accessible")
    void testSwaggerOpenApiDocsAccessible() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.info.title").value("Asrama Presensi UNKLAB Backend API"));
    }

    @Test
    @DisplayName("6. Schedule Change History Endpoint Authorized for Staff and Blocked for PENGHUNI")
    void testScheduleHistoryEndpointAuthorization() throws Exception {
        UUID scheduleId = UUID.randomUUID();
        String penghuniToken = jwtTokenService.generateAccessToken(
                UUID.randomUUID(), "10502211001", UserRole.PENGHUNI, UUID.randomUUID()
        );
        String monitorToken = jwtTokenService.generateAccessToken(
                UUID.randomUUID(), "monitor01", UserRole.MONITOR, null
        );

        mockMvc.perform(get("/api/v1/schedules/" + scheduleId + "/history")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + penghuniToken))
                .andExpect(status().isForbidden());

        when(scheduleService.getScheduleHistory(scheduleId)).thenReturn(List.of());
        mockMvc.perform(get("/api/v1/schedules/" + scheduleId + "/history")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + monitorToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    @DisplayName("7. AI Health Status Endpoint Accessible & Deactivated User Token Blocked in Filter")
    void testAiHealthEndpointAndDeactivatedUserTokenBlocked() throws Exception {
        when(attendanceService.isAiServiceHealthy()).thenReturn(true);

        mockMvc.perform(get("/api/v1/attendance/ai-status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.available").value(true));

        // When user is disabled, their token is immediately rejected with 401 UNAUTHORIZED by JwtAuthenticationFilter
        UUID disabledUserId = UUID.randomUUID();
        String token = jwtTokenService.generateAccessToken(disabledUserId, "10502211099", UserRole.PENGHUNI, UUID.randomUUID());
        jwtTokenService.setUserDisabled(disabledUserId, true);

        mockMvc.perform(get("/api/v1/residents/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    @DisplayName("8. Tampered or Forged JWT Token is Blocked with 401 UNAUTHORIZED")
    void testTamperedJwtBlocked() throws Exception {
        String token = jwtTokenService.generateAccessToken(
                UUID.randomUUID(), "10502211001", UserRole.PENGHUNI, UUID.randomUUID()
        );
        String forgedToken = token.substring(0, token.length() - 6) + "XXXXXX";

        mockMvc.perform(get("/api/v1/residents/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + forgedToken))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    @DisplayName("9. Revoked JWT Token (Logged Out JTI) is Blocked with 401 UNAUTHORIZED")
    void testRevokedTokenBlocked() throws Exception {
        UUID userId = UUID.randomUUID();
        String token = jwtTokenService.generateAccessToken(
                userId, "10502211001", UserRole.PENGHUNI, UUID.randomUUID()
        );
        io.jsonwebtoken.Claims claims = jwtTokenService.parseAndValidateToken(token, "ACCESS");
        jwtTokenService.revokeToken(claims.getId());

        mockMvc.perform(get("/api/v1/residents/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    @DisplayName("10. IDOR Defense: PENGHUNI Accessing Another Resident Profile Blocked with 403 FORBIDDEN")
    void testCrossUserAccessBlocked_IDOR() throws Exception {
        UUID residentA = UUID.randomUUID();
        UUID residentB = UUID.randomUUID();
        String tokenResidentA = jwtTokenService.generateAccessToken(
                UUID.randomUUID(), "10502211001", UserRole.PENGHUNI, residentA
        );

        when(residentService.getResidentById(residentB)).thenThrow(
                id.ac.unklab.asrama.common.BusinessException.forbidden("FORBIDDEN_OWNERSHIP",
                        "Penghuni hanya diizinkan mengakses data miliknya sendiri")
        );

        mockMvc.perform(get("/api/v1/residents/" + residentB)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenResidentA))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN_OWNERSHIP"));
    }

    @Test
    @DisplayName("11. Role Isolation: MONITOR Role Blocked From Administrative User & Resident Management (403 FORBIDDEN)")
    void testMonitorCannotAccessAdminEndpoints() throws Exception {
        String monitorToken = jwtTokenService.generateAccessToken(
                UUID.randomUUID(), "monitor01", UserRole.MONITOR, null
        );

        mockMvc.perform(get("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + monitorToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        mockMvc.perform(post("/api/v1/admin/residents")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + monitorToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nim\":\"10502211099\",\"fullName\":\"Test\",\"residenceCategory\":\"ASRAMA\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("12. Role Isolation: PENGHUNI Blocked From Manual Attendance & Opening Sessions (403 FORBIDDEN)")
    void testPenghuniCannotAccessStaffEndpoints() throws Exception {
        String penghuniToken = jwtTokenService.generateAccessToken(
                UUID.randomUUID(), "10502211001", UserRole.PENGHUNI, UUID.randomUUID()
        );

        mockMvc.perform(post("/api/v1/attendance/manual")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + penghuniToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":\"" + UUID.randomUUID() + "\",\"residentId\":\"" + UUID.randomUUID() + "\",\"status\":\"HADIR\",\"reason\":\"Test manual attendance\"}"))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/schedules/sessions")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + penghuniToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"scheduleId\":\"" + UUID.randomUUID() + "\",\"startsAt\":\"2026-11-10T19:00:00+08:00\",\"endsAt\":\"2026-11-10T21:00:00+08:00\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("13. Route Aliases: /api/v1/schedules/active-session and /api/v1/violations/coaching Route Correctly")
    void testRouteAliases() throws Exception {
        String adminToken = jwtTokenService.generateAccessToken(
                UUID.randomUUID(), "admin01", UserRole.ADMIN, null
        );

        when(scheduleService.getActiveSessionOrThrow()).thenReturn(null);
        mockMvc.perform(get("/api/v1/schedules/active-session")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                .andExpect(status().isOk());

        when(violationService.listCoachingRecords(any(), any(), any())).thenReturn(List.of());
        mockMvc.perform(get("/api/v1/violations/coaching")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                .andExpect(status().isOk());
    }
}
