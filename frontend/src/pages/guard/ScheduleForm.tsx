import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, CalendarCheck, Lock, Map as MapIcon, MapPin, Navigation, Save } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import { Button, Card, Chip, Field, Segmented } from "../../components/ui";
import { isApiError, mapFieldErrors, schedulesApi, type ScheduleDto } from "../../api";
import { useToast } from "../../state/app";
import { DAY_LABEL, fmtDate, isoDayToUi, shiftDate, toWitaDate, toWitaTime, uiDayToIso, wita } from "../../lib/utils";
import { UNKLAB_CENTER, isInsideUnklabBounds } from "../../lib/unklabBounds";

const GeofenceMapPicker = lazy(() => import("../../components/GeofenceMapPicker"));

function isoDayOfYmd(ymd: string): number {
  const day = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addOneDayYmd(ymd: string): string {
  const dt = new Date(`${ymd}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function oneTimeOverlapsRecurring(
  oneStartIso: string,
  oneEndIso: string,
  recDays: number[],
  recStartHm: string,
  recEndHm: string,
  recFrom: string,
  recTo: string,
): boolean {
  const oneStartMs = Date.parse(oneStartIso);
  const oneEndMs = Date.parse(oneEndIso);
  if (Number.isNaN(oneStartMs) || Number.isNaN(oneEndMs) || !recDays.length || !recStartHm || !recEndHm || !recFrom || !recTo) {
    return false;
  }
  const oneStartYmd = toWitaDate(oneStartIso);
  const oneEndYmd = toWitaDate(oneEndIso);
  const scanFrom = oneStartYmd > recFrom ? oneStartYmd : recFrom;
  const scanTo = oneEndYmd < recTo ? oneEndYmd : recTo;
  for (let d = scanFrom; d <= scanTo; d = addOneDayYmd(d)) {
    if (!recDays.includes(isoDayOfYmd(d))) continue;
    const occStartMs = Date.parse(`${d}T${recStartHm}:00+08:00`);
    const occEndMs = Date.parse(`${d}T${recEndHm}:00+08:00`);
    if (oneStartMs < occEndMs && oneEndMs > occStartMs) return true;
  }
  return false;
}

function findOverlappingSchedule(
  schedules: ScheduleDto[],
  form: ScheduleFormState,
  excludeId?: string,
): ScheduleDto | null {
  const isRecurring = form.mode === "berulang";
  const cDays = form.days.map(uiDayToIso);
  const cOneStartIso = `${form.date}T${form.start}:00+08:00`;
  const cOneEndIso = `${form.date}T${form.end}:00+08:00`;

  for (const s of schedules) {
    if (s.status !== "ACTIVE") continue;
    if (excludeId && s.id === excludeId) continue;

    if (!isRecurring && s.scheduleKind === "ONE_TIME") {
      if (!s.startsAt || !s.endsAt) continue;
      if (Date.parse(cOneStartIso) < Date.parse(s.endsAt) && Date.parse(cOneEndIso) > Date.parse(s.startsAt)) {
        return s;
      }
    } else if (isRecurring && s.scheduleKind === "RECURRING") {
      if (!s.validFrom || !s.validTo || !s.startTime || !s.endTime || !s.repeatDays?.length) continue;
      const overlapFrom = form.periodStart > s.validFrom ? form.periodStart : s.validFrom;
      const overlapTo = form.periodEnd < s.validTo ? form.periodEnd : s.validTo;
      if (overlapTo < overlapFrom) continue;
      const eStart = toWitaTime(s.startTime);
      const eEnd = toWitaTime(s.endTime);
      if (!(form.start < eEnd && form.end > eStart)) continue;
      let d = overlapFrom;
      for (let i = 0; i < 7 && d <= overlapTo; i++, d = addOneDayYmd(d)) {
        const day = isoDayOfYmd(d);
        if (cDays.includes(day) && s.repeatDays.includes(day)) return s;
      }
    } else if (!isRecurring && s.scheduleKind === "RECURRING") {
      if (!s.validFrom || !s.validTo || !s.startTime || !s.endTime || !s.repeatDays?.length) continue;
      if (oneTimeOverlapsRecurring(cOneStartIso, cOneEndIso, s.repeatDays, toWitaTime(s.startTime), toWitaTime(s.endTime), s.validFrom, s.validTo)) {
        return s;
      }
    } else if (isRecurring && s.scheduleKind === "ONE_TIME") {
      if (!s.startsAt || !s.endsAt) continue;
      if (oneTimeOverlapsRecurring(s.startsAt, s.endsAt, cDays, form.start, form.end, form.periodStart, form.periodEnd)) {
        return s;
      }
    }
  }
  return null;
}

interface ScheduleFormState {
  name: string;
  mode: "berulang" | "tanggal";
  date: string;
  days: number[];
  periodStart: string;
  periodEnd: string;
  start: string;
  end: string;
}

export default function ScheduleForm() {
  const { id } = useParams();
  const toast = useToast();
  const nav = useNavigate();
  const today = wita().date;
  const isEditing = Boolean(id);

  const [form, setForm] = useState<ScheduleFormState>({
    name: "",
    mode: "berulang",
    date: today,
    days: [],
    periodStart: today,
    periodEnd: shiftDate(today, 90),
    start: "20:00",
    end: "21:00",
  });
  const [activityTypeId, setActivityTypeId] = useState<string | null>(null);
  const [maxDailySessions, setMaxDailySessions] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(Boolean(id));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Geofence states (J-06, K-05: Bebas diubah kapan saja tanpa batasan)
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [geoLat, setGeoLat] = useState<string>("1.417200");
  const [geoLon, setGeoLon] = useState<string>("124.983500");
  const [geoRadius, setGeoRadius] = useState<number>(50);
  const [geoRadiusText, setGeoRadiusText] = useState<string>("50");
  const [geoLocating, setGeoLocating] = useState(false);
  const [geoAccuracy, setGeoAccuracy] = useState<number | null>(null);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [geoSource, setGeoSource] = useState<"default" | "gps" | "map" | "existing">("default");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [types, settings] = await Promise.all([
          schedulesApi.listActivityTypes(),
          schedulesApi.getScheduleSettings().catch(() => ({ maxDailySessions: 1 })),
        ]);
        if (active) {
          setMaxDailySessions(Math.max(1, Math.min(3, settings.maxDailySessions || 1)));
        }
        if (active && types.length > 0) {
          setActivityTypeId(types[0].id);
        }
        if (id) {
          const existing = await schedulesApi.getSchedule(id);
          if (!active) return;
          if (existing.activityTypeId) setActivityTypeId(existing.activityTypeId);
          const isRecurring = existing.scheduleKind === "RECURRING";
          setForm({
            name: existing.name,
            mode: isRecurring ? "berulang" : "tanggal",
            date: today,
            days: isRecurring && existing.repeatDays
              ? existing.repeatDays.map(isoDayToUi).sort()
              : [],
            periodStart: isRecurring ? (existing.validFrom ?? today) : today,
            periodEnd: isRecurring ? (existing.validTo ?? shiftDate(today, 90)) : today,
            start: isRecurring ? toWitaTime(existing.startTime) : toWitaTime(existing.startsAt),
            end: isRecurring ? toWitaTime(existing.endTime) : toWitaTime(existing.endsAt),
          });

          // Cek konfigurasi geofence pada sesi terkait (J-06, K-05)
          try {
            const sessList = await schedulesApi.listSessions({ scheduleId: id });
            if (active && sessList.length > 0) {
              const firstSess = sessList[0];
              if (firstSess.geofence) {
                setGeoEnabled(firstSess.geofence.isEnabled);
                setGeoLat(firstSess.geofence.latitude.toString());
                setGeoLon(firstSess.geofence.longitude.toString());
                setGeoRadius(firstSess.geofence.radiusM);
                setGeoRadiusText(String(firstSess.geofence.radiusM));
                setGeoSource("existing");
              }
            }
          } catch {
            // Abaikan jika belum ada sesi
          }
        }
      } catch (e) {
        if (active) {
          setErr(isApiError(e) ? e.message : "Gagal memuat data jadwal.");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, today]);

  const fetchCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast("Browser Anda tidak mendukung Geolocation.");
      return;
    }
    setGeoLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLocating(false);
        if (!isInsideUnklabBounds(pos.coords.latitude, pos.coords.longitude)) {
          const msg = "Lokasi GPS saat ini berada di luar batas area Kampus UNKLAB. Titik lokasi hanya diperbolehkan di dalam area UNKLAB.";
          setErr(msg);
          toast(msg, "error");
          return;
        }
        setGeoLat(pos.coords.latitude.toFixed(6));
        setGeoLon(pos.coords.longitude.toFixed(6));
        setGeoAccuracy(Math.round(pos.coords.accuracy));
        setGeoSource("gps");
        setErr("");
        toast(`Titik lokasi perangkat berhasil diambil (±${Math.round(pos.coords.accuracy)}m)`);
      },
      (geoErr) => {
        setGeoLocating(false);
        if (geoErr.code === 1) {
          toast("Izin akses lokasi ditolak oleh browser.");
        } else {
          toast("Gagal mendapatkan sinyal GPS perangkat.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const toggleDay = (d: number) => {
    setForm((prev) => ({
      ...prev,
      days: prev.days.includes(d) ? prev.days.filter((x) => x !== d) : [...prev.days, d].sort(),
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErr("");
    setFieldErrors({});

    const cleanName = form.name.trim();
    if (!cleanName) {
      setFieldErrors({ name: "Nama sesi presensi wajib diisi." });
      return;
    }
    if (form.end <= form.start) {
      setErr("Jam selesai harus lebih besar daripada jam mulai (J-06).");
      return;
    }
    const effectiveToday = wita().date;
    if (form.mode === "berulang" && form.days.length === 0) {
      setErr("Pilih minimal satu hari berulang.");
      return;
    }
    if (form.mode === "berulang" && form.periodEnd < form.periodStart) {
      setErr("Tanggal berlaku sampai tidak boleh sebelum tanggal berlaku mulai.");
      return;
    }
    if (form.mode === "berulang") {
      const nowWita = wita();
      if (!isEditing && form.periodStart < nowWita.date) {
        const msg = "Tanggal berlaku mulai tidak boleh sebelum hari ini.";
        setErr(msg);
        toast(msg, "error");
        return;
      }
      if (form.periodEnd < nowWita.date) {
        const msg = "Tanggal berlaku sampai sudah lewat dari hari ini.";
        setErr(msg);
        toast(msg, "error");
        return;
      }
      const isoDays = form.days.map(uiDayToIso);
      const scanFrom = form.periodStart > nowWita.date ? form.periodStart : nowWita.date;
      let hasUpcoming = false;
      let d = scanFrom;
      for (let i = 0; i < 14 && d <= form.periodEnd; i++, d = addOneDayYmd(d)) {
        if (isoDays.includes(isoDayOfYmd(d))) {
          hasUpcoming = true;
          break;
        }
      }
      if (!hasUpcoming && form.periodEnd <= shiftDate(scanFrom, 14)) {
        const msg = "Tidak ada hari pelaksanaan yang cocok mulai dari hari ini.";
        setErr(msg);
        toast(msg, "error");
        return;
      }
    }

    if (geoEnabled) {
      const latNum = parseFloat(geoLat);
      const lonNum = parseFloat(geoLon);
      if (isNaN(latNum) || latNum < -90 || latNum > 90) {
        setErr("Nilai latitude harus berupa angka antara -90 sampai 90.");
        return;
      }
      if (isNaN(lonNum) || lonNum < -180 || lonNum > 180) {
        setErr("Nilai longitude harus berupa angka antara -180 sampai 180.");
        return;
      }
      if (!isInsideUnklabBounds(latNum, lonNum)) {
        const msg = "Titik koordinat lokasi harus berada di dalam batas area Kampus UNKLAB.";
        setErr(msg);
        toast(msg, "error");
        return;
      }
      if (geoRadius <= 0) {
        setErr("Batas radius presensi harus lebih besar dari 0 meter.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const [activeSchedules, existingSessions] = await Promise.all([
        schedulesApi.listSchedules("ACTIVE"),
        schedulesApi.listSessions(),
      ]);
      const isRecurring = form.mode === "berulang";
      const effectiveForm: ScheduleFormState = isRecurring
        ? form
        : { ...form, date: effectiveToday, periodStart: effectiveToday, periodEnd: effectiveToday };

      if (!isRecurring) {
        const usedIds = new Set<string>();
        let usedCount = 0;
        for (const s of existingSessions) {
          if (s.status !== "CANCELLED" && toWitaDate(s.startsAt) === effectiveToday && s.scheduleId !== id) {
            usedCount += 1;
            if (s.scheduleId) usedIds.add(s.scheduleId);
          }
        }
        for (const sched of activeSchedules) {
          if (
            sched.status === "ACTIVE" &&
            sched.scheduleKind === "ONE_TIME" &&
            sched.startsAt &&
            toWitaDate(sched.startsAt) === effectiveToday &&
            sched.id !== id &&
            !usedIds.has(sched.id)
          ) {
            usedCount += 1;
          }
        }
        if (usedCount >= maxDailySessions) {
          const msg = `Maksimal ${maxDailySessions} sesi per hari untuk tanggal ${fmtDate(effectiveToday)} sudah tercapai. Hapus permanen salah satu sesi terlebih dahulu menggunakan tombol Hapus.`;
          setErr(msg);
          toast(msg, "error");
          setSubmitting(false);
          return;
        }
      }
      const conflict = findOverlappingSchedule(activeSchedules, effectiveForm, id);
      if (conflict) {
        const conflictStart = conflict.scheduleKind === "RECURRING" ? toWitaTime(conflict.startTime) : toWitaTime(conflict.startsAt);
        const conflictEnd = conflict.scheduleKind === "RECURRING" ? toWitaTime(conflict.endTime) : toWitaTime(conflict.endsAt);
        const msg = `Jadwal bertabrakan dengan "${conflict.name}" (${conflictStart} - ${conflictEnd} WITA). Hapus jadwal yang bertabrakan terlebih dahulu.`;
        setErr(msg);
        toast(msg, "error");
        setSubmitting(false);
        return;
      }

      const payload = {
        name: cleanName,
        activityTypeId,
        scheduleKind: isRecurring ? ("RECURRING" as const) : ("ONE_TIME" as const),
        startsAt: !isRecurring ? `${effectiveToday}T${form.start}:00+08:00` : null,
        endsAt: !isRecurring ? `${effectiveToday}T${form.end}:00+08:00` : null,
        repeatDays: isRecurring ? form.days.map(uiDayToIso) : null,
        startTime: isRecurring ? `${form.start}:00` : null,
        endTime: isRecurring ? `${form.end}:00` : null,
        validFrom: isRecurring ? form.periodStart : effectiveToday,
        validTo: isRecurring ? form.periodEnd : effectiveToday,
      };

      const saved = isEditing && id
        ? await schedulesApi.updateSchedule(id, { ...payload, status: "ACTIVE" })
        : await schedulesApi.createSchedule(payload);

      // Materialize sesi otomatis agar langsung siap dipakai
      try {
        const matTo = isRecurring ? shiftDate(effectiveToday, 7) : effectiveToday;
        await schedulesApi.materializeSessions(saved.id, {
          fromDate: effectiveToday,
          toDate: matTo,
        });
      } catch {
        // Jika sesi pada tanggal tersebut sudah ada atau beririsan, jadwal tetap tersimpan
      }

      // Konfigurasikan geofence untuk sesi yang terbuat/diperbarui (J-06, K-05)
      if (geoEnabled) {
        const latNum = parseFloat(geoLat);
        const lonNum = parseFloat(geoLon);
        try {
          const sessions = await schedulesApi.listSessions({ scheduleId: saved.id });
          for (const s of sessions) {
            try {
              await schedulesApi.configureGeofence(s.id, {
                locationName: cleanName,
                isEnabled: true,
                latitude: latNum,
                longitude: lonNum,
                radiusM: geoRadius,
                maxAccuracyM: geoAccuracy ?? 50.0,
              });
            } catch {
              // Lanjutkan jika ada sesi lain
            }
          }
        } catch {
          // Abaikan jika konfigurasi geofence otomatis gagal
        }
      }

      toast(isEditing ? "Jadwal diperbarui" : "Sesi baru ditambahkan");
      nav("/penjaga/jadwal", { replace: true });
    } catch (ex) {
      setFieldErrors(mapFieldErrors(ex));
      const msg = isApiError(ex) ? ex.message : "Gagal menyimpan jadwal sesi presensi.";
      setErr(msg);
      toast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const isPastHoursToday =
    form.mode === "tanggal" && form.end.length === 5 && form.end <= wita().time;

  return (
    <Page nav={false}>
      <TopBar
        back="/penjaga/jadwal"
        title={isEditing ? "Ubah sesi presensi" : "Tambah sesi presensi"}
        sub={`Maks ${maxDailySessions} sesi/hari · Jam lewat hari ini otomatis ditutup`}
      />

      {loading ? (
        <Card className="p-6 text-center text-sm text-muted">Memuat detail jadwal…</Card>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Card className="space-y-4 p-5">
            <Field
              label="Nama sesi"
              placeholder="Contoh: Presensi Malam / Apel Pagi"
              value={form.name}
              error={fieldErrors.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                setErr("");
                setFieldErrors((f) => ({ ...f, name: "" }));
              }}
            />

            <div>
              <p className="mb-1.5 text-[13px] font-semibold">Jenis jadwal</p>
              <Segmented
                value={form.mode}
                onChange={(m) => {
                  setErr("");
                  setForm((prev) => ({
                    ...prev,
                    mode: m,
                    date: today,
                    periodStart: m === "tanggal" ? today : (prev.periodStart || today),
                    periodEnd:
                      m === "tanggal"
                        ? today
                        : prev.periodEnd <= prev.periodStart
                          ? shiftDate(today, 90)
                          : prev.periodEnd,
                  }));
                }}
                options={[
                  { value: "berulang", label: "Hari berulang" },
                  { value: "tanggal", label: "Hari Ini" },
                ]}
              />
            </div>

            {form.mode === "berulang" ? (
              <div>
                <p className="mb-2 text-[13px] font-semibold">Pilih hari berulang</p>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_LABEL.map((lbl, idx) => (
                    <Chip key={lbl} on={form.days.includes(idx)} onClick={() => toggleDay(idx)}>
                      {lbl}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <Field
                  label="Tanggal pelaksanaan (otomatis hari ini · berlaku 1 hari)"
                  type="text"
                  readOnly
                  value={fmtDate(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  trailing={<Lock className="size-4 text-muted" aria-hidden />}
                />
                <p className="mt-1.5 text-[11px] text-muted">
                  Tanggal terkunci otomatis ke hari pembuatan ({fmtDate(today)}) dan langsung membuat sesi hanya untuk hari ini.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Jam mulai (WITA)"
                type="time"
                value={form.start}
                onChange={(e) => {
                  setForm({ ...form, start: e.target.value });
                  setErr("");
                }}
              />
              <Field
                label="Jam selesai (WITA)"
                type="time"
                value={form.end}
                onChange={(e) => {
                  setForm({ ...form, end: e.target.value });
                  setErr("");
                }}
              />
            </div>

            {isPastHoursToday && (
              <div className="rounded-2xl bg-amber-500/12 p-3 text-xs font-medium text-amber-700 dark:text-amber-300">
                Jam selesai sudah lewat dari waktu saat ini. Sesi tetap dibuat untuk hari ini namun otomatis{" "}
                <strong>Ditutup (CLOSED)</strong>: penghuni tidak dapat scan wajah, pencatatan hanya lewat{" "}
                <strong>Presensi Manual</strong> oleh penjaga.
              </div>
            )}

            {form.mode === "berulang" && (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Berlaku mulai"
                  type="date"
                  min={!isEditing ? today : undefined}
                  value={form.periodStart}
                  onChange={(e) => {
                    setForm({ ...form, periodStart: e.target.value });
                    setErr("");
                  }}
                />
                <Field
                  label="Berlaku sampai"
                  type="date"
                  min={form.periodStart > today ? form.periodStart : today}
                  value={form.periodEnd}
                  onChange={(e) => {
                    setForm({ ...form, periodEnd: e.target.value });
                    setErr("");
                  }}
                />
              </div>
            )}

            {/* Geofencing Section (J-06, K-05) */}
            <div className="space-y-3 rounded-2xl border border-border/40 bg-surface/50 p-3.5 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <MapPin className="size-5" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold">Aktifkan Geo-Lokasi (Geofence)</p>
                    <p className="text-[11px] text-muted">Batasi presensi di dalam radius lokasi tertentu</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={geoEnabled}
                  onChange={(e) => setGeoEnabled(e.target.checked)}
                  className="size-5 accent-primary cursor-pointer"
                  aria-label="Aktifkan Geo-Lokasi"
                />
              </div>

              {geoEnabled && (
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="glass"
                      size="sm"
                      disabled={geoLocating}
                      onClick={fetchCurrentLocation}
                      icon={<Navigation className="size-4" />}
                      className="w-full text-xs"
                    >
                      {geoLocating ? "Mengambil lokasi perangkat…" : "Ambil Titik Lokasi Saat Ini"}
                    </Button>
                    <Button
                      type="button"
                      variant={showMapPicker ? "primary" : "glass"}
                      size="sm"
                      onClick={() => setShowMapPicker((prev) => !prev)}
                      icon={<MapIcon className="size-4" />}
                      className="w-full text-xs"
                    >
                      {showMapPicker ? "Tutup Peta" : "Pilih Titik di Maps"}
                    </Button>
                  </div>

                  {geoSource === "gps" && geoAccuracy !== null ? (
                    <p className="text-right text-[11px] text-success">
                      Titik GPS diambil ({Number(geoLat).toFixed(5)}, {Number(geoLon).toFixed(5)} · Akurasi ±{geoAccuracy}m)
                    </p>
                  ) : geoSource === "map" ? (
                    <p className="text-right text-[11px] text-success">
                      Titik dipilih dari peta ({Number(geoLat).toFixed(5)}, {Number(geoLon).toFixed(5)})
                    </p>
                  ) : geoSource === "existing" ? (
                    <p className="text-right text-[11px] text-muted">
                      Menggunakan titik tersimpan ({Number(geoLat).toFixed(5)}, {Number(geoLon).toFixed(5)})
                    </p>
                  ) : (
                    <p className="text-right text-[11px] text-muted">
                      Menggunakan titik lokasi asrama (ambil GPS atau pilih titik di peta)
                    </p>
                  )}

                  {showMapPicker && (
                    <Suspense
                      fallback={
                        <div className="flex h-64 w-full items-center justify-center rounded-2xl border border-border/50 bg-surface/60 text-xs text-muted">
                          Memuat peta OpenStreetMap…
                        </div>
                      }
                    >
                      <GeofenceMapPicker
                        latitude={parseFloat(geoLat) || UNKLAB_CENTER.lat}
                        longitude={parseFloat(geoLon) || UNKLAB_CENTER.lon}
                        radiusM={geoRadius > 0 ? geoRadius : 50}
                        onChange={(lat, lon) => {
                          if (!isInsideUnklabBounds(lat, lon)) return;
                          setGeoLat(lat.toFixed(6));
                          setGeoLon(lon.toFixed(6));
                          setGeoAccuracy(null);
                          setGeoSource("map");
                          setErr("");
                        }}
                        onRejectOutside={(msg) => toast(msg, "error")}
                      />
                    </Suspense>
                  )}

                  <div className="space-y-2.5">
                    <Field
                      label="Batas Radius Presensi"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Masukkan batas radius (meter)"
                      value={geoRadiusText}
                      trailing={<span className="text-xs font-semibold text-muted">meter</span>}
                      onKeyDown={(e) => {
                        if (
                          e.ctrlKey ||
                          e.metaKey ||
                          ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab", "Home", "End"].includes(e.key)
                        ) {
                          return;
                        }
                        if (!/^\d$/.test(e.key)) {
                          e.preventDefault();
                        }
                      }}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        setGeoRadiusText(digits);
                        setGeoRadius(digits ? parseInt(digits, 10) : 0);
                        setErr("");
                      }}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {[25, 50, 100, 200].map((r) => (
                        <Chip
                          key={r}
                          on={geoRadius === r}
                          onClick={() => {
                            setGeoRadius(r);
                            setGeoRadiusText(String(r));
                            setErr("");
                          }}
                        >
                          {r}m
                        </Chip>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {err && (
              <div className="flex items-start gap-2.5 rounded-2xl bg-danger-soft p-3.5 text-sm font-semibold text-danger" role="alert">
                <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>{err}</span>
              </div>
            )}

            <div className="soft-inset flex items-center gap-2 rounded-2xl p-3 text-xs text-muted">
              <CalendarCheck className="size-4 shrink-0 text-primary" aria-hidden />
              <span>
                Dalam satu hari maksimal {maxDailySessions} sesi presensi
                {maxDailySessions > 1 ? " (dengan jam yang tidak bertabrakan)" : ""}. Sesi sebelumnya harus
                dihapus permanen dengan tombol Hapus terlebih dahulu jika kuota harian sudah penuh.
              </span>
            </div>

            <Button type="submit" block size="lg" disabled={submitting} icon={<Save className="size-5" />}>
              {submitting ? "Menyimpan…" : "Simpan jadwal sesi"}
            </Button>
          </Card>
        </form>
      )}
    </Page>
  );
}
