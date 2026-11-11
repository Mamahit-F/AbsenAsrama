import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { CalendarX2, Clock3, HelpCircle, MapPin, MapPinOff, RotateCcw, ScanFace, ShieldAlert, Timer, WifiOff } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import {
  Pipeline,
  ResultMark,
  Viewfinder,
  type CamAccessState,
  type CamState,
  type ViewfinderHandle,
} from "../../components/camera";
import { Badge, Button, Card, spring } from "../../components/ui";
import {
  attendanceApi,
  helpRequestsApi,
  isApiError,
  residentsApi,
  schedulesApi,
  type AttendanceScanResultResponse,
  type ResidentProfileDto,
  type SessionDto,
} from "../../api";
import { useToast } from "../../state/app";
import { calcDistanceMeters, cn, fmtDate, toMin, toWitaDate, toWitaTime, wita } from "../../lib/utils";

const STEPS = [
  "Mengambil gambar",
  "Liveness (anti-spoofing)",
  "Pencocokan wajah",
  "Validasi sesi & lokasi",
  "Menyimpan presensi",
];

interface Res {
  ok: boolean;
  title: string;
  text: string;
  icon?: typeof ShieldAlert;
  ms: number;
  failedAt?: number;
  scanData?: AttendanceScanResultResponse;
}

function getGpsCoordinates(): Promise<{ latitude?: number; longitude?: number; accuracyM?: number; error?: string }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ error: "Perangkat atau browser tidak mendukung Geolocation." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
        });
      },
      (err) => {
        let msg = "Gagal membaca lokasi perangkat.";
        if (err.code === err.PERMISSION_DENIED) {
          msg = "Akses lokasi ditolak. Izinkan akses GPS di browser.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = "Sinyal GPS perangkat tidak tersedia.";
        } else if (err.code === err.TIMEOUT) {
          msg = "Waktu pembacaan GPS habis (timeout).";
        }
        resolve({ error: msg });
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 },
    );
  });
}

export default function ResidentScan() {
  const toast = useToast();
  const nav = useNavigate();
  const vfRef = useRef<ViewfinderHandle>(null);
  const busy = useRef(false);
  const w = wita();

  const [profile, setProfile] = useState<ResidentProfileDto | null>(null);
  const [active, setActive] = useState<SessionDto | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean>(true);
  const [camAccess, setCamAccess] = useState<CamAccessState>("loading");
  const [loadingInit, setLoadingInit] = useState(true);
  const [step, setStep] = useState(-1);
  const [res, setRes] = useState<Res | null>(null);
  const [sendingHelp, setSendingHelp] = useState(false);

  const [gpsState, setGpsState] = useState<{
    loading: boolean;
    latitude?: number;
    longitude?: number;
    accuracyM?: number;
    error?: string;
  }>({ loading: false });

  const refreshGps = useCallback(async () => {
    setGpsState((prev) => ({ ...prev, loading: true, error: undefined }));
    const coords = await getGpsCoordinates();
    setGpsState({
      loading: false,
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracyM: coords.accuracyM,
      error: coords.error,
    });
    return coords;
  }, []);

  const loadInit = useCallback(async () => {
    setLoadingInit(true);
    try {
      const [prof, actSess, aiStat] = await Promise.all([
        residentsApi.getMyProfile(),
        schedulesApi.getActiveSession(),
        attendanceApi.getAiStatus().catch(() => ({ available: false, healthy: false, service: "AI", status: "OFFLINE" })),
      ]);
      setProfile(prof);
      setActive(actSess);
      setAiAvailable(Boolean(aiStat.available && aiStat.healthy));
    } catch {
      // Ditangani pada tampilan di bawah
    } finally {
      setLoadingInit(false);
    }
  }, []);

  useEffect(() => {
    void loadInit();
  }, [loadInit]);

  const isGeoActive = Boolean(active?.geofence?.isEnabled ?? active?.isGeoEnabled);
  const activeLat = active?.geofence?.latitude ?? active?.geoLatitude ?? null;
  const activeLon = active?.geofence?.longitude ?? active?.geoLongitude ?? null;
  const activeRadius = active?.geofence?.radiusM ?? active?.geoRadiusMeters ?? 100;

  useEffect(() => {
    if (isGeoActive) {
      void refreshGps();
    }
  }, [active?.id, isGeoActive, refreshGps]);

  const geoDistance = useMemo(() => {
    if (!isGeoActive || activeLat == null || activeLon == null || gpsState.latitude == null || gpsState.longitude == null) {
      return null;
    }
    return calcDistanceMeters(
      gpsState.latitude,
      gpsState.longitude,
      activeLat,
      activeLon,
    );
  }, [isGeoActive, activeLat, activeLon, gpsState.latitude, gpsState.longitude]);

  const isInsideRadius = useMemo(() => {
    if (!isGeoActive) return true;
    if (geoDistance == null) return null;
    return geoDistance <= activeRadius;
  }, [isGeoActive, geoDistance, activeRadius]);

  const isResidentActive = profile ? profile.status === "AKTIF" : true;
  const hasFace = Boolean(profile?.hasActiveFaceProfile);
  const cam: CamState = res ? (res.ok ? "ok" : "fail") : step >= 0 ? "scanning" : "idle";
  const canScan = hasFace && isResidentActive && Boolean(active) && camAccess === "on" && aiAvailable;

  const run = async () => {
    if (busy.current || !active) return;
    busy.current = true;
    setRes(null);
    const t0 = performance.now();

    try {
      setStep(0);
      const blob = await vfRef.current?.captureFrame(0.92);
      if (!blob) {
        setRes({
          ok: false,
          title: "Kamera belum siap",
          text: "Pastikan izin kamera diaktifkan dan wajah terlihat pada bingkai.",
          icon: ShieldAlert,
          ms: performance.now() - t0,
          failedAt: 0,
        });
        return;
      }

      setStep(1);
      let currentGps: {
        latitude?: number;
        longitude?: number;
        accuracyM?: number;
        error?: string;
      } = {
        latitude: gpsState.latitude,
        longitude: gpsState.longitude,
        accuracyM: gpsState.accuracyM,
        error: gpsState.error,
      };
      if (isGeoActive && (!currentGps.latitude || !currentGps.longitude)) {
        currentGps = await refreshGps();
      }

      if (isGeoActive && (!currentGps.latitude || !currentGps.longitude)) {
        setRes({
          ok: false,
          title: "Izin lokasi diperlukan",
          text: currentGps.error || "Akses GPS diperlukan untuk memverifikasi kehadiran di area asrama (P-11). Aktifkan izin lokasi atau hubungi penjaga.",
          icon: MapPinOff,
          ms: performance.now() - t0,
          failedAt: 1,
        });
        return;
      }

      setStep(2);

      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `scan-${Date.now()}`;

      const scanResult = await attendanceApi.scanSelf({
        photoBlob: blob,
        sessionId: active.id,
        latitude: currentGps.latitude,
        longitude: currentGps.longitude,
        accuracyM: currentGps.accuracyM,
        idempotencyKey,
      });

      const serverMs = scanResult.stageLatenciesMs?.totalLatencyMs ?? Math.round(performance.now() - t0);
      setStep(5);
      setRes({
        ok: true,
        title: "Presensi berhasil",
        text: "Kehadiran Anda telah diverifikasi dan tercatat.",
        ms: serverMs,
        scanData: scanResult,
      });
    } catch (err) {
      const elapsed = Math.round(performance.now() - t0);
      if (isApiError(err)) {
        if (err.code === "LIVENESS_FAILED") {
          setStep(1);
          setRes({
            ok: false,
            title: "Terdeteksi bukan wajah asli",
            text: err.message,
            icon: ShieldAlert,
            ms: elapsed,
            failedAt: 1,
          });
        } else if (err.code === "FACE_MISMATCH") {
          setStep(2);
          setRes({
            ok: false,
            title: "Wajah tidak dikenali",
            text: err.message,
            icon: ScanFace,
            ms: elapsed,
            failedAt: 2,
          });
        } else if (err.code === "OUTSIDE_GEOFENCE" || err.code === "LOCATION_REQUIRED") {
          setStep(3);
          setRes({
            ok: false,
            title: "Lokasi di luar area asrama",
            text: err.message,
            icon: MapPinOff,
            ms: elapsed,
            failedAt: 3,
          });
        } else if (err.code === "NO_ACTIVE_SESSION") {
          setStep(3);
          setRes({
            ok: false,
            title: "Tidak ada sesi presensi aktif",
            text: err.message,
            icon: CalendarX2,
            ms: elapsed,
            failedAt: 3,
          });
        } else if (err.status === 409 || err.code === "ALREADY_ATTENDED") {
          setStep(4);
          setRes({
            ok: false,
            title: "Sudah presensi (P-09)",
            text: err.message,
            icon: Clock3,
            ms: elapsed,
            failedAt: 4,
          });
        } else if (err.status === 503 || err.code === "AI_SERVICE_UNAVAILABLE" || err.status === 0) {
          setStep(1);
          setRes({
            ok: false,
            title: "Layanan AI / Jaringan Tidak Tersedia",
            text: err.message,
            icon: WifiOff,
            ms: elapsed,
            failedAt: 1,
          });
        } else {
          setStep(2);
          setRes({
            ok: false,
            title: "Presensi ditolak",
            text: err.message,
            icon: ShieldAlert,
            ms: elapsed,
            failedAt: 2,
          });
        }
      } else {
        setStep(1);
        setRes({
          ok: false,
          title: "Koneksi terputus",
          text: "Tidak ada data yang disimpan. Silakan pindai ulang.",
          icon: WifiOff,
          ms: elapsed,
          failedAt: 1,
        });
      }
    } finally {
      busy.current = false;
    }
  };

  const requestHelp = async () => {
    if (sendingHelp) return;
    setSendingHelp(true);
    try {
      await helpRequestsApi.create({
        residentId: profile?.id ?? null,
        requestType: "PERMINTAAN_BANTUAN",
        subject: `Bantuan Presensi Sesi ${active?.scheduleName || "Hari Ini"}`,
        description: res?.text || "Penghuni mengalami kendala saat memindai wajah mandiri dan memerlukan bantuan penjaga.",
      });
      toast("Permintaan bantuan telah dikirim ke penjaga asrama");
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal mengirim permintaan bantuan.", "error");
    } finally {
      setSendingHelp(false);
    }
  };

  const reset = () => {
    setRes(null);
    setStep(-1);
  };

  const label = useMemo(() => {
    if (res) return res.ok ? "Terverifikasi" : "Ditolak";
    if (step >= 0) return STEPS[Math.min(step, STEPS.length - 1)] + "…";
    return "Posisikan wajah di dalam bingkai";
  }, [res, step]);

  if (!loadingInit && (!hasFace || !isResidentActive)) {
    return (
      <Page>
        <TopBar title="Presensi" />
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass mt-8 rounded-[32px] p-7 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-warning-soft text-warning">
            <ShieldAlert className="size-8" aria-hidden />
          </span>
          <h2 className="mt-4 text-xl font-semibold">
            {!isResidentActive ? "Akun dinonaktifkan" : "Status wajah belum Aktif"}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {!isResidentActive
              ? "Hubungi admin asrama untuk mengaktifkan kembali akun Anda."
              : "Hanya penghuni dengan profil wajah Aktif yang dapat melakukan presensi mandiri (P-06)."}
          </p>
          {isResidentActive && (
            <Button block className="mt-6" onClick={() => nav("/penghuni/wajah")}>
              Daftarkan wajah
            </Button>
          )}
        </motion.div>
      </Page>
    );
  }

  const activeStart = active ? toWitaTime(active.startsAt) : "";
  const activeEnd = active ? toWitaTime(active.endsAt) : "";
  const remainingMin = active ? Math.max(0, toMin(activeEnd) - w.minutes) : 0;

  return (
    <Page>
      <TopBar
        title="Presensi wajah"
        sub={active ? `${active.scheduleName} · ${activeStart}–${activeEnd} WITA` : "Tidak ada sesi aktif"}
        right={<span className="size-11" />}
      />

      {!aiAvailable && (
        <Card className="mb-3 flex items-start gap-2.5 !bg-warning-soft p-3.5 text-xs text-warning">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold">Layanan AI pengenalan wajah sedang tidak dapat dihubungi</p>
            <p className="mt-0.5 text-warning/90">
              Silakan hubungi penjaga untuk presensi dibantu penjaga atau manual, atau kirim permintaan bantuan di bawah.
            </p>
            <button
              type="button"
              disabled={sendingHelp}
              onClick={() => void requestHelp()}
              className="mt-1.5 inline-flex items-center gap-1 font-semibold underline"
            >
              <HelpCircle className="size-3.5" aria-hidden />
              {sendingHelp ? "Mengirim permintaan…" : "Minta bantuan penjaga"}
            </button>
          </div>
        </Card>
      )}

      <div className="mb-3 flex items-center justify-between">
        {active ? (
          <Badge tone="success" dot>
            Sesi dibuka · sisa {remainingMin} mnt
          </Badge>
        ) : (
          <Badge tone="danger" dot>
            Tidak ada sesi presensi aktif
          </Badge>
        )}
        <Badge tone={aiAvailable ? "info" : "warning"}>
          {aiAvailable ? "ArcFace + PAD" : "AI Offline"}
        </Badge>
      </div>

      {active && (
        <div className="mb-3">
          {!isGeoActive ? (
            <div className="flex items-center justify-between rounded-2xl bg-neutral-100/80 px-3.5 py-2 text-xs text-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <MapPin className="size-3.5 text-primary" aria-hidden />
                Lokasi Bebas (Tanpa Batas Radius)
              </span>
              <Badge tone="neutral">Fleksibel</Badge>
            </div>
          ) : (
            <div
              className={cn(
                "flex flex-col gap-1.5 rounded-2xl p-3 text-xs transition-colors",
                gpsState.loading
                  ? "bg-neutral-100/70 text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-300"
                  : isInsideRadius
                    ? "border border-emerald-200/60 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border border-rose-200/60 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-300",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  {isInsideRadius ? (
                    <MapPin className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  ) : (
                    <MapPinOff className="size-4 text-rose-600 dark:text-rose-400" aria-hidden />
                  )}
                  {gpsState.loading
                    ? "Mencari lokasi..."
                    : gpsState.error
                      ? "Akses lokasi ditolak"
                      : isInsideRadius
                        ? `Lokasi valid (${geoDistance} m dari titik presensi)`
                        : `Di luar radius (${geoDistance} m dari titik presensi, maks ${activeRadius} m)`}
                </span>
                <button
                  type="button"
                  onClick={() => void refreshGps()}
                  disabled={gpsState.loading}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                >
                  <RotateCcw className={cn("size-3", gpsState.loading && "animate-spin")} />
                  Perbarui
                </button>
              </div>

              {gpsState.accuracyM && gpsState.accuracyM > 100 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  ⚠️ Akurasi GPS rendah ({gpsState.accuracyM} m). Presensi mungkin gagal jika lokasi tidak akurat (T-05).
                </p>
              )}
              {gpsState.error && (
                <p className="text-[11px] text-rose-700 dark:text-rose-400">
                  {gpsState.error} Pastikan izin lokasi aktif atau hubungi penjaga (K-04).
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <Viewfinder ref={vfRef} state={cam} label={label} onCameraStateChange={setCamAccess} />

      <AnimatePresence mode="wait">
        {!res ? (
          <motion.div key="act" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="mt-5">
            {step >= 0 ? (
              <div className="glass rounded-3xl p-4">
                <Pipeline steps={STEPS} current={step} />
              </div>
            ) : (
              <>
                <Button
                  block
                  size="lg"
                  onClick={() => void run()}
                  disabled={!canScan || loadingInit || (isGeoActive && isInsideRadius === false)}
                  icon={<ScanFace className="size-5" />}
                >
                  {camAccess === "off"
                    ? "Kamera tidak tersedia"
                    : !active
                      ? "Tidak ada sesi presensi aktif"
                      : isGeoActive && isInsideRadius === false
                        ? `Di luar radius (${geoDistance} m > ${activeRadius} m)`
                        : "Pindai wajah"}
                </Button>
                <p className="mt-3 text-center text-xs text-muted">
                  {canScan
                    ? isGeoActive && isInsideRadius === false
                      ? "Dekati lokasi asrama atau minta bantuan penjaga jika sinyal lemah (K-04)."
                      : "Geofencing & liveness diperiksa sebelum pencocokan wajah."
                    : "Tombol aktif saat sesi presensi dibuka dan kamera siap."}
                </p>
              </>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="res"
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            transition={spring}
            className="glass relative z-10 -mt-16 rounded-[30px] p-6 text-center"
            role="status"
          >
            {res.ok ? (
              <ResultMark ok size={76} />
            ) : (
              <span className="mx-auto grid size-[76px] place-items-center rounded-full bg-danger-soft text-danger">
                {res.icon && <res.icon className="size-9" aria-hidden />}
              </span>
            )}
            <h2 className="mt-4 text-xl font-semibold">{res.title}</h2>
            <p className="mt-1.5 text-sm text-muted">{res.text}</p>

            {res.ok && active && (
              <dl className="mt-5 grid grid-cols-2 gap-2 text-left">
                {[
                  ["Nama", res.scanData?.residentName || profile?.fullName || "-"],
                  ["Sesi", active.scheduleName],
                  ["Tanggal", fmtDate(toWitaDate(res.scanData?.recordedAt))],
                  ["Waktu", `${toWitaTime(res.scanData?.recordedAt)} WITA`],
                  ["Metode", "Scan wajah"],
                  [
                    "Lokasi / Radius",
                    isGeoActive
                      ? (res.scanData?.distanceMeters ?? res.scanData?.distanceM) != null
                        ? `Terverifikasi (${res.scanData?.distanceMeters ?? res.scanData?.distanceM} m)`
                        : `Terverifikasi (≤${activeRadius} m)`
                      : "Lokasi bebas (tanpa batas)",
                  ],
                  [
                    "Skor / Liveness",
                    res.scanData
                      ? `${res.scanData.similarityScore.toFixed(2)} · ${(res.scanData.livenessScore * 100).toFixed(0)}%`
                      : "Terverifikasi",
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="soft-inset rounded-2xl px-3 py-2.5">
                    <dt className="eyebrow text-[10px] text-subtle">{k}</dt>
                    <dd className="truncate text-sm font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="soft-inset mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-muted">
              <Timer className="size-3.5" aria-hidden /> Diproses dalam <span className="font-display">{(res.ms / 1000).toFixed(2)} dtk</span>
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {res.ok ? (
                <Button block onClick={() => nav("/penghuni")}>
                  Selesai
                </Button>
              ) : (
                <>
                  <div className="flex gap-3">
                    <Button variant="glass" block onClick={reset} icon={<RotateCcw className="size-4" />}>
                      Coba lagi
                    </Button>
                    <Button block onClick={() => nav("/penghuni")}>
                      Beranda
                    </Button>
                  </div>
                  <Button
                    variant="glass"
                    block
                    size="sm"
                    disabled={sendingHelp}
                    onClick={() => void requestHelp()}
                    icon={<HelpCircle className="size-4" />}
                  >
                    {sendingHelp ? "Mengirim permintaan…" : "Minta bantuan penjaga"}
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  );
}
