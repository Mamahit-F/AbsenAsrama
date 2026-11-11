import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, FileUp, Sparkles, XCircle } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import { Badge, Button, Card, Item, SectionTitle, Stagger, TextArea } from "../../components/ui";
import { adminApi, isApiError, residentsApi, type CsvImportSummaryDto, type ResidentProfileDto } from "../../api";
import { useToast } from "../../state/app";

interface RowCheck {
  line: number;
  raw: string;
  nim: string;
  name: string;
  ok: boolean;
  reason: string;
}

export default function ImportCsv() {
  const toast = useToast();
  const nav = useNavigate();

  const [csvText, setCsvText] = useState("");
  const [existingResidents, setExistingResidents] = useState<ResidentProfileDto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<CsvImportSummaryDto | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    residentsApi
      .listResidents({ limit: 300 })
      .then((list) => setExistingResidents(list))
      .catch(() => setExistingResidents([]));
  }, []);

  // A-02: Pratinjau validasi per baris + pengiriman ke POST /api/v1/admin/residents/import-csv
  const validation = useMemo<RowCheck[]>(() => {
    const existingNims = new Set(existingResidents.map((r) => r.nim));
    const seenInFile = new Set<string>();
    const rawLines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const out: RowCheck[] = [];
    rawLines.forEach((raw, idx) => {
      if (idx === 0 && /^nim\s*,/i.test(raw)) {
        return;
      }
      const [nimRaw = "", ...nameParts] = raw.split(",");
      const nim = nimRaw.trim();
      const name = (nameParts[0] ?? "").trim();

      if (nim.length < 5 || nim.length > 30) {
        out.push({
          line: idx + 1,
          raw,
          nim,
          name,
          ok: false,
          reason: "Format NIM tidak valid (wajib 5–30 karakter).",
        });
        return;
      }
      if (!name || name.length < 2) {
        out.push({
          line: idx + 1,
          raw,
          nim,
          name,
          ok: false,
          reason: "Nama penghuni wajib diisi.",
        });
        return;
      }
      if (seenInFile.has(nim)) {
        out.push({
          line: idx + 1,
          raw,
          nim,
          name,
          ok: false,
          reason: "NIM ganda di dalam berkas CSV.",
        });
        return;
      }
      seenInFile.add(nim);
      const isUpdate = existingNims.has(nim);
      out.push({
        line: idx + 1,
        raw,
        nim,
        name,
        ok: true,
        reason: isUpdate ? "Valid · memperbarui data NIM terdaftar" : "Valid · siap diimpor",
      });
    });

    return out;
  }, [csvText, existingResidents]);

  const validRows = validation.filter((v) => v.ok);
  const invalidRows = validation.filter((v) => !v.ok);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ""));
      setSummary(null);
      setSubmitError(null);
    };
    reader.readAsText(file);
  };

  const commitImport = async () => {
    if (submitting || validation.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    setSummary(null);

    try {
      const trimmed = csvText.trim();
      const hasHeader = /^nim\s*,/i.test(trimmed.split(/\r?\n/)[0] || "");
      const finalCsvContent = hasHeader ? trimmed : `nim,full_name\n${trimmed}`;
      const blob = new Blob([finalCsvContent], { type: "text/csv;charset=utf-8;" });
      const result = await adminApi.importResidentsCsv(blob, "impor-penghuni.csv");
      setSummary(result);
      toast(
        `Impor selesai: ${result.insertedCount} baru, ${result.updatedCount} diperbarui, ${result.rejectedCount} ditolak`,
      );
    } catch (e) {
      setSubmitError(isApiError(e) ? e.message : "Gagal mengimpor berkas CSV ke server.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page nav={false}>
      <TopBar back="/admin/penghuni" title="Impor CSV penghuni" sub="Validasi tiap baris sebelum simpan" />

      <Stagger>
        <Card className="space-y-3.5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Format: nim,full_name,building,room_number</span>
            <label className="soft-inset inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-primary">
              <FileUp className="size-3.5" aria-hidden /> Pilih berkas .csv
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={handleFileUpload} />
            </label>
          </div>

          <TextArea
            label="Isi data CSV"
            placeholder={"nim,full_name,building,room_number\n105022010250,Bintang Kairupan,Crystal,201"}
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setSummary(null);
              setSubmitError(null);
            }}
            hint="Unggah berkas .csv atau tempel baris dengan format NIM,Nama Lengkap."
          />

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="soft-inset rounded-2xl p-2.5">
              <p className="font-display text-base font-semibold tabular">
                {summary ? summary.totalRowsProcessed : validation.length}
              </p>
              <p className="text-[11px] font-semibold text-muted">Total baris</p>
            </div>
            <div className="soft-inset rounded-2xl p-2.5">
              <p className="font-display text-base font-semibold text-success tabular">
                {summary ? summary.insertedCount + summary.updatedCount : validRows.length}
              </p>
              <p className="text-[11px] font-semibold text-muted">Berhasil validasi</p>
            </div>
            <div className="soft-inset rounded-2xl p-2.5">
              <p className="font-display text-base font-semibold text-danger tabular">
                {summary ? summary.rejectedCount : invalidRows.length}
              </p>
              <p className="text-[11px] font-semibold text-muted">Gagal / Ditolak</p>
            </div>
          </div>

          {submitError && (
            <div className="rounded-2xl bg-danger-soft p-3 text-center text-xs font-semibold text-danger">
              {submitError}
            </div>
          )}

          <Button
            block
            size="lg"
            disabled={validation.length === 0 || submitting}
            onClick={() => void commitImport()}
            icon={<Sparkles className="size-5" />}
          >
            {submitting ? "Memproses impor di server…" : `Impor ${validation.length} baris ke server`}
          </Button>

          {summary && (
            <div className="space-y-2 rounded-2xl bg-success-soft p-3.5 text-xs font-semibold text-success">
              <p className="text-center">
                Impor selesai: {summary.insertedCount} ditambahkan, {summary.updatedCount} diperbarui,{" "}
                {summary.rejectedCount} ditolak.{" "}
                <button onClick={() => nav("/admin/penghuni")} className="underline">
                  Lihat daftar
                </button>
              </p>
              {summary.errors.length > 0 && (
                <ul className="space-y-1 border-t border-success/20 pt-2 text-danger">
                  {summary.errors.map((errItem, idx) => (
                    <li key={`${errItem.rowNumber}-${idx}`}>
                      Baris #{errItem.rowNumber} ({errItem.nim || "Tanpa NIM"}): {errItem.errorMessage}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        <SectionTitle>Hasil validasi per baris ({validation.length} baris)</SectionTitle>
        <div className="space-y-2">
          {validation.map((row) => (
            <Item key={row.line} className="glass flex items-start gap-3 rounded-2xl p-3.5">
              {row.ok ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              ) : (
                <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-xs font-semibold text-muted">Baris #{row.line}</span>
                  <Badge tone={row.ok ? "success" : "danger"}>{row.ok ? "Lolos" : "Gagal"}</Badge>
                </div>
                <p className="mt-0.5 truncate text-sm font-semibold">
                  {row.name || "(Tanpa nama)"} · <span className="font-display font-semibold">{row.nim || "(Tanpa NIM)"}</span>
                </p>
                <p className={`mt-0.5 text-xs font-semibold ${row.ok ? "text-success" : "text-danger"}`}>{row.reason}</p>
              </div>
            </Item>
          ))}
        </div>
      </Stagger>
    </Page>
  );
}
