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
    { label: "Manual", icon: <ClipboardPen className="size-5" stroke="url(#g-amber)" />, onSelect: () => nav("/penjaga/manual") },
    { label: "Jadwal", icon: <CalendarClock className="size-5" stroke="url(#g-sky)" />, onSelect: () => nav("/penjaga/jadwal") },
    { label: "Rekap", icon: <FileSpreadsheet className="size-5" stroke="url(#g-mint)" />, onSelect: () => nav("/penjaga/rekap") },
    { label: "Kehadiran", icon: <ClipboardList className="size-5" stroke="url(#g-rose)" />, onSelect: () => nav("/penjaga/kehadiran") },
  ];

  const roleLabel = user?.backendRole === "VILLAGE_DEAN" ? "Village Dean" : "Penjaga";

  return (
    <Page>
      <NightHeader
        left={
          <IconButton label="Akun penjaga" tone="navy" onClick={() => nav("/penjaga/akun")}>
            <Settings className="size-5" aria-hidden />
          </IconButton>
        }
        center={<Avatar name={user!.name} size={46} />}
        right={
          <IconButton label="Daftar kehadiran" tone="navy" onClick={() => nav("/penjaga/kehadiran")}>
            <ClipboardList className="size-5" aria-hidden />
          </IconButton>
        }
      >
        <p className="mt-6 text-[13px] text-night-muted">{fmtLongToday()} · {roleLabel}</p>
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut }} className="text-[30px] font-bold text-white">
          {user!.name.split(" ")[0]}
        </motion.h1>

        <motion.div initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.2 }} className="night-card mt-5 rounded-[30px] p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12px] font-medium text-night-muted">
              {active ? <LiveDot /> : <span className="size-2 rounded-full bg-white/30" aria-hidden />}
              {loading
                ? "Memuat ringkasan sesi…"
                : active
                  ? active.scheduleName
                  : `Ringkasan · ${recap?.scheduleName ?? "Hari ini"}`}
            </span>
            <span className="font-display text-[12px] text-night-muted tabular">{w.time} WITA</span>
          </div>
          <div className="mt-4 flex items-center gap-5">
            <Ring value={totalCount ? hadirCount / totalCount : 0} size={104} stroke={10} dark>
              <span className="font-display text-xl font-semibold text-white tabular">
                {totalCount ? Math.round((hadirCount / totalCount) * 100) : 0}%
              </span>
            </Ring>
            <div>
              <p className="font-display text-[44px] font-semibold leading-none text-white tabular">
                <Num value={hadirCount} />
                <span className="text-xl text-night-muted">/{totalCount}</span>
              </p>
              <p className="mt-1.5 text-[13px] text-night-muted">penghuni sudah hadir</p>
            </div>
          </div>
          <div className="night-inset mt-5 grid grid-cols-4 rounded-[20px] py-2.5 text-center">
            {[
              ["Hadir", hadirCount],
              ["Absen", tidakHadirCount],
              ["Manual", manualCount],
              ["Dibantu", assistedCount],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <p className="font-display text-lg font-semibold text-white tabular">
                  <Num value={Number(val)} />
                </p>
                <p className="text-[11px] text-night-muted">{lbl}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </NightHeader>

      {error && (
        <Card className="-mt-4 mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadDashboard()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      <SectionTitle>Aksi cepat</SectionTitle>
      <Card className="flex flex-col items-center !pb-9 !pt-6">
        <CircleMenu items={quick} label="Buka aksi cepat penjaga" defaultOpen />
        <p className="mt-3 text-center text-[12px] text-subtle">Ketuk tombol tengah untuk membuka atau menutup.</p>
      </Card>

      <SectionTitle>Tren kehadiran</SectionTitle>
      <Card className="!p-0">
        <div className="flex items-end justify-between px-5 pt-5">
          <div>
            <p className="text-[13px] text-muted">Rata-rata kehadiran</p>
            <p className="font-display text-[34px] font-semibold leading-tight tabular">
              <Num value={avg} suffix="%" />
            </p>
          </div>
          <Badge tone="info">14 hari terakhir</Badge>
        </div>
        <AreaChart data={trend} aspectRatio="16 / 10" yMax={100} margin={{ top: 20, right: 30, bottom: 36, left: 30 }}>
          <Grid horizontal numTicksRows={4} />
          <Area dataKey="kehadiran" fill="#a855f7" stroke="#c026d3" fillOpacity={0.35} strokeWidth={3} />
          <XAxis numTicks={4} />
          <ChartTooltip rows={(p) => [{ color: "#c026d3", label: "Kehadiran", value: `${p.kehadiran}%` }]} />
        </AreaChart>
      </Card>

      <SectionTitle
        action={
          <motion.button whileTap={{ scale: 0.94 }} onClick={() => nav("/penjaga/kehadiran")} className="soft-sm flex h-9 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold text-primary">
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
            <Item key={a.id} className="soft flex items-center gap-3.5 rounded-[26px] p-3 pr-4">
              <Avatar name={a.residentName} size={46} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-semibold">{a.residentName}</p>
                <p className="truncate font-display text-[12px] text-muted tabular">
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
