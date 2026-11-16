import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, CalendarClock, CheckCircle2, Clock3, Pencil, Plus, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Page, PageHead } from "../../components/layout";
import { Badge, Button, Card, Empty, IconButton, Item, SectionTitle, Stagger } from "../../components/ui";
import {
  isApiError,
  schedulesApi,
  type ScheduleDto,
  type SessionDto,
} from "../../api";
import { useToast } from "../../state/app";
import { DAY_LABEL, fmtDate, isoDayToUi, shiftDate, toWitaDate, toWitaTime, wita } from "../../lib/utils";

export default function Schedules() {
  const toast = useToast();
  const nav = useNavigate();
  const today = wita().date;

  const [schedules, setSchedules] = useState<ScheduleDto[]>([]);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [active, setActive] = useState<SessionDto | null>(null);
  const [maxDailySessions, setMaxDailySessions] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [schedList, sessList, actSess, settings] = await Promise.all([
        schedulesApi.listSchedules(),
        schedulesApi.listSessions(),
        schedulesApi.getActiveSession(),
        schedulesApi.getScheduleSettings().catch(() => ({ maxDailySessions: 1 })),
      ]);
      setSchedules(schedList);
      setSessions(sessList);
      setActive(actSess);
      setMaxDailySessions(Math.max(1, Math.min(3, settings.maxDailySessions || 1)));
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat daftar jadwal dan sesi presensi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const activeSchedules = schedules.filter((s) => s.status === "ACTIVE");
  const archivedSchedules = schedules.filter((s) => s.status !== "ACTIVE");

  const setScheduleStatus = async (s: ScheduleDto, status: "ACTIVE" | "INACTIVE", toastMsg: string) => {
    if (busyId) return;
    setBusyId(s.id);
    try {
      await schedulesApi.updateSchedule(s.id, {
        name: s.name,
        activityTypeId: s.activityTypeId,
        scheduleKind: s.scheduleKind,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        repeatDays: s.repeatDays,
        startTime: s.startTime,
        endTime: s.endTime,
        validFrom: s.validFrom,
        validTo: s.validTo,
        status,
        description: s.description,
      });
      toast(toastMsg, "info");
      await loadAll();
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal memperbarui status jadwal.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleArchiveSchedule = (s: ScheduleDto) =>
    setScheduleStatus(s, "INACTIVE", `Jadwal "${s.name}" diarsipkan`);

  const handleRestoreSchedule = (s: ScheduleDto) =>
    setScheduleStatus(s, "ACTIVE", `Jadwal "${s.name}" dipulihkan ke aktif`);

  const handleDeleteSchedule = async (s: ScheduleDto) => {
    if (busyId) return;
    if (!window.confirm(`Hapus permanen jadwal "${s.name}" beserta seluruh sesi presensi di dalamnya?`)) {
      return;
    }
    setBusyId(s.id);
    try {
      await schedulesApi.deleteSchedule(s.id);
      toast(`Jadwal "${s.name}" berhasil dihapus`, "info");
      await loadAll();
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal menghapus jadwal.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleMaterializeSchedule = async (s: ScheduleDto) => {
    if (busyId) return;
    setBusyId(s.id);
    try {
      const isOneTime = s.scheduleKind === "ONE_TIME";
      const targetDate = isOneTime && s.startsAt ? toWitaDate(s.startsAt) : today;
      const res = await schedulesApi.materializeSessions(s.id, {
        fromDate: targetDate,
        toDate: isOneTime ? targetDate : shiftDate(today, 7),
      });
      toast(
        isOneTime
          ? `${res.createdSessionsCount} sesi presensi dibentuk untuk ${fmtDate(targetDate)}`
          : `${res.createdSessionsCount} sesi presensi dibentuk untuk 7 hari ke depan`,
      );
      await loadAll();
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal membentuk sesi presensi.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleCloseSession = async (sess: SessionDto) => {
    if (busyId) return;
    setBusyId(sess.id);
    try {
      const res = await schedulesApi.closeSession(sess.id);
      toast(`Sesi ditutup (${res.generatedAbsencesCount} ketidakhadiran tercatat)`);
      await loadAll();
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal menutup sesi presensi.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteSession = async (sess: SessionDto) => {
    if (busyId) return;
    if (
      !window.confirm(
        `Hapus permanen sesi "${sess.scheduleName}" (${fmtDate(toWitaDate(sess.startsAt))} ${toWitaTime(sess.startsAt)}–${toWitaTime(sess.endsAt)}) beserta seluruh data presensinya? Setelah dihapus permanen, Anda dapat membuat sesi baru di hari ini.`,
      )
    ) {
      return;
    }
    setBusyId(sess.id);
    try {
      await schedulesApi.deleteSession(sess.id);
      toast("Sesi presensi berhasil dihapus permanen", "info");
      await loadAll();
    } catch (e) {
      toast(
        isApiError(e)
          ? e.message
          : "Gagal menghapus sesi presensi.",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Page>
      <PageHead
        title="Jadwal"
        eyebrow="Sesi presensi · WITA"
        right={
          <IconButton label="Tambah sesi" tone="solid" onClick={() => nav("/penjaga/jadwal/baru")}>
            <Plus className="size-5" aria-hidden />
          </IconButton>
        }
      />

      {error && (
        <Card className="mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadAll()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      <Stagger className="space-y-3">
        <Item className="soft-inset flex items-start gap-2.5 rounded-2xl p-3.5 text-xs text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>
            <strong>Aturan Sesi Harian:</strong> Maksimal <strong>{maxDailySessions} sesi per hari</strong>. Jam yang sudah terlewat
            tetap dapat dibuat khusus untuk hari ini (otomatis <strong>Ditutup</strong> — khusus presensi manual penjaga).
            Hapus permanen sesi sebelumnya dengan tombol Hapus jika kuota sesi harian sudah penuh.
          </span>
        </Item>

        {loading ? (
          <Card className="p-6 text-center text-sm text-muted">Memuat daftar jadwal dan sesi…</Card>
        ) : activeSchedules.length === 0 ? (
          <Empty
            icon={<CalendarClock className="size-6" />}
            title="Belum ada jadwal aktif"
            text="Buat jadwal sesi presensi baru untuk mulai membuka presensi asrama."
          />
        ) : (
          activeSchedules.map((s) => {
            const schedSessions = sessions.filter((ss) => ss.scheduleId === s.id);
            const isRunning = active?.scheduleId === s.id;
            const startStr =
              s.scheduleKind === "RECURRING"
                ? toWitaTime(s.startTime)
                : toWitaTime(s.startsAt);
            const endStr =
              s.scheduleKind === "RECURRING"
                ? toWitaTime(s.endTime)
                : toWitaTime(s.endsAt);
            const repeatUiDays = (s.repeatDays ?? []).map((d) => DAY_LABEL[isoDayToUi(d)]);

            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">{s.name}</h3>
                      {isRunning && (
                        <Badge tone="success" dot>
                          Aktif sekarang
                        </Badge>
                      )}
                      {schedSessions.length > 0 && (
                        <Badge tone="info">{schedSessions.length} sesi</Badge>
                      )}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 font-display text-xs font-semibold text-primary">
                      <Clock3 className="size-3.5" aria-hidden /> {startStr} – {endStr} WITA
                    </p>
                  </div>

                  <div className="flex gap-1.5">
                    <IconButton label={`Ubah ${s.name}`} className="size-9" onClick={() => nav(`/penjaga/jadwal/${s.id}`)}>
                      <Pencil className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton
                      label={`Arsipkan ${s.name}`}
                      className="size-9 text-amber-500"
                      onClick={() => void handleArchiveSchedule(s)}
                    >
                      <Archive className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton
                      label={`Hapus ${s.name}`}
                      className="size-9 text-danger"
                      onClick={() => void handleDeleteSchedule(s)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-strong/60 pt-2.5 text-xs text-muted">
                  <span>
                    {s.scheduleKind === "RECURRING"
                      ? `Hari: ${repeatUiDays.join(", ") || "-"}`
                      : `Tanggal khusus: ${fmtDate(toWitaDate(s.startsAt))}`}
                  </span>
                  {s.scheduleKind === "RECURRING" && s.validFrom && s.validTo ? (
                    <span>
                      Periode: {fmtDate(s.validFrom, { day: "numeric", month: "short" })} –{" "}
                      {fmtDate(s.validTo, { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  ) : (
                    <span>Berlaku 1 hari</span>
                  )}
                </div>

                {(s.scheduleKind === "RECURRING" || schedSessions.length === 0) && (
                  <div className="mt-2.5 flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      disabled={busyId === s.id}
                      onClick={() => void handleMaterializeSchedule(s)}
                      className="soft-inset rounded-full px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary-soft"
                    >
                      {s.scheduleKind === "RECURRING" ? "+ Bentuk sesi 7 hari ke depan" : "+ Bentuk sesi hari ini"}
                    </button>
                  </div>
                )}
              </Card>
            );
          })
        )}

        {sessions.length > 0 && (
          <>
            <SectionTitle>Sesi presensi terbentuk ({sessions.length})</SectionTitle>
            {(showAllSessions ? sessions : sessions.slice(0, 10)).map((sess) => {
              const isExpired = Date.parse(sess.endsAt) <= Date.now();
              const effectiveStatus = sess.status === "OPEN" && isExpired ? "CLOSED" : sess.status;
              const isOpen = effectiveStatus === "OPEN";
              return (
                <Card key={sess.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{sess.scheduleName}</p>
                        <Badge tone={isOpen ? "success" : effectiveStatus === "CLOSED" ? "neutral" : "danger"}>
                          {effectiveStatus === "OPEN" ? "Terbuka" : effectiveStatus === "CLOSED" ? "Ditutup" : "Dibatalkan"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 font-display text-xs text-muted">
                        {fmtDate(toWitaDate(sess.startsAt))} · {toWitaTime(sess.startsAt)}–{toWitaTime(sess.endsAt)} WITA
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isOpen && (
                        <button
                          type="button"
                          disabled={busyId === sess.id}
                          onClick={() => void handleCloseSession(sess)}
                          className="soft-inset flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-success"
                          title="Tutup sesi & hitung absen otomatis"
                        >
                          <CheckCircle2 className="size-3.5" aria-hidden /> Tutup
                        </button>
                      )}
                      <IconButton
                        label={`Hapus permanen sesi ${sess.scheduleName}`}
                        className="size-8 text-danger"
                        onClick={() => void handleDeleteSession(sess)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </IconButton>
                    </div>
                  </div>
                </Card>
              );
            })}
            {sessions.length > 10 && (
              <Button
                type="button"
                variant="glass"
                size="sm"
                block
                onClick={() => setShowAllSessions((v) => !v)}
              >
                {showAllSessions ? "Tampilkan 10 sesi terbaru" : `Lihat semua sesi (${sessions.length})`}
              </Button>
            )}
          </>
        )}

        <Item className="pt-2">
          <Button block size="lg" onClick={() => nav("/penjaga/jadwal/baru")} icon={<CalendarClock className="size-5" />}>
            Buat sesi presensi baru
          </Button>
        </Item>

        {archivedSchedules.length > 0 && (
          <>
            <SectionTitle>Jadwal diarsipkan (riwayat dipertahankan · K-05)</SectionTitle>
            {archivedSchedules.map((s) => (
              <Card key={s.id} className="p-4 opacity-85">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{s.name}</p>
                    <p className="font-display text-xs text-muted">
                      {s.scheduleKind === "RECURRING"
                        ? `${toWitaTime(s.startTime)}–${toWitaTime(s.endTime)} WITA`
                        : `${toWitaTime(s.startsAt)}–${toWitaTime(s.endsAt)} WITA`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone="neutral">{s.status === "INACTIVE" ? "Diarsipkan" : "Dibatalkan"}</Badge>
                    <IconButton
                      label={`Pulihkan ${s.name}`}
                      className="size-8 text-primary"
                      onClick={() => void handleRestoreSchedule(s)}
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                    </IconButton>
                    <IconButton
                      label={`Hapus ${s.name}`}
                      className="size-8 text-danger"
                      onClick={() => void handleDeleteSchedule(s)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </IconButton>
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}
      </Stagger>
    </Page>
  );
}
