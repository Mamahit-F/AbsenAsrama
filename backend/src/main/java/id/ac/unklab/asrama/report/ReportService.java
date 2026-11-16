package id.ac.unklab.asrama.report;

import id.ac.unklab.asrama.common.DomainEnums.AttendanceMethod;
import id.ac.unklab.asrama.common.DomainEnums.AttendanceStatus;
import id.ac.unklab.asrama.common.DomainEnums.ValidationResult;
import id.ac.unklab.asrama.report.ReportDtos.*;
import id.ac.unklab.asrama.security.SecurityUtils;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.io.StringWriter;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

@Service
public class ReportService {

    private static final ZoneId WITA_ZONE = ZoneId.of("Asia/Makassar");
    private static final DateTimeFormatter WITA_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss 'WITA'").withZone(WITA_ZONE);
    private static final DateTimeFormatter WITA_DATE_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(WITA_ZONE);
    private static final DateTimeFormatter WITA_TIME_FORMATTER =
            DateTimeFormatter.ofPattern("HH:mm:ss").withZone(WITA_ZONE);

    private final ReportRepository reportRepository;
    private final SecurityUtils securityUtils;

    @Autowired
    public ReportService(ReportRepository reportRepository, SecurityUtils securityUtils) {
        this.reportRepository = reportRepository;
        this.securityUtils = securityUtils;
    }

    public ReportService(ReportRepository reportRepository) {
        this(reportRepository, null);
    }

    @Transactional(readOnly = true)
    public PeriodRecapReportDto getPeriodAttendanceReport(
            OffsetDateTime from,
            OffsetDateTime to,
            UUID sessionId,
            AttendanceStatus status
    ) {
        String hallName = null;
        if (securityUtils != null && securityUtils.hasRole("ROLE_MONITOR")) {
            hallName = securityUtils.getCurrentHallName();
        }
        List<AttendanceReportRowDto> rows = (hallName != null && !hallName.isBlank())
                ? reportRepository.queryAttendanceReportRows(from, to, sessionId, status, hallName)
                : reportRepository.queryAttendanceReportRows(from, to, sessionId, status);
        long hadir = rows.stream().filter(r -> r.status() == AttendanceStatus.HADIR).count();
        long tidakHadir = rows.stream().filter(r -> r.status() == AttendanceStatus.TIDAK_HADIR).count();
        long scan = rows.stream().filter(r -> r.method() == AttendanceMethod.SCAN).count();
        long guard = rows.stream().filter(r -> r.method() == AttendanceMethod.DIBANTU_PENJAGA).count();
        long manual = rows.stream().filter(r -> r.method() == AttendanceMethod.MANUAL).count();

        return new PeriodRecapReportDto(
                from,
                to,
                rows.size(),
                hadir,
                tidakHadir,
                scan,
                guard,
                manual,
                rows
        );
    }

    /**
     * Export CSV rekap presensi dengan seluruh kolom sesuai requirement (J-08).
     */
    @Transactional(readOnly = true)
    public String exportAttendanceReportCsv(
            OffsetDateTime from,
            OffsetDateTime to,
            UUID sessionId,
            AttendanceStatus status
    ) {
        String hallName = null;
        if (securityUtils != null && securityUtils.hasRole("ROLE_MONITOR")) {
            hallName = securityUtils.getCurrentHallName();
        }
        List<AttendanceReportRowDto> rows = (hallName != null && !hallName.isBlank())
                ? reportRepository.queryAttendanceReportRows(from, to, sessionId, status, hallName)
                : reportRepository.queryAttendanceReportRows(from, to, sessionId, status);
        StringWriter writer = new StringWriter();
        CSVFormat csvFormat = CSVFormat.DEFAULT.builder()
                .setHeader(
                        "record_id",
                        "session_id",
                        "schedule_name",
                        "activity_code",
                        "session_starts_at_wita",
                        "session_ends_at_wita",
                        "resident_nim",
                        "resident_name",
                        "hall_name",
                        "residence_category",
                        "building",
                        "room_number",
                        "status",
                        "method",
                        "reason",
                        "recorded_by",
                        "face_match",
                        "liveness_passed",
                        "location_valid",
                        "distance_m",
                        "is_geo_enabled",
                        "user_latitude",
                        "user_longitude",
                        "user_accuracy_m",
                        "distance_meters",
                        "session_latitude",
                        "session_longitude",
                        "session_radius_m",
                        "correction_reason",
                        "recorded_at_wita"
                )
                .build();

        try (CSVPrinter printer = new CSVPrinter(writer, csvFormat)) {
            for (AttendanceReportRowDto r : rows) {
                printer.printRecord(
                        r.recordId(),
                        r.sessionId(),
                        sanitizeCsvCell(r.scheduleName()),
                        sanitizeCsvCell(r.activityCode()),
                        formatWita(r.sessionStartsAt()),
                        formatWita(r.sessionEndsAt()),
                        sanitizeCsvCell(r.residentNim()),
                        sanitizeCsvCell(r.residentName()),
                        sanitizeCsvCell(r.hallName()),
                        r.residenceCategory(),
                        sanitizeCsvCell(r.building()),
                        sanitizeCsvCell(r.roomNumber()),
                        r.status(),
                        r.method() != null ? r.method() : "",
                        sanitizeCsvCell(r.reason()),
                        sanitizeCsvCell(r.recordedByUsername()),
                        r.faceMatch() != null ? r.faceMatch() : "",
                        r.livenessPassed() != null ? r.livenessPassed() : "",
                        r.locationValid() != null ? r.locationValid() : "",
                        r.distanceM() != null ? r.distanceM() : "",
                        r.isGeoEnabled() != null ? r.isGeoEnabled() : false,
                        r.userLatitude() != null ? r.userLatitude() : "",
                        r.userLongitude() != null ? r.userLongitude() : "",
                        r.userAccuracyM() != null ? r.userAccuracyM() : "",
                        r.distanceM() != null ? r.distanceM() : "",
                        r.sessionLatitude() != null ? r.sessionLatitude() : "",
                        r.sessionLongitude() != null ? r.sessionLongitude() : "",
                        r.sessionRadiusM() != null ? r.sessionRadiusM() : "",
                        sanitizeCsvCell(r.correctionReason()),
                        formatWita(r.recordedAt())
                );
            }
        } catch (IOException ex) {
            throw new IllegalStateException("Gagal membuat CSV rekap presensi", ex);
        }

        return writer.toString();
    }

    /**
     * Export CSV rekap presensi yang terstruktur rapi untuk Microsoft Excel & Google Sheets
     * (dengan blok ringkasan laporan, tanpa kolom UUID teknis maupun duplikasi jarak).
     */
    @Transactional(readOnly = true)
    public String exportStructuredAttendanceReportCsv(
            OffsetDateTime from,
            OffsetDateTime to,
            UUID sessionId,
            AttendanceStatus status,
            char delimiter
    ) {
        PeriodRecapReportDto report = getPeriodAttendanceReport(from, to, sessionId, status);
        List<AttendanceReportRowDto> rows = report.rows();
        String hallFilter = null;
        if (securityUtils != null && securityUtils.hasRole("ROLE_MONITOR")) {
            hallFilter = securityUtils.getCurrentHallName();
        }

        StringWriter writer = new StringWriter();
        CSVFormat csvFormat = CSVFormat.DEFAULT.builder()
                .setDelimiter(delimiter)
                .setRecordSeparator("\r\n")
                .build();

        try (CSVPrinter printer = new CSVPrinter(writer, csvFormat)) {
            printer.printRecord("LAPORAN REKAPITULASI PRESENSI ASRAMA");
            printer.printRecord("Hall / Asrama", hallFilter != null && !hallFilter.isBlank() ? sanitizeCsvCell(hallFilter) : "Semua Hall");
            printer.printRecord("Periode", formatPeriodLabel(from, to));
            printer.printRecord("Diekspor Pada", formatWita(OffsetDateTime.now(WITA_ZONE)));
            printer.printRecord(
                    "Ringkasan",
                    String.format(
                            "Total: %d | Hadir: %d | Tidak Hadir: %d | Scan: %d | Dibantu Penjaga: %d | Manual: %d",
                            report.totalRecords(),
                            report.hadirCount(),
                            report.tidakHadirCount(),
                            report.scanCount(),
                            report.guardAssistedCount(),
                            report.manualCount()
                    )
            );
            printer.println();

            printer.printRecord(
                    "No",
                    "NIM",
                    "Nama Penghuni",
                    "Hall",
                    "Gedung",
                    "Kamar",
                    "Tanggal",
                    "Waktu (WITA)",
                    "Nama Sesi",
                    "Status",
                    "Metode",
                    "Nama Penjaga",
                    "Alasan / Koreksi",
                    "Geofencing",
                    "Jarak (m)",
                    "Akurasi GPS (m)",
                    "Koordinat Pengguna",
                    "Koordinat Sesi"
            );

            int no = 1;
            for (AttendanceReportRowDto r : rows) {
                OffsetDateTime refTime = r.recordedAt() != null ? r.recordedAt() : r.sessionStartsAt();
                boolean geoOn = Boolean.TRUE.equals(r.isGeoEnabled());
                printer.printRecord(
                        no++,
                        safeTextCell(r.residentNim()),
                        safeTextCell(r.residentName()),
                        safeTextCell(r.hallName()),
                        safeTextCell(r.building()),
                        safeTextCell(r.roomNumber()),
                        formatWitaDate(refTime),
                        formatWitaTime(refTime),
                        safeTextCell(r.scheduleName()),
                        formatStatusLabel(r.status()),
                        formatMethodLabel(r.method()),
                        r.recordedByUsername() != null && !r.recordedByUsername().isBlank()
                                ? sanitizeCsvCell("@" + r.recordedByUsername().trim())
                                : "-",
                        formatNotesCell(r.reason(), r.correctionReason()),
                        geoOn ? "Aktif" : "Lokasi Bebas",
                        geoOn && r.distanceM() != null ? String.format(java.util.Locale.US, "%.1f", r.distanceM()) : "-",
                        r.userAccuracyM() != null ? String.format(java.util.Locale.US, "%.1f", r.userAccuracyM()) : "-",
                        formatCoordinates(r.userLatitude(), r.userLongitude(), null),
                        geoOn ? formatCoordinates(r.sessionLatitude(), r.sessionLongitude(), r.sessionRadiusM()) : "-"
                );
            }
        } catch (IOException ex) {
            throw new IllegalStateException("Gagal membuat CSV rekap presensi terstruktur", ex);
        }

        return writer.toString();
    }

    /**
     * Mencegah CSV Formula Injection (OWASP CSV Injection):
     * Menambahkan tanda kutip tunggal (') di depan nilai teks yang diawali karakter pemicu formula (=, +, -, @, tab, CR).
     */
    public static String sanitizeCsvCell(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        char first = value.charAt(0);
        if (first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r') {
            return "'" + value;
        }
        return value;
    }

    @Transactional(readOnly = true)
    public List<AuditLogDto> getAuditLogs(String entityType, int limit, int offset) {
        return reportRepository.findAuditLogs(entityType, limit, offset);
    }

    @Transactional(readOnly = true)
    public List<AuditLogDto> getAuditLogs(String entityType, int limit) {
        return getAuditLogs(entityType, limit, 0);
    }

    @Transactional(readOnly = true)
    public List<ValidationLogDto> getValidationLogs(UUID sessionId, ValidationResult result, int limit, int offset) {
        return reportRepository.findValidationLogs(sessionId, result, limit, offset);
    }

    @Transactional(readOnly = true)
    public List<ValidationLogDto> getValidationLogs(UUID sessionId, ValidationResult result, int limit) {
        return getValidationLogs(sessionId, result, limit, 0);
    }

    @Transactional(readOnly = true)
    public List<AttendanceRecordHistoryDto> getAttendanceHistoryLogs(UUID recordId, int limit, int offset) {
        return reportRepository.findAttendanceRecordHistory(recordId, limit, offset);
    }

    @Transactional(readOnly = true)
    public List<AttendanceRecordHistoryDto> getAttendanceHistoryLogs(UUID recordId, int limit) {
        return getAttendanceHistoryLogs(recordId, limit, 0);
    }

    private String formatWita(OffsetDateTime dt) {
        if (dt == null) {
            return "";
        }
        return WITA_FORMATTER.format(dt);
    }

    private String formatWitaDate(OffsetDateTime dt) {
        return dt == null ? "-" : WITA_DATE_FORMATTER.format(dt);
    }

    private String formatWitaTime(OffsetDateTime dt) {
        return dt == null ? "-" : WITA_TIME_FORMATTER.format(dt);
    }

    private String formatPeriodLabel(OffsetDateTime from, OffsetDateTime to) {
        if (from == null && to == null) return "Semua tanggal";
        String f = from != null ? WITA_DATE_FORMATTER.format(from) : "Awal";
        String t = to != null ? WITA_DATE_FORMATTER.format(to) : "Sekarang";
        return f + " s/d " + t;
    }

    private String safeTextCell(String value) {
        if (value == null || value.trim().isEmpty()) {
            return "-";
        }
        return sanitizeCsvCell(value.trim());
    }

    private String formatStatusLabel(AttendanceStatus status) {
        if (status == null) return "-";
        return status == AttendanceStatus.HADIR ? "Hadir" : "Tidak Hadir";
    }

    private String formatMethodLabel(AttendanceMethod method) {
        if (method == null) return "-";
        return switch (method) {
            case SCAN -> "Scan";
            case DIBANTU_PENJAGA -> "Dibantu Penjaga";
            case MANUAL -> "Manual";
        };
    }

    private String formatNotesCell(String reason, String correctionReason) {
        boolean hasReason = reason != null && !reason.trim().isEmpty();
        boolean hasCorrection = correctionReason != null && !correctionReason.trim().isEmpty();
        if (!hasReason && !hasCorrection) return "-";
        if (hasReason && hasCorrection && !reason.trim().equals(correctionReason.trim())) {
            return sanitizeCsvCell(reason.trim() + " | Koreksi: " + correctionReason.trim());
        }
        return sanitizeCsvCell(hasReason ? reason.trim() : correctionReason.trim());
    }

    private String formatCoordinates(Double lat, Double lon, Integer radiusM) {
        if (lat == null || lon == null) return "-";
        String coords = String.format(java.util.Locale.US, "%.6f, %.6f", lat, lon);
        return radiusM != null ? coords + " (" + radiusM + "m)" : coords;
    }
}
