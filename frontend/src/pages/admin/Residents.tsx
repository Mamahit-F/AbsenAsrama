import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileUp, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserCheck, UserX } from "lucide-react";
import { Page, PageHead } from "../../components/layout";
import { Avatar, Badge, Button, Card, Empty, Field, IconButton, Item, Sheet, Stagger, Switch } from "../../components/ui";
import {
  adminApi,
  isApiError,
  mapFieldErrors,
  residentsApi,
  type ResidentProfileDto,
} from "../../api";
import { useToast } from "../../state/app";

function parseBuildingAndRoom(raw: string): { building?: string; roomNumber?: string } {
  const clean = raw.trim();
  if (!clean || clean === "-") return { building: undefined, roomNumber: undefined };
  const idx = clean.indexOf("-");
  if (idx > 0) {
    return {
      building: clean.slice(0, idx).trim() || undefined,
      roomNumber: clean.slice(idx + 1).trim() || undefined,
    };
  }
  return { building: undefined, roomNumber: clean };
}

function formatBuildingAndRoom(r: ResidentProfileDto): string {
  if (r.building && r.roomNumber) return `${r.building}-${r.roomNumber}`;
  return r.roomNumber || r.building || "-";
}

export default function Residents() {
  const toast = useToast();
  const nav = useNavigate();

  const [residents, setResidents] = useState<ResidentProfileDto[]>([]);
  const [accountResidentIds, setAccountResidentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ResidentProfileDto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ResidentProfileDto | null>(null);
  const [form, setForm] = useState({ nim: "", name: "", room: "B-201" });
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadResidents = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [resList, userList] = await Promise.all([
        residentsApi.listResidents({ limit: 300 }),
        adminApi.listUsers({ role: "PENGHUNI", limit: 300 }),
      ]);
      setResidents(resList);
      const ids = new Set<string>();
      for (const u of userList) {
        if (u.residentId) ids.add(u.residentId);
      }
      setAccountResidentIds(ids);
    } catch (e) {
      setLoadError(isApiError(e) ? e.message : "Gagal memuat daftar penghuni resmi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  const openAdd = () => {
    setEditing(null);
    setForm({ nim: "", name: "", room: "B-201" });
    setErr("");
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEdit = (r: ResidentProfileDto) => {
    setEditing(r);
    setForm({ nim: r.nim, name: r.fullName, room: formatBuildingAndRoom(r) });
    setErr("");
    setFieldErrors({});
    setModalOpen(true);
  };

  const saveResident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErr("");
    setFieldErrors({});

    const cleanNim = form.nim.trim();
    const cleanName = form.name.trim();
    if (cleanNim.length < 5 || cleanNim.length > 30) {
      setFieldErrors({ nim: "NIM wajib diisi (5–30 karakter)." });
      return;
    }
    if (!cleanName) {
      setFieldErrors({ fullName: "Nama penghuni wajib diisi." });
      return;
    }

    const { building, roomNumber } = parseBuildingAndRoom(form.room);

    setSubmitting(true);
    try {
      if (editing) {
        const updated = await adminApi.updateResident(editing.id, {
          nim: cleanNim,
          fullName: cleanName,
          status: editing.status,
          residenceCategory: editing.residenceCategory || "ASRAMA",
          building,
          roomNumber,
        });
        setResidents((prev) => prev.map((x) => (x.id === editing.id ? updated : x)));
        toast("Data penghuni diperbarui");
      } else {
        const created = await adminApi.createResident({
          nim: cleanNim,
          fullName: cleanName,
          status: "AKTIF",
          residenceCategory: "ASRAMA",
          building,
          roomNumber,
        });
        setResidents((prev) => [created, ...prev]);
        toast("Penghuni resmi ditambahkan");
      }
      setModalOpen(false);
    } catch (ex) {
      setFieldErrors(mapFieldErrors(ex));
      setErr(isApiError(ex) ? ex.message : "Gagal menyimpan data penghuni.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (r: ResidentProfileDto, next: boolean) => {
    try {
      const updated = await adminApi.changeResidentStatus(r.id, next ? "AKTIF" : "NONAKTIF");
      setResidents((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
      toast(next ? `${r.fullName} diaktifkan` : `${r.fullName} dinonaktifkan (tidak dapat presensi)`);
    } catch (ex) {
      toast(isApiError(ex) ? ex.message : "Gagal mengubah status penghuni.", "error");
    }
  };

  const executeDelete = async () => {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    try {
      await adminApi.deleteResident(confirmDelete.id);
      setResidents((prev) => prev.filter((x) => x.id !== confirmDelete.id));
      toast("Profil & embedding dihapus; riwayat presensi dipertahankan");
      setConfirmDelete(null);
    } catch (ex) {
      toast(isApiError(ex) ? ex.message : "Gagal menghapus data penghuni.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = useMemo(() => {
    return residents.filter((r) => {
      if (!q.trim()) return true;
      const k = q.toLowerCase();
      const roomStr = formatBuildingAndRoom(r).toLowerCase();
      return (
        r.fullName.toLowerCase().includes(k) ||
        r.nim.toLowerCase().includes(k) ||
        roomStr.includes(k)
      );
    });
  }, [q, residents]);

  return (
    <Page>
      <PageHead title="Penghuni" eyebrow={`${residents.length} NIM resmi terdaftar`} />

      <div className="mb-4 mt-4 grid grid-cols-2 gap-2">
        <Button variant="glass" size="md" onClick={() => nav("/admin/penghuni/impor")} icon={<FileUp className="size-4" />}>
          Impor CSV
        </Button>
        <Button size="md" onClick={openAdd} icon={<Plus className="size-4" />}>
          Tambah NIM
        </Button>
      </div>

      <Field
        label="Cari NIM atau nama penghuni"
        placeholder="Ketik NIM, nama, atau kamar…"
        icon={<Search className="size-4" />}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {loading ? (
        <Card className="mt-4 p-6 text-center text-sm text-muted">Memuat daftar penghuni resmi…</Card>
      ) : loadError ? (
        <Card className="mt-4 space-y-3 p-5 text-center">
          <p className="text-xs font-semibold text-danger">{loadError}</p>
          <Button size="sm" variant="glass" onClick={() => void loadResidents()} icon={<RefreshCw className="size-4" />}>
            Coba Lagi
          </Button>
        </Card>
      ) : (
        <Stagger className="mt-4 space-y-2.5">
          {filtered.length === 0 ? (
            <Empty icon={<Search className="size-6" />} title="Penghuni tidak ditemukan" text="Coba kata kunci lain atau tambahkan NIM baru." />
          ) : (
            filtered.map((r) => {
              const isActive = r.status === "AKTIF";
              const faceStatus = r.hasActiveFaceProfile ? "Aktif" : "Belum Terdaftar";
              const hasAccount = accountResidentIds.has(r.id);
              const roomStr = formatBuildingAndRoom(r);

              return (
                <Card key={r.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={r.fullName} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-sm font-semibold">{r.fullName}</p>
                        <Badge tone={isActive ? "success" : "danger"} dot>
                          {isActive ? "Aktif" : "Nonaktif"}
                        </Badge>
                        <Badge tone={r.hasActiveFaceProfile ? "info" : "neutral"}>
                          Wajah: {faceStatus}
                        </Badge>
                      </div>
                      <p className="mt-0.5 font-display text-xs text-muted">
                        NIM {r.nim} · Kamar {roomStr} · {hasAccount ? "Sudah punya akun" : "Belum buat akun"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-line-strong/60 pt-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                      {isActive ? <UserCheck className="size-4 text-success" aria-hidden /> : <UserX className="size-4 text-danger" aria-hidden />}
                      <span>Izinkan presensi</span>
                      <Switch checked={isActive} onChange={(v) => void toggleActive(r, v)} label={`Status aktif ${r.fullName}`} />
                    </div>

                    <div className="flex gap-1.5">
                      <IconButton label={`Ubah ${r.fullName}`} className="size-9" onClick={() => openEdit(r)}>
                        <Pencil className="size-4" aria-hidden />
                      </IconButton>
                      <IconButton label={`Hapus ${r.fullName}`} className="size-9 text-danger" onClick={() => setConfirmDelete(r)}>
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </Stagger>
      )}

      {/* Sheet tambah / ubah */}
      <Sheet open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Ubah data penghuni" : "Tambah penghuni resmi"}>
        <form onSubmit={saveResident} className="space-y-3.5" noValidate>
          <Field
            label="NIM resmi"
            inputMode="numeric"
            placeholder="105022010xxx"
            value={form.nim}
            onChange={(e) => {
              setForm({ ...form, nim: e.target.value.replace(/\s+/g, "") });
              setErr("");
              setFieldErrors((f) => ({ ...f, nim: "" }));
            }}
            error={fieldErrors.nim || err}
          />
          <Field
            label="Nama lengkap penghuni"
            placeholder="Nama sesuai akademik"
            value={form.name}
            error={fieldErrors.fullName}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              setErr("");
              setFieldErrors((f) => ({ ...f, fullName: "" }));
            }}
          />
          <Field
            label="Kamar asrama"
            placeholder="Contoh: B-204"
            value={form.room}
            onChange={(e) => setForm({ ...form, room: e.target.value })}
          />
          <Button type="submit" block size="lg" disabled={submitting}>
            {submitting ? "Menyimpan…" : editing ? "Simpan perubahan" : "Tambahkan ke daftar resmi"}
          </Button>
        </form>
      </Sheet>

      {/* Sheet konfirmasi hapus */}
      <Sheet open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Hapus data penghuni">
        {confirmDelete && (
          <div className="space-y-4">
            <Item className="soft-inset flex items-start gap-2.5 rounded-2xl p-3.5 text-xs text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                Sesuai kriteria <strong>A-03</strong>: Profil dan embedding wajah <strong>{confirmDelete.fullName}</strong> akan dihapus,
                namun <strong>riwayat presensi yang sudah tercatat tetap dipertahankan</strong>. NIM{" "}
                <span className="font-display">{confirmDelete.nim}</span> dapat digunakan kembali untuk pendaftaran akun baru.
              </span>
            </Item>
            <div className="flex gap-2.5">
              <Button variant="glass" block onClick={() => setConfirmDelete(null)} disabled={deleting}>
                Batal
              </Button>
              <Button variant="danger" block onClick={() => void executeDelete()} disabled={deleting}>
                {deleting ? "Menghapus…" : "Hapus profil & embedding"}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </Page>
  );
}
