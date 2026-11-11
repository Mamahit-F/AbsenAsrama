import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { AttendanceMethod } from "../api/types";

export const TZ = "Asia/Makassar";

/** Merge Tailwind classes; later classes win (shadcn-style). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function parts(d: Date) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hh: Number(get("hour")) % 24,
    mm: Number(get("minute")),
    ss: Number(get("second")),
    dow: days.indexOf(get("weekday")),
  };
}

/** Current time in WITA. */
export function wita(d = new Date()) {
  const p = parts(d);
  return { ...p, minutes: p.hh * 60 + p.mm, time: `${pad(p.hh)}:${pad(p.mm)}` };
}

export const pad = (n: number) => String(n).padStart(2, "0");
export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  const normalized = iso.includes("T") ? iso : `${iso}T12:00:00+08:00`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, ...opts }).format(d);
}

export function fmtLongToday() {
  return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date());
}

export function shiftDate(iso: string, days: number) {
  const base = iso.slice(0, 10);
  const d = new Date(`${base}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return wita(d).date;
}

/** Mengubah timestamp ISO-8601 menjadi YYYY-MM-DD pada zona waktu WITA */
export function toWitaDate(iso: string | null | undefined): string {
  if (!iso) return wita().date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return wita(d).date;
}

/** Mengubah timestamp ISO-8601 atau HH:mm:ss menjadi HH:mm pada zona waktu WITA */
export function toWitaTime(isoOrTime: string | null | undefined): string {
  if (!isoOrTime) return "--:--";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(isoOrTime)) return isoOrTime.slice(0, 5);
  const d = new Date(isoOrTime);
  if (Number.isNaN(d.getTime())) return isoOrTime.slice(0, 5);
  return wita(d).time;
}

/** Awal hari (00:00:00+08:00) pada zona waktu WITA */
export function witaDayStartIso(ymd: string): string {
  return `${ymd.slice(0, 10)}T00:00:00+08:00`;
}

/** Akhir hari (23:59:59+08:00) pada zona waktu WITA */
export function witaDayEndIso(ymd: string): string {
  return `${ymd.slice(0, 10)}T23:59:59+08:00`;
}

/** Konversi indeks hari UI (0=Minggu..6=Sabtu) ke ISO-8601 backend (1=Senin..7=Minggu) */
export function uiDayToIso(uiDay: number): number {
  return uiDay === 0 ? 7 : uiDay;
}

/** Konversi hari ISO-8601 backend (1=Senin..7=Minggu) ke indeks hari UI (0=Minggu..6=Sabtu) */
export function isoDayToUi(isoDay: number): number {
  return isoDay === 7 ? 0 : isoDay;
}

/** Konversi enum AttendanceMethod backend ke label UI Bahasa Indonesia */
export function fmtMethodLabel(method: AttendanceMethod | string | null | undefined): "Scan" | "Dibantu Penjaga" | "Manual" {
  if (method === "DIBANTU_PENJAGA" || method === "Dibantu Penjaga") return "Dibantu Penjaga";
  if (method === "MANUAL" || method === "Manual") return "Manual";
  return "Scan";
}

export const DAY_LABEL = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export function initials(name: string) {
  if (!name || !name.trim()) return "U";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Hitung jarak Haversine dalam meter antara dua koordinat GPS */
export function calcDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}



