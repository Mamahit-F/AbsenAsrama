import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, CalendarCheck, Lock, MapPin, Navigation, Save } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import { Button, Card, Chip, Field, Segmented } from "../../components/ui";
import { isApiError, mapFieldErrors, schedulesApi } from "../../api";
import { useToast } from "../../state/app";
import { DAY_LABEL, isoDayToUi, shiftDate, toWitaDate, toWitaTime, uiDayToIso, wita } from "../../lib/utils";

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
    days: [1, 2, 3, 4, 5],
    periodStart: today,
    periodEnd: shiftDate(today, 90),
    start: "20:00",
    end: "21:00",
  });
  const [activityTypeId, setActivityTypeId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(id));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Geofence states (J-06, K-05)
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [geoLat, setGeoLat] = useState<string>("1.417200");
  const [geoLon, setGeoLon] = useState<string>("124.983500");
  const [geoRadius, setGeoRadius] = useState<number>(50);
  const [geoLocating, setGeoLocating] = useState(false);
  const [geoAccuracy, setGeoAccuracy] = useState<number | null>(null);
  const [geoLocked, setGeoLocked] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const types = await schedulesApi.listActivityTypes();
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
            date: existing.startsAt ? toWitaDate(existing.startsAt) : today,
            days: isRecurring && existing.repeatDays
              ? existing.repeatDays.map(isoDayToUi).sort()
              : [1, 2, 3, 4, 5],
            periodStart: existing.validFrom ?? today,
            periodEnd: existing.validTo ?? shiftDate(today, 90),
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
        setGeoLat(pos.coords.latitude.toFixed(6));
        setGeoLon(pos.coords.longitude.toFixed(6));
        setGeoAccuracy(Math.round(pos.coords.accuracy));
        setGeoLocating(false);
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
    if (form.mode === "berulang" && form.days.length === 0) {
      setErr("Pilih minimal satu hari berulang.");
      return;
    }
    if (form.mode === "berulang" && form.periodEnd < form.periodStart) {
      setErr("Tanggal berlaku sampai tidak boleh sebelum tanggal berlaku mulai.");
      return;
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
      if (geoRadius <= 0) {
        setErr("Batas radius presensi harus lebih besar dari 0 meter.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const isRecurring = form.mode === "berulang";
      const payload = {
        name: cleanName,
        activityTypeId,
        scheduleKind: isRecurring ? ("RECURRING" as const) : ("ONE_TIME" as const),
        startsAt: !isRecurring ? `${form.date}T${form.start}:00+08:00` : null,
        endsAt: !isRecurring ? `${form.date}T${form.end}:00+08:00` : null,
        repeatDays: isRecurring ? form.days.map(uiDayToIso) : null,
        startTime: isRecurring ? `${form.start}:00` : null,
        endTime: isRecurring ? `${form.end}:00` : null,
        validFrom: isRecurring ? form.periodStart : form.date,
        validTo: isRecurring ? form.periodEnd : form.date,
      };

      const saved = isEditing && id
        ? await schedulesApi.updateSchedule(id, { ...payload, status: "ACTIVE" })
        : await schedulesApi.createSchedule(payload);

      // Materialize sesi otomatis agar langsung siap dipakai
      try {
        const matFrom = isRecurring ? today : form.date;
        const matTo = isRecurring ? shiftDate(today, 7) : form.date;
        await schedulesApi.materializeSessions(saved.id, {
          fromDate: matFrom,
          toDate: matTo,
        });
      } catch {
        // Jika sesi pada tanggal tersebut sudah ada atau beririsan, jadwal tetap tersimpan
      }

      // Konfigurasikan geofence untuk sesi yang terbuat/diperbarui (J-06, K-05)
      if (geoEnabled && !geoLocked) {
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
              // Jika sesi terkunci karena sudah ada presensi, abaikan per sesi
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
      setErr(isApiError(ex) ? ex.message : "Gagal menyimpan jadwal sesi presensi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page nav={false}>
      <TopBar
        back="/penjaga/jadwal"
        title={isEditing ? "Ubah sesi presensi" : "Tambah sesi presensi"}
        sub="Validasi jam & tumpukan otomatis"
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
                onChange={(m) => setForm({ ...form, mode: m })}
                options={[
                  { value: "berulang", label: "Hari berulang" },
                  { value: "tanggal", label: "Tanggal tertentu" },
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
              <Field
                label="Tanggal pelaksanaan"
                type="date"
                value={form.date}
                onChange={(e) =>
                  setForm({
                    ...form,
                    date: e.target.value,
                    periodStart: e.target.value,
                    periodEnd: e.target.value,
                  })
                }
              />
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

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Berlaku mulai"
                type="date"
                value={form.periodStart}
                onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
              />
              <Field
                label="Berlaku sampai"
                type="date"
                value={form.periodEnd}
                onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
              />
            </div>

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
                  disabled={geoLocked}
                  checked={geoEnabled}
                  onChange={(e) => setGeoEnabled(e.target.checked)}
                  className="size-5 accent-primary cursor-pointer disabled:opacity-50"
                  aria-label="Aktifkan Geo-Lokasi"
                />
              </div>

              {geoLocked && (
                <div className="flex items-center gap-2 rounded-xl bg-warning/10 p-2.5 text-xs font-medium text-warning">
                  <Lock className="size-4 shrink-0" />
                  <span>Titik geo-lokasi terkunci karena sesi ini telah memiliki riwayat kehadiran (K-05).</span>
                </div>
              )}

              {geoEnabled && (
                <div className="space-y-3 pt-2">
                  <Button
                    type="button"
                    variant="glass"
                    size="sm"
                    disabled={geoLocating || geoLocked}
                    onClick={fetchCurrentLocation}
                    icon={<Navigation className="size-4" />}
                    className="w-full text-xs"
                  >
                    {geoLocating ? "Mengambil lokasi perangkat…" : "Ambil Titik Lokasi Saat Ini"}
                  </Button>

                  {geoAccuracy !== null && (
                    <p className="text-right text-[11px] text-muted">
                      Akurasi GPS perangkat: ±{geoAccuracy}m
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2.5">
                    <Field
                      label="Latitude"
                      placeholder="Contoh: 1.4172"
                      value={geoLat}
                      disabled={geoLocked}
                      onChange={(e) => setGeoLat(e.target.value)}
                    />
                    <Field
                      label="Longitude"
                      placeholder="Contoh: 124.9835"
                      value={geoLon}
                      disabled={geoLocked}
                      onChange={(e) => setGeoLon(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[12px] font-medium text-muted">Batas Radius Presensi</span>
                      <span className="text-[12px] font-bold text-primary">{geoRadius} meter</span>
                    </div>
                    <div className="flex gap-1.5">
                      {[25, 50, 100, 200].map((r) => (
                        <Chip
                          key={r}
                          on={geoRadius === r}
                          onClick={() => !geoLocked && setGeoRadius(r)}
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
                Perubahan jadwal tidak mengubah riwayat presensi yang sudah tercatat dan disimpan ke Audit Log.
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
