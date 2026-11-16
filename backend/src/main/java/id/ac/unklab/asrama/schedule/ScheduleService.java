package id.ac.unklab.asrama.schedule;

import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.ScheduleKind;
import id.ac.unklab.asrama.common.DomainEnums.ScheduleStatus;
import id.ac.unklab.asrama.common.DomainEnums.SessionStatus;
import id.ac.unklab.asrama.resident.ResidentDtos.ResidentProfileDto;
import id.ac.unklab.asrama.resident.ResidentRepository;
import id.ac.unklab.asrama.schedule.ScheduleDtos.*;
import id.ac.unklab.asrama.security.SecurityUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class ScheduleService {

    private static final ZoneId WITA_ZONE = ZoneId.of("Asia/Makassar");
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm");
    private static final DateTimeFormatter DATE_TIME_FMT = DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm");

    private final ScheduleRepository scheduleRepository;
    private final SecurityUtils securityUtils;
    private ResidentRepository residentRepository;

    public ScheduleService(ScheduleRepository scheduleRepository, SecurityUtils securityUtils) {
        this.scheduleRepository = scheduleRepository;
        this.securityUtils = securityUtils;
    }

    @Autowired(required = false)
    void setResidentRepository(ResidentRepository residentRepository) {
        this.residentRepository = residentRepository;
    }

    @Transactional(readOnly = true)
    public List<ActivityTypeDto> listActivityTypes() {
        return scheduleRepository.findAllActivityTypes();
    }

    @Transactional(readOnly = true)
    public ScheduleSettingsDto getScheduleSettings() {
        return new ScheduleSettingsDto(getEffectiveMaxDailySessions());
    }

    @Transactional
    public ScheduleSettingsDto updateMaxDailySessions(int maxDailySessions) {
        if (maxDailySessions < 1 || maxDailySessions > 3) {
            throw BusinessException.badRequest(
                    "INVALID_DAILY_SESSION_LIMIT",
                    "Batas maksimal sesi per hari harus bernilai antara 1 hingga 3 sesi"
            );
        }
        UUID actorId = securityUtils.getCurrentUserId();
        int saved = scheduleRepository.updateMaxDailySessions(maxDailySessions, actorId);
        return new ScheduleSettingsDto(Math.max(1, Math.min(3, saved)));
    }

    private int getEffectiveMaxDailySessions() {
        int raw = scheduleRepository.getMaxDailySessions();
        if (raw < 1) return 1;
        return Math.min(3, raw);
    }

    @Transactional(readOnly = true)
    public List<ScheduleDto> listSchedules(ScheduleStatus status) {
        String hallName = null;
        if (securityUtils.hasRole("ROLE_MONITOR")) {
            hallName = securityUtils.getCurrentHallName();
        }
        return scheduleRepository.findAllSchedules(status, hallName);
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
        validateScheduleNotInPast(
                null,
                request.scheduleKind(),
                request.startsAt(),
                request.endsAt(),
                request.repeatDays(),
                request.startTime(),
                request.endTime(),
                request.validFrom(),
                request.validTo()
        );
        enforceMonitorOneTimeTodayOnly(request.scheduleKind(), request.startsAt(), request.endsAt());
        UUID actorId = securityUtils.getCurrentUserId();
        String hallName = resolveTargetHallName(request.hallName(), null);
        scheduleRepository.closeExpiredOpenSessions();
        LocalDate oneTimeDate = (request.scheduleKind() == ScheduleKind.ONE_TIME && request.startsAt() != null)
                ? request.startsAt().atZoneSameInstant(WITA_ZONE).toLocalDate()
                : null;
        if (oneTimeDate != null) {
            validateDailySessionLimit(null, null, hallName, oneTimeDate);
        }
        LocalDate effectiveValidFrom = oneTimeDate != null ? oneTimeDate : request.validFrom();
        LocalDate effectiveValidTo = oneTimeDate != null ? oneTimeDate : request.validTo();
        validateNoOverlappingSchedule(
                null,
                hallName,
                request.scheduleKind(),
                request.startsAt(),
                request.endsAt(),
                request.repeatDays(),
                request.startTime(),
                request.endTime(),
                effectiveValidFrom,
                effectiveValidTo
        );
        CreateScheduleRequest reqWithHall = new CreateScheduleRequest(
                request.name(), request.activityTypeId(), request.scheduleKind(),
                request.startsAt(), request.endsAt(), request.repeatDays(),
                request.startTime(), request.endTime(), effectiveValidFrom, effectiveValidTo,
                request.description(), hallName
        );
        UUID id = scheduleRepository.insertSchedule(reqWithHall, actorId);
        if (request.scheduleKind() == ScheduleKind.ONE_TIME && request.startsAt() != null && request.endsAt() != null) {
            materializeOneTimeSession(id, request.startsAt(), request.endsAt(), actorId, hallName, false);
        }
        return getSchedule(id);
    }

    @Transactional
    public ScheduleDto updateSchedule(UUID scheduleId, UpdateScheduleRequest request) {
        ScheduleDto existing = getSchedule(scheduleId);
        assertMonitorHallAccess(existing.hallName(), "mengubah jadwal");
        ScheduleKind effectiveKind = request.scheduleKind() != null ? request.scheduleKind() : existing.scheduleKind();
        validateScheduleTimes(
                effectiveKind,
                request.startsAt(),
                request.endsAt(),
                request.repeatDays(),
                request.startTime(),
                request.endTime(),
                request.validFrom(),
                request.validTo()
        );
        ScheduleStatus targetStatus = request.status() != null ? request.status() : existing.status();
        String effectiveHall = resolveTargetHallName(request.hallName(), existing.hallName());
        LocalDate oneTimeDate = (effectiveKind == ScheduleKind.ONE_TIME && request.startsAt() != null)
                ? request.startsAt().atZoneSameInstant(WITA_ZONE).toLocalDate()
                : null;
        LocalDate effectiveValidFrom = oneTimeDate != null ? oneTimeDate : request.validFrom();
        LocalDate effectiveValidTo = oneTimeDate != null ? oneTimeDate : request.validTo();
        if (targetStatus == ScheduleStatus.ACTIVE) {
            scheduleRepository.closeExpiredOpenSessions();
            validateScheduleNotInPast(
                    existing,
                    effectiveKind,
                    request.startsAt(),
                    request.endsAt(),
                    request.repeatDays(),
                    request.startTime(),
                    request.endTime(),
                    effectiveValidFrom,
                    effectiveValidTo
            );
            enforceMonitorOneTimeTodayOnly(effectiveKind, request.startsAt(), request.endsAt());
            if (oneTimeDate != null) {
                validateDailySessionLimit(null, scheduleId, effectiveHall, oneTimeDate);
            }
            validateNoOverlappingSchedule(
                    scheduleId,
                    effectiveHall,
                    effectiveKind,
                    request.startsAt(),
                    request.endsAt(),
                    request.repeatDays(),
                    request.startTime(),
                    request.endTime(),
                    effectiveValidFrom,
                    effectiveValidTo
            );
        }
        UpdateScheduleRequest normalizedRequest = new UpdateScheduleRequest(
                request.name(),
                request.activityTypeId(),
                effectiveKind,
                request.startsAt(),
                request.endsAt(),
                request.repeatDays(),
                request.startTime(),
                request.endTime(),
                effectiveValidFrom,
                effectiveValidTo,
                request.status(),
                request.description(),
                request.hallName()
        );
        scheduleRepository.updateSchedule(scheduleId, normalizedRequest);
        if (targetStatus == ScheduleStatus.ACTIVE
                && effectiveKind == ScheduleKind.ONE_TIME
                && request.startsAt() != null
                && request.endsAt() != null) {
            syncOneTimeSession(scheduleId, request.startsAt(), request.endsAt(), securityUtils.getCurrentUserId(), effectiveHall);
        }
        return getSchedule(scheduleId);
    }

    @Transactional
    public void deleteSchedule(UUID scheduleId) {
        ScheduleDto existing = getSchedule(scheduleId);
        assertMonitorHallAccess(existing.hallName(), "menghapus jadwal");
        scheduleRepository.deleteSchedule(scheduleId);
    }

    @Scheduled(fixedDelay = 30_000)
    @Transactional
    public void closeExpiredSessionsPeriodically() {
        scheduleRepository.closeExpiredOpenSessions();
    }

    @Transactional
    public SessionDto createSession(CreateSessionRequest request) {
        if (!request.endsAt().isAfter(request.startsAt())) {
            throw BusinessException.badRequest("INVALID_SESSION_TIME",
                    "Jam selesai sesi harus lebih besar daripada jam mulai sesi (J-06)");
        }
        scheduleRepository.closeExpiredOpenSessions();
        OffsetDateTime nowWita = OffsetDateTime.now(WITA_ZONE);
        LocalDate todayWita = nowWita.toLocalDate();
        LocalDate sessionDateWita = request.startsAt().atZoneSameInstant(WITA_ZONE).toLocalDate();
        if (sessionDateWita.isBefore(todayWita)) {
            throw BusinessException.badRequest("PAST_SCHEDULE_TIME",
                    "Sesi tidak dapat dibuat untuk tanggal sebelum hari ini. Jam yang sudah lewat hanya diperbolehkan untuk hari ini.");
        }
        ScheduleDto sched = getSchedule(request.scheduleId());
        assertMonitorHallAccess(sched.hallName(), "membuka sesi");
        UUID actorId = securityUtils.getCurrentUserId();
        String hallName = resolveTargetHallName(request.hallName(), sched.hallName());
        validateDailySessionLimit(null, null, hallName, sessionDateWita);
        validateNoOverlappingSession(null, hallName, request.startsAt(), request.endsAt());
        SessionStatus initialStatus = !request.endsAt().isAfter(nowWita) ? SessionStatus.CLOSED : SessionStatus.OPEN;
        UUID sessionId = scheduleRepository.insertSession(
                request.scheduleId(), request.startsAt(), request.endsAt(), initialStatus, actorId, hallName
        );
        return getSession(sessionId);
    }

    @Transactional
    public SessionDto updateSession(UUID sessionId, UpdateSessionRequest request) {
        scheduleRepository.closeExpiredOpenSessions();
        SessionDto existing = getSession(sessionId);
        assertMonitorHallAccess(existing.hallName(), "mengubah sesi");
        OffsetDateTime effectiveStart = request.startsAt() != null ? request.startsAt() : existing.startsAt();
        OffsetDateTime effectiveEnd = request.endsAt() != null ? request.endsAt() : existing.endsAt();
        if (effectiveStart != null && effectiveEnd != null && !effectiveEnd.isAfter(effectiveStart)) {
            throw BusinessException.badRequest("INVALID_SESSION_TIME",
                    "Jam selesai sesi harus lebih besar daripada jam mulai sesi (J-06)");
        }
        SessionStatus targetStatus = request.status() != null ? request.status() : existing.status();
        String effectiveHall = resolveTargetHallName(request.hallName(), existing.hallName());
        OffsetDateTime nowWita = OffsetDateTime.now(WITA_ZONE);
        if (targetStatus != SessionStatus.CANCELLED && effectiveStart != null && effectiveEnd != null) {
            LocalDate todayWita = nowWita.toLocalDate();
            LocalDate effectiveDateWita = effectiveStart.atZoneSameInstant(WITA_ZONE).toLocalDate();
            LocalDate existingDateWita = existing.startsAt() != null
                    ? existing.startsAt().atZoneSameInstant(WITA_ZONE).toLocalDate()
                    : null;
            boolean dateChanged = existingDateWita == null || !effectiveDateWita.equals(existingDateWita);
            if (dateChanged && effectiveDateWita.isBefore(todayWita)) {
                throw BusinessException.badRequest("PAST_SCHEDULE_TIME",
                        "Sesi tidak dapat diperbarui ke tanggal sebelum hari ini");
            }
            validateDailySessionLimit(sessionId, null, effectiveHall, effectiveDateWita);
            validateNoOverlappingSession(sessionId, effectiveHall, effectiveStart, effectiveEnd);
            if (targetStatus == SessionStatus.OPEN && !effectiveEnd.isAfter(nowWita)) {
                targetStatus = SessionStatus.CLOSED;
            }
        }
        SessionStatus statusToPersist = (request.status() != null || targetStatus != existing.status()) ? targetStatus : null;
        scheduleRepository.updateSession(sessionId, request.startsAt(), request.endsAt(), statusToPersist, request.hallName());
        if (request.geofence() != null) {
            configureSessionGeofence(sessionId, request.geofence());
        }
        return getSession(sessionId);
    }

    @Transactional
    public Map<String, Object> materializeSessions(UUID scheduleId, MaterializeSessionsRequest request) {
        if (request.toDate().isBefore(request.fromDate())) {
            throw BusinessException.badRequest("INVALID_DATE_RANGE", "toDate harus sama atau setelah fromDate");
        }
        scheduleRepository.closeExpiredOpenSessions();
        ScheduleDto sched = getSchedule(scheduleId);
        assertMonitorHallAccess(sched.hallName(), "membentuk sesi");
        if (sched.status() != ScheduleStatus.ACTIVE) {
            throw BusinessException.badRequest("SCHEDULE_INACTIVE", "Jadwal tidak aktif dan tidak dapat membentuk sesi");
        }
        UUID actorId = securityUtils.getCurrentUserId();
        String effectiveHall = resolveTargetHallName(sched.hallName(), null);
        OffsetDateTime nowWita = OffsetDateTime.now(WITA_ZONE);
        LocalDate todayWita = nowWita.toLocalDate();
        int createdCount = 0;

        int maxDaily = getEffectiveMaxDailySessions();
        if (sched.scheduleKind() == ScheduleKind.ONE_TIME) {
            if (sched.startsAt() == null || sched.endsAt() == null) {
                throw BusinessException.badRequest("INVALID_SCHEDULE_TIME", "Jadwal sekali waktu belum memiliki jam mulai/selesai");
            }
            LocalDate sessionDateWita = sched.startsAt().atZoneSameInstant(WITA_ZONE).toLocalDate();
            if (sessionDateWita.isBefore(todayWita)) {
                throw BusinessException.badRequest("PAST_SCHEDULE_TIME",
                        "Sesi tidak dapat dibuat untuk tanggal sebelum hari ini");
            }
            enforceMonitorOneTimeTodayOnly(sched.scheduleKind(), sched.startsAt(), sched.endsAt());
            createdCount = materializeOneTimeSession(scheduleId, sched.startsAt(), sched.endsAt(), actorId, effectiveHall, true);
        } else {
            LocalDate from = request.fromDate();
            if (sched.validFrom() != null && sched.validFrom().isAfter(from)) {
                from = sched.validFrom();
            }
            if (todayWita.isAfter(from)) {
                from = todayWita;
            }
            LocalDate to = request.toDate();
            if (sched.validTo() != null && sched.validTo().isBefore(to)) {
                to = sched.validTo();
            }
            List<Short> repeatDays = sched.repeatDays() != null ? sched.repeatDays() : List.of();
            if (!from.isAfter(to) && sched.startTime() != null && sched.endTime() != null && !repeatDays.isEmpty()) {
                for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                    short isoDay = (short) d.getDayOfWeek().getValue();
                    if (!repeatDays.contains(isoDay)) {
                        continue;
                    }
                    List<SessionDto> existingOnDate = scheduleRepository.findNonCancelledSessionsOnDate(d, effectiveHall);
                    boolean sameScheduleExists = existingOnDate.stream().anyMatch(s -> scheduleId.equals(s.scheduleId()));
                    if (sameScheduleExists) {
                        continue;
                    }
                    long otherSessionsCount = existingOnDate.stream()
                            .filter(s -> s.status() != SessionStatus.CANCELLED && !scheduleId.equals(s.scheduleId()))
                            .count();
                    if (otherSessionsCount >= maxDaily) {
                        if (request.fromDate().equals(request.toDate())) {
                            throw BusinessException.conflict("DAILY_SESSION_LIMIT",
                                    "Batas maksimal " + maxDaily + " sesi presensi per hari pada tanggal " + d
                                            + " sudah tercapai. Hapus permanen salah satu sesi terlebih dahulu dengan tombol Hapus.");
                        }
                        continue;
                    }
                    OffsetDateTime startsAt = d.atTime(sched.startTime()).atZone(WITA_ZONE).toOffsetDateTime();
                    OffsetDateTime endsAt = d.atTime(sched.endTime()).atZone(WITA_ZONE).toOffsetDateTime();
                    SessionStatus initialStatus = !endsAt.isAfter(nowWita) ? SessionStatus.CLOSED : SessionStatus.OPEN;
                    scheduleRepository.insertSession(scheduleId, startsAt, endsAt, initialStatus, actorId, effectiveHall);
                    createdCount++;
                }
            }
        }

        return Map.of(
                "scheduleId", scheduleId,
                "fromDate", request.fromDate(),
                "toDate", request.toDate(),
                "createdSessionsCount", createdCount
        );
    }

    @Transactional
    public List<SessionDto> listSessions(SessionStatus status, UUID scheduleId) {
        scheduleRepository.closeExpiredOpenSessions();
        String hallName = null;
        if (securityUtils.hasRole("ROLE_MONITOR")) {
            hallName = securityUtils.getCurrentHallName();
        } else if (securityUtils.hasRole("ROLE_PENGHUNI")) {
            hallName = resolveEffectiveHallNameForCurrentUser();
            if (hallName == null || hallName.isBlank()) {
                return List.of();
            }
        }
        return scheduleRepository.findSessions(status, scheduleId, hallName);
    }

    @Transactional
    public SessionDto getSession(UUID sessionId) {
        scheduleRepository.closeExpiredOpenSessions();
        return scheduleRepository.findSessionById(sessionId)
                .orElseThrow(() -> BusinessException.notFound("SESSION_NOT_FOUND", "Sesi presensi tidak ditemukan"));
    }

    @Transactional
    public SessionDto getActiveSessionOrThrow() {
        scheduleRepository.closeExpiredOpenSessions();
        String hallName = resolveEffectiveHallNameForCurrentUser();
        if (securityUtils.hasRole("ROLE_PENGHUNI")) {
            if (hallName == null || hallName.isBlank()) {
                throw BusinessException.badRequest("HALL_UNASSIGNED",
                        "Anda belum terdaftar di Hall asrama manapun. Silakan hubungi Monitor Hall Anda.");
            }
        }
        return scheduleRepository.findCurrentActiveOpenSessionForHall(hallName)
                .orElseThrow(() -> BusinessException.badRequest("NO_ACTIVE_SESSION",
                        hallName != null
                                ? "Tidak ada sesi presensi aktif untuk " + hallName
                                : "Tidak ada sesi presensi aktif saat ini"));
    }

    private String resolveEffectiveHallNameForCurrentUser() {
        if (securityUtils.hasRole("ROLE_PENGHUNI") && residentRepository != null) {
            var resident = residentRepository.findById(securityUtils.getCurrentResidentId());
            if (resident.isPresent()) {
                return resident.get().hallName();
            }
        }
        return securityUtils.getCurrentHallName();
    }

    @Transactional
    public GeofenceDto configureSessionGeofence(UUID sessionId, GeofenceConfigRequest request) {
        getSession(sessionId);

        // Perubahan 2 (J-06, K-05): Penjaga bebas mengubah konfigurasi geofence sesi kapan saja tanpa batasan

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
     * Perubahan 2 (J-06, K-05): Penjaga bebas menghapus sesi presensi kapan saja tanpa batasan.
     */
    @Transactional
    public void deleteOrCancelSession(UUID sessionId) {
        SessionDto session = getSession(sessionId);
        assertMonitorHallAccess(session.hallName(), "menghapus sesi");
        scheduleRepository.deleteSession(sessionId);
        if (session.scheduleId() != null) {
            scheduleRepository.findScheduleById(session.scheduleId()).ifPresent(parent -> {
                if (parent.scheduleKind() == ScheduleKind.ONE_TIME
                        && scheduleRepository.findSessions(null, parent.id(), null).isEmpty()) {
                    scheduleRepository.deleteSchedule(parent.id());
                }
            });
        }
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

    private void validateScheduleNotInPast(
            ScheduleDto existing,
            ScheduleKind kind,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            List<Short> repeatDays,
            LocalTime startTime,
            LocalTime endTime,
            LocalDate validFrom,
            LocalDate validTo
    ) {
        OffsetDateTime nowWita = OffsetDateTime.now(WITA_ZONE);
        LocalDate todayWita = nowWita.toLocalDate();
        boolean isUpdate = existing != null;

        if (kind == ScheduleKind.ONE_TIME && startsAt != null && endsAt != null) {
            LocalDate startDateWita = startsAt.atZoneSameInstant(WITA_ZONE).toLocalDate();
            LocalDate existingDateWita = (isUpdate && existing.startsAt() != null)
                    ? existing.startsAt().atZoneSameInstant(WITA_ZONE).toLocalDate()
                    : null;
            boolean dateChanged = !isUpdate || existingDateWita == null || !startDateWita.equals(existingDateWita);
            if (dateChanged && startDateWita.isBefore(todayWita)) {
                throw BusinessException.badRequest(
                        "PAST_SCHEDULE_TIME",
                        "Jadwal tidak dapat dibuat atau diubah untuk tanggal sebelum hari ini ("
                                + startDateWita + "). Jam yang sudah lewat hanya diperbolehkan untuk hari ini (" + todayWita + ")."
                );
            }
        } else if (kind == ScheduleKind.RECURRING && validFrom != null && validTo != null
                && startTime != null && endTime != null && repeatDays != null) {
            boolean fromChanged = !isUpdate
                    || existing.validFrom() == null
                    || !validFrom.equals(existing.validFrom());
            if (fromChanged && validFrom.isBefore(todayWita)) {
                throw BusinessException.badRequest(
                        "PAST_SCHEDULE_TIME",
                        "Tanggal berlaku mulai tidak boleh lebih awal dari hari ini (" + todayWita + ")."
                );
            }
            if (validTo.isBefore(todayWita)) {
                throw BusinessException.badRequest(
                        "PAST_SCHEDULE_TIME",
                        "Tanggal berlaku sampai sudah lewat dari hari ini (" + todayWita + ")."
                );
            }
            LocalDate scanFrom = validFrom.isAfter(todayWita) ? validFrom : todayWita;
            boolean hasUpcomingOccurrence = false;
            for (LocalDate d = scanFrom; !d.isAfter(validTo) && ChronoUnit.DAYS.between(scanFrom, d) <= 14; d = d.plusDays(1)) {
                short isoDay = (short) d.getDayOfWeek().getValue();
                if (repeatDays.contains(isoDay)) {
                    hasUpcomingOccurrence = true;
                    break;
                }
            }
            if (!hasUpcomingOccurrence && ChronoUnit.DAYS.between(scanFrom, validTo) <= 14) {
                throw BusinessException.badRequest(
                        "PAST_SCHEDULE_TIME",
                        "Jadwal tidak dapat dibuat karena tidak ada hari pelaksanaan yang sesuai mulai dari hari ini."
                );
            }
        }
    }

    private void enforceMonitorOneTimeTodayOnly(ScheduleKind kind, OffsetDateTime startsAt, OffsetDateTime endsAt) {
        if (!securityUtils.hasRole("ROLE_MONITOR") || kind != ScheduleKind.ONE_TIME || startsAt == null || endsAt == null) {
            return;
        }
        LocalDate todayWita = LocalDate.now(WITA_ZONE);
        LocalDate startDateWita = startsAt.atZoneSameInstant(WITA_ZONE).toLocalDate();
        LocalDate endDateWita = endsAt.atZoneSameInstant(WITA_ZONE).toLocalDate();
        if (!startDateWita.equals(todayWita) || !endDateWita.equals(todayWita)) {
            throw BusinessException.badRequest(
                    "ONE_TIME_MUST_BE_TODAY",
                    "Untuk kategori tanggal tertentu, Penjaga hanya dapat membuat atau mengubah jadwal untuk hari ini ("
                            + todayWita + ") dan berlaku 1 hari saja."
            );
        }
    }

    private int materializeOneTimeSession(
            UUID scheduleId,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            UUID actorId,
            String effectiveHall,
            boolean throwOnLimit
    ) {
        OffsetDateTime nowWita = OffsetDateTime.now(WITA_ZONE);
        LocalDate sessionDateWita = startsAt.atZoneSameInstant(WITA_ZONE).toLocalDate();
        int maxDaily = getEffectiveMaxDailySessions();
        List<SessionDto> existingOnDate = scheduleRepository.findNonCancelledSessionsOnDate(sessionDateWita, effectiveHall);
        boolean sameScheduleExists = existingOnDate != null && existingOnDate.stream().anyMatch(s -> scheduleId.equals(s.scheduleId()));
        long otherSessionsCount = existingOnDate == null ? 0 : existingOnDate.stream()
                .filter(s -> s.status() != SessionStatus.CANCELLED && !scheduleId.equals(s.scheduleId()))
                .count();
        if (!sameScheduleExists && otherSessionsCount >= maxDaily) {
            if (throwOnLimit) {
                throw BusinessException.conflict("DAILY_SESSION_LIMIT",
                        "Batas maksimal " + maxDaily + " sesi presensi per hari pada tanggal " + sessionDateWita
                                + " sudah tercapai. Hapus permanen salah satu sesi terlebih dahulu dengan tombol Hapus.");
            }
            return 0;
        }
        if (!sameScheduleExists) {
            SessionStatus initialStatus = !endsAt.isAfter(nowWita) ? SessionStatus.CLOSED : SessionStatus.OPEN;
            scheduleRepository.insertSession(scheduleId, startsAt, endsAt, initialStatus, actorId, effectiveHall);
            return 1;
        }
        return 0;
    }

    private void syncOneTimeSession(
            UUID scheduleId,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            UUID actorId,
            String effectiveHall
    ) {
        List<SessionDto> existingSessions = scheduleRepository.findSessions(null, scheduleId, effectiveHall);
        SessionDto activeSession = existingSessions == null ? null : existingSessions.stream()
                .filter(s -> s.status() != SessionStatus.CANCELLED)
                .findFirst()
                .orElse(null);
        if (activeSession == null) {
            materializeOneTimeSession(scheduleId, startsAt, endsAt, actorId, effectiveHall, false);
            return;
        }
        OffsetDateTime nowWita = OffsetDateTime.now(WITA_ZONE);
        SessionStatus syncedStatus = !endsAt.isAfter(nowWita) ? SessionStatus.CLOSED : SessionStatus.OPEN;
        scheduleRepository.updateSession(activeSession.id(), startsAt, endsAt, syncedStatus, effectiveHall);
    }

    private void validateDailySessionLimit(
            UUID excludeSessionId,
            UUID excludeScheduleId,
            String hallName,
            LocalDate targetDateWita
    ) {
        if (targetDateWita == null) {
            return;
        }
        int maxDaily = getEffectiveMaxDailySessions();
        int usedCount = 0;
        Set<UUID> seenScheduleIds = new HashSet<>();

        List<SessionDto> existingSessions = scheduleRepository.findNonCancelledSessionsOnDate(targetDateWita, hallName);
        if (existingSessions != null) {
            for (SessionDto existing : existingSessions) {
                if (existing == null || existing.status() == SessionStatus.CANCELLED) {
                    continue;
                }
                if (excludeSessionId != null && excludeSessionId.equals(existing.id())) {
                    continue;
                }
                if (excludeScheduleId != null && excludeScheduleId.equals(existing.scheduleId())) {
                    continue;
                }
                usedCount++;
                if (existing.scheduleId() != null) {
                    seenScheduleIds.add(existing.scheduleId());
                }
            }
        }
        if (excludeSessionId == null) {
            List<ScheduleDto> existingSchedules = scheduleRepository.findAllSchedules(ScheduleStatus.ACTIVE, hallName);
            if (existingSchedules != null) {
                for (ScheduleDto existingSched : existingSchedules) {
                    if (existingSched == null || existingSched.status() != ScheduleStatus.ACTIVE
                            || existingSched.scheduleKind() != ScheduleKind.ONE_TIME
                            || existingSched.startsAt() == null) {
                        continue;
                    }
                    if (excludeScheduleId != null && excludeScheduleId.equals(existingSched.id())) {
                        continue;
                    }
                    if (seenScheduleIds.contains(existingSched.id())) {
                        continue;
                    }
                    LocalDate schedDate = existingSched.startsAt().atZoneSameInstant(WITA_ZONE).toLocalDate();
                    if (targetDateWita.equals(schedDate)) {
                        usedCount++;
                        seenScheduleIds.add(existingSched.id());
                    }
                }
            }
        }
        if (usedCount >= maxDaily) {
            throw BusinessException.conflict(
                    "DAILY_SESSION_LIMIT",
                    "Dalam satu hari hanya diperbolehkan maksimal " + maxDaily + " sesi presensi. Hapus permanen salah satu sesi pada tanggal "
                            + targetDateWita + " terlebih dahulu menggunakan tombol Hapus."
            );
        }
    }

    private String resolveTargetHallName(String requestedHall, String fallbackHall) {
        if (requestedHall != null && !requestedHall.isBlank()) {
            return requestedHall.trim();
        }
        if (fallbackHall != null && !fallbackHall.isBlank()) {
            return fallbackHall.trim();
        }
        if (securityUtils.hasRole("ROLE_MONITOR")) {
            return securityUtils.getCurrentHallName();
        }
        return null;
    }

    private void assertMonitorHallAccess(String entityHallName, String actionLabel) {
        if (securityUtils.hasRole("ROLE_MONITOR")) {
            String monitorHall = securityUtils.getCurrentHallName();
            if (entityHallName != null && monitorHall != null && !entityHallName.equalsIgnoreCase(monitorHall)) {
                throw BusinessException.forbidden("FORBIDDEN_HALL",
                        "Anda tidak memiliki izin untuk " + actionLabel + " milik Hall lain");
            }
        }
    }

    private void validateNoOverlappingSchedule(
            UUID excludeScheduleId,
            String hallName,
            ScheduleKind candidateKind,
            OffsetDateTime candidateStartsAt,
            OffsetDateTime candidateEndsAt,
            List<Short> candidateRepeatDays,
            LocalTime candidateStartTime,
            LocalTime candidateEndTime,
            LocalDate candidateValidFrom,
            LocalDate candidateValidTo
    ) {
        List<ScheduleDto> existingSchedules = scheduleRepository.findAllSchedules(ScheduleStatus.ACTIVE, hallName);
        if (existingSchedules == null || existingSchedules.isEmpty()) {
            return;
        }
        for (ScheduleDto existing : existingSchedules) {
            if (existing == null || existing.status() != ScheduleStatus.ACTIVE) {
                continue;
            }
            if (excludeScheduleId != null && excludeScheduleId.equals(existing.id())) {
                continue;
            }
            if (schedulesOverlap(
                    candidateKind, candidateStartsAt, candidateEndsAt, candidateRepeatDays,
                    candidateStartTime, candidateEndTime, candidateValidFrom, candidateValidTo,
                    existing
            )) {
                throw BusinessException.conflict(
                        "SCHEDULE_OVERLAP",
                        "Jadwal bertabrakan dengan \"" + existing.name() + "\" ("
                                + formatScheduleWindow(existing)
                                + "). Hapus jadwal yang bertabrakan terlebih dahulu sebelum menambahkan jadwal di jam ini."
                );
            }
        }
    }

    private void validateNoOverlappingSession(
            UUID excludeSessionId,
            String hallName,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt
    ) {
        List<SessionDto> existingSessions = scheduleRepository.findSessions(null, null, hallName);
        if (existingSessions == null || existingSessions.isEmpty()) {
            return;
        }
        for (SessionDto existing : existingSessions) {
            if (existing == null || existing.status() == SessionStatus.CANCELLED) {
                continue;
            }
            if (excludeSessionId != null && excludeSessionId.equals(existing.id())) {
                continue;
            }
            if (existing.startsAt() != null && existing.endsAt() != null
                    && startsAt.isBefore(existing.endsAt()) && endsAt.isAfter(existing.startsAt())) {
                String window = existing.startsAt().atZoneSameInstant(WITA_ZONE).format(DATE_TIME_FMT)
                        + " - " + existing.endsAt().atZoneSameInstant(WITA_ZONE).format(TIME_FMT) + " WITA";
                throw BusinessException.conflict(
                        "SCHEDULE_OVERLAP",
                        "Sesi bertabrakan dengan sesi \"" + existing.scheduleName() + "\" (" + window
                                + "). Hapus sesi yang bertabrakan terlebih dahulu."
                );
            }
        }
    }

    private boolean schedulesOverlap(
            ScheduleKind aKind,
            OffsetDateTime aStartsAt,
            OffsetDateTime aEndsAt,
            List<Short> aRepeatDays,
            LocalTime aStartTime,
            LocalTime aEndTime,
            LocalDate aValidFrom,
            LocalDate aValidTo,
            ScheduleDto b
    ) {
        if (aKind == ScheduleKind.ONE_TIME && b.scheduleKind() == ScheduleKind.ONE_TIME) {
            return aStartsAt != null && aEndsAt != null
                    && b.startsAt() != null && b.endsAt() != null
                    && aStartsAt.isBefore(b.endsAt()) && aEndsAt.isAfter(b.startsAt());
        }
        if (aKind == ScheduleKind.RECURRING && b.scheduleKind() == ScheduleKind.RECURRING) {
            if (aValidFrom == null || aValidTo == null || b.validFrom() == null || b.validTo() == null
                    || aStartTime == null || aEndTime == null || b.startTime() == null || b.endTime() == null
                    || aRepeatDays == null || b.repeatDays() == null) {
                return false;
            }
            LocalDate overlapFrom = aValidFrom.isAfter(b.validFrom()) ? aValidFrom : b.validFrom();
            LocalDate overlapTo = aValidTo.isBefore(b.validTo()) ? aValidTo : b.validTo();
            if (overlapTo.isBefore(overlapFrom)) {
                return false;
            }
            if (!aStartTime.isBefore(b.endTime()) || !aEndTime.isAfter(b.startTime())) {
                return false;
            }
            long daysBetween = ChronoUnit.DAYS.between(overlapFrom, overlapTo);
            long limit = Math.min(daysBetween, 6);
            for (long i = 0; i <= limit; i++) {
                short isoDay = (short) overlapFrom.plusDays(i).getDayOfWeek().getValue();
                if (aRepeatDays.contains(isoDay) && b.repeatDays().contains(isoDay)) {
                    return true;
                }
            }
            return false;
        }
        if (aKind == ScheduleKind.ONE_TIME && b.scheduleKind() == ScheduleKind.RECURRING) {
            return oneTimeOverlapsRecurring(
                    aStartsAt, aEndsAt, b.repeatDays(), b.startTime(), b.endTime(), b.validFrom(), b.validTo()
            );
        }
        if (aKind == ScheduleKind.RECURRING && b.scheduleKind() == ScheduleKind.ONE_TIME) {
            return oneTimeOverlapsRecurring(
                    b.startsAt(), b.endsAt(), aRepeatDays, aStartTime, aEndTime, aValidFrom, aValidTo
            );
        }
        return false;
    }

    private boolean oneTimeOverlapsRecurring(
            OffsetDateTime oneStart,
            OffsetDateTime oneEnd,
            List<Short> repeatDays,
            LocalTime recStartTime,
            LocalTime recEndTime,
            LocalDate recValidFrom,
            LocalDate recValidTo
    ) {
        if (oneStart == null || oneEnd == null || repeatDays == null || repeatDays.isEmpty()
                || recStartTime == null || recEndTime == null || recValidFrom == null || recValidTo == null) {
            return false;
        }
        LocalDate oneStartDate = oneStart.atZoneSameInstant(WITA_ZONE).toLocalDate();
        LocalDate oneEndDate = oneEnd.atZoneSameInstant(WITA_ZONE).toLocalDate();
        LocalDate scanFrom = oneStartDate.minusDays(1).isAfter(recValidFrom) ? oneStartDate.minusDays(1) : recValidFrom;
        LocalDate scanTo = oneEndDate.isBefore(recValidTo) ? oneEndDate : recValidTo;
        if (scanTo.isBefore(scanFrom)) {
            return false;
        }
        for (LocalDate d = scanFrom; !d.isAfter(scanTo); d = d.plusDays(1)) {
            short isoDay = (short) d.getDayOfWeek().getValue();
            if (!repeatDays.contains(isoDay)) {
                continue;
            }
            OffsetDateTime occStart = d.atTime(recStartTime).atZone(WITA_ZONE).toOffsetDateTime();
            OffsetDateTime occEnd = d.atTime(recEndTime).atZone(WITA_ZONE).toOffsetDateTime();
            if (oneStart.isBefore(occEnd) && oneEnd.isAfter(occStart)) {
                return true;
            }
        }
        return false;
    }

    private String formatScheduleWindow(ScheduleDto s) {
        if (s.scheduleKind() == ScheduleKind.RECURRING && s.startTime() != null && s.endTime() != null) {
            return s.startTime().format(TIME_FMT) + " - " + s.endTime().format(TIME_FMT) + " WITA";
        }
        if (s.startsAt() != null && s.endsAt() != null) {
            return s.startsAt().atZoneSameInstant(WITA_ZONE).format(DATE_TIME_FMT)
                    + " - " + s.endsAt().atZoneSameInstant(WITA_ZONE).format(TIME_FMT) + " WITA";
        }
        return "jadwal aktif";
    }
}
