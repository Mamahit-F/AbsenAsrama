import { useCallback, useEffect, useState } from "react";
import { Cpu, History, RefreshCw, ShieldCheck } from "lucide-react";
import { Page, PageHead } from "../../components/layout";
import { Badge, Button, Card, Chip, Empty, Item, Segmented, Stagger } from "../../components/ui";
import {
  isApiError,
  reportsApi,
  type AttendanceRecordHistoryDto,
  type AuditLogDto,
  type ValidationLogDto,
} from "../../api";
import { TZ, fmtDate, toWitaDate } from "../../lib/utils";

export default function Logs() {
  const [stream, setStream] = useState<"sys" | "audit" | "history">("sys");
  const [filter, setFilter] = useState<"ALL" | "SUCCESS" | "REJECTED">("ALL");

  const [valLogs, setValLogs] = useState<ValidationLogDto[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogDto[]>([]);
  const [historyLogs, setHistoryLogs] = useState<AttendanceRecordHistoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [validations, audits, histories] = await Promise.all([
        reportsApi.getValidationLogs({ limit: 100 }),
        reportsApi.getAuditLogs({ limit: 100 }),
        reportsApi.getAttendanceHistory({ limit: 100 }),
      ]);
      setValLogs(validations);
      setAuditLogs(audits);
      setHistoryLogs(histories);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat log sistem dan audit.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const sysFiltered = valLogs.filter((l) => filter === "ALL" || l.result === filter);

  const fmtStamp = (iso: string) => {
    const d = toWitaDate(iso);
    const t = new Date(iso).toLocaleTimeString("id-ID", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return `${fmtDate(d, { day: "numeric", month: "short" })} · ${t}`;
  };

  return (
    <Page>
      <PageHead eyebrow="Sistem & audit · WITA" title="Log" />

      {error && (
        <Card className="mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadLogs()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      <Segmented
        value={stream}
        onChange={setStream}
        options={[
          { value: "sys", label: "Validasi AI", count: valLogs.length },
          { value: "audit", label: "Audit Log", count: auditLogs.length },
          { value: "history", label: "Koreksi", count: historyLogs.length },
        ]}
      />

      {loading ? (
        <Card className="mt-4 p-6 text-center text-sm text-muted">Memuat catatan log…</Card>
      ) : stream === "sys" ? (
        <Stagger className="mt-3 space-y-2.5" key="sys">
          <Item className="soft-inset flex items-start gap-2.5 rounded-2xl p-3.5 text-xs text-muted">
            <Cpu className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <strong>Log Validasi AI (S-07):</strong> Mencatat setiap percobaan scan wajah beserta skor liveness,
              skor kecocokan ArcFace, jarak geofence, dan alasan penolakan.
            </span>
          </Item>

          <div className="no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5 py-1">
            {(["ALL", "SUCCESS", "REJECTED"] as const).map((k) => (
              <Chip key={k} on={filter === k} onClick={() => setFilter(k)}>
                {k === "ALL" ? "Semua" : k === "SUCCESS" ? "SCAN_OK" : "SCAN_REJECT"}
              </Chip>
            ))}
          </div>

          {sysFiltered.length === 0 ? (
            <Empty icon={<Cpu className="size-6" />} title="Belum ada log validasi" text="Log validasi muncul setelah percobaan scan presensi dilakukan." />
          ) : (
            sysFiltered.map((l) => {
              const isOk = l.result === "SUCCESS";
              return (
                <Item key={l.id} className="glass rounded-2xl p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={isOk ? "success" : "danger"}>
                      {isOk ? "SCAN_OK" : "SCAN_REJECT"}
                    </Badge>
                    <span className="font-display text-xs text-muted">{fmtStamp(l.attemptedAt)} WITA</span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold">
                    {l.residentName || "Penghuni"} ({l.residentNim || "-"}) ·{" "}
                    {isOk
                      ? "Presensi wajah terverifikasi"
                      : l.rejectionReason || l.locationReason || "Validasi ditolak"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 font-display text-[11px] font-semibold text-primary">
                    {l.livenessScore !== null && l.livenessScore !== undefined && (
                      <span className="soft-inset rounded-full px-2.5 py-0.5">
                        Liveness: {(l.livenessScore * 100).toFixed(0)}%
                      </span>
                    )}
                    {l.faceScore !== null && l.faceScore !== undefined && (
                      <span className="soft-inset rounded-full px-2.5 py-0.5">
                        Skor ArcFace: {l.faceScore.toFixed(2)}
                      </span>
                    )}
                    {l.distanceM !== null && l.distanceM !== undefined && (
                      <span className="soft-inset rounded-full px-2.5 py-0.5">
                        Jarak: {Math.round(l.distanceM)} m
                      </span>
                    )}
                  </div>
                </Item>
              );
            })
          )}
        </Stagger>
      ) : stream === "audit" ? (
        <Stagger className="mt-3 space-y-2.5" key="audit">
          <Item className="soft-inset flex items-start gap-2.5 rounded-2xl p-3.5 text-xs text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <strong>Audit Log (K-03):</strong> Terpisah dari log teknis; mencatat aktivitas penting oleh penghuni,
              penjaga (presensi manual, dibantu penjaga, perubahan jadwal), dan admin.
            </span>
          </Item>

          {auditLogs.length === 0 ? (
            <Empty icon={<ShieldCheck className="size-6" />} title="Belum ada audit log" text="Aktivitas sistem akan tercatat secara otomatis di sini." />
          ) : (
            auditLogs.map((a) => (
              <Item key={a.id} className="glass rounded-2xl p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="info">{a.action}</Badge>
                  <span className="font-display text-xs text-muted">{fmtStamp(a.createdAt)} WITA</span>
                </div>
                <p className="mt-1.5 text-sm font-semibold">{a.description || a.entityType || a.action}</p>
                <p className="mt-1 text-xs text-muted">
                  Pelaku: {a.actorUsername ? `@${a.actorUsername}` : "Sistem"}
                  {a.entityType ? ` · Entitas: ${a.entityType}` : ""}
                </p>
              </Item>
            ))
          )}
        </Stagger>
      ) : (
        <Stagger className="mt-3 space-y-2.5" key="history">
          <Item className="soft-inset flex items-start gap-2.5 rounded-2xl p-3.5 text-xs text-muted">
            <History className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <strong>Riwayat Koreksi Presensi:</strong> Catatan perubahan status kehadiran yang tidak dapat dihapus (immutable).
            </span>
          </Item>

          {historyLogs.length === 0 ? (
            <Empty icon={<History className="size-6" />} title="Belum ada koreksi" text="Belum ada perubahan status presensi yang tercatat." />
          ) : (
            historyLogs.map((h) => (
              <Item key={h.id} className="glass rounded-2xl p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="warning">
                    {h.oldStatus || "-"} → {h.newStatus}
                  </Badge>
                  <span className="font-display text-xs text-muted">{fmtStamp(h.changedAt)} WITA</span>
                </div>
                <p className="mt-1.5 text-sm font-semibold">
                  Alasan: {h.correctionReason || h.newReason || "-"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Diubah oleh: {h.changedByUsername ? `@${h.changedByUsername}` : "Petugas"}
                </p>
              </Item>
            ))
          )}
        </Stagger>
      )}
    </Page>
  );
}
