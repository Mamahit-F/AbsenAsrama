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
import { useToast } from "../../state/app";
import { fmtMethodLabel, shiftDate, toWitaDate, toWitaTime, wita, witaDayEndIso, witaDayStartIso } from "../../lib/utils";

export default function ExportCsv() {
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
      const blob = await reportsApi.exportAttendanceCsv({
        from: witaDayStartIso(startDate),
        to: witaDayEndIso(endDate),
        sessionId: sessionFilter === "all" ? undefined : sessionFilter,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rekap-presensi-${startDate}-sd-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Rekap CSV (${rows.length} baris) berhasil diunduh`);
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal mengunduh berkas CSV dari server.", "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Page>
      <PageHead eyebrow="Ekspor CSV per periode" title="Rekap" />

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

          <div className="grid grid-cols-3 gap-2 pt-1 text-center">
            <div className="soft-inset rounded-2xl p-2.5">
              <p className="font-display text-base font-semibold tabular">{rows.length}</p>
              <p className="text-[11px] font-semibold text-muted">Total baris</p>
            </div>
            <div className="soft-inset rounded-2xl p-2.5">
              <p className="font-display text-base font-semibold text-success tabular">{hadir}</p>
              <p className="text-[11px] font-semibold text-muted">Hadir</p>
            </div>
            <div className="soft-inset rounded-2xl p-2.5">
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
            {downloading ? "Mengunduh berkas CSV…" : `Unduh berkas CSV (${rows.length} baris)`}
          </Button>
        </Card>

        <SectionTitle>Kolom standar CSV (J-08)</SectionTitle>
        <Item className="soft-inset flex flex-wrap gap-1.5 rounded-2xl p-3.5">
          {[
            "NIM",
            "Nama",
            "Tanggal",
            "Waktu",
            "Nama Sesi",
            "Status (Hadir/Tidak Hadir)",
            "Metode (Scan/Dibantu Penjaga/Manual)",
            "Nama Penjaga",
            "Alasan",
            "Geofencing",
            "Jarak (m)",
            "Akurasi GPS (m)",
            "Koordinat Pengguna",
            "Koordinat Sesi",
          ].map((col) => (
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
                <Item key={r.recordId} className="soft-inset rounded-2xl p-3 text-xs">
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
