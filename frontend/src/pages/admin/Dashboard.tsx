import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, ChevronRight, ClipboardList, FileUp, RefreshCw, Settings, ShieldCheck, Users } from "lucide-react";
import { motion } from "motion/react";
import { NightHeader, Page } from "../../components/layout";
import { Ring } from "../../components/charts";
import { Avatar, Badge, Button, Card, IconButton, IconTile, Item, Meter, Num, SectionTitle, easeOut, spring, type Paint } from "../../components/ui";
import { Area, AreaChart, ChartTooltip, Grid, XAxis } from "../../components/ui/area-chart";
import {
  adminApi,
  attendanceApi,
  isApiError,
  reportsApi,
  residentsApi,
  type AuditLogDto,
  type DashboardStatsDto,
  type ResidentProfileDto,
  type UserAccountDto,
  type ValidationLogDto,
} from "../../api";
import { useAuth, useToast } from "../../state/app";
import { TZ, fmtLongToday, shiftDate, toWitaDate, wita } from "../../lib/utils";

export default function AdminDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const w = wita();

  const [stats, setStats] = useState<DashboardStatsDto | null>(null);
  const [residents, setResidents] = useState<ResidentProfileDto[]>([]);
  const [guards, setGuards] = useState<UserAccountDto[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogDto[]>([]);
  const [valLogs, setValLogs] = useState<ValidationLogDto[]>([]);
  const [savedMaxSessions, setSavedMaxSessions] = useState<number>(1);
  const [draftMaxSessions, setDraftMaxSessions] = useState<number>(1);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAdminOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashStats, resList, guardList, audits, validations, schedulePolicy] = await Promise.all([
        attendanceApi.getDashboardStats(),
        residentsApi.listResidents({ limit: 300 }),
        adminApi.listUsers({ role: "MONITOR", limit: 100 }),
        reportsApi.getAuditLogs({ limit: 6 }),
        reportsApi.getValidationLogs({ limit: 100 }),
        adminApi.getScheduleSettings().catch(() => ({ maxDailySessions: 1 })),
      ]);
      setStats(dashStats);
      setResidents(resList);
      setGuards(guardList);
      setAuditLogs(audits);
      setValLogs(validations);
      const safeMax = Math.max(1, Math.min(3, schedulePolicy.maxDailySessions || 1));
      setSavedMaxSessions(safeMax);
      setDraftMaxSessions(safeMax);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat ikhtisar dashboard admin.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSaveSessionLimit = async () => {
    if (savingPolicy || draftMaxSessions === savedMaxSessions) return;
    setSavingPolicy(true);
    try {
      const updated = await adminApi.updateScheduleSettings(draftMaxSessions);
      const safeMax = Math.max(1, Math.min(3, updated.maxDailySessions));
      setSavedMaxSessions(safeMax);
      setDraftMaxSessions(safeMax);
      toast(`Batas maksimal sesi harian diatur menjadi ${safeMax} sesi/hari`);
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal menyimpan pengaturan batas sesi harian.", "error");
    } finally {
      setSavingPolicy(false);
    }
  };

  useEffect(() => {
    void loadAdminOverview();
  }, [loadAdminOverview]);

  const totalOfficial = residents.length;
  const activeResidents = stats?.totalActiveResidents ?? residents.filter((r) => r.status === "AKTIF").length;
  const enrolledCount = stats?.totalEnrolledFaces ?? residents.filter((r) => r.hasActiveFaceProfile).length;
  const activeGuards = guards.filter((g) => g.isActive).length;
  const lockedGuards = guards.filter((g) => g.lockedUntil && Date.parse(g.lockedUntil) > Date.now()).length;
  const pct = totalOfficial ? enrolledCount / totalOfficial : 0;

  const successValidations = valLogs.filter((v) => v.result === "SUCCESS").length;
  const validationRate = valLogs.length > 0 ? Math.round((successValidations / valLogs.length) * 100) : 0;

  // Grafik 14 hari dari sesi nyata pada DashboardStatsDto
  const series = useMemo(() => {
    const recent = stats?.recentSessions ?? [];
    return Array.from({ length: 14 }, (_, idx) => {
      const d = shiftDate(w.date, idx - 13);
      const daySessions = recent.filter((s) => toWitaDate(s.startsAt) === d);
      let rate = 0;
      if (daySessions.length > 0) {
        const sumHadir = daySessions.reduce((acc, s) => acc + s.hadirCount, 0);
        const denom = Math.max(1, (activeResidents || 1) * daySessions.length);
        rate = Math.min(100, Math.round((sumHadir / denom) * 100));
      }
      return {
        date: new Date(`${d}T12:00:00+08:00`),
        sukses: rate,
      };
    });
  }, [activeResidents, stats, w.date]);

  const overallRate = Math.round(stats?.overallAttendanceRatePercent ?? 0);

  const tiles: { to: string; icon: typeof Users; paint: Paint; title: string; meta: string }[] = [
    { to: "/admin/pengguna", icon: Users, paint: "teal", title: "Pengguna", meta: lockedGuards ? `${lockedGuards} terkunci` : `${totalOfficial + activeGuards} akun` },
    { to: "/admin/pengguna/impor", icon: FileUp, paint: "amber", title: "Impor CSV", meta: "Massal penghuni" },
    { to: "/admin/log", icon: ClipboardList, paint: "mint", title: "Log Audit", meta: `${auditLogs.length} terbaru` },
    { to: "/admin/log?tab=sys", icon: ShieldCheck, paint: "rose", title: "Validasi AI", meta: `${valLogs.length} log` },
  ];

  return (
    <Page>
      <NightHeader
        left={
          <IconButton label="Akun admin" tone="glass" onClick={() => nav("/admin/akun")}>
            <Settings className="size-5" aria-hidden />
          </IconButton>
        }
        center={<Avatar name={user!.name} size={46} />}
        right={
          <IconButton label="Log" tone="glass" onClick={() => nav("/admin/log")}>
            <ClipboardList className="size-5" aria-hidden />
          </IconButton>
        }
      >
        <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-lg">
            <div className="flex flex-wrap items-center gap-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] ink-4">
              <span>{fmtLongToday()} · Admin</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold normal-case tracking-normal ink-teal">
                <span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" aria-hidden />
                Sinkron Real-time
              </span>
            </div>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: easeOut }}
              className="hero-metric-wrap mt-2 text-[32px] font-bold leading-tight tracking-tight ink-1 sm:text-[36px]"
            >
              Ikhtisar asrama
            </motion.h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed ink-3">
              Pantau registrasi wajah biometrik, status validasi liveness, dan sesi kehadiran seluruh asrama UNKLAB.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/50 pt-3.5 text-[12.5px] font-semibold">
              {[
                [<Num key="a" value={activeResidents} />, "Penghuni aktif"],
                [<Num key="g" value={activeGuards} />, "Penjaga aktif"],
                [<Num key="v" value={validationRate} suffix="%" />, "Scan lolos"],
              ].map(([val, lbl], i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="font-display text-sm font-bold ink-1 tabular">{val}</span>
                  <span className="ink-4">{lbl}</span>
                </div>
              ))}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.16 }}
            className="w-full shrink-0 border-t border-line/50 pt-4 lg:w-[300px] lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
          >
            <div className="flex items-center gap-4">
              <Ring value={pct} size={86} stroke={9}>
                <span className="hero-metric-wrap font-display text-[17px] font-bold ink-1 tabular">{Math.round(pct * 100)}%</span>
              </Ring>
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-semibold ink-4">Wajah terdaftar</p>
                <p className="hero-metric-wrap mt-0.5 font-display text-[32px] font-bold leading-none ink-1 tabular">
                  <Num value={enrolledCount} />
                  <span className="text-base font-semibold ink-4">/{totalOfficial}</span>
                </p>
                <p className="mt-1 text-[11px] ink-4">ArcFace · liveness PAD</p>
              </div>
            </div>
            <div className="mt-3.5">
              <Meter value={pct} />
            </div>
            <button
              type="button"
              onClick={() => nav("/admin/pengguna")}
              className="mt-3 inline-flex items-center gap-1 rounded-full py-1 text-[12.5px] font-semibold ink-teal transition-opacity hover:opacity-80"
            >
              Kelola Pengguna <ChevronRight className="size-3.5" aria-hidden />
            </button>
          </motion.div>
        </div>
      </NightHeader>

      {error && (
        <Card className="-mt-2 mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadAdminOverview()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      <SectionTitle>Kelola</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <motion.button
            key={t.to}
            type="button"
            data-glass="card"
            data-radius="24"
            data-wave-sync=""
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={() => nav(t.to)}
            className="glass flex flex-col items-center rounded-[24px] p-4 sm:p-5 text-center"
            aria-label={t.title}
          >
            <IconTile icon={t.icon} paint={t.paint} size={56} flat />
            <span className="mt-3 font-display text-[14.5px] font-semibold ink-1">{t.title}</span>
            <span className="mt-0.5 text-[11.5px] ink-4">{t.meta}</span>
          </motion.button>
        ))}
      </div>

      <SectionTitle>Pengaturan sesi harian</SectionTitle>
      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <IconTile icon={CalendarClock} paint="teal" size={44} flat />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-[15px] font-semibold text-ink">
                  Maksimal sesi presensi per hari
                </h3>
                <Badge tone="info">Aktif: {savedMaxSessions} sesi/hari</Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Atur batas maksimal sesi yang dapat dibuat Penjaga Hall dalam satu hari (custom 1 hingga 3 sesi/hari,
                dengan jam antar sesi tidak boleh bertabrakan).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <div className="inline-flex rounded-full bg-background/60 p-1">
              {[1, 2, 3].map((val) => {
                const selected = draftMaxSessions === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setDraftMaxSessions(val)}
                    disabled={savingPolicy}
                    aria-pressed={selected}
                    className={`rounded-full px-3.5 py-1.5 font-display text-xs font-semibold transition-all ${
                      selected
                        ? "bg-primary text-white shadow-sm"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {val} Sesi
                  </button>
                );
              })}
            </div>
            <Button
              size="sm"
              disabled={savingPolicy || draftMaxSessions === savedMaxSessions}
              onClick={() => void handleSaveSessionLimit()}
            >
              {savingPolicy ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </div>
      </Card>

      <SectionTitle>Tingkat kehadiran asrama</SectionTitle>
      <Card className="!p-0">
        <div className="flex items-end justify-between px-5 pt-5">
          <div>
            <p className="text-[13px] ink-4">Rata-rata keseluruhan sesi</p>
            <p className="hero-metric-wrap font-display text-[34px] font-semibold leading-tight ink-1 tabular">
              <Num value={overallRate} suffix="%" />
            </p>
          </div>
          <Badge tone="info">{stats?.totalOpenSessions ?? 0} sesi aktif</Badge>
        </div>
        <AreaChart data={series} aspectRatio="16 / 10" yMax={100} margin={{ top: 20, right: 30, bottom: 36, left: 30 }}>
          <Grid horizontal numTicksRows={4} />
          <Area dataKey="sukses" fill="#3CC4AE" stroke="var(--accent-teal)" fillOpacity={0.32} strokeWidth={3} />
          <XAxis numTicks={4} />
          <ChartTooltip rows={(p) => [{ color: "#2dd4bf", label: "Kehadiran", value: `${p.sukses}%` }]} />
        </AreaChart>
      </Card>

      <SectionTitle
        action={
          <motion.button data-wave-sync="" whileTap={{ scale: 0.94 }} onClick={() => nav("/admin/log")} className="micro-glass flex h-9 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold ink-teal">
            Semua <ChevronRight className="size-4" aria-hidden />
          </motion.button>
        }
      >
        Audit terbaru
      </SectionTitle>
      <div className="space-y-3">
        {auditLogs.slice(0, 4).map((l) => (
          <Item key={l.id} data-glass="card" data-radius="24" data-wave-sync="" className="glass flex items-center gap-3.5 rounded-[24px] p-3 pr-4">
            <IconTile icon={ClipboardList} paint="violet" size={46} flat />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[15px] font-semibold ink-1">{l.action}</p>
              <p className="truncate text-[12px] ink-4">
                {l.actorUsername ? `@${l.actorUsername}` : "Sistem"} · {l.description || l.entityType || "-"}
              </p>
            </div>
            <span className="shrink-0 font-display text-[12px] ink-5 tabular">
              {new Date(l.createdAt).toLocaleTimeString("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}
            </span>
          </Item>
        ))}
        {!loading && auditLogs.length === 0 && (
          <Card className="p-5 text-center text-sm text-muted">Belum ada catatan pada Audit Log.</Card>
        )}
      </div>
    </Page>
  );
}
