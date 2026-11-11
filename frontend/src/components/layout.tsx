import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  ClipboardList,
  Cpu,
  FileSpreadsheet,
  History,
  Home,
  ScanFace,
  ShieldCheck,
  UserRound,
  Users,
  UserCog,
} from "lucide-react";
import { cn } from "../lib/utils";
import { IconButton, easeOut, spring } from "./ui";
import type { Role } from "../state/store";

/* ---------- Page transition ---------- */
export const DirCtx = createContext(1);

const pageVariants: Variants = {
  initial: (d: number) => ({ opacity: 0, x: d === 0 ? 0 : d * 40, scale: d === 0 ? 0.985 : 1 }),
  enter: { opacity: 1, x: 0, scale: 1, transition: { type: "spring", bounce: 0.12, visualDuration: 0.42 } },
  exit: (d: number) => ({ opacity: 0, x: d === 0 ? 0 : d * -24, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] as const } }),
};

export function Page({ children, className, nav = true }: { children: ReactNode; className?: string; nav?: boolean }) {
  const d = useContext(DirCtx);
  return (
    <motion.main
      custom={d}
      variants={pageVariants}
      initial="initial"
      animate="enter"
      exit="exit"
      className={cn("min-h-dvh px-5 pt-[max(0.75rem,env(safe-area-inset-top))]", nav ? "pb-36" : "pb-10", className)}
    >
      {children}
    </motion.main>
  );
}

/** Sub-page header: soft round back button + centred title. Gains a backdrop once scrolled. */
export function TopBar({ title, back, right, sub }: { title?: string; back?: boolean | string; right?: ReactNode; sub?: string }) {
  const nav = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("sticky top-0 z-30 -mx-5 mb-3 flex h-[68px] items-center gap-3 px-5 transition-colors duration-300", scrolled && "bg-background/92 backdrop-blur-md")}>
      {back ? (
        <IconButton label="Kembali" onClick={() => (typeof back === "string" ? nav(back) : nav(-1))}>
          <ArrowLeft className="size-5" aria-hidden />
        </IconButton>
      ) : null}
      <div className={cn("min-w-0 flex-1", back ? "text-center" : "text-left")}>
        {title && <h1 className={cn("truncate font-semibold", back ? "text-[18px]" : "text-[22px]")}>{title}</h1>}
        {sub && <p className="truncate text-xs text-muted">{sub}</p>}
      </div>
      {right ?? (back ? <span className="size-11" /> : null)}
    </header>
  );
}

/** Compact night header with wave edge for tab pages (Jadwal, Rekap, Log, …). */
export function PageHead({ eyebrow, title, right }: { eyebrow?: ReactNode; title: ReactNode; right?: ReactNode }) {
  return (
    <NightHeader className="mb-1 pb-16">
      <div className="flex items-end gap-3 pt-6">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }} className="text-[13px] font-medium text-night-muted">
              {eyebrow}
            </motion.p>
          )}
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: easeOut, delay: 0.05 }} className="mt-0.5 truncate text-[32px] font-bold leading-[1.05] text-white">
            {title}
          </motion.h1>
        </div>
        {right && (
          <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring, delay: 0.12 }}>
            {right}
          </motion.div>
        )}
      </div>
    </NightHeader>
  );
}

/* ==========================================================================
   Night header with wave edge (reference: "MyDocs").
   Bleeds to the screen edges; the light page "flows" up into it on the left.
   ========================================================================== */
const WAVE_FLAT = "M0,70 C110,70 150,70 250,70 C320,70 360,70 390,70 L390,72 L0,72 Z";
const WAVE_CURVE = "M0,4 C110,4 150,58 250,58 C320,58 360,58 390,58 L390,72 L0,72 Z";

export function NightHeader({
  left,
  right,
  center,
  children,
  className,
}: {
  left?: ReactNode;
  right?: ReactNode;
  center?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <section className={cn("night relative -mx-5 -mt-[max(0.75rem,env(safe-area-inset-top))] overflow-hidden px-5 pb-20 pt-[max(1rem,env(safe-area-inset-top))]", className)}>
      {/* faint orbit rings for depth */}
      <svg className="pointer-events-none absolute -right-24 -top-24 size-80 opacity-[0.18]" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r="98" fill="none" stroke="#b8b5f5" strokeWidth="0.6" />
        <circle cx="100" cy="100" r="70" fill="none" stroke="#b8b5f5" strokeWidth="0.6" />
        <circle cx="100" cy="100" r="42" fill="none" stroke="#b8b5f5" strokeWidth="0.6" />
      </svg>

      {(left || right || center) && (
        <div className="relative flex h-14 items-center justify-between">
          <div className="flex w-12 justify-start">{left}</div>
          {center && (
            <div className="absolute left-1/2 top-0 -translate-x-1/2">
              {/* the notch the avatar sits in */}
              <svg width="140" height="58" viewBox="0 0 140 58" className="absolute left-1/2 top-[-14px] -translate-x-1/2" aria-hidden>
                <path d="M0,0 H140 C120,0 112,10 106,26 C100,44 88,52 70,52 C52,52 40,44 34,26 C28,10 20,0 0,0 Z" fill="#14123a" />
              </svg>
              <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...spring, delay: 0.1 }} className="relative">
                {center}
              </motion.div>
            </div>
          )}
          <div className="flex w-12 justify-end">{right}</div>
        </div>
      )}

      <div className="relative">{children}</div>

      {/* wave edge */}
      <svg className="absolute inset-x-0 -bottom-px h-[72px] w-full" viewBox="0 0 390 72" preserveAspectRatio="none" aria-hidden>
        <motion.path
          fill="var(--color-background)"
          initial={{ d: reduce ? WAVE_CURVE : WAVE_FLAT }}
          animate={{ d: WAVE_CURVE }}
          transition={{ duration: 1, ease: easeOut, delay: 0.15 }}
        />
      </svg>
    </section>
  );
}

/* ---------- Bottom nav (reference: dark curved dock with a centre orb) ---------- */
interface Tab {
  to: string;
  label: string;
  icon: typeof Home;
  center?: boolean;
}
export const TABS: Record<Role, Tab[]> = {
  penghuni: [
    { to: "/penghuni", label: "Beranda", icon: Home },
    { to: "/penghuni/riwayat", label: "Riwayat", icon: History },
    { to: "/penghuni/scan", label: "Presensi", icon: ScanFace, center: true },
    { to: "/penghuni/wajah", label: "Wajah", icon: ShieldCheck },
    { to: "/penghuni/profil", label: "Profil", icon: UserRound },
  ],
  penjaga: [
    { to: "/penjaga", label: "Beranda", icon: Home },
    { to: "/penjaga/kehadiran", label: "Kehadiran", icon: ClipboardList },
    { to: "/penjaga/bantu-scan", label: "Bantu Scan", icon: ScanFace, center: true },
    { to: "/penjaga/jadwal", label: "Jadwal", icon: CalendarClock },
    { to: "/penjaga/rekap", label: "Rekap", icon: FileSpreadsheet },
  ],
  admin: [
    { to: "/admin", label: "Beranda", icon: BarChart3 },
    { to: "/admin/penghuni", label: "Penghuni", icon: Users },
    { to: "/admin/penjaga", label: "Penjaga", icon: UserCog },
    { to: "/admin/log", label: "Log", icon: ClipboardList },
  ],
};

export function tabIndex(path: string) {
  for (const tabs of Object.values(TABS)) {
    const i = tabs.findIndex((t) => t.to === path);
    if (i >= 0) return i;
  }
  return -1;
}

const DOCK = "M0,26 C0,12 10,4 26,4 L136,4 C152,4 158,10 164,18 C172,30 182,36 195,36 C208,36 218,30 226,18 C232,10 238,4 254,4 L364,4 C380,4 390,12 390,26 L390,96 L0,96 Z";
const DOCK_FLAT = "M0,26 C0,12 10,4 26,4 L364,4 C380,4 390,12 390,26 L390,96 L0,96 Z";

export function BottomNav({ role }: { role: Role }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const tabs = TABS[role];
  if (!tabs.some((t) => t.to === pathname)) return null;
  const hasCenter = tabs.some((t) => t.center);
  return (
    <motion.nav
      initial={{ y: 120 }}
      animate={{ y: 0 }}
      exit={{ y: 120, transition: { duration: 0.2 } }}
      transition={spring}
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[430px]"
    >
      <div className="relative h-[86px] pb-[env(safe-area-inset-bottom)]">
        <svg className="absolute inset-0 h-full w-full drop-shadow-[0_-10px_24px_rgba(29,27,70,.28)]" viewBox="0 0 390 96" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="dock-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2a2766" />
              <stop offset="1" stopColor="#15133a" />
            </linearGradient>
          </defs>
          <path d={hasCenter ? DOCK : DOCK_FLAT} fill="url(#dock-fill)" />
          <path d={hasCenter ? DOCK : DOCK_FLAT} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
        </svg>

        <div className="relative flex h-full items-start justify-around px-2 pt-3">
          {tabs.map((t) => {
            const on = pathname === t.to;
            const I = t.icon;
            if (t.center)
              return (
                <div key={t.to} className="relative flex w-[76px] justify-center">
                  <motion.button
                    aria-label={t.label}
                    aria-current={on ? "page" : undefined}
                    onClick={() => nav(t.to)}
                    whileTap={{ scale: 0.88 }}
                    whileHover={{ y: -2 }}
                    transition={spring}
                    className="absolute -top-9 grid size-[68px] place-items-center rounded-full bg-[#211e55] shadow-[0_14px_28px_-10px_rgba(10,8,40,.9),inset_0_2px_0_rgba(255,255,255,.12),inset_0_-6px_14px_rgba(0,0,0,.35)] ring-[6px] ring-background"
                  >
                    <span className="absolute inset-2 rounded-full border border-white/10" aria-hidden />
                    <I className="size-7" stroke="url(#g-violet)" strokeWidth={2.4} aria-hidden />
                    {on && <motion.span layoutId={`dock-${role}`} transition={spring} className="absolute -bottom-3 size-1.5 rounded-full bg-[#c4b5fd]" />}
                  </motion.button>
                </div>
              );
            return (
              <motion.button
                key={t.to}
                aria-current={on ? "page" : undefined}
                onClick={() => nav(t.to)}
                whileTap={{ scale: 0.88 }}
                className={cn("relative flex h-14 w-16 flex-col items-center justify-start gap-1 pt-1 font-display text-[11px] font-medium transition-colors duration-200", on ? "text-white" : "text-night-muted hover:text-white/90")}
              >
                <motion.span animate={{ y: on ? -2 : 0, scale: on ? 1.08 : 1 }} transition={spring} className="grid place-items-center">
                  <I className="size-[22px]" strokeWidth={on ? 2.3 : 1.8} aria-hidden />
                </motion.span>
                <span>{t.label}</span>
                {on && <motion.span layoutId={`dock-${role}`} transition={spring} className="absolute -bottom-0.5 size-1.5 rounded-full bg-[#c4b5fd] shadow-[0_0_10px_#a78bfa]" />}
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.nav>
  );
}

export function Ambient() {
  return <div className="ambient" aria-hidden />;
}

/* ==========================================================================
   Scan orb — hero illustration: a night sphere with a gradient ring that
   draws itself, a line-drawn face and orbiting readout pills.
   ========================================================================== */
export function ScanArt({ className, state = "idle", tags = true }: { className?: string; state?: "idle" | "ok" | "fail"; tags?: boolean }) {
  const reduce = useReducedMotion();
  const stroke = state === "ok" ? "#34d399" : state === "fail" ? "#fb7185" : "url(#orb-ring)";
  const draw = (delay: number, duration = 1.2) => ({ initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration, ease: easeOut, delay } });
  return (
    <div className={cn("relative mx-auto aspect-square w-64", className)} aria-hidden>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...spring, delay: 0.05 }}
        className="absolute inset-[10%] rounded-full"
        style={{
          background: "radial-gradient(circle at 35% 30%, #3b3794 0%, #1d1b46 55%, #121030 100%)",
          boxShadow: "0 30px 60px -24px rgba(29,27,70,.75), inset 0 2px 0 rgba(255,255,255,.12), inset 0 -18px 40px rgba(0,0,0,.35)",
        }}
      />
      <svg viewBox="0 0 240 240" className="absolute inset-0 h-full w-full" fill="none">
        <defs>
          <linearGradient id="orb-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e879f9" />
            <stop offset="0.5" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <motion.circle cx="120" cy="120" r="102" stroke={stroke} strokeWidth="5" strokeLinecap="round" transform="rotate(-90 120 120)" {...draw(0.3, 1.4)} />
        <motion.circle cx="120" cy="120" r="114" stroke="#c6c9de" strokeWidth="1" strokeDasharray="2 7" {...draw(0.1)} />
        {/* face */}
        <motion.ellipse cx="120" cy="116" rx="34" ry="44" stroke="#e9e8ff" strokeWidth="2.4" {...draw(0.6)} />
        <motion.path d="M107 110c2.5-2.5 6.5-2.5 9 0M124 110c2.5-2.5 6.5-2.5 9 0" stroke="#e9e8ff" strokeWidth="2.2" strokeLinecap="round" {...draw(1)} />
        <motion.path d="M110 134c6 5 14 5 20 0" stroke="#e9e8ff" strokeWidth="2.2" strokeLinecap="round" {...draw(1.1)} />
        {["M74 84V72h12", "M166 84V72h-12", "M74 156v12h12", "M166 156v12h-12"].map((d, i) => (
          <motion.path key={d} d={d} stroke="#c4b5fd" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...draw(0.8 + i * 0.06, 0.5)} />
        ))}
      </svg>
      {!reduce && state === "idle" && (
        <div className="absolute left-[35.8%] top-[29.7%] h-[36.6%] w-[28.4%] overflow-hidden rounded-[50%]">
          <motion.div
            className="h-6 w-full bg-gradient-to-b from-transparent via-[#e879f9]/60 to-transparent"
            initial={{ y: "-100%" }}
            animate={{ y: ["-100%", "520%"] }}
            transition={{ duration: 2.4, repeat: Infinity, repeatType: "reverse", ease: "easeInOut", delay: 1.4 }}
          />
        </div>
      )}
      {tags && (
        <>
          <OrbTag className="-left-2 top-[12%]" delay={1.2} label="Liveness" value="0,96" />
          <OrbTag className="-right-3 top-[48%]" delay={1.35} label="Cocok" value="0,81" />
          <OrbTag className="bottom-[4%] left-[8%]" delay={1.5} label="Waktu" value="19:32" />
        </>
      )}
    </div>
  );
}

function OrbTag({ className, label, value, delay }: { className: string; label: string; value: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...spring, delay }} className={cn("absolute", className)}>
      <div className="soft-sm float-y flex items-center gap-2 rounded-full px-3 py-1.5" style={{ animationDelay: `${delay}s` }}>
        <span className="text-[11px] font-medium text-muted">{label}</span>
        <span className="font-display text-[13px] font-semibold text-foreground tabular">{value}</span>
      </div>
    </motion.div>
  );
}
