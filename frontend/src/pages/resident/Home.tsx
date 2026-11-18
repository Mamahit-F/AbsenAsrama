import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { CheckCircle2, ChevronRight, Clock3, History, RefreshCw, ScanFace, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { NightHeader, Page } from "../../components/layout";
import { Ring } from "../../components/charts";
import { Avatar, Badge, Button, Card, IconButton, IconTile, Item, LiveDot, Meter, Num, PressCard, SectionTitle, easeOut, methodTone, spring } from "../../components/ui";
import {
  attendanceApi,
  isApiError,
  residentsApi,
  schedulesApi,
  type AttendanceRecordDto,
  type ResidentProfileDto,
  type SessionDto,
} from "../../api";
import { useAuth } from "../../state/app";
import { cn, fmtDate, fmtLongToday, fmtMethodLabel, shiftDate, toMin, toWitaDate, toWitaTime, wita } from "../../lib/utils";

export default function ResidentHome() {
  const { user, refreshProfile } = useAuth();
  const nav = useNavigate();
  const w = wita();

  const [profile, setProfile] = useState<ResidentProfileDto | null>(null);
  const [active, setActive] = useState<SessionDto | null>(null);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [history, setHistory] = useState<AttendanceRecordDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profResult, actResult, sessResult, histResult] = await Promise.allSettled([
        residentsApi.getMyProfile(),
        schedulesApi.getActiveSession(),
        schedulesApi.listSessions(),
        attendanceApi.getMyHistory({ limit: 60 }),
        refreshProfile(),
      ]);

      if (profResult.status === "fulfilled") {
        setProfile(profResult.value);
      }
      if (actResult.status === "fulfilled") {
        setActive(actResult.value);
      }
      if (sessResult.status === "fulfilled") {
        setSessions(sessResult.value);
      }
      if (histResult.status === "fulfilled") {
        setHistory(histResult.value);
      }

      if (profResult.status === "rejected") {
        const err = profResult.reason;
        setError(isApiError(err) ? err.message : "Gagal memuat data beranda penghuni.");
      }
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat data beranda penghuni.");
    } finally {
      setLoading(false);
    }
  }, [refreshProfile]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const displayName = profile?.fullName || user?.name || "Penghuni";
  const roomLabel = profile?.roomNumber
    ? profile.building
      ? `${profile.building}-${profile.roomNumber}`
      : profile.roomNumber
    : user?.room || "-";
  const faceOk = Boolean(profile?.hasActiveFaceProfile);
  const faceLabel = faceOk ? "Aktif" : "Belum Terdaftar";

  const sessionMap = useMemo(() => {
    const m = new Map<string, SessionDto>();
    for (const s of sessions) m.set(s.id, s);
    return m;
  }, [sessions]);

  const todaySessions = useMemo(() => {
    return sessions
      .filter((s) => s.status !== "CANCELLED" && toWitaDate(s.startsAt) === w.date)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [sessions, w.date]);

  const next = useMemo(() => {
    const upcoming = todaySessions.find((s) => {
      const startMin = toMin(toWitaTime(s.startsAt));
      return startMin > w.minutes && s.status === "OPEN";
    });
    if (!upcoming) return null;
    const startMin = toMin(toWitaTime(upcoming.startsAt));
    return {
      session: upcoming,
      startsIn: Math.max(0, startMin - w.minutes),
    };
  }, [todaySessions, w.minutes]);

  const doneNow = useMemo(() => {
    if (!active) return false;
    return history.some((a) => a.sessionId === active.id && a.status === "HADIR");
  }, [active, history]);

  const weekStart = shiftDate(w.date, -6);
  const weekSessionsCount = useMemo(() => {
    const count = sessions.filter((s) => {
      const d = toWitaDate(s.startsAt);
      return s.status !== "CANCELLED" && d >= weekStart && d <= w.date;
    }).length;
    return Math.max(1, count);
  }, [sessions, weekStart, w.date]);

  const weekHits = useMemo(() => {
    return history.filter((a) => a.status === "HADIR" && toWitaDate(a.recordedAt) >= weekStart).length;
  }, [history, weekStart]);

  const activeStartStr = active ? toWitaTime(active.startsAt) : "00:00";
  const activeEndStr = active ? toWitaTime(active.endsAt) : "00:00";
  const progress = active
    ? Math.min(
        1,
        Math.max(
          0,
          (w.minutes - toMin(activeStartStr)) /
            Math.max(1, toMin(activeEndStr) - toMin(activeStartStr)),
        ),
      )
    : 0;

  const upcomingIdx = todaySessions.findIndex(
    (s) => active?.id === s.id || w.minutes < toMin(toWitaTime(s.endsAt)),
  );
  const focusIdx = upcomingIdx === -1 ? Math.max(0, todaySessions.length - 1) : upcomingIdx;

  return (
    <Page>
      <NightHeader
        center={
          <button onClick={() => nav("/penghuni/profil")} aria-label="Profil" className="block">
            <Avatar name={displayName} size={46} />
          </button>
        }
        right={
          <IconButton label="Riwayat" tone="glass" onClick={() => nav("/penghuni/riwayat")}>
            <History className="size-5" aria-hidden />
          </IconButton>
        }
      >
        <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-lg text-center lg:text-left">
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }} className="text-[13px] font-semibold ink-4">
              {fmtLongToday()}
            </motion.p>
            <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut, delay: 0.08 }} className="hero-metric-wrap mt-1 text-[30px] font-bold leading-tight ink-1">
              Halo, {displayName.split(" ")[0]}
            </motion.h1>

            {/* Badge Status Hall */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mt-3 flex flex-wrap items-center justify-center gap-3 lg:justify-start"
            >
              {profile?.hallName ? (
                <span className="inline-flex items-center gap-2 font-display text-xs font-semibold ink-teal">
                  <span className="size-2 rounded-full bg-current animate-pulse" aria-hidden />
                  Terdaftar di {profile.hallName}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 font-display text-xs font-semibold text-warning">
                  <ShieldAlert className="size-3.5 text-warning" aria-hidden />
                  Belum Terdaftar di Hall — Hubungi Monitor Hall
                </span>
              )}
              <button
                type="button"
                onClick={() => void loadData()}
                disabled={loading}
                aria-label="Refresh status Hall dan data beranda"
                title="Refresh status Hall"
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-display text-[11.5px] font-semibold ink-3 transition hover:bg-black/[0.05] dark:hover:bg-white/[0.08] disabled:opacity-60"
              >
                <RefreshCw className={cn("size-3", loading && "animate-spin")} aria-hidden />
                Refresh
              </button>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...spring, delay: 0.18 }}
            className="w-full shrink-0 border-t border-line/50 pt-4 lg:w-[320px] lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
          >
            <div className="flex items-start gap-3.5">
              <IconTile icon={ScanFace} paint="violet" size={48} flat />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[12px] font-semibold ink-4">
                  {active ? <LiveDot /> : <span className="size-2 rounded-full bg-current opacity-30" aria-hidden />}
                  {loading
                    ? "Memeriksa sesi…"
                    : active
                      ? "Sedang berlangsung"
                      : next
                        ? "Sesi berikutnya"
                        : "Tidak ada sesi aktif"}
                </p>
                <h2 className="mt-1 truncate text-[21px] font-semibold leading-tight ink-1">
                  {loading
                    ? "Memuat jadwal…"
                    : active
                      ? active.scheduleName
                      : next
                        ? next.session.scheduleName
                        : "Tidak ada sesi saat ini"}
                </h2>
                <p className="mt-0.5 font-display text-[12.5px] ink-4 tabular">
                  {active
                    ? `${activeStartStr} – ${activeEndStr} WITA`
                    : next
                      ? `Dibuka ${toWitaTime(next.session.startsAt)} · ${Math.floor(next.startsIn / 60) ? `${Math.floor(next.startsIn / 60)} j ` : ""}${next.startsIn % 60} mnt lagi`
                      : "Menunggu sesi presensi berikutnya"}
                </p>
              </div>
            </div>
            {active && (
              <div className="mt-4">
                <Meter value={progress} />
                <p className="mt-1.5 text-right font-display text-[11.5px] ink-4 tabular">
                  sisa {Math.max(0, toMin(activeEndStr) - w.minutes)} menit
                </p>
              </div>
            )}
            <div className="mt-4">
              {doneNow ? (
                <div className="flex items-center gap-2 text-sm font-semibold text-success">
                  <CheckCircle2 className="size-4.5" aria-hidden /> Sudah presensi di sesi ini
                </div>
              ) : active ? (
                <Button block size="md" onClick={() => nav("/penghuni/scan")} icon={<ScanFace className="size-5" />}>
                  Presensi sekarang
                </Button>
              ) : (
                <div className="flex items-center gap-2 text-[12.5px] font-medium ink-4">
                  <Clock3 className="size-4" aria-hidden /> Tombol aktif saat sesi dibuka
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </NightHeader>

      {error && (
        <Card className="-mt-4 mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadData()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      {!loading && !faceOk && (
        <PressCard glass={false} onClick={() => nav("/penghuni/wajah")} className="-mt-4 mb-2 flex items-center gap-3 !bg-warning-soft">
          <ShieldAlert className="size-6 shrink-0 text-warning" aria-hidden />
          <span className="flex-1">
            <span className="block font-semibold text-warning">Wajah belum terdaftar</span>
            <span className="block text-[13px] text-warning/90">Daftarkan wajah agar bisa presensi.</span>
          </span>
          <ChevronRight className="size-5 text-warning" aria-hidden />
        </PressCard>
      )}

      {/* ---------- weekly ring + face ---------- */}
      <div className="grid grid-cols-[1.15fr_1fr] gap-4 lg:mt-4 lg:gap-6">
        <Card className="flex flex-col items-center py-5">
          <Ring value={Math.min(1, weekHits / weekSessionsCount)} size={118} stroke={11}>
            <span className="font-display text-[26px] font-semibold tabular">
              <Num value={Math.min(100, Math.round((weekHits / weekSessionsCount) * 100))} />
              <span className="text-[15px] text-muted">%</span>
            </span>
          </Ring>
          <p className="mt-3 text-[13px] text-muted">
            Kehadiran <span className="font-semibold text-foreground">7 hari</span>
          </p>
        </Card>
        <div className="grid gap-4">
          <Card className="flex flex-col justify-center !py-4">
            <p className="font-display text-[30px] font-semibold leading-none tabular">
              <Num value={weekHits} />
              <span className="text-base text-subtle">/{weekSessionsCount}</span>
            </p>
            <p className="mt-1 text-[12px] text-muted">sesi hadir</p>
          </Card>
          <PressCard onClick={() => nav("/penghuni/wajah")} className="flex flex-col justify-center !py-4">
            <Badge tone={faceOk ? "success" : "warning"} dot>
              {faceLabel}
            </Badge>
            <p className="mt-1.5 text-[12px] text-muted">status wajah</p>
          </PressCard>
        </div>
      </div>

      {/* ---------- quick tiles ---------- */}
      <SectionTitle>Akses cepat</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Riwayat", sub: "7 & 30 hari", icon: History, paint: "amber" as const, to: "/penghuni/riwayat" },
          { label: "Wajah", sub: faceLabel, icon: ShieldCheck, paint: "violet" as const, to: "/penghuni/wajah" },
          { label: "Profil", sub: roomLabel, icon: UserRound, paint: "sky" as const, to: "/penghuni/profil" },
        ].map((t) => (
          <Item key={t.label} className="flex flex-col items-center">
            <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => nav(t.to)} className="rounded-[30px] active:shadow-[var(--sh-inset)]" aria-label={t.label}>
              <IconTile icon={t.icon} paint={t.paint} size={86} />
            </motion.button>
            <span className="mt-2.5 font-display text-[15px] font-semibold">{t.label}</span>
            <span className="text-[12px] text-subtle">{t.sub}</span>
          </Item>
        ))}
      </div>

      {/* ---------- today timeline ---------- */}
      <SectionTitle>Jadwal hari ini</SectionTitle>
      {todaySessions.length === 0 ? (
        <Card className="p-5 text-center text-sm text-muted">
          {loading ? "Memuat jadwal hari ini…" : "Belum ada sesi presensi terjadwal untuk hari ini."}
        </Card>
      ) : (
        <Card className="px-4 pb-5 pt-7">
          <div className="relative">
            <div className="absolute left-[8%] right-[8%] top-[13px] h-[3px] rounded-full bg-line" aria-hidden />
            <motion.div
              className="absolute left-[8%] top-[13px] h-[3px] origin-left rounded-full"
              style={{
                background: "var(--grad-accent)",
                width: `${todaySessions.length > 1 ? (focusIdx / (todaySessions.length - 1)) * 84 : 0}%`,
              }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, ease: easeOut, delay: 0.08 }}
              aria-hidden
            />
            <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, todaySessions.length)}, minmax(0,1fr))` }}>
              {todaySessions.map((s, i) => {
                const hit = history.find((a) => a.sessionId === s.id && a.status === "HADIR");
                const endMin = toMin(toWitaTime(s.endsAt));
                const past = w.minutes >= endMin || s.status === "CLOSED";
                const isActive = active?.id === s.id;
                const focus = i === focusIdx;
                return (
                  <motion.li
                    key={s.id}
                    initial={{ opacity: 0.95, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...spring, delay: Math.min(i * 0.04, 0.16) }}
                    className="flex flex-col items-center text-center"
                  >
                    <span className={cn("soft-sm grid size-[29px] place-items-center rounded-full")}>
                      <span className={cn("size-3 rounded-full", hit ? "bg-success" : isActive ? "bg-[#3CC4AE] shadow-[0_0_10px_#3CC4AE]" : past ? "bg-danger" : "bg-line-strong")} />
                    </span>
                    <span className={cn("mt-3 rounded-full px-3 py-1 font-display text-[13px] font-semibold tabular", focus ? "grad-accent" : "soft-sm text-muted")}>
                      {toWitaTime(s.startsAt)}
                    </span>
                    <span className="mt-2 line-clamp-2 px-1 text-[12px] font-medium leading-tight">{s.scheduleName}</span>
                    <span className={cn("mt-1 text-[11px] font-semibold", hit ? "text-success" : past ? "text-danger" : isActive ? "text-primary" : "text-subtle")}>
                      {hit ? `Hadir ${toWitaTime(hit.recordedAt)}` : past ? "Tidak hadir" : isActive ? "Berlangsung" : "Nanti"}
                    </span>
                  </motion.li>
                );
              })}
            </ol>
          </div>
        </Card>
      )}

      {/* ---------- recent ---------- */}
      <SectionTitle
        action={
          <motion.button data-wave-sync="" whileTap={{ scale: 0.94 }} onClick={() => nav("/penghuni/riwayat")} className="micro-glass flex h-9 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold ink-teal">
            Semua <ChevronRight className="size-4" aria-hidden />
          </motion.button>
        }
      >
        Aktivitas terakhir
      </SectionTitle>
      <div className="space-y-3">
        {history.slice(0, 3).map((a) => {
          const recDate = toWitaDate(a.recordedAt);
          const recTime = toWitaTime(a.recordedAt);
          const sessName = sessionMap.get(a.sessionId)?.scheduleName || "Sesi Presensi";
          const mLabel = fmtMethodLabel(a.method);
          return (
            <Item key={a.id} data-glass="card" data-radius="24" data-wave-sync="" className="glass flex items-center gap-4 rounded-[24px] p-3 pr-4">
              <div className="icon-well grid h-[54px] w-[50px] shrink-0 place-items-center rounded-[16px] text-center">
                <div>
                  <p className="font-display text-[19px] font-bold leading-none ink-1">{fmtDate(recDate, { day: "numeric" })}</p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase ink-4">{fmtDate(recDate, { month: "short" })}</p>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-semibold ink-1">{sessName}</p>
                <p className="font-display text-[13px] ink-4 tabular">{recTime} WITA</p>
              </div>
              {a.status === "HADIR" ? (
                <Badge tone={methodTone(mLabel)}>{mLabel}</Badge>
              ) : (
                <Badge tone="danger">Tidak Hadir</Badge>
              )}
            </Item>
          );
        })}
        {!loading && history.length === 0 && (
          <Card className="p-5 text-center text-sm text-muted">Belum ada catatan aktivitas presensi.</Card>
        )}
      </div>
    </Page>
  );
}
