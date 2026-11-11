import React, { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, Compass, ShieldAlert } from "lucide-react";
import { Ambient, BottomNav, DirCtx, Page, tabIndex } from "./components/layout";
import { Button, Card, GradientDefs } from "./components/ui";
import { roleHomePath, useAuth, type Role } from "./state/app";

import Welcome from "./pages/public/Welcome";
import Login from "./pages/public/Login";
import Register from "./pages/public/Register";

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
import Residents from "./pages/admin/Residents";
import ImportCsv from "./pages/admin/Import";
import Guards from "./pages/admin/Guards";
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

  return (
    <AppErrorBoundary>
      <div className="relative mx-auto min-h-dvh max-w-[430px] overflow-x-clip">
        <GradientDefs />
        <Ambient />
        <DirCtx.Provider value={dir.current}>
          <AnimatePresence mode="wait" initial={false}>
            <Routes location={loc} key={loc.pathname}>
              <Route path="/" element={<Welcome />} />
              <Route path="/masuk" element={<Login />} />
              <Route path="/daftar" element={<Register />} />

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
              <Route path="/admin/penghuni" element={<RequireRole role="admin"><Residents /></RequireRole>} />
              <Route path="/admin/penghuni/impor" element={<RequireRole role="admin"><ImportCsv /></RequireRole>} />
              <Route path="/admin/penjaga" element={<RequireRole role="admin"><Guards /></RequireRole>} />
              <Route path="/admin/log" element={<RequireRole role="admin"><Logs /></RequireRole>} />
              <Route path="/admin/akun" element={<RequireRole role="admin"><Account /></RequireRole>} />

              <Route path="*" element={<NotFoundView />} />
            </Routes>
          </AnimatePresence>
        </DirCtx.Provider>
        {user && <BottomNav role={user.role} />}
      </div>
    </AppErrorBoundary>
  );
}
