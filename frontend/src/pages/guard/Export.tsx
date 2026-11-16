import { useCallback, useEffect, useState } from "react";
import { Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { Page, PageHead } from "../../components/layout";
import { Badge, Button, Card, Field, Item, SectionTitle, SelectField, Stagger, methodTone } from "../../components/ui";
import {
  isApiError,
  reportsApi,
  schedulesApi,
  type AttendanceReportRowDto,
  type PeriodRecapReportDto,
  type SessionDto,
} from "../../api";
import { useAuth, useToast } from "../../state/app";
import { TZ, fmtMethodLabel, shiftDate, toWitaDate, toWitaTime, wita, witaDayEndIso, witaDayStartIso } from "../../lib/utils";

const CSV_DELIMITER = ";";

const CSV_COLUMNS = [
  "No",
  "NIM",
  "Nama Penghuni",
  "Hall",
  "Gedung",
  "Kamar",
  "Tanggal",
  "Waktu (WITA)",
  "Nama Sesi",
  "Status",
  "Metode",
  "Nama Penjaga",
  "Alasan / Koreksi",
  "Geofencing",
  "Jarak (m)",
  "Akurasi GPS (m)",
  "Koordinat Pengguna",
  "Koordinat Sesi",
] as const;

function sanitizeCsvText(raw: string | null | undefined, fallback = "-"): string {
  const value = (raw ?? "").trim();
  if (!value) return fallback;
  const first = value[0];
  if (first === "=" || first === "+" || first === "@" || first === "\t" || first === "\r" || (first === "-" && value.length > 1)) {
    return `'${value}`;
  }
  return value;
}

function encodeCsvCell(value: string | number, delimiter: string): string {
  const str = String(value);
  if (str.includes(delimiter) || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatWitaHms(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

function formatCoords(lat?: number | null, lon?: number | null, radiusM?: number | null): string {
  if (lat == null || lon == null) return "-";
  const base = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  return radiusM != null ? `${base} (${radiusM}m)` : base;
}

function formatNotes(reason?: string | null, correctionReason?: string | null): string {
  const r = reason?.trim() ?? "";
  const c = correctionReason?.trim() ?? "";
  if (!r && !c) return "-";
  if (r && c && r !== c) return sanitizeCsvText(`${r} | Koreksi: ${c}`);
  return sanitizeCsvText(r || c);
}

function buildStructuredAttendanceCsv({
  report,
  delimiter,
  hallLabel,
  startDate,
  endDate,
  sessionLabel,
}: {
  report: PeriodRecapReportDto;
  delimiter: string;
  hallLabel: string;
  startDate: string;
  endDate: string;
  sessionLabel: string;
}): string {
  const toLine = (cells: (string | number)[]) =>
    cells.map((cell) => encodeCsvCell(cell, delimiter)).join(delimiter);

  const nowWita = `${wita().date} ${formatWitaHms(new Date().toISOString())} WITA`;
  const lines: string[] = [
    toLine(["LAPORAN REKAPITULASI PRESENSI ASRAMA"]),
    toLine(["Hall / Asrama", sanitizeCsvText(hallLabel, "Semua Hall")]),
    toLine(["Periode", `${startDate} s/d ${endDate}`]),
    toLine(["Filter Sesi", sanitizeCsvText(sessionLabel, "Semua sesi presensi")]),
    toLine(["Diekspor Pada", nowWita]),
    toLine([
      "Ringkasan",
      `Total: ${report.totalRecords} | Hadir: ${report.hadirCount} | Tidak Hadir: ${report.tidakHadirCount} | Scan: ${report.scanCount} | Dibantu Penjaga: ${report.guardAssistedCount} | Manual: ${report.manualCount}`,
    ]),
    "",
    toLine([...CSV_COLUMNS]),
  ];

  report.rows.forEach((r, idx) => {
    const refTime = r.recordedAt || r.sessionStartsAt;
    const isHadir = r.status === "HADIR";
    const geoOn = Boolean(r.isGeoEnabled);
    const dist = r.distanceMeters ?? r.distanceM;
    const guardUser = r.recordedByUsername?.trim() ? sanitizeCsvText(`@${r.recordedByUsername.trim()}`) : "-";

    lines.push(
      toLine([
        idx + 1,
        sanitizeCsvText(r.residentNim),
        sanitizeCsvText(r.residentName),
        sanitizeCsvText(r.hallName),
        sanitizeCsvText(r.building),
        sanitizeCsvText(r.roomNumber),
        refTime ? toWitaDate(refTime) : "-",
        formatWitaHms(refTime),
        sanitizeCsvText(r.scheduleName),
        isHadir ? "Hadir" : "Tidak Hadir",
        r.method ? fmtMethodLabel(r.method) : "-",
        guardUser,
        formatNotes(r.reason, r.correctionReason),
        geoOn ? "Aktif" : "Lokasi Bebas",
        geoOn && dist != null ? dist.toFixed(1) : "-",
        r.userAccuracyM != null ? r.userAccuracyM.toFixed(1) : "-",
        formatCoords(r.userLatitude, r.userLongitude),
        geoOn ? formatCoords(r.sessionLatitude, r.sessionLongitude, r.sessionRadiusM) : "-",
      ]),
    );
  });

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export default function ExportCsv() {
  const { user } = useAuth();
  const toast = useToast();
  const today = wita().date;

  const [startDate, setStartDate] = useState(shiftDate(today, -6));
  const [endDate, setEndDate] = useState(today);
  const [sessionFilter, setSessionFilter] = useState("all");

  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [report, setReport] = useState<PeriodRecapReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    schedulesApi
      .listSessions()
      .then((list) => setSessions(list))
      .catch(() => setSessions([]));
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await reportsApi.getAttendanceReport({
        from: witaDayStartIso(startDate),
        to: witaDayEndIso(endDate),
        sessionId: sessionFilter === "all" ? undefined : sessionFilter,
      });
      setReport(data);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat laporan rekap presensi.");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, sessionFilter]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const rows: AttendanceReportRowDto[] = report?.rows ?? [];
  const hadir = report?.hadirCount ?? 0;
  const tidakHadir = report?.tidakHadirCount ?? 0;

  const downloadCsv = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const latestReport = await reportsApi.getAttendanceReport({
        from: witaDayStartIso(startDate),
        to: witaDayEndIso(endDate),
        sessionId: sessionFilter === "all" ? undefined : sessionFilter,
      });
      setReport(latestReport);

      const selectedSession = sessions.find((s) => s.id === sessionFilter);
      const sessionLabel = selectedSession
        ? `${selectedSession.scheduleName} (${toWitaDate(selectedSession.startsAt)} ${toWitaTime(selectedSession.startsAt)})`
        : "Semua sesi presensi";

      const csvText = buildStructuredAttendanceCsv({
        report: latestReport,
        delimiter: CSV_DELIMITER,
        hallLabel: user?.hallName ?? "Semua Hall",
        startDate,
        endDate,
        sessionLabel,
      });

      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rekap-presensi-${startDate}-sd-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Rekap CSV terstruktur (${latestReport.rows.length} baris) berhasil diunduh`);
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal mengunduh berkas CSV dari server.", "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Page>
      <PageHead
        eyebrow={user?.hallName ? `Ekspor CSV · ${user.hallName}` : "Ekspor CSV per periode"}
        title="Rekap"
      />

      {error && (
        <Card className="mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadReport()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      <Stagger>
        <Card className="space-y-3.5 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dari tanggal" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Field label="Sampai tanggal" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>

          <SelectField label="Filter sesi" value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)}>
            <option value="all">Semua sesi presensi</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.scheduleName} ({toWitaDate(s.startsAt)} · {toWitaTime(s.startsAt)})
              </option>
            ))}
          </SelectField>

          <div className="grid grid-cols-3 divide-x divide-line border-y border-line py-2.5 text-center">
            <div className="px-2">
              <p className="font-display text-base font-semibold tabular">{rows.length}</p>
              <p className="text-[11px] font-semibold text-muted">Total baris</p>
            </div>
            <div className="px-2">
              <p className="font-display text-base font-semibold text-success tabular">{hadir}</p>
              <p className="text-[11px] font-semibold text-muted">Hadir</p>
            </div>
            <div className="px-2">
              <p className="font-display text-base font-semibold text-danger tabular">{tidakHadir}</p>
              <p className="text-[11px] font-semibold text-muted">Tidak Hadir</p>
            </div>
          </div>

          <Button
            block
            size="lg"
            disabled={downloading || loading}
            onClick={downloadCsv}
            icon={<Download className="size-5" />}
          >
            {downloading ? "Menyiapkan berkas CSV…" : `Unduh berkas CSV (${rows.length} baris)`}
          </Button>
        </Card>

        <SectionTitle>Struktur kolom CSV ({CSV_COLUMNS.length} kolom)</SectionTitle>
        <Item className="soft-inset flex flex-wrap gap-1.5 rounded-2xl p-3.5">
          {CSV_COLUMNS.map((col) => (
            <Badge key={col} tone="info">
              {col}
            </Badge>
          ))}
        </Item>

        <SectionTitle>Pratinjau 15 baris pertama</SectionTitle>
        <div className="space-y-2">
          {loading ? (
            <Card className="p-6 text-center text-sm text-muted">Memuat pratinjau laporan…</Card>
          ) : (
            rows.slice(0, 15).map((r) => {
              const isHadir = r.status === "HADIR";
              const mLabel = fmtMethodLabel(r.method);
              return (
                <Item key={r.recordId} data-glass="card" data-radius="16" className="glass rounded-2xl p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{r.residentName}</span>
                    <Badge tone={isHadir ? "success" : "danger"}>
                      {isHadir ? "Hadir" : "Tidak Hadir"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 font-display text-muted">
                    {r.residentNim} · {toWitaDate(r.recordedAt)} · {toWitaTime(r.recordedAt)} WITA · {r.scheduleName}
                  </p>
                  {isHadir && (
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={methodTone(mLabel)}>{mLabel}</Badge>
                        {r.isGeoEnabled != null && (
                          <Badge tone="neutral">
                            {r.isGeoEnabled
                              ? `GPS: ${(r.distanceMeters ?? r.distanceM) != null ? `${r.distanceMeters ?? r.distanceM}m` : "Terverifikasi"}`
                              : "Lokasi Bebas"}
                          </Badge>
                        )}
                      </div>
                      {r.recordedByUsername && (
                        <span className="text-muted">
                          Penjaga: @{r.recordedByUsername}
                          {r.reason ? ` (${r.reason})` : ""}
                        </span>
                      )}
                    </div>
                  )}
                </Item>
              );
            })
          )}
          {!loading && rows.length === 0 && (
            <Card className="p-6 text-center text-sm text-muted">
              <FileSpreadsheet className="mx-auto mb-2 size-6 text-primary" aria-hidden />
              Tidak ada data pada rentang tanggal tersebut.
            </Card>
          )}
        </div>
      </Stagger>
    </Page>
  );
}
