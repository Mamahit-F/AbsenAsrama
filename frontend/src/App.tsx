import React, { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { AlertTriangle, Compass, ShieldAlert } from "lucide-react";
import {
  Ambient,
  DirCtx,
  LiquidGlassFilters,
  NavProvider,
  NavigationShell,
  Page,
  shouldShowSidebar,
  tabIndex,
  useNavShell,
} from "./components/layout";
import { AuroraOrb } from "./components/AuroraOrb";
import {
  OceanWaveTransition,
  OceanWaveTransitionProvider,
  useOceanWaveTransition,
} from "./components/OceanWaveTransition";
import { Button, Card, GradientDefs } from "./components/ui";
import { LiquidGlassStage } from "./components/ui/LiquidGlassStage";
import { roleHomePath, useAuth, type Role } from "./state/app";
import { ThemeProvider } from "./state/theme";

import Welcome from "./pages/public/Welcome";
import Login from "./pages/public/Login";

import ResidentHome from "./pages/resident/Home";
import Consent from "./pages/resident/Consent";
import Enroll from "./pages/resident/Enroll";
import Scan from "./pages/resident/Scan";
import History from "./pages/resident/History";
import FaceStatus from "./pages/resident/FaceStatus";
import Profile from "./pages/resident/Profile";

import GuardDashboard from "./pages/guard/Dashboard";
import Roster from "./pages/guard/Roster";
import AssistedScan from "./pages/guard/AssistedScan";
import ManualAttendance from "./pages/guard/Manual";
import Schedules from "./pages/guard/Schedules";
import ScheduleForm from "./pages/guard/ScheduleForm";
import ExportCsv from "./pages/guard/Export";

import AdminDashboard from "./pages/admin/Dashboard";
import UserManagement from "./pages/admin/UserManagement";
import ImportCsv from "./pages/admin/Import";
import Logs from "./pages/admin/Logs";

import Account from "./pages/shared/Account";

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Terjadi kesalahan tidak terduga pada aplikasi.",
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="relative mx-auto min-h-dvh max-w-[430px] overflow-x-clip">
          <Page nav={false}>
            <Card className="mt-16 space-y-4 p-6 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger-soft text-danger">
                <AlertTriangle className="size-7" aria-hidden />
              </span>
              <h1 className="text-lg font-semibold">Terjadi Gangguan Tampilan</h1>
              <p className="text-xs text-muted">{this.state.message}</p>
              <Button
                block
                onClick={() => {
                  this.setState({ hasError: false, message: "" });
                  window.location.href = "/";
                }}
              >
                Muat Ulang Aplikasi
              </Button>
            </Card>
          </Page>
        </div>
      );
    }
    return this.props.children;
  }
}

function ForbiddenView() {
  const { user } = useAuth();
  const nav = useNavigate();
  return (
    <Page nav={false}>
      <Card className="mt-16 space-y-4 p-6 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger-soft text-danger">
          <ShieldAlert className="size-7" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold">Akses Ditolak (403)</h1>
        <p className="text-xs text-muted">
          Peran akun Anda tidak memiliki izin untuk membuka halaman ini.
        </p>
        <Button
          block
          onClick={() => nav(user ? roleHomePath(user.role) : "/masuk", { replace: true })}
        >
          Kembali ke Beranda
        </Button>
      </Card>
    </Page>
  );
}

function NotFoundView() {
  const { user } = useAuth();
  const nav = useNavigate();
  return (
    <Page nav={false}>
      <Card className="mt-16 space-y-4 p-6 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
          <Compass className="size-7" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold">Halaman Tidak Ditemukan (404)</h1>
        <p className="text-xs text-muted">
          Alamat halaman yang Anda tuju tidak tersedia.
        </p>
        <Button
          block
          onClick={() => nav(user ? roleHomePath(user.role) : "/", { replace: true })}
        >
          Kembali ke Beranda
        </Button>
      </Card>
    </Page>
  );
}

function RequireRole({ role, children }: { role: Role; children: React.ReactElement }) {
  const { user, initializing } = useAuth();
  if (initializing) {
    return (
      <Page nav={false}>
        <Card className="mt-20 p-6 text-center text-sm text-muted">
          Memverifikasi sesi akun…
        </Card>
      </Page>
    );
  }
  if (!user) return <Navigate to="/masuk" replace />;
  if (user.role !== role) {
    return <ForbiddenView />;
  }
  return children;
}

const drawerCanvasSpring = { type: "spring" as const, stiffness: 150, damping: 18, mass: 1.05 };

function AppShell({ dirValue }: { dirValue: number }) {
  const { user } = useAuth();
  const loc = useLocation();
  const { hasSidebar, isDesktop, drawerOpen } = useNavShell();
  const { enteringFromLogin, registerRevealElement } = useOceanWaveTransition();

  const isPublicOrbRoute = loc.pathname === "/" || loc.pathname === "/masuk";

  const routesEl = (
    <DirCtx.Provider value={dirValue}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={loc.pathname}
          initial={
            isPublicOrbRoute
              ? { opacity: 0, y: 14 }
              : enteringFromLogin
                ? false
                : { opacity: 0 }
          }
          animate={
            isPublicOrbRoute
              ? { opacity: 1, y: 0 }
              : { opacity: 1 }
          }
          exit={
            isPublicOrbRoute
              ? { opacity: 0, y: -10 }
              : { opacity: 0 }
          }
          transition={{
            duration: isPublicOrbRoute ? 0.34 : enteringFromLogin ? 0.1 : 0.18,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="relative z-10 min-h-dvh w-full"
        >
          <Routes location={loc}>
            <Route path="/" element={<Welcome />} />
            <Route path="/masuk" element={<Login />} />

          {/* Penghuni */}
          <Route path="/penghuni" element={<RequireRole role="penghuni"><ResidentHome /></RequireRole>} />
          <Route path="/penghuni/persetujuan" element={<RequireRole role="penghuni"><Consent /></RequireRole>} />
          <Route path="/penghuni/daftar-wajah" element={<RequireRole role="penghuni"><Enroll /></RequireRole>} />
          <Route path="/penghuni/scan" element={<RequireRole role="penghuni"><Scan /></RequireRole>} />
          <Route path="/penghuni/riwayat" element={<RequireRole role="penghuni"><History /></RequireRole>} />
          <Route path="/penghuni/wajah" element={<RequireRole role="penghuni"><FaceStatus /></RequireRole>} />
          <Route path="/penghuni/profil" element={<RequireRole role="penghuni"><Profile /></RequireRole>} />

          {/* Penjaga Asrama */}
          <Route path="/penjaga" element={<RequireRole role="penjaga"><GuardDashboard /></RequireRole>} />
          <Route path="/penjaga/kehadiran" element={<RequireRole role="penjaga"><Roster /></RequireRole>} />
          <Route path="/penjaga/bantu-scan" element={<RequireRole role="penjaga"><AssistedScan /></RequireRole>} />
          <Route path="/penjaga/manual" element={<RequireRole role="penjaga"><ManualAttendance /></RequireRole>} />
          <Route path="/penjaga/jadwal" element={<RequireRole role="penjaga"><Schedules /></RequireRole>} />
          <Route path="/penjaga/jadwal/baru" element={<RequireRole role="penjaga"><ScheduleForm /></RequireRole>} />
          <Route path="/penjaga/jadwal/:id" element={<RequireRole role="penjaga"><ScheduleForm /></RequireRole>} />
          <Route path="/penjaga/rekap" element={<RequireRole role="penjaga"><ExportCsv /></RequireRole>} />
          <Route path="/penjaga/akun" element={<RequireRole role="penjaga"><Account /></RequireRole>} />

          {/* Admin */}
          <Route path="/admin" element={<RequireRole role="admin"><AdminDashboard /></RequireRole>} />
          <Route path="/admin/pengguna" element={<RequireRole role="admin"><UserManagement /></RequireRole>} />
          <Route path="/admin/pengguna/impor" element={<RequireRole role="admin"><ImportCsv /></RequireRole>} />
          <Route path="/admin/penghuni" element={<Navigate to="/admin/pengguna?role=PENGHUNI" replace />} />
          <Route path="/admin/penghuni/impor" element={<Navigate to="/admin/pengguna/impor" replace />} />
          <Route path="/admin/penjaga" element={<Navigate to="/admin/pengguna?role=MONITOR" replace />} />
          <Route path="/admin/log" element={<RequireRole role="admin"><Logs /></RequireRole>} />
          <Route path="/admin/akun" element={<RequireRole role="admin"><Account /></RequireRole>} />

          <Route path="*" element={<NotFoundView />} />
        </Routes>
        </motion.div>
      </AnimatePresence>
    </DirCtx.Provider>
  );

  if (!hasSidebar || !user) {
    return (
      <div
        className={
          isPublicOrbRoute
            ? "relative min-h-dvh w-full overflow-x-clip bg-[#020105]"
            : "relative mx-auto min-h-dvh w-full overflow-x-clip sm:max-w-[460px]"
        }
      >
        {isPublicOrbRoute ? (
          <AuroraOrb className="fixed inset-0 h-full w-full" />
        ) : (
          <>
            <Ambient />
            <LiquidGlassStage enabled />
          </>
        )}
        <div className="relative z-10">{routesEl}</div>
      </div>
    );
  }

  const pushMobileCanvas = !isDesktop && drawerOpen;

  return (
    <>
      <LiquidGlassStage enabled />
      <div
        ref={registerRevealElement}
        className="relative z-10 min-h-dvh w-full lg:flex lg:items-start lg:gap-[20px] lg:p-[20px]"
      >
        <NavigationShell user={user} />
        <motion.div
          initial={false}
          animate={
            pushMobileCanvas
              ? { x: 64, scale: 0.94, borderRadius: 34 }
              : { x: 0, scale: 1, borderRadius: 0, transitionEnd: { transform: "none" } }
          }
          transition={drawerCanvasSpring}
          className="relative min-h-dvh min-w-0 flex-1 origin-right overflow-x-clip bg-transparent lg:min-h-0"
          style={{
            pointerEvents: pushMobileCanvas ? "none" : "auto",
            filter: pushMobileCanvas ? "saturate(1.12) contrast(1.03)" : undefined,
          }}
        >
          {routesEl}
        </motion.div>
      </div>
    </>
  );
}

export default function App() {
  const { user } = useAuth();
  const loc = useLocation();
  const prev = useRef(loc.pathname);
  const dir = useRef(1);

  if (prev.current !== loc.pathname) {
    const a = tabIndex(prev.current);
    const b = tabIndex(loc.pathname);
    if (a >= 0 && b >= 0) dir.current = b > a ? 1 : -1;
    else dir.current = loc.pathname.length >= prev.current.length ? 1 : -1;
    prev.current = loc.pathname;
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [loc.pathname]);

  const showSidebar = shouldShowSidebar(user, loc.pathname);
  const isPublicOrbRoute = loc.pathname === "/" || loc.pathname === "/masuk";

  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider hasWebglStage={!isPublicOrbRoute}>
        <OceanWaveTransitionProvider>
          <AppErrorBoundary>
            <LiquidGlassFilters />
            <GradientDefs />
            <NavProvider hasSidebar={showSidebar}>
              <AppShell dirValue={dir.current} />
            </NavProvider>
            <OceanWaveTransition />
          </AppErrorBoundary>
        </OceanWaveTransitionProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}
