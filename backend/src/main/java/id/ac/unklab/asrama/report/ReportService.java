package id.ac.unklab.asrama.report;

import id.ac.unklab.asrama.common.DomainEnums.AttendanceMethod;
import id.ac.unklab.asrama.common.DomainEnums.AttendanceStatus;
import id.ac.unklab.asrama.common.DomainEnums.ValidationResult;
import id.ac.unklab.asrama.report.ReportDtos.*;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;
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

    private final ReportRepository reportRepository;

    public ReportService(ReportRepository reportRepository) {
        this.reportRepository = reportRepository;
    }

    @Transactional(readOnly = true)
    public PeriodRecapReportDto getPeriodAttendanceReport(
            OffsetDateTime from,
            OffsetDateTime to,
            UUID sessionId,
            AttendanceStatus status
    ) {
        List<AttendanceReportRowDto> rows = reportRepository.queryAttendanceReportRows(from, to, sessionId, status);
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
        List<AttendanceReportRowDto> rows = reportRepository.queryAttendanceReportRows(from, to, sessionId, status);
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
}
