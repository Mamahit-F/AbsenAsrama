import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Lock,
  LogIn,
  ScanFace,
  ShieldAlert,
  User as UserIcon,
} from "lucide-react";
import { Countdown, LiveDot, easeOut } from "../../components/ui";
import { wita } from "../../lib/utils";
import { roleHomePath, useAuth, useToast } from "../../state/app";

const ROLE_COPY = {
  penghuni: {
    sub: "Masuk sebagai Penghuni Asrama menggunakan NIM resmi",
    label: "NIM Penghuni",
    placeholder: "Contoh: 105022010101",
  },
  penjaga: {
    sub: "Masuk sebagai Penjaga (Monitor) Hall menggunakan username",
    label: "Username Penjaga",
    placeholder: "Contoh: penjaga_a1",
  },
  admin: {
    sub: "Masuk sebagai Administrator Sistem Asrama",
    label: "Username Admin",
    placeholder: "Contoh: admin",
  },
} as const;

export default function Login() {
  const [params] = useSearchParams();
  const peranParam = params.get("peran")?.toLowerCase();
  const roleCopy =
    peranParam === "penghuni" || peranParam === "penjaga" || peranParam === "admin"
      ? ROLE_COPY[peranParam]
      : null;

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [err, setErr] = useState<{ msg: string; lockedUntil?: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const w = wita();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErr(null);
    setSubmitting(true);
    try {
      const r = await login(id, pw);
      if (!r.ok) {
        setErr({ msg: r.error, lockedUntil: r.lockedUntil });
        return;
      }
      toast("Selamat datang kembali");
      nav(roleHomePath(r.role), { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="relative flex min-h-dvh w-full flex-col justify-between overflow-hidden bg-transparent text-white">
      {/* Subtle dimming scrim over the persistent AuroraOrb */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgba(8,7,22,0.52)_0%,rgba(4,3,12,0.78)_100%)]"
      />

      {/* Top Bar */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-6 sm:px-10 sm:pt-7">
        <button
          type="button"
          onClick={() => nav("/")}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-white/90 backdrop-blur-md transition hover:border-white/30 hover:bg-white/[0.12] hover:text-white"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Kembali
        </button>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 font-display text-xs text-white/75 tabular sm:inline-flex">
            <LiveDot /> {w.time} WITA
          </span>
          <span className="grid size-8 place-items-center rounded-full bg-white text-[#121030] shadow-sm">
            <ScanFace className="size-4" strokeWidth={2.2} aria-hidden />
          </span>
        </div>
      </header>

      {/* Centered Frosted Glass Login Card */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: easeOut }}
          className="w-full max-w-[420px]"
        >
          <div className="rounded-[28px] border border-white/15 bg-[#0e0d24]/75 p-6 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl sm:p-7">
            <div className="mb-6 text-center">
              <span className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl border border-[#3CC4AE]/30 bg-[#3CC4AE]/10 text-[#3CC4AE]">
                <ScanFace className="size-5" aria-hidden />
              </span>
              <h1 className="font-display text-2xl font-bold tracking-tight text-white">
                Masuk ke Akun
              </h1>
              <p className="mt-1.5 text-xs leading-relaxed text-[#a9a7d6]">
                {roleCopy?.sub ?? "Gunakan NIM (penghuni) atau username (penjaga / admin)"}
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4" noValidate>
              <div>
                <label className="mb-1.5 block font-display text-xs font-medium text-white/80">
                  {roleCopy?.label ?? "NIM atau Username"}
                </label>
                <div className="flex items-center gap-2.5 rounded-2xl border border-white/12 bg-white/[0.04] px-3.5 transition focus-within:border-[#3CC4AE]/70 focus-within:bg-white/[0.07]">
                  <UserIcon className="size-4 shrink-0 text-[#a9a7d6]" aria-hidden />
                  <input
                    type="text"
                    autoComplete="username"
                    placeholder={roleCopy?.placeholder ?? "Contoh: 105022010101 atau penjaga_a1"}
                    value={id}
                    onChange={(e) => {
                      setId(e.target.value);
                      setErr(null);
                    }}
                    className="dark-autofill h-11 w-full bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-display text-xs font-medium text-white/80">
                  Kata Sandi
                </label>
                <div className="flex items-center gap-2.5 rounded-2xl border border-white/12 bg-white/[0.04] px-3.5 transition focus-within:border-[#3CC4AE]/70 focus-within:bg-white/[0.07]">
                  <KeyRound className="size-4 shrink-0 text-[#a9a7d6]" aria-hidden />
                  <input
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Masukkan kata sandi"
                    value={pw}
                    onChange={(e) => {
                      setPw(e.target.value);
                      setErr(null);
                    }}
                    className="dark-autofill h-11 w-full bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Sembunyikan sandi" : "Tampilkan sandi"}
                    className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white"
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {err && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-2xl border border-rose-400/35 bg-rose-500/15 p-3.5 text-xs text-rose-200"
                >
                  {err.lockedUntil ? (
                    <Lock className="mt-0.5 size-4 shrink-0 text-rose-300" />
                  ) : (
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-300" />
                  )}
                  <div className="space-y-1">
                    <p className="font-semibold">{err.msg}</p>
                    {err.lockedUntil && err.lockedUntil > Date.now() && (
                      <p className="text-rose-100/90">
                        Sisa waktu kunci:{" "}
                        <Countdown until={err.lockedUntil} className="font-bold text-white" />
                      </p>
                    )}
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-1 inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[#D5F0EA] via-[#3CC4AE] to-[#0E8F7E] font-display text-sm font-bold text-[#09081a] shadow-[0_0_0_1px_rgba(213,240,234,0.4),0_12px_26px_-8px_rgba(60,196,174,0.5)] transition hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <LogIn className="size-4" aria-hidden />
                {submitting ? "Memverifikasi…" : "Masuk"}
              </button>
            </form>
          </div>

          {/* Helper Notes */}
          <div className="mt-5 space-y-2.5 text-center text-xs text-[#a9a7d6]">
            <p>
              Penghuni baru? Gunakan <span className="font-semibold text-white">NIM resmi</span> &amp; sandi awal{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5 font-bold text-[#D5F0EA]">11111111</code>.
            </p>
            <button
              type="button"
              onClick={() => setForgotOpen((v) => !v)}
              className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[#3CC4AE] hover:underline"
            >
              <HelpCircle className="size-3.5" aria-hidden /> Lupa kata sandi atau akun terkunci?
            </button>
            {forgotOpen && (
              <div className="rounded-2xl border border-white/12 bg-[#0e0d24]/80 p-3.5 text-left leading-relaxed text-white/80 backdrop-blur-md">
                Demi keamanan biometrik asrama, reset kata sandi dan pembukaan kunci akun dilakukan oleh{" "}
                <strong className="text-white">Administrator Asrama</strong>. Jika akun terkunci sementara akibat
                5x salah sandi, tunggu 5 menit atau hubungi Admin/Penjaga Hall Anda.
              </div>
            )}
          </div>
        </motion.div>
      </main>

      <div className="h-3" aria-hidden />
    </section>
  );
}
