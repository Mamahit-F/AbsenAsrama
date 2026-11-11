import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ClipboardList, FileUp, RefreshCw, Settings, ShieldCheck, UserCog, Users } from "lucide-react";
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
import { useAuth } from "../../state/app";
import { TZ, fmtLongToday, shiftDate, toWitaDate, wita } from "../../lib/utils";

export default function AdminDashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const w = wita();

  const [stats, setStats] = useState<DashboardStatsDto | null>(null);
  const [residents, setResidents] = useState<ResidentProfileDto[]>([]);
  const [guards, setGuards] = useState<UserAccountDto[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogDto[]>([]);
  const [valLogs, setValLogs] = useState<ValidationLogDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAdminOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashStats, resList, guardList, audits, validations] = await Promise.all([
        attendanceApi.getDashboardStats(),
        residentsApi.listResidents({ limit: 300 }),
        adminApi.listUsers({ role: "MONITOR", limit: 100 }),
        reportsApi.getAuditLogs({ limit: 6 }),
        reportsApi.getValidationLogs({ limit: 100 }),
      ]);
      setStats(dashStats);
      setResidents(resList);
      setGuards(guardList);
      setAuditLogs(audits);
      setValLogs(validations);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat ikhtisar dashboard admin.");
    } finally {
      setLoading(false);
    }
  }, []);

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
    { to: "/admin/penghuni", icon: Users, paint: "violet", title: "Penghuni", meta: `${totalOfficial} NIM` },
    { to: "/admin/penghuni/impor", icon: FileUp, paint: "amber", title: "Impor CSV", meta: "Per baris" },
    { to: "/admin/penjaga", icon: UserCog, paint: "sky", title: "Penjaga", meta: lockedGuards ? `${lockedGuards} terkunci` : `${activeGuards} aktif` },
    { to: "/admin/log", icon: ClipboardList, paint: "mint", title: "Log Audit", meta: `${auditLogs.length} terbaru` },
    { to: "/admin/log?tab=sys", icon: ShieldCheck, paint: "rose", title: "Validasi AI", meta: `${valLogs.length} log` },
    { to: "/admin/akun", icon: Settings, paint: "violet", title: "Akun", meta: "Admin" },
  ];

  return (
    <Page>
      <NightHeader
        left={
          <IconButton label="Akun admin" tone="navy" onClick={() => nav("/admin/akun")}>
            <Settings className="size-5" aria-hidden />
          </IconButton>
        }
        center={<Avatar name={user!.name} size={46} />}
        right={
          <IconButton label="Log" tone="navy" onClick={() => nav("/admin/log")}>
            <ClipboardList className="size-5" aria-hidden />
          </IconButton>
        }
      >
        <p className="mt-6 text-[13px] text-night-muted">{fmtLongToday()} · Admin</p>
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut }} className="text-[30px] font-bold text-white">
          Ikhtisar asrama
        </motion.h1>

        <motion.div initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.2 }} className="night-card mt-5 rounded-[30px] p-5">
          <div className="flex items-center gap-5">
            <Ring value={pct} size={104} stroke={10} dark>
              <span className="font-display text-xl font-semibold text-white tabular">{Math.round(pct * 100)}%</span>
            </Ring>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-night-muted">Wajah terdaftar</p>
              <p className="font-display text-[42px] font-semibold leading-none text-white tabular">
                <Num value={enrolledCount} />
                <span className="text-xl text-night-muted">/{totalOfficial}</span>
              </p>
              <p className="mt-1.5 text-[12px] text-night-muted">ArcFace · liveness PAD</p>
            </div>
          </div>
          <div className="mt-5">
            <Meter value={pct} night />
          </div>
          <div className="night-inset mt-5 grid grid-cols-3 rounded-[20px] py-2.5 text-center">
            {[
              [<Num key="a" value={activeResidents} />, "Penghuni aktif"],
              [<Num key="g" value={activeGuards} />, "Penjaga aktif"],
              [<Num key="v" value={validationRate} suffix="%" />, "Scan lolos"],
            ].map(([val, lbl], i) => (
              <div key={i}>
                <p className="font-display text-lg font-semibold text-white tabular">{val}</p>
                <p className="text-[11px] text-night-muted">{lbl}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </NightHeader>

      {error && (
        <Card className="-mt-4 mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadAdminOverview()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      <SectionTitle>Kelola</SectionTitle>
      <div className="grid grid-cols-3 gap-x-3 gap-y-5">
        {tiles.map((t) => (
          <Item key={t.to} className="flex flex-col items-center text-center">
            <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => nav(t.to)} className="rounded-[30px] active:shadow-[var(--sh-inset)]" aria-label={t.title}>
              <IconTile icon={t.icon} paint={t.paint} size={84} />
            </motion.button>
            <span className="mt-2.5 font-display text-[15px] font-semibold">{t.title}</span>
            <span className="text-[12px] text-subtle">{t.meta}</span>
          </Item>
        ))}
      </div>

      <SectionTitle>Tingkat kehadiran asrama</SectionTitle>
      <Card className="!p-0">
        <div className="flex items-end justify-between px-5 pt-5">
          <div>
            <p className="text-[13px] text-muted">Rata-rata keseluruhan sesi</p>
            <p className="font-display text-[34px] font-semibold leading-tight tabular">
              <Num value={overallRate} suffix="%" />
            </p>
          </div>
          <Badge tone="info">{stats?.totalOpenSessions ?? 0} sesi aktif</Badge>
        </div>
        <AreaChart data={series} aspectRatio="16 / 10" yMax={100} margin={{ top: 20, right: 30, bottom: 36, left: 30 }}>
          <Grid horizontal numTicksRows={4} />
          <Area dataKey="sukses" fill="#a855f7" stroke="#c026d3" fillOpacity={0.35} strokeWidth={3} />
          <XAxis numTicks={4} />
          <ChartTooltip rows={(p) => [{ color: "#c026d3", label: "Kehadiran", value: `${p.sukses}%` }]} />
        </AreaChart>
      </Card>

      <SectionTitle
        action={
          <motion.button whileTap={{ scale: 0.94 }} onClick={() => nav("/admin/log")} className="soft-sm flex h-9 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold text-primary">
            Semua <ChevronRight className="size-4" aria-hidden />
          </motion.button>
        }
      >
        Audit terbaru
      </SectionTitle>
      <div className="space-y-3">
        {auditLogs.slice(0, 4).map((l) => (
          <Item key={l.id} className="soft flex items-center gap-3.5 rounded-[26px] p-3 pr-4">
            <IconTile icon={ClipboardList} paint="violet" size={46} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[15px] font-semibold">{l.action}</p>
              <p className="truncate text-[12px] text-muted">
                {l.actorUsername ? `@${l.actorUsername}` : "Sistem"} · {l.description || l.entityType || "-"}
              </p>
            </div>
            <span className="shrink-0 font-display text-[12px] text-subtle tabular">
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
