import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, CalendarClock, CheckCircle2, Clock3, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [schedList, sessList, actSess] = await Promise.all([
        schedulesApi.listSchedules(),
        schedulesApi.listSessions(),
        schedulesApi.getActiveSession(),
      ]);
      setSchedules(schedList);
      setSessions(sessList);
      setActive(actSess);
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

  const handleArchiveSchedule = async (s: ScheduleDto) => {
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
        status: "INACTIVE",
        description: s.description,
      });
      toast(`Jadwal "${s.name}" diarsipkan`, "info");
      await loadAll();
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal mengarsipkan jadwal.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleMaterializeToday = async (s: ScheduleDto) => {
    if (busyId) return;
    setBusyId(s.id);
    try {
      const res = await schedulesApi.materializeSessions(s.id, {
        fromDate: today,
        toDate: shiftDate(today, 7),
      });
      toast(`${res.createdSessionsCount} sesi presensi dibentuk untuk 7 hari ke depan`);
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
    setBusyId(sess.id);
    try {
      await schedulesApi.deleteSession(sess.id);
      toast("Sesi presensi berhasil dihapus", "info");
      await loadAll();
    } catch (e) {
      toast(
        isApiError(e)
          ? e.message
          : "Sesi tidak dapat dihapus karena sudah memiliki catatan presensi (K-05).",
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
            <strong>J-06 & K-05:</strong> Sesi bertumpuk ditolak. Sesi yang sudah memiliki catatan presensi tidak dapat dihapus permanen
            (diarsipkan agar riwayat tetap terjaga).
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
                      className="size-9 text-danger"
                      onClick={() => void handleArchiveSchedule(s)}
                    >
                      <Archive className="size-4" aria-hidden />
                    </IconButton>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-strong/60 pt-2.5 text-xs text-muted">
                  <span>
                    {s.scheduleKind === "RECURRING"
                      ? `Hari: ${repeatUiDays.join(", ") || "-"}`
                      : `Tanggal khusus: ${fmtDate(toWitaDate(s.startsAt))}`}
                  </span>
                  {s.validFrom && s.validTo && (
                    <span>
                      Periode: {fmtDate(s.validFrom, { day: "numeric", month: "short" })} –{" "}
                      {fmtDate(s.validTo, { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => void handleMaterializeToday(s)}
                    className="soft-inset rounded-full px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary-soft"
                  >
                    + Bentuk sesi 7 hari ke depan
                  </button>
                </div>
              </Card>
            );
          })
        )}

        {sessions.length > 0 && (
          <>
            <SectionTitle>Sesi presensi terbentuk ({sessions.length})</SectionTitle>
            {sessions.slice(0, 10).map((sess) => {
              const isOpen = sess.status === "OPEN";
              return (
                <Card key={sess.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{sess.scheduleName}</p>
                        <Badge tone={isOpen ? "success" : sess.status === "CLOSED" ? "neutral" : "danger"}>
                          {sess.status}
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
                        label={`Hapus sesi ${sess.scheduleName}`}
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
              <Card key={s.id} className="p-4 opacity-75">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <p className="font-display text-xs text-muted">
                      {s.scheduleKind === "RECURRING"
                        ? `${toWitaTime(s.startTime)}–${toWitaTime(s.endTime)} WITA`
                        : `${toWitaTime(s.startsAt)}–${toWitaTime(s.endsAt)} WITA`}
                    </p>
                  </div>
                  <Badge tone="neutral">{s.status === "INACTIVE" ? "Diarsipkan" : "Dibatalkan"}</Badge>
                </div>
              </Card>
            ))}
          </>
        )}
      </Stagger>
    </Page>
  );
}
