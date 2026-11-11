package id.ac.unklab.asrama.auth;

import id.ac.unklab.asrama.auth.AuthDtos.*;
import id.ac.unklab.asrama.common.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
@Tag(name = "01. Authentication & Session", description = "Registrasi penghuni (P-01), Login multi-role & lockout 5x gagal (A-01, A-04), Refresh JWT, dan Logout")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    @Operation(summary = "Registrasi akun penghuni menggunakan NIM resmi (P-01)")
    public ResponseEntity<ApiResponse<UserSessionDto>> register(@Valid @RequestBody RegisterResidentRequest request) {
        UserSessionDto created = authService.registerResident(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Registrasi akun penghuni berhasil", created));
    }

    @PostMapping("/login")
    @Operation(summary = "Login semua role (PENGHUNI, MONITOR, ADMIN, VILLAGE_DEAN) dengan proteksi lockout 5x gagal (A-01, A-04)")
    public ResponseEntity<ApiResponse<AuthTokenResponse>> login(@Valid @RequestBody LoginRequest request) {
        AuthTokenResponse tokens = authService.login(request);
        return ResponseEntity.ok(ApiResponse.ok("Login berhasil", tokens));
    }

    @PostMapping("/refresh")
    @Operation(summary = "Memperbarui Access Token menggunakan Refresh Token")
    public ResponseEntity<ApiResponse<AuthTokenResponse>> refresh(@Valid @RequestBody RefreshTokenRequest request) {
        AuthTokenResponse tokens = authService.refreshToken(request);
        return ResponseEntity.ok(ApiResponse.ok("Token berhasil diperbarui", tokens));
    }

    @PostMapping("/logout")
    @Operation(summary = "Logout dan mencabut Access/Refresh Token aktif")
    public ResponseEntity<ApiResponse<Void>> logout(@RequestBody(required = false) LogoutRequest request) {
        authService.logout(request);
        return ResponseEntity.ok(ApiResponse.ok("Logout berhasil", null));
    }

    @GetMapping("/me")
    @Operation(summary = "Mendapatkan profil akun & sesi pengguna yang sedang login")
    public ResponseEntity<ApiResponse<UserSessionDto>> me() {
        return ResponseEntity.ok(ApiResponse.ok("Profil sesi aktif", authService.getCurrentSessionProfile()));
    }

    @PostMapping("/change-password")
    @Operation(summary = "Mengubah password akun milik sendiri")
    public ResponseEntity<ApiResponse<Void>> changePassword(@Valid @RequestBody ChangePasswordRequest request) {
        authService.changeOwnPassword(request);
        return ResponseEntity.ok(ApiResponse.ok("Password berhasil diperbarui", null));
    }
}
