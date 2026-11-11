package id.ac.unklab.asrama.admin;

import id.ac.unklab.asrama.admin.AdminDtos.*;
import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.ResidenceCategory;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import id.ac.unklab.asrama.enrollment.EnrollmentRepository;
import id.ac.unklab.asrama.resident.ResidentDtos.ResidentProfileDto;
import id.ac.unklab.asrama.resident.ResidentRepository;
import id.ac.unklab.asrama.security.JwtTokenService;
import id.ac.unklab.asrama.storage.SupabaseStorageService;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
public class AdminService {

    private static final Logger log = LoggerFactory.getLogger(AdminService.class);

    private final AdminRepository adminRepository;
    private final ResidentRepository residentRepository;
    private final EnrollmentRepository enrollmentRepository;
    private final SupabaseStorageService storageService;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenService jwtTokenService;

    @Autowired
    public AdminService(
            AdminRepository adminRepository,
            ResidentRepository residentRepository,
            EnrollmentRepository enrollmentRepository,
            SupabaseStorageService storageService,
            PasswordEncoder passwordEncoder,
            JwtTokenService jwtTokenService
    ) {
        this.adminRepository = adminRepository;
        this.residentRepository = residentRepository;
        this.enrollmentRepository = enrollmentRepository;
        this.storageService = storageService;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenService = jwtTokenService;
    }

    public AdminService(
            AdminRepository adminRepository,
            ResidentRepository residentRepository,
            EnrollmentRepository enrollmentRepository,
            SupabaseStorageService storageService,
            PasswordEncoder passwordEncoder
    ) {
        this(adminRepository, residentRepository, enrollmentRepository, storageService, passwordEncoder, null);
    }

    @Transactional
    public ResidentProfileDto createResident(CreateResidentRequest request) {
        Optional<ResidentProfileDto> existing = residentRepository.findByNim(request.nim());
        if (existing.isPresent()) {
            throw BusinessException.conflict("NIM_ALREADY_EXISTS",
                    "Penghuni dengan NIM " + request.nim().trim() + " sudah terdaftar");
        }
        UUID id = adminRepository.insertResident(
                request.nim(),
                request.fullName(),
                request.status() != null ? request.status() : ResidentStatus.AKTIF,
                request.residenceCategory() != null ? request.residenceCategory() : ResidenceCategory.ASRAMA,
                request.building(),
                request.roomNumber()
        );
        return residentRepository.findById(id).orElseThrow();
    }

    @Transactional
    public ResidentProfileDto updateResident(UUID residentId, UpdateResidentRequest request) {
        ResidentProfileDto current = residentRepository.findById(residentId)
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Penghuni tidak ditemukan"));

        if (!current.nim().equals(request.nim().trim())) {
            residentRepository.findByNim(request.nim().trim()).ifPresent(other -> {
                throw BusinessException.conflict("NIM_ALREADY_EXISTS", "NIM " + request.nim().trim() + " sudah digunakan");
            });
        }

        adminRepository.updateResident(
                residentId,
                request.nim(),
                request.fullName(),
                request.status(),
                request.residenceCategory(),
                request.building(),
                request.roomNumber()
        );
        return residentRepository.findById(residentId).orElseThrow();
    }

    @Transactional
    public ResidentProfileDto changeResidentStatus(UUID residentId, ResidentStatus newStatus) {
        residentRepository.findById(residentId)
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Penghuni tidak ditemukan"));
        adminRepository.updateResidentStatus(residentId, newStatus);
        return residentRepository.findById(residentId).orElseThrow();
    }

    /**
     * A-03 & K-05: Menghapus data penghuni sesuai aturan retensi:
     * - Menghapus face_profiles, face_profile_history, face_enrollments, consent_records, dan akun users penghuni (ON DELETE CASCADE).
     * - Mempertahankan riwayat presensi di attendance_records (ON DELETE SET NULL dengan snapshot resident_nim & resident_name tetap utuh).
     */
    @Transactional
    public void deleteResidentWithRetentionPolicy(UUID residentId) {
        residentRepository.findById(residentId)
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Penghuni tidak ditemukan"));
        adminRepository.deleteResident(residentId);
        log.info("Deleted resident with retention compliance (face profile purged, attendance history preserved): residentId={}", residentId);
    }

    @Transactional
    public int purgeExpiredBiometricRetentionData() {
        return enrollmentRepository.purgeExpiredFaceData();
    }

    /**
     * Import CSV daftar penghuni resmi dengan validasi per baris (A-02).
     * Header didukung: nim,full_name,status,residence_category,building,room_number
     */
    @Transactional
    public CsvImportSummaryDto importResidentsFromCsv(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw BusinessException.badRequest("EMPTY_CSV_FILE", "File CSV daftar penghuni tidak boleh kosong");
        }

        int totalRows = 0;
        int inserted = 0;
        int updated = 0;
        List<CsvRowValidationError> errors = new ArrayList<>();
        Set<String> seenNimsInFile = new HashSet<>();

        CSVFormat format = CSVFormat.DEFAULT.builder()
                .setHeader()
                .setSkipHeaderRecord(true)
                .setIgnoreHeaderCase(true)
                .setTrim(true)
                .setIgnoreEmptyLines(true)
                .build();

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8));
             CSVParser parser = new CSVParser(reader, format)) {

            for (CSVRecord record : parser) {
                totalRows++;
                int rowNum = (int) record.getRecordNumber() + 1;
                String nim = getColumn(record, "nim");
                String fullName = getColumn(record, "full_name", "nama", "name");
                String statusStr = getColumn(record, "status");
                String categoryStr = getColumn(record, "residence_category", "category", "kategori");
                String building = getColumn(record, "building", "gedung", "asrama");
                String roomNumber = getColumn(record, "room_number", "kamar", "room");

                if (nim == null || nim.isBlank() || nim.length() < 5 || nim.length() > 30) {
                    errors.add(new CsvRowValidationError(rowNum, nim, "NIM wajib diisi (5-30 karakter)"));
                    continue;
                }
                if (fullName == null || fullName.isBlank() || fullName.length() < 2) {
                    errors.add(new CsvRowValidationError(rowNum, nim, "Nama lengkap wajib diisi"));
                    continue;
                }
                if (!seenNimsInFile.add(nim)) {
                    errors.add(new CsvRowValidationError(rowNum, nim, "Duplikasi NIM di dalam file CSV yang sama"));
                    continue;
                }

                ResidentStatus status = ResidentStatus.AKTIF;
                if (statusStr != null && !statusStr.isBlank()) {
                    try {
                        status = ResidentStatus.valueOf(statusStr.toUpperCase());
                    } catch (IllegalArgumentException ex) {
                        errors.add(new CsvRowValidationError(rowNum, nim, "Status tidak valid (gunakan AKTIF atau NONAKTIF)"));
                        continue;
                    }
                }

                ResidenceCategory category = ResidenceCategory.ASRAMA;
                if (categoryStr != null && !categoryStr.isBlank()) {
                    try {
                        category = ResidenceCategory.valueOf(categoryStr.toUpperCase());
                    } catch (IllegalArgumentException ex) {
                        errors.add(new CsvRowValidationError(rowNum, nim,
                                "Kategori tempat tinggal tidak valid (gunakan ASRAMA, LUAR_DEKAT, atau LUAR_JAUH)"));
                        continue;
                    }
                }

                Optional<ResidentProfileDto> existing = residentRepository.findByNim(nim);
                if (existing.isPresent()) {
                    adminRepository.updateResident(
                            existing.get().id(),
                            nim,
                            fullName,
                            status,
                            category,
                            building,
                            roomNumber
                    );
                    updated++;
                } else {
                    adminRepository.insertResident(nim, fullName, status, category, building, roomNumber);
                    inserted++;
                }
            }
        } catch (Exception ex) {
            throw BusinessException.badRequest("CSV_PARSE_ERROR", "Format file CSV tidak valid: " + ex.getMessage());
        }

        return new CsvImportSummaryDto(totalRows, inserted, updated, errors.size(), errors);
    }

    @Transactional(readOnly = true)
    public List<UserAccountDto> listUsers(UserRole role, String search, Integer limit, Integer offset) {
        return adminRepository.findAllUsers(role, search, limit, offset);
    }

    @Transactional(readOnly = true)
    public List<UserAccountDto> listUsers(UserRole role) {
        return listUsers(role, null, null, null);
    }

    @Transactional
    public UserAccountDto createStaffUser(CreateStaffUserRequest request) {
        if (request.role() == UserRole.PENGHUNI) {
            throw BusinessException.badRequest("INVALID_STAFF_ROLE",
                    "Akun PENGHUNI wajib didaftarkan melalui registrasi penghuni dengan NIM resmi");
        }
        String hash = passwordEncoder.encode(request.password());
        UUID userId = adminRepository.insertStaffUser(request.username(), request.email(), hash, request.role());
        return adminRepository.findUserAccountById(userId).orElseThrow();
    }

    @Transactional
    public UserAccountDto setUserActive(UUID userId, boolean isActive) {
        adminRepository.findUserAccountById(userId)
                .orElseThrow(() -> BusinessException.notFound("USER_NOT_FOUND", "Akun pengguna tidak ditemukan"));
        adminRepository.updateUserActiveStatus(userId, isActive);
        if (jwtTokenService != null) {
            jwtTokenService.setUserDisabled(userId, !isActive);
        }
        return adminRepository.findUserAccountById(userId).orElseThrow();
    }

    @Transactional
    public void resetUserPassword(UUID userId, ResetUserPasswordRequest request) {
        adminRepository.findUserAccountById(userId)
                .orElseThrow(() -> BusinessException.notFound("USER_NOT_FOUND", "Akun pengguna tidak ditemukan"));
        String hash = passwordEncoder.encode(request.newPassword());
        adminRepository.resetUserPassword(userId, hash);
        if (jwtTokenService != null) {
            jwtTokenService.revokeAllUserTokens(userId);
        }
    }

    @Transactional
    public UserAccountDto updateUserRole(UUID userId, UserRole newRole) {
        adminRepository.findUserAccountById(userId)
                .orElseThrow(() -> BusinessException.notFound("USER_NOT_FOUND", "Akun pengguna tidak ditemukan"));
        adminRepository.updateUserRole(userId, newRole);
        if (jwtTokenService != null) {
            jwtTokenService.revokeAllUserTokens(userId);
        }
        return adminRepository.findUserAccountById(userId).orElseThrow();
    }

    private String getColumn(CSVRecord record, String... candidateNames) {
        for (String name : candidateNames) {
            if (record.isMapped(name)) {
                String val = record.get(name);
                return val != null ? val.trim() : null;
            }
        }
        return null;
    }
}
