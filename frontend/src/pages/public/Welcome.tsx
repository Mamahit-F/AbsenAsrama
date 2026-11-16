import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, ScanFace } from "lucide-react";
import { LiveDot, easeOut } from "../../components/ui";
import { LiquidDrippingButton } from "../../components/LiquidDrippingButton";
import { wita } from "../../lib/utils";

export default function Welcome() {
  const nav = useNavigate();
  const w = wita();

  return (
    <section className="relative flex min-h-dvh w-full flex-col justify-between overflow-hidden bg-transparent text-white select-none">
      {/* Soft center scrim for crisp typography contrast without dulling the orb */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_46%,rgba(7,6,20,0.26)_0%,transparent_64%)]"
      />

      {/* Top Navigation */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.35, ease: easeOut }}
        className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-6 sm:px-10 sm:pt-7"
      >
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-full bg-white text-[#121030] shadow-sm">
            <ScanFace className="size-4" strokeWidth={2.2} aria-hidden />
          </span>
          <span className="font-display text-sm font-bold tracking-tight text-white sm:text-base">
            Presensi Asrama
          </span>
        </div>

        <div className="flex items-center gap-3.5">
          <span className="hidden items-center gap-2 font-display text-xs text-white/75 tabular sm:inline-flex">
            <LiveDot /> {w.time} WITA
          </span>
          <button
            type="button"
            onClick={() => nav("/masuk")}
            className="lg-hero-liquid-btn cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold text-white hover:-translate-y-0.5 active:scale-[0.97]"
          >
            <span className="relative z-10">Masuk</span>
          </button>
        </div>
      </motion.header>

      {/* Center Hero Content */}
      <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
        <h1
          className="font-display text-[40px] font-bold leading-[1.05] tracking-[-0.03em] text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.85)] sm:text-[58px]"
          aria-label="Hadir cukup dengan wajahmu."
        >
          <span className="block overflow-hidden pb-1">
            <motion.span
              aria-hidden
              className="block"
              initial={{ y: "105%" }}
              animate={{ y: 0 }}
              transition={{ duration: 0.9, delay: 0.08, ease: easeOut }}
            >
              Hadir cukup
            </motion.span>
          </span>
          <span className="block overflow-hidden pb-1.5">
            <motion.span
              aria-hidden
              className="block bg-gradient-to-r from-[#D5F0EA] via-[#3CC4AE] to-[#b8b5f5] bg-clip-text text-transparent"
              initial={{ y: "105%" }}
              animate={{ y: 0 }}
              transition={{ duration: 0.9, delay: 0.18, ease: easeOut }}
            >
              dengan wajahmu.
            </motion.span>
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: easeOut }}
          className="mt-4 max-w-[34ch] text-sm leading-relaxed text-white/85 drop-shadow-[0_2px_14px_rgba(0,0,0,0.9)] sm:text-[15px]"
        >
          Presensi sesi asrama UNKLAB cepat &amp; otomatis dengan pengenalan wajah.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.65, delay: 0.65, ease: easeOut }}
          className="mt-7 flex items-center justify-center"
        >
          <LiquidDrippingButton onClick={() => nav("/masuk")}>
            <span>Masuk ke Akun</span>
            <ArrowRight className="size-4" aria-hidden />
          </LiquidDrippingButton>
        </motion.div>
      </main>

      <div className="h-4" aria-hidden />
    </section>
  );
}
