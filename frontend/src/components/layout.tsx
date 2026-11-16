import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileSpreadsheet,
  History,
  Home,
  LogOut,
  Menu,
  ScanFace,
  ShieldCheck,
  UserRound,
  Users,
  UserCog,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useAuth, type Role, type User } from "../state/app";
import { useTheme } from "../state/theme";
import { Avatar, IconButton, easeOut, spring } from "./ui";
import { SkyToggle } from "./ui/sky-toggle";

/* ==========================================================================
   Responsive & Liquid Glass Navigation Context
   ========================================================================== */
interface NavContextValue {
  hasSidebar: boolean;
  isDesktop: boolean;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const NavCtx = createContext<NavContextValue>({
  hasSidebar: false,
  isDesktop: true,
  drawerOpen: false,
  setDrawerOpen: () => {},
  collapsed: false,
  setCollapsed: () => {},
});

export function useNavShell() {
  return useContext(NavCtx);
}

const NO_SIDEBAR_ROUTES = new Set([
  "/",
  "/masuk",
  "/penghuni/persetujuan",
  "/penghuni/daftar-wajah",
  "/penghuni/scan",
  "/penjaga/bantu-scan",
]);

export function shouldShowSidebar(user: User | null, pathname: string): boolean {
  if (!user) return false;
  if (NO_SIDEBAR_ROUTES.has(pathname)) return false;
  return (
    pathname.startsWith("/penghuni") ||
    pathname.startsWith("/penjaga") ||
    pathname.startsWith("/admin")
  );
}

/** Smooth, elastic liquid spring for sidebar expand/collapse & mobile drawer slide. */
const dockSpring = {
  type: "spring" as const,
  stiffness: 145,
  damping: 17,
  mass: 1.05,
};

/** Unhurried, buttery liquid puddle glide & bounce settle for active menu transitions. */
const puddleSpring = {
  type: "spring" as const,
  stiffness: 135,
  damping: 14,
  mass: 1.05,
};

/** Tactile bouncy spring for icon pops, hover lift, and tap feedback. */
const dropletSpring = {
  type: "spring" as const,
  stiffness: 220,
  damping: 14,
  mass: 0.85,
};

function useIsDesktopLg() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isDesktop;
}

/* ==========================================================================
   Real Liquid Glass SDF Normal Map Generator & SVG Refraction Filters
   ========================================================================== */
interface GlassMaps {
  sidebarDisp: string;
  cardDisp: string;
  pillDisp: string;
  dockDisp: string;
  insetDisp: string;
}

let cachedGlassMaps: GlassMaps | null = null;

function generateSdfMap(
  W: number,
  H: number,
  radius: number,
  bezel: number,
  opts?: { concave?: boolean; ripple?: number },
): string {
  const dispCanvas = document.createElement("canvas");
  dispCanvas.width = W;
  dispCanvas.height = H;
  const dispCtx = dispCanvas.getContext("2d");
  if (!dispCtx) return "";

  const img = dispCtx.createImageData(W, H);
  const d = img.data;
  const hw = W / 2 - radius;
  const hh = H / 2 - radius;
  const sign = opts?.concave ? 1 : -1;
  const ripple = opts?.ripple ?? 0;

  for (let y = 0; y < H; y++) {
    const uy = (y / Math.max(H - 1, 1)) * 2 - 1;
    for (let x = 0; x < W; x++) {
      const ux = (x / Math.max(W - 1, 1)) * 2 - 1;
      const px = x - W / 2;
      const py = y - H / 2;
      const ax = Math.max(0, Math.abs(px) - hw);
      const ay = Math.max(0, Math.abs(py) - hh);
      const sdf = Math.hypot(ax, ay) - radius;
      const distIn = Math.max(0, -sdf);
      const t = Math.max(0, 1 - distIn / bezel);
      // Curved Snell meniscus profile: flat crystal center with steep organic bend toward the rim
      const meniscus = Math.sin(t * Math.PI * 0.5) * Math.pow(t, 1.05);

      let nx = 0;
      let ny = 0;
      if (ax > 0 || ay > 0) {
        const len = Math.hypot(ax, ay) || 1;
        nx = (ax / len) * Math.sign(px);
        ny = (ay / len) * Math.sign(py);
      } else if (distIn < bezel) {
        // Smooth continuous normal blend toward nearest edges (eliminates diagonal corner creases)
        const edgeX = Math.max(0.001, W / 2 - Math.abs(px));
        const edgeY = Math.max(0.001, H / 2 - Math.abs(py));
        const wx = 1 / (edgeX * edgeX);
        const wy = 1 / (edgeY * edgeY);
        const gx = Math.sign(px) * wx;
        const gy = Math.sign(py) * wy;
        const gl = Math.hypot(gx, gy) || 1;
        nx = gx / gl;
        ny = gy / gl;
      }

      // Subtle organic fluid wave modulation along surface + bezel (reminiscent of molten crystal)
      const waveX = ripple * Math.sin(uy * 3.4 + ux * 1.9) * (0.3 + 0.7 * t);
      const waveY = ripple * Math.cos(ux * 3.1 - uy * 2.2) * (0.3 + 0.7 * t);

      const dx = Math.max(-1, Math.min(1, sign * nx * meniscus + waveX));
      const dy = Math.max(-1, Math.min(1, sign * ny * meniscus + waveY));

      const i = (y * W + x) * 4;
      d[i] = Math.round(128 + dx * 120);
      d[i + 1] = Math.round(128 + dy * 120);
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }

  dispCtx.putImageData(img, 0, 0);
  return dispCanvas.toDataURL();
}

export function LiquidGlassFilters() {
  const dispSidebarRef = useRef<SVGFEImageElement>(null);
  const dispCardRef = useRef<SVGFEImageElement>(null);
  const dispPillRef = useRef<SVGFEImageElement>(null);
  const dispDockRef = useRef<SVGFEImageElement>(null);
  const dispInsetRef = useRef<SVGFEImageElement>(null);
  const [enableSvgRefraction, setEnableSvgRefraction] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(hover: hover) and (pointer: fine)").matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setEnableSvgRefraction(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!enableSvgRefraction) return;
    if (!cachedGlassMaps) {
      cachedGlassMaps = {
        sidebarDisp: generateSdfMap(220, 680, 44, 38, { ripple: 0.06 }),
        cardDisp: generateSdfMap(240, 150, 30, 26, { ripple: 0.07 }),
        pillDisp: generateSdfMap(220, 46, 23, 15, { ripple: 0.04 }),
        dockDisp: generateSdfMap(62, 58, 26, 15, { ripple: 0.04 }),
        insetDisp: generateSdfMap(240, 72, 22, 16, { concave: true, ripple: 0.03 }),
      };
    }
    dispSidebarRef.current?.setAttribute("href", cachedGlassMaps.sidebarDisp);
    dispCardRef.current?.setAttribute("href", cachedGlassMaps.cardDisp);
    dispPillRef.current?.setAttribute("href", cachedGlassMaps.pillDisp);
    dispDockRef.current?.setAttribute("href", cachedGlassMaps.dockDisp);
    dispInsetRef.current?.setAttribute("href", cachedGlassMaps.insetDisp);
  }, [enableSvgRefraction]);

  if (!enableSvgRefraction) return null;

  return (
    <svg width="0" height="0" className="pointer-events-none absolute" aria-hidden>
      <defs>
        <filter id="lg-sidebar" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
          <feImage ref={dispSidebarRef} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="28" xChannelSelector="R" yChannelSelector="G" />
        </filter>

        <filter id="lg-card" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
          <feImage ref={dispCardRef} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="44" xChannelSelector="R" yChannelSelector="G" />
        </filter>

        <filter id="lg-pill" x="-12%" y="-20%" width="124%" height="140%" colorInterpolationFilters="sRGB">
          <feImage ref={dispPillRef} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="28" xChannelSelector="R" yChannelSelector="G" />
        </filter>

        <filter id="lg-dock" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
          <feImage ref={dispDockRef} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="22" xChannelSelector="R" yChannelSelector="G" />
        </filter>

        <filter id="lg-inset" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
          <feImage ref={dispInsetRef} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="22" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

export function NavProvider({
  hasSidebar,
  children,
}: {
  hasSidebar: boolean;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktopLg();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, isDesktop]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const value = useMemo<NavContextValue>(
    () => ({
      hasSidebar,
      isDesktop,
      drawerOpen: hasSidebar && !isDesktop && drawerOpen,
      setDrawerOpen,
      collapsed: hasSidebar && isDesktop && collapsed,
      setCollapsed,
    }),
    [hasSidebar, isDesktop, drawerOpen, collapsed],
  );

  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}

/* ---------- Page transition ---------- */
export const DirCtx = createContext(1);

const pageVariants: Variants = {
  initial: (d: number) => ({ opacity: 0, x: d === 0 ? 0 : d * 24 }),
  enter: { opacity: 1, x: 0, transition: { type: "spring", bounce: 0.1, visualDuration: 0.34 } },
  exit: (d: number) => ({ opacity: 0, x: d === 0 ? 0 : d * -16, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] as const } }),
};

export function Page({ children, className, nav = true }: { children: ReactNode; className?: string; nav?: boolean }) {
  const d = useContext(DirCtx);
  const { hasSidebar } = useNavShell();
  return (
    <motion.main
      custom={d}
      variants={pageVariants}
      initial="initial"
      animate="enter"
      exit="exit"
      className={cn(
        "min-h-dvh px-5 pt-[max(0.75rem,env(safe-area-inset-top))]",
        hasSidebar && "lg:px-0 lg:pt-0",
        nav && hasSidebar ? "pb-14 lg:pb-12" : nav ? "pb-24" : "pb-10",
        className,
      )}
    >
      {children}
    </motion.main>
  );
}

function LiquidMenuTrigger({ onClick, label = "Buka menu navigasi" }: { onClick: () => void; label?: string }) {
  return (
    <motion.button
      type="button"
      data-wave-sync=""
      aria-label={label}
      whileTap={{ scale: 0.9 }}
      transition={spring}
      onClick={onClick}
      className="micro-glass ink-2 relative grid size-11 shrink-0 place-items-center rounded-full"
    >
      <Menu className="size-5" aria-hidden />
      <span
        className="absolute right-2 top-2 size-[7px] rounded-full bg-[#3CC4AE] shadow-[0_0_8px_#3CC4AE,0_0_3px_#D5F0EA]"
        aria-hidden
      />
    </motion.button>
  );
}

const DASHBOARD_PATHS = new Set(["/penghuni", "/penjaga", "/admin"]);

/** Sub-page header: soft round back button + centred title. */
export function TopBar({ title, back, right, sub }: { title?: string; back?: boolean | string; right?: ReactNode; sub?: string }) {
  const nav = useNavigate();
  const { hasSidebar, setDrawerOpen } = useNavShell();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      data-wave-sync=""
      className={cn(
        "sticky top-2 z-30 -mx-2 mb-3 flex h-[64px] items-center gap-3 rounded-full px-3 transition-[background-color,box-shadow,border-color] duration-200 lg:mx-0 lg:px-3",
        scrolled && "micro-glass",
      )}
    >
      {back ? (
        <IconButton label="Kembali" onClick={() => (typeof back === "string" ? nav(back) : nav(-1))}>
          <ArrowLeft className="size-5" aria-hidden />
        </IconButton>
      ) : hasSidebar ? (
        <div className="lg:hidden">
          <LiquidMenuTrigger onClick={() => setDrawerOpen(true)} />
        </div>
      ) : null}
      <div className={cn("min-w-0 flex-1", back ? "text-center" : "text-left")}>
        {title && <h1 className={cn("truncate font-semibold ink-1", back ? "text-[18px]" : "text-[22px]")}>{title}</h1>}
        {sub && <p className="truncate text-xs ink-4">{sub}</p>}
      </div>
      {right ? (
        <div className="flex shrink-0 items-center justify-end gap-2">{right}</div>
      ) : back ? (
        <span className="size-11 shrink-0" aria-hidden />
      ) : null}
    </header>
  );
}

/** Compact optical hero header for tab pages (Jadwal, Rekap, Log, …). */
export function PageHead({ eyebrow, title, right }: { eyebrow?: ReactNode; title: ReactNode; right?: ReactNode }) {
  return (
    <NightHeader className="mb-5">
      <div className="flex items-end gap-3 pt-2 lg:pt-1">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }} className="text-[13px] font-medium ink-4">
              {eyebrow}
            </motion.p>
          )}
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: easeOut, delay: 0.05 }} className="mt-0.5 truncate text-[30px] font-bold leading-[1.08] ink-1">
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
   Unified Optical Liquid Glass Hero Slab
   - Integrates seamlessly into the global WebGL flowing chrome background
   - Synchronizes Day <-> Midnight Dark transition via ocean-wave shader
   ========================================================================== */
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
  const { pathname } = useLocation();
  const { hasSidebar, setDrawerOpen } = useNavShell();
  const { isDark, toggleTheme } = useTheme();
  const showThemeToggle = DASHBOARD_PATHS.has(pathname);
  const hasDesktopBar = Boolean(left || right || center || hasSidebar || showThemeToggle);

  return (
    <section
      data-glass="slab"
      data-radius="32"
      className={cn(
        "lg-hero-slab relative mb-6 rounded-[30px] px-5 pb-6 pt-5 lg:rounded-[32px] lg:px-7 lg:pb-7 lg:pt-6",
        className,
      )}
    >
      {hasDesktopBar && (
        <div className="relative mb-2 flex h-12 items-center justify-between gap-2">
          <div className="flex items-center justify-start gap-2">
            {hasSidebar && (
              <div className="lg:hidden">
                <LiquidMenuTrigger onClick={() => setDrawerOpen(true)} />
              </div>
            )}
            {left}
          </div>
          {center && (
            <div className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <motion.div initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...spring, delay: 0.08 }} className="relative">
                {center}
              </motion.div>
            </div>
          )}
          <div className="flex shrink-0 items-center justify-end gap-2">
            {showThemeToggle && <SkyToggle checked={isDark} onCheckedChange={() => toggleTheme()} size={9.5} />}
            {right}
          </div>
        </div>
      )}

      <div className="relative">{children}</div>
    </section>
  );
}

/* ==========================================================================
   Navigation Tabs / Role Menus + Sidebar Config
   ========================================================================== */
export interface Tab {
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
    { to: "/admin/pengguna", label: "Pengguna", icon: Users },
    { to: "/admin/log", label: "Log", icon: ClipboardList },
  ],
};

const SIDEBAR_ITEMS: Record<Role, Tab[]> = {
  penghuni: TABS.penghuni.filter((t) => !t.center),
  penjaga: TABS.penjaga.filter((t) => !t.center),
  admin: TABS.admin,
};

interface FeaturedCta {
  to: string;
  title: string;
  subtitle: string;
  icon: typeof ScanFace;
  live?: boolean;
}

const FEATURED_CTA: Record<Role, FeaturedCta> = {
  penghuni: {
    to: "/penghuni/scan",
    title: "Presensi Wajah",
    subtitle: "Scan wajah & liveness",
    icon: ScanFace,
    live: true,
  },
  penjaga: {
    to: "/penjaga/bantu-scan",
    title: "Bantu Scan",
    subtitle: "Scan asisten penjaga",
    icon: ScanFace,
    live: true,
  },
  admin: {
    to: "/admin/log?tab=sys",
    title: "Monitoring Live",
    subtitle: "Audit & validasi AI",
    icon: ShieldCheck,
    live: true,
  },
};

const PROFILE_ROUTE: Record<Role, string> = {
  penghuni: "/penghuni/profil",
  penjaga: "/penjaga/akun",
  admin: "/admin/akun",
};

function isTabActive(pathname: string, tabTo: string) {
  if (pathname === tabTo) return true;
  if (tabTo.split("/").length > 2 && pathname.startsWith(`${tabTo}/`)) return true;
  if (tabTo === "/penjaga/kehadiran" && pathname === "/penjaga/manual") return true;
  return false;
}

export function tabIndex(path: string) {
  for (const tabs of Object.values(TABS)) {
    const i = tabs.findIndex((t) => t.to === path);
    if (i >= 0) return i;
  }
  return -1;
}

function getUserSummaryMeta(user: User): string {
  if (user.role === "penghuni") {
    const hall = user.hallName || "Penghuni Asrama";
    const room = user.room ? `Kamar ${user.room}` : user.nim ? `NIM ${user.nim}` : "Aktif";
    return `${hall} · ${room}`;
  }
  if (user.role === "penjaga") {
    return user.hallName ? `${user.hallName} · Penjaga` : "Penjaga";
  }
  return "Super Administrator";
}

interface PuddleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ==========================================================================
   Shared Minimalist Real Liquid Glass Sidebar Content
   - NO role switch
   - User Info Summary Card positioned at TOP (right under brand header)
   - Persistent gliding crystal-clear liquid puddle + 0.6px hairline borders
   - Smooth, unhurried bouncy spring motion
   ========================================================================== */
function SidebarContent({
  user,
  collapsed,
  onNavigate,
  onToggleCollapse,
  headerAction,
}: {
  user: User;
  collapsed: boolean;
  onNavigate: (to: string) => void;
  onToggleCollapse?: () => void;
  headerAction?: ReactNode;
}) {
  const { pathname } = useLocation();
  const { logout } = useAuth();
  const nav = useNavigate();

  const items = SIDEBAR_ITEMS[user.role];
  const cta = FEATURED_CTA[user.role];
  const CtaIcon = cta.icon;
  const profileRoute = PROFILE_ROUTE[user.role];
  const onProfile = pathname === profileRoute;

  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [puddle, setPuddle] = useState<PuddleRect | null>(null);
  const activeKey = useMemo(
    () => items.find((item) => isTabActive(pathname, item.to))?.to ?? null,
    [items, pathname],
  );

  const measureActive = useCallback(() => {
    if (!activeKey) {
      setPuddle(null);
      return;
    }
    const btnEl = itemRefs.current.get(activeKey);
    if (!btnEl) {
      setPuddle(null);
      return;
    }
    const next: PuddleRect = {
      x: btnEl.offsetLeft,
      y: btnEl.offsetTop,
      width: btnEl.offsetWidth,
      height: btnEl.offsetHeight,
    };
    setPuddle((prev) =>
      prev &&
      prev.x === next.x &&
      prev.y === next.y &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next,
    );
  }, [activeKey]);

  useLayoutEffect(() => {
    measureActive();
  }, [measureActive, collapsed, items.length]);

  useEffect(() => {
    const navEl = navRef.current;
    if (!navEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureActive());
    ro.observe(navEl);
    return () => ro.disconnect();
  }, [measureActive]);

  const handleLogout = useCallback(async () => {
    await logout();
    nav("/masuk", { replace: true });
  }, [logout, nav]);

  return (
    <>
      {/* 1. Minimalist Optical Brand Header */}
      <div
        className={cn(
          "relative z-10 flex w-full items-center gap-[11px]",
          collapsed ? "justify-center px-0 pb-3.5 pt-0.5" : "px-1 pb-4 pt-0.5",
        )}
      >
        {onToggleCollapse && collapsed ? (
          <motion.button
            type="button"
            data-wave-sync=""
            onClick={onToggleCollapse}
            aria-label="Perluas sidebar"
            whileHover={{ scale: 1.1, rotate: -6 }}
            whileTap={{ scale: 0.9 }}
            transition={dropletSpring}
            className="micro-glass ink-teal group relative grid size-[38px] shrink-0 place-items-center rounded-full"
          >
            <ScanFace className="size-[18px]" strokeWidth={2} aria-hidden />
            <span className="lg-tooltip-pill pointer-events-none absolute left-[60px] top-1/2 z-50 inline-flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 font-display text-[12px] font-semibold text-white opacity-0 transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100">
              Perluas sidebar
            </span>
          </motion.button>
        ) : (
          <div
            data-wave-sync=""
            className="micro-glass ink-teal grid size-[38px] shrink-0 place-items-center rounded-full"
          >
            <ScanFace className="size-[18px]" strokeWidth={2.05} aria-hidden />
          </div>
        )}

        {!collapsed && (
          <div data-wave-sync="" className="min-w-0 flex-1">
            <p className="truncate font-display text-[14.5px] font-bold leading-tight tracking-tight ink-1">
              Presensi Asrama
            </p>
            <p className="mt-0.5 truncate text-[11px] font-medium ink-4">
              UNKLAB · WITA
            </p>
          </div>
        )}

        {headerAction ??
          (onToggleCollapse && !collapsed && (
            <motion.button
              type="button"
              data-wave-sync=""
              onClick={onToggleCollapse}
              aria-label="Ciutkan sidebar"
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.88 }}
              transition={dropletSpring}
              className="micro-glass ink-3 ml-auto grid size-7 shrink-0 place-items-center rounded-full hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" strokeWidth={2.2} aria-hidden />
            </motion.button>
          ))}
      </div>

      {/* 2. Top User Info Pill */}
      <div className="relative z-10 w-full">
        <motion.button
          type="button"
          data-wave-sync=""
          onClick={() => onNavigate(profileRoute)}
          whileHover={{ scale: 1.02, y: -1.5 }}
          whileTap={{ scale: 0.95 }}
          transition={dropletSpring}
          aria-label={`Profil ${user.name}`}
          className={cn(
            "micro-glass group relative flex items-center text-left",
            onProfile && "ring-2 ring-[#0E8F7E]/45",
            collapsed
              ? "mx-auto size-[52px] justify-center rounded-full p-0"
              : "w-full gap-[11px] rounded-[20px] px-[11px] py-[9px]",
          )}
        >
          <div className="relative shrink-0">
            <Avatar name={user.name} size={36} className="ring-1 ring-white/40" />
            <span
              className="absolute bottom-0 right-0 size-[9px] rounded-full border-[1.5px] border-white bg-[#10b981] shadow-[0_0_8px_#34d399]"
              aria-hidden
            />
          </div>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[13px] font-semibold leading-tight ink-1">
                {user.name}
              </p>
              <p className="mt-0.5 truncate text-[11px] ink-4">
                {getUserSummaryMeta(user)}
              </p>
            </div>
          ) : (
            <span className="lg-tooltip-pill pointer-events-none absolute left-[68px] top-1/2 z-50 inline-flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 font-display text-[12px] font-semibold text-white opacity-0 transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100">
              <span className="size-1.5 rounded-full bg-[#34d399] shadow-[0_0_8px_#34d399]" />
              {user.name}
            </span>
          )}
        </motion.button>
      </div>

      {/* 3. Featured Optical Action CTA */}
      <div className="relative z-10 mt-3 w-full">
        <motion.button
          type="button"
          onClick={() => onNavigate(cta.to)}
          whileHover={{ scale: 1.025, y: -2 }}
          whileTap={{ scale: 0.94 }}
          transition={dropletSpring}
          aria-label={cta.title}
          className={cn(
            "grad-accent group relative flex items-center text-left text-white",
            collapsed
              ? "mx-auto size-[52px] justify-center rounded-full p-0"
              : "w-full gap-[11px] rounded-full px-3.5 py-[11px]",
          )}
        >
          <CtaIcon className="size-5 shrink-0 text-white" strokeWidth={2.05} aria-hidden />
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[13px] font-bold leading-tight text-white">
                {cta.title}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[10.5px] text-white/90">
                {cta.live && (
                  <span className="size-1.5 shrink-0 rounded-full bg-[#6ee7b7] shadow-[0_0_8px_#6ee7b7]" aria-hidden />
                )}
                <span className="truncate">{cta.subtitle}</span>
              </p>
            </div>
          ) : (
            <span className="lg-tooltip-pill pointer-events-none absolute left-[68px] top-1/2 z-50 inline-flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 font-display text-[12px] font-semibold text-white opacity-0 transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100">
              <span className="size-1.5 rounded-full bg-[#6ee7b7] shadow-[0_0_8px_#6ee7b7]" />
              {cta.title}
            </span>
          )}
        </motion.button>
      </div>

      {/* Whisper-thin optical hairline divider */}
      <div
        className="relative z-10 mx-auto my-3.5 h-px w-[calc(100%-16px)] bg-current opacity-10"
        aria-hidden
      />

      {/* 4. Crystal Gliding Liquid Puddle Navigation */}
      <nav
        ref={navRef}
        aria-label="Menu navigasi utama"
        className={cn(
          "relative z-10 flex w-full flex-1 flex-col",
          collapsed ? "items-center gap-2.5" : "gap-1.5",
        )}
      >
        {puddle && (
          <motion.div
            data-wave-sync=""
            initial={{
              opacity: 0,
              scale: 0.9,
              x: puddle.x,
              y: puddle.y,
              width: puddle.width,
              height: puddle.height,
              borderRadius: collapsed ? 26 : 999,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              x: puddle.x,
              y: puddle.y,
              width: puddle.width,
              height: puddle.height,
              borderRadius: collapsed ? 26 : 999,
            }}
            transition={puddleSpring}
            className="micro-glass pointer-events-none absolute left-0 top-0 z-0 will-change-transform"
            aria-hidden
          >
            <motion.span
              key={activeKey}
              initial={{ opacity: 0.5, scale: 0.95 }}
              animate={{ opacity: 0, scale: 1.04 }}
              transition={{ duration: 0.68, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[#0E8F7E]/20"
            />
          </motion.div>
        )}

        {items.map((item) => {
          const active = isTabActive(pathname, item.to);
          const Icon = item.icon;
          return (
            <motion.button
              key={item.to}
              data-wave-sync=""
              ref={(el) => {
                if (el) itemRefs.current.set(item.to, el);
                else itemRefs.current.delete(item.to);
              }}
              type="button"
              onClick={() => onNavigate(item.to)}
              aria-current={active ? "page" : undefined}
              whileHover={collapsed ? { scale: 1.07, y: -2 } : { scale: 1.02, x: 3 }}
              whileTap={{ scale: 0.94 }}
              transition={dropletSpring}
              className={cn(
                "group relative z-10 flex items-center font-display transition-colors duration-200",
                collapsed
                  ? "h-[58px] w-[62px] flex-col justify-center gap-1 rounded-[26px] px-1"
                  : "h-[46px] w-full gap-[13px] rounded-full px-[15px] text-[13.5px]",
                active ? "font-semibold ink-teal" : "font-medium ink-3 hover:text-foreground",
              )}
            >
              <motion.span
                animate={{
                  scale: active ? 1.12 : 1,
                  y: active ? -1 : 0,
                }}
                transition={dropletSpring}
                className="relative z-10 grid size-5 shrink-0 place-items-center"
              >
                <Icon className="size-[19px]" strokeWidth={active ? 2.25 : 1.9} aria-hidden />
              </motion.span>

              {!collapsed ? (
                <motion.span
                  animate={{ x: active ? 2 : 0 }}
                  transition={dropletSpring}
                  className="relative z-10 truncate"
                >
                  {item.label}
                </motion.span>
              ) : (
                <span className="relative z-10 max-w-[54px] truncate text-[10px] font-medium leading-tight">
                  {item.label}
                </span>
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Whisper-thin footer divider */}
      <div
        className="relative z-10 mx-auto mb-3 mt-auto h-px w-[calc(100%-16px)] bg-current opacity-10"
        aria-hidden
      />

      {/* 5. Sign-out Micro-Glass Pill */}
      <motion.button
        type="button"
        data-wave-sync=""
        onClick={() => void handleLogout()}
        whileHover={{ scale: 1.025, y: -1.5 }}
        whileTap={{ scale: 0.94 }}
        transition={dropletSpring}
        className={cn(
          "micro-glass ink-2 group relative z-10 flex items-center font-display text-[13px] font-semibold",
          collapsed
            ? "mx-auto h-[42px] w-[48px] justify-center rounded-full p-0"
            : "h-[42px] w-full gap-3 rounded-full px-[15px]",
        )}
      >
        <LogOut className="size-[18px] shrink-0" aria-hidden />
        {!collapsed ? (
          <span className="truncate">Keluar</span>
        ) : (
          <span className="lg-tooltip-pill pointer-events-none absolute left-[68px] top-1/2 z-50 inline-flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 font-display text-[12px] font-semibold text-white opacity-0 transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100">
            <span className="size-1.5 rounded-full bg-[#fda4af]" />
            Keluar
          </span>
        )}
      </motion.button>
    </>
  );
}

/* ==========================================================================
   Navigation Shell:
   - Desktop (>= 1024px): Sticky Optical Liquid Glass Capsule (256px <-> 88px dock)
   - Mobile (< 1024px): Edge Liquid Glass Handle + Floating Optical Glass Drawer
   ========================================================================== */
export function NavigationShell({ user }: { user: User }) {
  const nav = useNavigate();
  const { hasSidebar, isDesktop, drawerOpen, setDrawerOpen, collapsed, setCollapsed } = useNavShell();
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  if (!hasSidebar) return null;

  if (isDesktop) {
    return (
      <motion.aside
        aria-label="Sidebar navigasi"
        data-glass="card"
        data-radius="32"
        initial={false}
        animate={{ width: collapsed ? 88 : 256 }}
        transition={dockSpring}
        className={cn(
          "lg-optical-sidebar sticky top-[20px] z-40 hidden h-[calc(100dvh-40px)] shrink-0 flex-col rounded-[32px] lg:flex",
          collapsed ? "items-center px-3 py-[22px]" : "px-[18px] pb-[20px] pt-[24px]",
        )}
      >
        {/* Subtle expand trigger visible on dock edge when collapsed */}
        <AnimatePresence>
          {collapsed && (
            <motion.button
              type="button"
              data-wave-sync=""
              onClick={() => setCollapsed(false)}
              aria-label="Perluas sidebar"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              whileHover={{ scale: 1.14 }}
              whileTap={{ scale: 0.88 }}
              transition={dropletSpring}
              className="micro-glass ink-2 absolute -right-3 top-7 z-50 grid size-7 place-items-center rounded-full"
            >
              <ChevronRight className="size-3.5" strokeWidth={2.3} aria-hidden />
            </motion.button>
          )}
        </AnimatePresence>

        <SidebarContent
          user={user}
          collapsed={collapsed}
          onNavigate={(to) => nav(to)}
          onToggleCollapse={() => setCollapsed(!collapsed)}
        />
      </motion.aside>
    );
  }

  return (
    <>
      {/* Left Edge Liquid Glass Swipe / Tap Handle */}
      {!drawerOpen && (
        <motion.button
          type="button"
          data-wave-sync=""
          aria-label="Buka sidebar navigasi"
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -14 }}
          whileHover={{ scale: 1.06, x: 2 }}
          whileTap={{ scale: 0.9 }}
          transition={dropletSpring}
          onClick={() => setDrawerOpen(true)}
          onPanEnd={(_, info) => {
            if (info.offset.x > 28 || info.velocity.x > 250) setDrawerOpen(true);
          }}
          className="micro-glass fixed left-0 top-1/2 z-30 grid h-[76px] w-[15px] -translate-y-1/2 place-items-center rounded-r-[16px] lg:hidden"
        >
          <span className="h-7 w-[3px] rounded-full bg-[#0E8F7E]/75 shadow-[0_0_8px_rgba(45,212,191,0.55)]" aria-hidden />
        </motion.button>
      )}

      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu navigasi">
            {/* Soft dimmed scrim */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 bg-[#080d1a]/38 backdrop-blur-[3px]"
            />

            {/* Floating Optical Liquid Glass Drawer */}
            <motion.aside
              data-wave-sync=""
              initial={{ x: "-108%", scale: 0.96 }}
              animate={{ x: 0, scale: 1 }}
              exit={{ x: "-108%", scale: 0.96 }}
              transition={dockSpring}
              drag="x"
              dragConstraints={{ left: -280, right: 0 }}
              dragElastic={{ left: 0.14, right: 0.06 }}
              onDragEnd={(_, info) => {
                if (info.offset.x < -70 || info.velocity.x < -380) setDrawerOpen(false);
              }}
              className="lg-drawer-optical relative flex h-[calc(100dvh-28px)] w-[278px] max-w-[82vw] flex-col rounded-[36px] px-[18px] pb-[20px] pt-[22px]"
              style={{ marginTop: "max(14px, env(safe-area-inset-top))", marginLeft: 10 }}
            >
              <SidebarContent
                user={user}
                collapsed={false}
                onNavigate={(to) => {
                  nav(to);
                  if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
                  closeTimerRef.current = window.setTimeout(() => {
                    closeTimerRef.current = null;
                    setDrawerOpen(false);
                  }, 210);
                }}
                headerAction={
                  <motion.button
                    type="button"
                    data-wave-sync=""
                    aria-label="Tutup menu"
                    whileHover={{ scale: 1.12 }}
                    whileTap={{ scale: 0.88 }}
                    transition={dropletSpring}
                    onClick={() => setDrawerOpen(false)}
                    className="micro-glass ink-2 ml-auto grid size-8 shrink-0 place-items-center rounded-full"
                  >
                    <X className="size-4" aria-hidden />
                  </motion.button>
                }
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Backwards-compatible alias kept exported for any legacy consumers. */
export function BottomNav({ role: _role }: { role: Role }) {
  const { user } = useAuth();
  if (!user) return null;
  return <NavigationShell user={user} />;
}

export function Ambient() {
  return (
    <div
      className="ambient pointer-events-none"
      aria-hidden
      style={{
        background:
          "radial-gradient(640px 620px at 14% 20%, rgba(30, 30, 78, 0.08), transparent 70%), radial-gradient(540px 540px at 88% 82%, rgba(92, 96, 145, 0.10), transparent 70%), linear-gradient(135deg, #e7e9f4 0%, #eff0f8 52%, #f5f6fb 100%)",
      }}
    />
  );
}

/* ==========================================================================
   Scan orb — hero illustration: a night sphere with a Teal Petrol gradient ring
   that draws itself, a line-drawn face and orbiting readout pills.
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
            <stop offset="0" stopColor="#D5F0EA" />
            <stop offset="0.5" stopColor="#3CC4AE" />
            <stop offset="1" stopColor="#0E8F7E" />
          </linearGradient>
        </defs>
        <motion.circle cx="120" cy="120" r="102" stroke={stroke} strokeWidth="5" strokeLinecap="round" transform="rotate(-90 120 120)" {...draw(0.3, 1.4)} />
        <motion.circle cx="120" cy="120" r="114" stroke="#c6c9de" strokeWidth="1" strokeDasharray="2 7" {...draw(0.1)} />
        {/* face */}
        <motion.ellipse cx="120" cy="116" rx="34" ry="44" stroke="#e9e8ff" strokeWidth="2.4" {...draw(0.6)} />
        <motion.path d="M107 110c2.5-2.5 6.5-2.5 9 0M124 110c2.5-2.5 6.5-2.5 9 0" stroke="#e9e8ff" strokeWidth="2.2" strokeLinecap="round" {...draw(1)} />
        <motion.path d="M110 134c6 5 14 5 20 0" stroke="#e9e8ff" strokeWidth="2.2" strokeLinecap="round" {...draw(1.1)} />
        {["M74 84V72h12", "M166 84V72h-12", "M74 156v12h12", "M166 156v12h-12"].map((d, i) => (
          <motion.path key={d} d={d} stroke="#3CC4AE" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...draw(0.8 + i * 0.06, 0.5)} />
        ))}
      </svg>
      {!reduce && state === "idle" && (
        <div className="absolute left-[35.8%] top-[29.7%] h-[36.6%] w-[28.4%] overflow-hidden rounded-[50%]">
          <motion.div
            className="h-6 w-full bg-gradient-to-b from-transparent via-[#3CC4AE]/60 to-transparent"
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
