import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

const STORAGE_KEY = "presensi-theme";
const WAVE_DURATION_SEC = 2.4;

export interface OceanWaveState {
  active: boolean;
  progress: number;
  duration: number;
  fromDark: number;
  toDark: number;
  reverse: number;
  time: number;
}

interface ThemeContextValue {
  isDark: boolean;
  setDark: (dark: boolean) => void;
  toggleTheme: () => void;
  oceanWaveRef: MutableRefObject<OceanWaveState>;
  applySettledThemeZones: (dark?: boolean) => void;
}

const ThemeCtx = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return ctx;
}

function readInitialDark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark";
  } catch {
    return false;
  }
}

export const WAVE_SYNC_SELECTOR =
  '[data-glass], [data-wave-sync], .glass, .soft, .soft-sm, .soft-inset, .glass-soft, .micro-glass, [class*="dark:"]';

export function applyDomThemeZones(dark: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove("wave-animating");
  document.documentElement.classList.toggle("theme-dark", dark);
  const zones = document.querySelectorAll(WAVE_SYNC_SELECTOR);
  for (const el of zones) {
    el.classList.toggle("is-dark-zone", dark);
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", dark ? "#060d1c" : "#eef2f7");
  }
}

export function ThemeProvider({
  children,
  hasWebglStage = false,
}: {
  children: ReactNode;
  hasWebglStage?: boolean;
}) {
  const [isDark, setIsDarkState] = useState<boolean>(readInitialDark);
  const { pathname } = useLocation();

  const oceanWaveRef = useRef<OceanWaveState>({
    active: false,
    progress: 0,
    duration: WAVE_DURATION_SEC,
    fromDark: isDark ? 1 : 0,
    toDark: isDark ? 1 : 0,
    reverse: 0,
    time: 0,
  });

  const applySettledThemeZones = useCallback(
    (overrideDark?: boolean) => {
      const dark = overrideDark ?? isDark;
      applyDomThemeZones(dark);
    },
    [isDark],
  );

  const prevPathRef = useRef(pathname);

  // Ensure initial <html> class, DOM zones, and route transitions stay synced when settled
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, isDark ? "dark" : "light");
    } catch {
      // Ignore storage quota / private mode restrictions
    }
    const routeChanged = prevPathRef.current !== pathname;
    prevPathRef.current = pathname;

    if (routeChanged && oceanWaveRef.current.active) {
      oceanWaveRef.current.active = false;
      oceanWaveRef.current.progress = 0;
      oceanWaveRef.current.fromDark = isDark ? 1 : 0;
      oceanWaveRef.current.toDark = isDark ? 1 : 0;
      applyDomThemeZones(isDark);
      return;
    }

    if (!oceanWaveRef.current.active) {
      oceanWaveRef.current.fromDark = isDark ? 1 : 0;
      oceanWaveRef.current.toDark = isDark ? 1 : 0;
      applyDomThemeZones(isDark);
    } else {
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute("content", isDark ? "#060d1c" : "#eef2f7");
      }
    }
  }, [isDark, pathname]);

  // Sync newly mounted cards/badges after async data fetches while no wave is active
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    let frame = 0;
    const obs = new MutationObserver(() => {
      if (oceanWaveRef.current.active) return;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!oceanWaveRef.current.active) {
          applyDomThemeZones(isDark);
        }
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [isDark]);

  const setDark = useCallback(
    (targetDark: boolean) => {
      if (targetDark === isDark) return;

      const isFallback =
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("gl-fallback");

      if (!hasWebglStage || isFallback) {
        oceanWaveRef.current.active = false;
        oceanWaveRef.current.progress = 0;
        oceanWaveRef.current.fromDark = targetDark ? 1 : 0;
        oceanWaveRef.current.toDark = targetDark ? 1 : 0;
        setIsDarkState(targetDark);
        applyDomThemeZones(targetDark);
        return;
      }

      const w = oceanWaveRef.current;
      w.fromDark = isDark ? 1 : 0;
      w.toDark = targetDark ? 1 : 0;
      w.reverse = targetDark ? 0 : 1; // Light -> Dark: top-right to bottom-left; Dark -> Light: recedes bottom-left to top-right
      if (typeof document !== "undefined") {
        document.documentElement.classList.add("wave-animating");
      }
      w.progress = 0.001;
      w.active = true;
      setIsDarkState(targetDark);
    },
    [hasWebglStage, isDark],
  );

  const toggleTheme = useCallback(() => {
    setDark(!isDark);
  }, [isDark, setDark]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      isDark,
      setDark,
      toggleTheme,
      oceanWaveRef,
      applySettledThemeZones,
    }),
    [isDark, setDark, toggleTheme, applySettledThemeZones],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
