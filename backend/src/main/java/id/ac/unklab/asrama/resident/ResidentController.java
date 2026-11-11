package id.ac.unklab.asrama.resident;

import id.ac.unklab.asrama.common.ApiResponse;
import id.ac.unklab.asrama.common.DomainEnums.ResidenceCategory;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.resident.ResidentDtos.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/residents")
@Tag(name = "02. Resident & Consent Management", description = "Profil penghuni, kategori tempat tinggal, persetujuan biometrik wajah (P-05), dan kontak darurat")
public class ResidentController {

    private final ResidentService residentService;

    public ResidentController(ResidentService residentService) {
        this.residentService = residentService;
    }

    @GetMapping("/me")
    @PreAuthorize("hasRole('PENGHUNI')")
    @Operation(summary = "Mendapatkan profil penghuni milik pengguna PENGHUNI yang sedang login")
    public ResponseEntity<ApiResponse<ResidentProfileDto>> getMyProfile() {
        return ResponseEntity.ok(ApiResponse.ok("Profil penghuni", residentService.getMyResidentProfile()));
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR', 'VILLAGE_DEAN')")
    @Operation(summary = "Daftar seluruh penghuni dengan filter status, kategori tempat tinggal, pencarian NIM/Nama, dan paginasi")
    public ResponseEntity<ApiResponse<List<ResidentProfileDto>>> listResidents(
            @RequestParam(required = false) ResidentStatus status,
            @RequestParam(required = false) ResidenceCategory category,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        return ResponseEntity.ok(ApiResponse.ok(
                "Daftar penghuni berhasil dimuat",
                residentService.listResidents(status, category, search, limit, offset)
        ));
    }

    @GetMapping("/{residentId}")
    @Operation(summary = "Detail profil penghuni berdasarkan ID (dilindungi kepemilikan data & RLS)")
    public ResponseEntity<ApiResponse<ResidentProfileDto>> getResidentById(@PathVariable UUID residentId) {
        return ResponseEntity.ok(ApiResponse.ok("Detail penghuni", residentService.getResidentById(residentId)));
    }

    @PostMapping("/{residentId}/consents")
    @PreAuthorize("hasAnyRole('PENGHUNI', 'ADMIN')")
    @Operation(summary = "Memberikan persetujuan pengumpulan & pemrosesan data biometrik wajah (P-05)")
    public ResponseEntity<ApiResponse<ConsentDto>> giveConsent(
            @PathVariable UUID residentId,
            @Valid @RequestBody ConsentRequest request
    ) {
        ConsentDto consent = residentService.recordConsent(residentId, request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Persetujuan data wajah berhasil disimpan", consent));
    }

    @GetMapping("/{residentId}/consents")
    @Operation(summary = "Riwayat persetujuan data biometrik wajah penghuni")
    public ResponseEntity<ApiResponse<List<ConsentDto>>> getConsents(@PathVariable UUID residentId) {
        return ResponseEntity.ok(ApiResponse.ok("Riwayat persetujuan data wajah", residentService.getConsents(residentId)));
    }

    @PostMapping("/{residentId}/consents/revoke")
    @PreAuthorize("hasAnyRole('PENGHUNI', 'ADMIN')")
    @Operation(summary = "Mencabut persetujuan data biometrik wajah aktif")
    public ResponseEntity<ApiResponse<Void>> revokeConsent(@PathVariable UUID residentId) {
        residentService.revokeConsent(residentId);
        return ResponseEntity.ok(ApiResponse.ok("Persetujuan data wajah berhasil dicabut", null));
    }

    @GetMapping("/{residentId}/emergency-contacts")
    @Operation(summary = "Daftar kontak darurat penghuni")
    public ResponseEntity<ApiResponse<List<EmergencyContactDto>>> getEmergencyContacts(@PathVariable UUID residentId) {
        return ResponseEntity.ok(ApiResponse.ok("Daftar kontak darurat", residentService.getEmergencyContacts(residentId)));
    }

    @PostMapping("/{residentId}/emergency-contacts")
    @PreAuthorize("hasAnyRole('PENGHUNI', 'ADMIN', 'VILLAGE_DEAN')")
    @Operation(summary = "Menambahkan kontak darurat penghuni")
    public ResponseEntity<ApiResponse<EmergencyContactDto>> addEmergencyContact(
            @PathVariable UUID residentId,
            @Valid @RequestBody EmergencyContactRequest request
    ) {
        EmergencyContactDto created = residentService.addEmergencyContact(residentId, request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Kontak darurat berhasil ditambahkan", created));
    }
}
