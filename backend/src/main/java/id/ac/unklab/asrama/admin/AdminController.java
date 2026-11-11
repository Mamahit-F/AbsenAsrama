package id.ac.unklab.asrama.admin;

import id.ac.unklab.asrama.admin.AdminDtos.*;
import id.ac.unklab.asrama.common.ApiResponse;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import id.ac.unklab.asrama.resident.ResidentDtos.ResidentProfileDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("hasRole('ADMIN')")
@Tag(name = "06. Admin Management (Residents, CSV Import, Staff/Monitor Accounts & Retention)",
        description = "Pengelolaan daftar penghuni resmi, import CSV tervalidasi per baris (A-02), hapus sesuai retensi (A-03), dan pengelolaan akun MONITOR/staff (A-04)")
public class AdminController {

    private final AdminService adminService;

    public AdminController(AdminService adminService) {
        this.adminService = adminService;
    }

    @PostMapping("/residents")
    @Operation(summary = "Menambahkan penghuni baru ke daftar penghuni resmi (A-02)")
    public ResponseEntity<ApiResponse<ResidentProfileDto>> createResident(@Valid @RequestBody CreateResidentRequest request) {
        ResidentProfileDto created = adminService.createResident(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Data penghuni berhasil ditambahkan", created));
    }

    @PutMapping("/residents/{residentId}")
    @Operation(summary = "Mengubah data penghuni (NIM, nama, status, kategori tempat tinggal, asrama/kamar)")
    public ResponseEntity<ApiResponse<ResidentProfileDto>> updateResident(
            @PathVariable UUID residentId,
            @Valid @RequestBody UpdateResidentRequest request
    ) {
        ResidentProfileDto updated = adminService.updateResident(residentId, request);
        return ResponseEntity.ok(ApiResponse.ok("Data penghuni berhasil diperbarui", updated));
    }

    @PatchMapping("/residents/{residentId}/status")
    @Operation(summary = "Mengaktifkan atau menonaktifkan status penghuni (AKTIF / NONAKTIF)")
    public ResponseEntity<ApiResponse<ResidentProfileDto>> changeResidentStatus(
            @PathVariable UUID residentId,
            @Valid @RequestBody ChangeResidentStatusRequest request
    ) {
        ResidentProfileDto updated = adminService.changeResidentStatus(residentId, request.status());
        return ResponseEntity.ok(ApiResponse.ok("Status penghuni berhasil diubah", updated));
    }

    @DeleteMapping("/residents/{residentId}")
    @Operation(summary = "Menghapus data penghuni sesuai aturan retensi: profil wajah & akun dihapus, riwayat presensi tetap tersimpan (A-03)")
    public ResponseEntity<ApiResponse<Void>> deleteResident(@PathVariable UUID residentId) {
        adminService.deleteResidentWithRetentionPolicy(residentId);
        return ResponseEntity.ok(ApiResponse.ok(
                "Data penghuni dan profil wajah telah dihapus; riwayat presensi tetap dipertahankan sesuai aturan retensi",
                null
        ));
    }

    @PostMapping(value = "/residents/import-csv", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Import daftar penghuni resmi dari file CSV dengan validasi setiap baris (A-02)")
    public ResponseEntity<ApiResponse<CsvImportSummaryDto>> importResidentsCsv(@RequestParam("file") MultipartFile file) {
        CsvImportSummaryDto summary = adminService.importResidentsFromCsv(file);
        return ResponseEntity.ok(ApiResponse.ok("Proses import CSV penghuni selesai", summary));
    }

    @PostMapping("/retention/purge-biometrics")
    @Operation(summary = "Menjalankan pembersihan data histori biometrik wajah yang telah melewati masa retensi")
    public ResponseEntity<ApiResponse<Map<String, Integer>>> purgeExpiredBiometrics() {
        int purged = adminService.purgeExpiredBiometricRetentionData();
        return ResponseEntity.ok(ApiResponse.ok("Pembersihan retensi data biometrik selesai", Map.of("purgedCount", purged)));
    }

    @GetMapping("/users")
    @Operation(summary = "Daftar seluruh akun pengguna (PENGHUNI, MONITOR, VILLAGE_DEAN, ADMIN) dengan filter role, pencarian, dan paginasi")
    public ResponseEntity<ApiResponse<List<UserAccountDto>>> listUsers(
            @RequestParam(required = false) UserRole role,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        return ResponseEntity.ok(ApiResponse.ok("Daftar akun pengguna", adminService.listUsers(role, search, limit, offset)));
    }

    @PostMapping("/users")
    @Operation(summary = "Membuat akun petugas baru (MONITOR, VILLAGE_DEAN, atau ADMIN) (A-04)")
    public ResponseEntity<ApiResponse<UserAccountDto>> createStaffUser(@Valid @RequestBody CreateStaffUserRequest request) {
        UserAccountDto created = adminService.createStaffUser(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Akun petugas berhasil dibuat", created));
    }

    @PatchMapping({"/users/{userId}/active", "/users/{userId}/status"})
    @Operation(summary = "Mengaktifkan atau menonaktifkan akun pengguna serta membuka kunci lockout")
    public ResponseEntity<ApiResponse<UserAccountDto>> setUserActive(
            @PathVariable UUID userId,
            @Valid @RequestBody ChangeUserActiveRequest request
    ) {
        UserAccountDto updated = adminService.setUserActive(userId, request.isActive());
        return ResponseEntity.ok(ApiResponse.ok("Status aktif akun berhasil diperbarui", updated));
    }

    @PatchMapping("/users/{userId}/role")
    @Operation(summary = "Mengubah role kewenangan pengguna dalam sistem (ADMIN, MONITOR, VILLAGE_DEAN, PENGHUNI)")
    public ResponseEntity<ApiResponse<UserAccountDto>> updateUserRole(
            @PathVariable UUID userId,
            @Valid @RequestBody ChangeUserRoleRequest request
    ) {
        UserAccountDto updated = adminService.updateUserRole(userId, request.role());
        return ResponseEntity.ok(ApiResponse.ok("Role pengguna berhasil diperbarui", updated));
    }

    @PostMapping("/users/{userId}/reset-password")
    @Operation(summary = "Reset password akun pengguna dan membuka kunci lockout (A-04)")
    public ResponseEntity<ApiResponse<Void>> resetUserPassword(
            @PathVariable UUID userId,
            @Valid @RequestBody ResetUserPasswordRequest request
    ) {
        adminService.resetUserPassword(userId, request);
        return ResponseEntity.ok(ApiResponse.ok("Password akun berhasil di-reset", null));
    }
}
