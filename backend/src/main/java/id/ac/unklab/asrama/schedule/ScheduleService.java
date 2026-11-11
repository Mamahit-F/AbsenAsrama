package id.ac.unklab.asrama.schedule;

import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.ScheduleKind;
import id.ac.unklab.asrama.common.DomainEnums.ScheduleStatus;
import id.ac.unklab.asrama.common.DomainEnums.SessionStatus;
import id.ac.unklab.asrama.schedule.ScheduleDtos.*;
import id.ac.unklab.asrama.security.SecurityUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class ScheduleService {

    private final ScheduleRepository scheduleRepository;
    private final SecurityUtils securityUtils;

    public ScheduleService(ScheduleRepository scheduleRepository, SecurityUtils securityUtils) {
        this.scheduleRepository = scheduleRepository;
        this.securityUtils = securityUtils;
    }

    @Transactional(readOnly = true)
    public List<ActivityTypeDto> listActivityTypes() {
        return scheduleRepository.findAllActivityTypes();
    }

    @Transactional(readOnly = true)
    public List<ScheduleDto> listSchedules(ScheduleStatus status) {
        return scheduleRepository.findAllSchedules(status);
    }

    @Transactional(readOnly = true)
    public ScheduleDto getSchedule(UUID scheduleId) {
        return scheduleRepository.findScheduleById(scheduleId)
                .orElseThrow(() -> BusinessException.notFound("SCHEDULE_NOT_FOUND", "Jadwal presensi tidak ditemukan"));
    }

    @Transactional
    public ScheduleDto createSchedule(CreateScheduleRequest request) {
        validateScheduleTimes(
                request.scheduleKind(),
                request.startsAt(),
                request.endsAt(),
                request.repeatDays(),
                request.startTime(),
                request.endTime(),
                request.validFrom(),
                request.validTo()
        );
        UUID actorId = securityUtils.getCurrentUserId();
        UUID id = scheduleRepository.insertSchedule(request, actorId);
        return getSchedule(id);
    }

    @Transactional
    public ScheduleDto updateSchedule(UUID scheduleId, UpdateScheduleRequest request) {
        getSchedule(scheduleId);
        validateScheduleTimes(
                request.scheduleKind(),
                request.startsAt(),
                request.endsAt(),
                request.repeatDays(),
                request.startTime(),
                request.endTime(),
                request.validFrom(),
                request.validTo()
        );
        scheduleRepository.updateSchedule(scheduleId, request);
        return getSchedule(scheduleId);
    }

    @Transactional
    public SessionDto createSession(CreateSessionRequest request) {
        if (!request.endsAt().isAfter(request.startsAt())) {
            throw BusinessException.badRequest("INVALID_SESSION_TIME",
                    "Jam selesai sesi harus lebih besar daripada jam mulai sesi (J-06)");
        }
        getSchedule(request.scheduleId());
        UUID actorId = securityUtils.getCurrentUserId();
        UUID sessionId = scheduleRepository.insertSession(request.scheduleId(), request.startsAt(), request.endsAt(), actorId);
        return getSession(sessionId);
    }

    @Transactional
    public Map<String, Object> materializeSessions(UUID scheduleId, MaterializeSessionsRequest request) {
        if (request.toDate().isBefore(request.fromDate())) {
            throw BusinessException.badRequest("INVALID_DATE_RANGE", "toDate harus sama atau setelah fromDate");
        }
        UUID actorId = securityUtils.getCurrentUserId();
        int createdCount = scheduleRepository.materializeSessions(scheduleId, request.fromDate(), request.toDate(), actorId);
        return Map.of(
                "scheduleId", scheduleId,
                "fromDate", request.fromDate(),
                "toDate", request.toDate(),
                "createdSessionsCount", createdCount
        );
    }

    @Transactional(readOnly = true)
    public List<SessionDto> listSessions(SessionStatus status, UUID scheduleId) {
        return scheduleRepository.findSessions(status, scheduleId);
    }

    @Transactional(readOnly = true)
    public SessionDto getSession(UUID sessionId) {
        return scheduleRepository.findSessionById(sessionId)
                .orElseThrow(() -> BusinessException.notFound("SESSION_NOT_FOUND", "Sesi presensi tidak ditemukan"));
    }

    @Transactional(readOnly = true)
    public SessionDto getActiveSessionOrThrow() {
        return scheduleRepository.findCurrentActiveOpenSession()
                .orElseThrow(() -> BusinessException.badRequest("NO_ACTIVE_SESSION", "Tidak ada sesi presensi aktif"));
    }

    @Transactional
    public GeofenceDto configureSessionGeofence(UUID sessionId, GeofenceConfigRequest request) {
        getSession(sessionId);

        // K-05: Sesi yang telah memiliki presensi tidak boleh diubah titik referensi geolokasinya
        int recordCount = scheduleRepository.countAttendanceRecordsForSession(sessionId);
        if (recordCount > 0) {
            throw BusinessException.conflict("SESSION_HAS_ATTENDANCE_RECORDS",
                    "Titik referensi dan pengaturan geofence sesi yang sudah memiliki riwayat presensi ("
                            + recordCount + " data) tidak dapat diubah (K-05)");
        }

        // Validasi koordinat
        if (request.isEnabled()) {
            if (request.latitude() == null || request.longitude() == null) {
                throw BusinessException.badRequest("INVALID_COORDINATES", "Latitude dan longitude wajib diisi saat geofence diaktifkan");
            }
            if (request.latitude() < -90.0 || request.latitude() > 90.0) {
                throw BusinessException.badRequest("INVALID_LATITUDE", "Latitude harus berada dalam rentang -90 sampai 90");
            }
            if (request.longitude() < -180.0 || request.longitude() > 180.0) {
                throw BusinessException.badRequest("INVALID_LONGITUDE", "Longitude harus berada dalam rentang -180 sampai 180");
            }
            if (request.radiusM() <= 0) {
                throw BusinessException.badRequest("INVALID_RADIUS", "Radius presensi harus lebih besar dari 0 meter");
            }
        }

        return scheduleRepository.upsertGeofence(sessionId, request);
    }

    @Transactional
    public Map<String, Object> closeSessionAndGenerateAbsences(UUID sessionId) {
        getSession(sessionId);
        UUID actorId = securityUtils.getCurrentUserId();
        int generatedAbsences = scheduleRepository.generateAbsencesAndCloseSession(sessionId, actorId);
        return Map.of(
                "sessionId", sessionId,
                "status", SessionStatus.CLOSED,
                "generatedAbsencesCount", generatedAbsences
        );
    }

    /**
     * K-05: Sesi yang memiliki riwayat presensi tidak boleh dihapus permanen.
     */
    @Transactional
    public void deleteOrCancelSession(UUID sessionId) {
        getSession(sessionId);
        int recordCount = scheduleRepository.countAttendanceRecordsForSession(sessionId);
        if (recordCount > 0) {
            throw BusinessException.conflict("SESSION_HAS_ATTENDANCE_RECORDS",
                    "Sesi presensi yang sudah memiliki riwayat kehadiran (" + recordCount + " data) tidak dapat dihapus permanen (K-05)");
        }
        scheduleRepository.deleteSession(sessionId);
    }

    @Transactional
    public ExemptionDto createExemption(CreateExemptionRequest request) {
        if (request.endsOn().isBefore(request.startsOn())) {
            throw BusinessException.badRequest("INVALID_EXEMPTION_DATES", "Tanggal berakhir harus sama atau setelah tanggal mulai");
        }
        return scheduleRepository.insertExemption(request, securityUtils.getCurrentUserId());
    }

    @Transactional(readOnly = true)
    public List<ExemptionDto> listExemptions() {
        return scheduleRepository.findAllExemptions();
    }

    @Transactional(readOnly = true)
    public List<ScheduleHistoryEntryDto> getScheduleHistory(UUID scheduleId) {
        getSchedule(scheduleId);
        return scheduleRepository.findScheduleHistory(scheduleId);
    }

    private void validateScheduleTimes(
            ScheduleKind kind,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            List<Short> repeatDays,
            LocalTime startTime,
            LocalTime endTime,
            LocalDate validFrom,
            LocalDate validTo
    ) {
        if (kind == ScheduleKind.ONE_TIME) {
            if (startsAt == null || endsAt == null) {
                throw BusinessException.badRequest("INVALID_SCHEDULE_TIME",
                        "Jadwal ONE_TIME wajib memiliki startsAt dan endsAt");
            }
            if (!endsAt.isAfter(startsAt)) {
                throw BusinessException.badRequest("INVALID_SCHEDULE_TIME",
                        "Waktu selesai jadwal harus lebih besar daripada waktu mulai (J-06)");
            }
        } else if (kind == ScheduleKind.RECURRING) {
            if (repeatDays == null || repeatDays.isEmpty()) {
                throw BusinessException.badRequest("INVALID_REPEAT_DAYS",
                        "Jadwal RECURRING wajib mencantumkan hari berulang (1=Senin .. 7=Minggu)");
            }
            for (Short day : repeatDays) {
                if (day == null || day < 1 || day > 7) {
                    throw BusinessException.badRequest("INVALID_REPEAT_DAYS",
                            "Hari berulang wajib bernilai antara 1 (Senin) sampai 7 (Minggu)");
                }
            }
            if (startTime == null || endTime == null || !endTime.isAfter(startTime)) {
                throw BusinessException.badRequest("INVALID_SCHEDULE_TIME",
                        "Jam selesai (endTime) harus lebih besar daripada jam mulai (startTime)");
            }
            if (validFrom == null || validTo == null || validTo.isBefore(validFrom)) {
                throw BusinessException.badRequest("INVALID_VALIDITY_PERIOD",
                        "Rentang tanggal berlaku jadwal berulang (validFrom - validTo) tidak valid");
            }
        }
    }
}
