import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { CalendarClock, ChevronRight, ClipboardList, ClipboardPen, FileSpreadsheet, RefreshCw, ScanFace, Settings } from "lucide-react";
import { NightHeader, Page } from "../../components/layout";
import { Ring } from "../../components/charts";
import { Avatar, Badge, Button, Card, IconButton, Item, LiveDot, Num, SectionTitle, easeOut, methodTone, spring } from "../../components/ui";
import { Area, AreaChart, ChartTooltip, Grid, XAxis } from "../../components/ui/area-chart";
import { CircleMenu } from "../../components/ui/circle-menu";
import {
  attendanceApi,
  isApiError,
  schedulesApi,
  type DashboardStatsDto,
  type SessionDto,
  type SessionRecapDto,
} from "../../api";
import { useAuth } from "../../state/app";
import { fmtLongToday, fmtMethodLabel, shiftDate, toWitaDate, toWitaTime, wita } from "../../lib/utils";

export default function GuardDashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const w = wita();

  const [stats, setStats] = useState<DashboardStatsDto | null>(null);
  const [active, setActive] = useState<SessionDto | null>(null);
  const [recap, setRecap] = useState<SessionRecapDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashStats, activeSess] = await Promise.all([
        attendanceApi.getDashboardStats(),
        schedulesApi.getActiveSession(),
      ]);
      setStats(dashStats);
      setActive(activeSess);

      const targetSessionId =
        activeSess?.id ?? dashStats.recentSessions?.[0]?.sessionId ?? null;
      if (targetSessionId) {
        try {
          const r = await attendanceApi.getSessionRecap(targetSessionId);
          setRecap(r);
        } catch {
          setRecap(null);
        }
      } else {
        setRecap(null);
      }
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat dashboard penjaga.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const totalCount = recap?.totalRequiredResidents ?? stats?.totalActiveResidents ?? 0;
  const hadirCount = recap?.totalHadir ?? stats?.todayTotalHadir ?? 0;
  const tidakHadirCount = recap
    ? recap.totalTidakHadir + recap.totalBelumPresensi
    : Math.max(0, totalCount - hadirCount);
  const manualCount = recap?.manualCount ?? 0;
  const assistedCount = recap?.guardAssistedCount ?? 0;

  const recentRecords = useMemo(() => {
    return (recap?.records ?? []).filter((r) => r.status === "HADIR").slice(0, 4);
  }, [recap]);

  // Tren kehadiran murni dari data sesi nyata di backend (tanpa angka acak/sintetis)
  const trend = useMemo(() => {
    const out: { date: Date; kehadiran: number }[] = [];
    const recent = stats?.recentSessions ?? [];
    for (let d = 13; d >= 0; d--) {
      const dt = shiftDate(w.date, -d);
      const daySessions = recent.filter((s) => toWitaDate(s.startsAt) === dt);
      let pct = 0;
      if (daySessions.length > 0) {
        const sumHadir = daySessions.reduce((acc, s) => acc + s.hadirCount, 0);
        const denom = Math.max(1, (stats?.totalActiveResidents || 1) * daySessions.length);
        pct = Math.min(100, Math.round((sumHadir / denom) * 100));
      }
      out.push({ date: new Date(`${dt}T12:00:00+08:00`), kehadiran: pct });
    }
    return out;
  }, [stats, w.date]);

  const avg = useMemo(() => {
    if (stats && stats.overallAttendanceRatePercent > 0) {
      return Math.round(stats.overallAttendanceRatePercent);
    }
    const activeDays = trend.filter((t) => t.kehadiran > 0);
    if (activeDays.length === 0) return 0;
    return Math.round(activeDays.reduce((s, t) => s + t.kehadiran, 0) / activeDays.length);
  }, [stats, trend]);

  const quick = [
    { label: "Bantu scan", icon: <ScanFace className="size-5" stroke="url(#g-violet)" />, onSelect: () => nav("/penjaga/bantu-scan") },
    { label: "Manual", icon: <ClipboardPen className="size-5" stroke="url(#g-amber)" />, onSelect: () => nav("/penjaga/kehadiran") },
    { label: "Jadwal", icon: <CalendarClock className="size-5" stroke="url(#g-sky)" />, onSelect: () => nav("/penjaga/jadwal") },
    { label: "Rekap", icon: <FileSpreadsheet className="size-5" stroke="url(#g-mint)" />, onSelect: () => nav("/penjaga/rekap") },
    { label: "Kehadiran", icon: <ClipboardList className="size-5" stroke="url(#g-rose)" />, onSelect: () => nav("/penjaga/kehadiran") },
  ];

  const roleLabel = "Penjaga";

  return (
    <Page>
      <NightHeader
        left={
          <IconButton label="Akun penjaga" tone="glass" onClick={() => nav("/penjaga/akun")}>
            <Settings className="size-5" aria-hidden />
          </IconButton>
        }
        center={<Avatar name={user!.name} size={46} />}
        right={
          <IconButton label="Daftar kehadiran" tone="glass" onClick={() => nav("/penjaga/kehadiran")}>
            <ClipboardList className="size-5" aria-hidden />
          </IconButton>
        }
      >
        <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-lg">
            <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold ink-4">
              <span>{fmtLongToday()} · {roleLabel}</span>
              {user?.hallName && (
                <span className="inline-flex items-center gap-1.5 font-display text-[12px] font-semibold ink-teal">
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                  {user.hallName}
                </span>
              )}
            </p>
            <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut }} className="hero-metric-wrap mt-1.5 text-[32px] font-bold leading-tight tracking-tight ink-1">
              Halo, {user!.name.split(" ")[0]}
            </motion.h1>
            <div className="mt-4 grid grid-cols-4 divide-x divide-line/50 border-t border-line/50 pt-3.5 text-center">
              {[
                ["Hadir", hadirCount],
                ["Absen", tidakHadirCount],
                ["Manual", manualCount],
                ["Dibantu", assistedCount],
              ].map(([lbl, val]) => (
                <div key={lbl} className="px-2">
                  <p className="font-display text-lg font-bold ink-1 tabular">
                    <Num value={Number(val)} />
                  </p>
                  <p className="text-[11px] font-medium ink-4">{lbl}</p>
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
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 truncate text-[12px] font-semibold ink-3">
                {active ? <LiveDot /> : <span className="size-2 shrink-0 rounded-full bg-current opacity-30" aria-hidden />}
                <span className="truncate">
                  {loading
                    ? "Memuat ringkasan sesi…"
                    : active
                      ? active.scheduleName
                      : `Ringkasan · ${recap?.scheduleName ?? "Hari ini"}`}
                </span>
              </span>
              <span className="shrink-0 font-display text-[11.5px] font-semibold ink-4 tabular">{w.time} WITA</span>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <Ring value={totalCount ? hadirCount / totalCount : 0} size={88} stroke={9}>
                <span className="hero-metric-wrap font-display text-[17px] font-bold ink-1 tabular">
                  {totalCount ? Math.round((hadirCount / totalCount) * 100) : 0}%
                </span>
              </Ring>
              <div className="min-w-0">
                <p className="hero-metric-wrap font-display text-[36px] font-bold leading-none ink-1 tabular">
                  <Num value={hadirCount} />
                  <span className="text-lg font-semibold ink-4">/{totalCount}</span>
                </p>
                <p className="mt-1.5 text-[12px] ink-4">penghuni sudah hadir</p>
              </div>
            </div>
          </motion.div>
        </div>
      </NightHeader>

      {error && (
        <Card className="-mt-2 mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadDashboard()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      <SectionTitle>Aksi cepat</SectionTitle>
      <Card className="flex flex-col items-center !pb-9 !pt-6">
        <CircleMenu items={quick} label="Buka aksi cepat penjaga" defaultOpen />
        <p className="mt-3 text-center text-[12px] ink-4">Ketuk tombol tengah untuk membuka atau menutup.</p>
      </Card>

      <SectionTitle>Tren kehadiran</SectionTitle>
      <Card className="!p-0">
        <div className="flex items-end justify-between px-5 pt-5">
          <div>
            <p className="text-[13px] ink-4">Rata-rata kehadiran</p>
            <p className="hero-metric-wrap font-display text-[34px] font-semibold leading-tight ink-1 tabular">
              <Num value={avg} suffix="%" />
            </p>
          </div>
          <Badge tone="info">14 hari terakhir</Badge>
        </div>
        <AreaChart data={trend} aspectRatio="16 / 10" yMax={100} margin={{ top: 20, right: 30, bottom: 36, left: 30 }}>
          <Grid horizontal numTicksRows={4} />
          <Area dataKey="kehadiran" fill="#3CC4AE" stroke="var(--accent-teal)" fillOpacity={0.32} strokeWidth={3} />
          <XAxis numTicks={4} />
          <ChartTooltip rows={(p) => [{ color: "#2dd4bf", label: "Kehadiran", value: `${p.kehadiran}%` }]} />
        </AreaChart>
      </Card>

      <SectionTitle
        action={
          <motion.button data-wave-sync="" whileTap={{ scale: 0.94 }} onClick={() => nav("/penjaga/kehadiran")} className="micro-glass flex h-9 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold ink-teal">
            Semua <ChevronRight className="size-4" aria-hidden />
          </motion.button>
        }
      >
        Presensi terbaru
      </SectionTitle>
      <div className="space-y-3">
        {recentRecords.map((a) => {
          const mLabel = fmtMethodLabel(a.method);
          return (
            <Item key={a.id} data-glass="card" data-radius="24" data-wave-sync="" className="glass flex items-center gap-3.5 rounded-[24px] p-3 pr-4">
              <Avatar name={a.residentName} size={46} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-semibold ink-1">{a.residentName}</p>
                <p className="truncate font-display text-[12px] ink-4 tabular">
                  {toWitaTime(a.recordedAt)} WITA · {a.residentNim}
                </p>
              </div>
              <Badge tone={methodTone(mLabel)}>{mLabel}</Badge>
            </Item>
          );
        })}
        {!loading && recentRecords.length === 0 && (
          <Item className="soft-inset rounded-[26px] p-6 text-center text-sm text-muted">
            Belum ada presensi untuk sesi ini.
          </Item>
        )}
      </div>
    </Page>
  );
}
