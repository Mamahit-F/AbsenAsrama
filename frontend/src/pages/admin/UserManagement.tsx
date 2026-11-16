import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  Eye,
  EyeOff,
  FileUp,
  KeyRound,
  Menu,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SquarePen,
  Trash2,
} from "lucide-react";
import { Page, useNavShell } from "../../components/layout";
import {
  Badge,
  Button,
  Card,
  Countdown,
  Empty,
  Field,
  IconButton,
  Item,
  SelectField,
  Sheet,
  Switch,
} from "../../components/ui";
import {
  adminApi,
  isApiError,
  mapFieldErrors,
  residentsApi,
  type ResidentProfileDto,
  type UserAccountDto,
  type UserRole,
} from "../../api";
import { useAuth, useToast } from "../../state/app";

const HALL_OPTIONS = ["Hall A1", "Hall B1", "Hall A2", "Hall B2"] as const;
const PAGE_SIZE = 20;

function parseRoleFilter(raw: string | null): "ALL" | UserRole {
  const upper = raw?.trim().toUpperCase();
  if (upper === "PENGHUNI" || upper === "MONITOR" || upper === "ADMIN") {
    return upper;
  }
  return "ALL";
}

function formatRoleLabel(role: UserRole): string {
  if (role === "PENGHUNI") return "Penghuni";
  if (role === "MONITOR") return "Penjaga";
  return "Admin";
}

function formatDisplayName(u: UserAccountDto): string {
  if (u.residentName) return u.residentName;
  return u.username
    .split(/[._-]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

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

function formatBuildingAndRoom(r?: ResidentProfileDto): string {
  if (!r) return "-";
  if (r.building && r.roomNumber) return `${r.building}-${r.roomNumber}`;
  return r.roomNumber || r.building || "-";
}

function formatUserCode(u: UserAccountDto): string {
  if (u.residentNim) return u.residentNim;
  return u.id.slice(0, 6).toUpperCase();
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { hasSidebar, setDrawerOpen } = useNavShell();
  const toast = useToast();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const roleFilter = parseRoleFilter(searchParams.get("role"));

  const [users, setUsers] = useState<UserAccountDto[]>([]);
  const [residentsById, setResidentsById] = useState<Record<string, ResidentProfileDto>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  // Modal Tambah Pengguna
  const [openAdd, setOpenAdd] = useState(false);
  const [addRole, setAddRole] = useState<UserRole>("PENGHUNI");
  const [addForm, setAddForm] = useState({
    nim: "",
    fullName: "",
    room: "B-201",
    hallName: "",
    username: "",
    email: "",
    password: "",
  });
  const [showAddPw, setShowAddPw] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [addFieldErrors, setAddFieldErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  // Modal Edit Pengguna
  const [editTarget, setEditTarget] = useState<UserAccountDto | null>(null);
  const [editForm, setEditForm] = useState({
    nim: "",
    fullName: "",
    room: "-",
    hallName: "",
    role: "MONITOR" as UserRole,
    isActive: true,
    newPassword: "",
    resetDefaultPw: false,
  });
  const [showEditPw, setShowEditPw] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  // Modal Konfirmasi Reset Sandi Default
  const [resetTarget, setResetTarget] = useState<UserAccountDto | null>(null);
  const [resettingPw, setResettingPw] = useState(false);

  // Modal Konfirmasi Hapus
  const [deleteTarget, setDeleteTarget] = useState<UserAccountDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const setRoleFilter = (next: "ALL" | UserRole) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === "ALL") {
      nextParams.delete("role");
    } else {
      nextParams.set("role", next);
    }
    setSearchParams(nextParams, { replace: true });
    setPage(1);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [userList, resList] = await Promise.all([
        adminApi.listUsers({ limit: 500 }),
        residentsApi.listResidents(),
      ]);
      const resMap: Record<string, ResidentProfileDto> = {};
      for (const r of resList) {
        resMap[r.id] = r;
      }
      setUsers(userList);
      setResidentsById(resMap);
    } catch (e) {
      setLoadError(isApiError(e) ? e.message : "Gagal memuat daftar pengguna dari database.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setPage(1);
  }, [q, roleFilter]);

  const roleCounts = useMemo(() => {
    const counts = { ALL: users.length, PENGHUNI: 0, MONITOR: 0, ADMIN: 0 };
    for (const u of users) {
      if (u.role === "PENGHUNI") counts.PENGHUNI += 1;
      else if (u.role === "MONITOR") counts.MONITOR += 1;
      else if (u.role === "ADMIN") counts.ADMIN += 1;
    }
    return counts;
  }, [users]);

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
      if (!keyword) return true;
      const res = u.residentId ? residentsById[u.residentId] : undefined;
      const name = formatDisplayName(u).toLowerCase();
      const idCode = formatUserCode(u).toLowerCase();
      const email = (u.email || "").toLowerCase();
      const username = u.username.toLowerCase();
      const hall = (res?.hallName ?? u.hallName ?? "").toLowerCase();
      const room = formatBuildingAndRoom(res).toLowerCase();
      return (
        name.includes(keyword) ||
        idCode.includes(keyword) ||
        email.includes(keyword) ||
        username.includes(keyword) ||
        hall.includes(keyword) ||
        room.includes(keyword)
      );
    });
  }, [q, roleFilter, users, residentsById]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const openAddModal = () => {
    setAddRole(roleFilter === "ALL" ? "PENGHUNI" : roleFilter);
    setAddForm({
      nim: "",
      fullName: "",
      room: "B-201",
      hallName: roleFilter === "MONITOR" ? "Hall A1" : "",
      username: "",
      email: "",
      password: "",
    });
    setShowAddPw(false);
    setAddErr("");
    setAddFieldErrors({});
    setOpenAdd(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adding) return;
    setAddErr("");
    setAddFieldErrors({});

    if (addRole === "PENGHUNI") {
      const cleanNim = addForm.nim.trim();
      const cleanName = addForm.fullName.trim();
      if (cleanNim.length < 5 || cleanNim.length > 30) {
        setAddFieldErrors({ nim: "NIM wajib diisi (5–30 karakter)." });
        return;
      }
      if (!cleanName) {
        setAddFieldErrors({ fullName: "Nama lengkap penghuni wajib diisi." });
        return;
      }
      const { building, roomNumber } = parseBuildingAndRoom(addForm.room);
      setAdding(true);
      try {
        await adminApi.createResident({
          nim: cleanNim,
          fullName: cleanName,
          status: "AKTIF",
          residenceCategory: "ASRAMA",
          building,
          roomNumber,
        });
        toast(`Penghuni ${cleanName} (${cleanNim}) ditambahkan`);
        setOpenAdd(false);
        await loadData();
      } catch (ex) {
        setAddFieldErrors(mapFieldErrors(ex));
        setAddErr(isApiError(ex) ? ex.message : "Gagal menambah pengguna penghuni.");
      } finally {
        setAdding(false);
      }
      return;
    }

    const cleanUsername = addForm.username.trim().toLowerCase();
    if (cleanUsername.length < 3) {
      setAddFieldErrors({ username: "Username minimal 3 karakter." });
      return;
    }
    if (addForm.password.length < 8) {
      setAddFieldErrors({ password: "Kata sandi minimal 8 karakter." });
      return;
    }
    setAdding(true);
    try {
      const created = await adminApi.createStaffUser({
        username: cleanUsername,
        email: addForm.email.trim() || undefined,
        password: addForm.password,
        role: addRole,
        hallName: addRole === "MONITOR" ? addForm.hallName || "Hall A1" : undefined,
      });
      toast(`Akun ${formatRoleLabel(addRole)} @${created.username} berhasil dibuat`);
      setOpenAdd(false);
      await loadData();
    } catch (ex) {
      setAddFieldErrors(mapFieldErrors(ex));
      setAddErr(isApiError(ex) ? ex.message : "Gagal membuat akun pengguna.");
    } finally {
      setAdding(false);
    }
  };

  const openEditModal = (u: UserAccountDto) => {
    const res = u.residentId ? residentsById[u.residentId] : undefined;
    setEditTarget(u);
    setEditForm({
      nim: res?.nim ?? u.residentNim ?? u.username,
      fullName: res?.fullName ?? u.residentName ?? formatDisplayName(u),
      room: formatBuildingAndRoom(res),
      hallName: res?.hallName ?? u.hallName ?? "",
      role: u.role,
      isActive: u.isActive,
      newPassword: "",
      resetDefaultPw: false,
    });
    setShowEditPw(false);
    setEditErr("");
    setEditFieldErrors({});
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || savingEdit) return;
    setEditErr("");
    setEditFieldErrors({});

    const isDefaultResetOnly = editTarget.role === "PENGHUNI" || editForm.role === "MONITOR";
    if (!isDefaultResetOnly && editForm.newPassword && editForm.newPassword.length < 8) {
      setEditFieldErrors({ newPassword: "Kata sandi baru minimal 8 karakter." });
      return;
    }

    setSavingEdit(true);
    try {
      if (editTarget.role === "PENGHUNI" && editTarget.residentId) {
        const res = residentsById[editTarget.residentId];
        const cleanNim = editForm.nim.trim();
        const cleanName = editForm.fullName.trim();
        if (cleanNim.length < 5) {
          setEditFieldErrors({ nim: "NIM minimal 5 karakter." });
          setSavingEdit(false);
          return;
        }
        if (!cleanName) {
          setEditFieldErrors({ fullName: "Nama lengkap wajib diisi." });
          setSavingEdit(false);
          return;
        }
        const { building, roomNumber } = parseBuildingAndRoom(editForm.room);
        await adminApi.updateResident(editTarget.residentId, {
          nim: cleanNim,
          fullName: cleanName,
          status: editForm.isActive ? "AKTIF" : "NONAKTIF",
          residenceCategory: res?.residenceCategory || "ASRAMA",
          building,
          roomNumber,
        });
      } else {
        if (editForm.role !== editTarget.role) {
          await adminApi.updateUserRole(editTarget.id, editForm.role);
        }
        if (editForm.role === "MONITOR") {
          await adminApi.updateUserHall(editTarget.id, editForm.hallName || null);
        } else if (editTarget.hallName) {
          await adminApi.updateUserHall(editTarget.id, null);
        }
      }

      if (editForm.isActive !== editTarget.isActive) {
        await adminApi.setUserActive(editTarget.id, editForm.isActive);
      }

      if (isDefaultResetOnly) {
        if (editForm.resetDefaultPw) {
          await adminApi.resetUserPassword(editTarget.id, "11111111");
        }
      } else if (editForm.newPassword.trim().length >= 8) {
        await adminApi.resetUserPassword(editTarget.id, editForm.newPassword);
      }

      toast(
        isDefaultResetOnly && editForm.resetDefaultPw
          ? `Data ${formatDisplayName(editTarget)} diperbarui & kata sandi di-reset ke 11111111`
          : `Data pengguna ${formatDisplayName(editTarget)} diperbarui`,
      );
      setEditTarget(null);
      await loadData();
    } catch (ex) {
      setEditFieldErrors(mapFieldErrors(ex));
      setEditErr(isApiError(ex) ? ex.message : "Gagal menyimpan perubahan pengguna.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleResetDefaultPassword = async () => {
    if (!resetTarget || resettingPw) return;
    setResettingPw(true);
    try {
      await adminApi.resetUserPassword(resetTarget.id, "11111111");
      toast(`Kata sandi ${formatDisplayName(resetTarget)} berhasil di-reset ke 11111111`);
      setResetTarget(null);
      await loadData();
    } catch (ex) {
      toast(isApiError(ex) ? ex.message : "Gagal mereset kata sandi pengguna.", "error");
    } finally {
      setResettingPw(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteTarget.residentId) {
        await adminApi.deleteResident(deleteTarget.residentId);
        toast("Penghuni & akun dihapus; riwayat presensi tetap dipertahankan");
      } else {
        await adminApi.deleteUser(deleteTarget.id);
        toast(`Akun @${deleteTarget.username} berhasil dihapus`);
      }
      setDeleteTarget(null);
      await loadData();
    } catch (ex) {
      toast(isApiError(ex) ? ex.message : "Gagal menghapus pengguna.", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Page>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-start gap-3">
          {hasSidebar && (
            <div className="lg:hidden">
              <IconButton label="Buka menu" onClick={() => setDrawerOpen(true)}>
                <Menu className="size-5" aria-hidden />
              </IconButton>
            </div>
          )}
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-[26px]">
              User Management
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              Kelola data Penghuni, Penjaga Hall, dan Admin langsung dari database backend.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="glass"
            onClick={() => nav("/admin/pengguna/impor")}
            icon={<FileUp className="size-4" aria-hidden />}
            className="rounded-xl px-3.5"
          >
            Impor CSV
          </Button>
          <Button
            size="sm"
            onClick={openAddModal}
            icon={<Plus className="size-4" aria-hidden />}
            className="rounded-xl px-4"
          >
            Tambah Pengguna
          </Button>
        </div>
      </div>

      {/* Kontainer Utama */}
      <Card radius={16} className="overflow-hidden rounded-2xl !p-0">
        {/* Toolbar Pencarian & Filter Peran */}
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari Nama, NIM/ID, Hall, atau Email…"
              aria-label="Cari Nama, NIM/ID, Hall, atau Email"
              className="soft-inset h-10 w-full rounded-xl pl-10 pr-3.5 text-sm text-foreground placeholder:text-subtle outline-none transition-shadow focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <div className="relative">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as "ALL" | UserRole)}
                aria-label="Filter peran pengguna"
                className="soft-inset h-10 appearance-none rounded-xl pl-3.5 pr-9 text-sm font-medium text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary"
              >
                <option value="ALL">Semua Peran ({roleCounts.ALL})</option>
                <option value="PENGHUNI">Penghuni ({roleCounts.PENGHUNI})</option>
                <option value="MONITOR">Penjaga ({roleCounts.MONITOR})</option>
                <option value="ADMIN">Admin ({roleCounts.ADMIN})</option>
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
            </div>

            <button
              type="button"
              onClick={() => void loadData()}
              title="Muat ulang data pengguna"
              aria-label="Muat ulang data pengguna"
              className="soft-sm grid size-10 place-items-center rounded-xl text-muted transition-colors hover:text-foreground"
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
        </div>

        {/* Informasi Kontekstual Berdasarkan Role Dipilih */}
        {!loading && !loadError && roleFilter !== "ALL" && (
          <div className="border-b border-line px-5 py-2.5 text-xs text-muted">
            {roleFilter === "PENGHUNI" && (
              <span>
                <strong>Mode Penghuni:</strong> Menampilkan NIM, kamar, penempatan Hall, dan status pendaftaran wajah.
                Penghuni baru otomatis mendapat kata sandi awal <code className="font-bold text-foreground">11111111</code>.
              </span>
            )}
            {roleFilter === "MONITOR" && (
              <span>
                <strong>Mode Penjaga Hall:</strong> Menampilkan penugasan Hall (`Hall A1`–`Hall B2`) dan jumlah
                percobaan salah sandi (dikunci 5 menit setelah 5x gagal login).
              </span>
            )}
            {roleFilter === "ADMIN" && (
              <span>
                <strong>Mode Administrator:</strong> Menampilkan akun dengan akses penuh pengelolaan sistem asrama.
              </span>
            )}
          </div>
        )}

        {/* Isi Tabel */}
        {loading ? (
          <div className="p-10 text-center text-sm text-muted">
            Memuat data pengguna dari database…
          </div>
        ) : loadError ? (
          <div className="space-y-3 p-8 text-center">
            <p className="text-sm font-semibold text-danger">{loadError}</p>
            <Button size="sm" variant="glass" onClick={() => void loadData()} icon={<RefreshCw className="size-4" />}>
              Coba Lagi
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8">
            <Empty
              icon={<Search className="size-6" />}
              title="Pengguna tidak ditemukan"
              text="Ubah kata kunci pencarian, pilih peran lain, atau tambah pengguna baru."
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-xs font-medium text-muted">
                    <th className="px-5 py-3.5 font-medium">
                      {roleFilter === "PENGHUNI" ? "NIM" : "ID / NIM"}
                    </th>
                    <th className="px-4 py-3.5 font-medium">Nama Lengkap</th>
                    {roleFilter === "ALL" && <th className="px-4 py-3.5 font-medium">Peran</th>}
                    {roleFilter === "ALL" && <th className="px-4 py-3.5 font-medium">Info Peran</th>}
                    {roleFilter === "PENGHUNI" && <th className="px-4 py-3.5 font-medium">Kamar & Hall</th>}
                    {roleFilter === "PENGHUNI" && <th className="px-4 py-3.5 font-medium">Wajah</th>}
                    {roleFilter === "MONITOR" && <th className="px-4 py-3.5 font-medium">Penugasan Hall</th>}
                    {roleFilter === "MONITOR" && <th className="px-4 py-3.5 font-medium">Gagal Sandi</th>}
                    {roleFilter === "ADMIN" && <th className="px-4 py-3.5 font-medium">Email</th>}
                    {roleFilter === "ADMIN" && <th className="px-4 py-3.5 font-medium">Gagal Sandi</th>}
                    <th className="px-4 py-3.5 font-medium">Username</th>
                    <th className="px-4 py-3.5 font-medium">Kata Sandi</th>
                    <th className="px-4 py-3.5 font-medium">Status</th>
                    <th className="px-5 py-3.5 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 text-sm">
                  {visibleRows.map((u) => {
                    const displayName = formatDisplayName(u);
                    const idCode = formatUserCode(u);
                    const res = u.residentId ? residentsById[u.residentId] : undefined;
                    const roomStr = formatBuildingAndRoom(res);
                    const hallLabel = res?.hallName ?? u.hallName ?? null;
                    const isSelf = currentUser?.id === u.id;
                    const lockedMs = u.lockedUntil ? Date.parse(u.lockedUntil) : 0;
                    const isLocked = lockedMs > Date.now();
                    const residentActive = res ? res.status === "AKTIF" : true;
                    const effectiveActive = u.isActive && residentActive;

                    return (
                      <tr key={u.id} className="transition-colors hover:bg-primary/[0.03]">
                        <td className="whitespace-nowrap px-5 py-3.5 font-display text-[13px] font-medium text-ink tabular">
                          {idCode}
                        </td>

                        <td className="px-4 py-3.5">
                          <span className="font-semibold text-ink">{displayName}</span>
                        </td>

                        {roleFilter === "ALL" && (
                          <td className="whitespace-nowrap px-4 py-3.5 text-muted">
                            {formatRoleLabel(u.role)}
                          </td>
                        )}

                        {roleFilter === "ALL" && (
                          <td className="px-4 py-3.5 text-xs text-muted">
                            {u.role === "PENGHUNI" ? (
                              <span>
                                Kamar {roomStr} · {hallLabel ?? "Belum Masuk Hall"} ·{" "}
                                <span className={res?.hasActiveFaceProfile ? "font-semibold text-primary" : ""}>
                                  {res?.hasActiveFaceProfile ? "Wajah Aktif" : "Wajah Belum Ada"}
                                </span>
                              </span>
                            ) : u.role === "MONITOR" ? (
                              <span>
                                {hallLabel ?? "Hall Belum Ditugaskan"} · Gagal sandi {u.failedLoginAttempts}/5
                              </span>
                            ) : (
                              <span>{u.email || "Akses penuh sistem"}</span>
                            )}
                          </td>
                        )}

                        {roleFilter === "PENGHUNI" && (
                          <td className="whitespace-nowrap px-4 py-3.5 text-xs text-muted">
                            <span className="font-medium text-ink">Kamar {roomStr}</span>
                            {" · "}
                            {hallLabel ? (
                              <span className="rounded-md bg-primary-soft px-2 py-0.5 font-medium text-primary">
                                {hallLabel}
                              </span>
                            ) : (
                              <span className="text-warning">Belum Masuk Hall</span>
                            )}
                          </td>
                        )}

                        {roleFilter === "PENGHUNI" && (
                          <td className="whitespace-nowrap px-4 py-3.5">
                            <Badge tone={res?.hasActiveFaceProfile ? "info" : "neutral"} className="h-6 px-2.5 text-[11px]">
                              {res?.hasActiveFaceProfile ? "Terdaftar" : "Belum"}
                            </Badge>
                          </td>
                        )}

                        {roleFilter === "MONITOR" && (
                          <td className="whitespace-nowrap px-4 py-3.5">
                            {hallLabel ? (
                              <Badge tone="info" className="h-6 px-2.5 text-[11px]">
                                {hallLabel}
                              </Badge>
                            ) : (
                              <span className="text-xs text-warning">Belum Ditugaskan</span>
                            )}
                          </td>
                        )}

                        {roleFilter === "ADMIN" && (
                          <td className="whitespace-nowrap px-4 py-3.5 text-xs text-muted">
                            {u.email || "-"}
                          </td>
                        )}

                        {(roleFilter === "MONITOR" || roleFilter === "ADMIN") && (
                          <td className="whitespace-nowrap px-4 py-3.5 font-display text-xs text-muted tabular">
                            {u.failedLoginAttempts}/5
                          </td>
                        )}

                        <td className="whitespace-nowrap px-4 py-3.5 font-display text-[13px] text-muted tabular">
                          {u.username}
                        </td>

                        <td className="whitespace-nowrap px-4 py-3.5">
                          <div className="inline-flex items-center gap-2">
                            <span
                              className="tracking-widest text-muted select-none"
                              aria-label="Kata sandi terenkripsi"
                            >
                              ••••••••
                            </span>
                            {(u.role === "PENGHUNI" || u.role === "MONITOR") && (
                              <button
                                type="button"
                                onClick={() => setResetTarget(u)}
                                aria-label={`Reset kata sandi ${displayName} ke default 11111111`}
                                title="Reset kata sandi ke 11111111"
                                className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary hover:text-white"
                              >
                                <RotateCcw className="size-3" aria-hidden />
                                Reset
                              </button>
                            )}
                          </div>
                        </td>

                        <td className="whitespace-nowrap px-4 py-3.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge tone={effectiveActive ? "success" : "danger"} dot className="h-6 px-2.5 text-[11px]">
                              {effectiveActive ? "Aktif" : "Nonaktif"}
                            </Badge>
                            {isLocked && (
                              <Badge tone="warning" className="h-6 px-2 text-[11px]">
                                Terkunci <Countdown until={lockedMs} className="ml-1" />
                              </Badge>
                            )}
                          </div>
                        </td>

                        <td className="whitespace-nowrap px-5 py-3.5 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(u)}
                              aria-label={`Ubah ${displayName}`}
                              title="Ubah pengguna"
                              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-primary-soft hover:text-primary"
                            >
                              <SquarePen className="size-4" aria-hidden />
                            </button>
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={() => setDeleteTarget(u)}
                              aria-label={
                                isSelf ? "Akun aktif sendiri tidak dapat dihapus" : `Hapus ${displayName}`
                              }
                              title={isSelf ? "Akun aktif Anda tidak dapat dihapus" : "Hapus pengguna"}
                              className="rounded-lg p-1.5 text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer Ringkasan & Paginasi */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-5 py-3 text-xs text-muted">
              <span>
                Menampilkan {visibleRows.length} dari {filtered.length} pengguna
                {filtered.length !== users.length ? ` (total ${users.length})` : ""}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-line-strong px-2.5 py-1 font-medium text-ink disabled:opacity-40"
                  >
                    Sebelumnya
                  </button>
                  <span className="tabular">
                    Hal {safePage}/{totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-lg border border-line-strong px-2.5 py-1 font-medium text-ink disabled:opacity-40"
                  >
                    Berikutnya
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      {/* Modal Tambah Pengguna */}
      <Sheet open={openAdd} onClose={() => setOpenAdd(false)} title="Tambah pengguna baru">
        <form onSubmit={handleCreate} className="space-y-3.5" noValidate>
          <SelectField
            label="Peran pengguna"
            value={addRole}
            onChange={(e) => {
              setAddRole(e.target.value as UserRole);
              setAddErr("");
              setAddFieldErrors({});
            }}
          >
            <option value="PENGHUNI">Penghuni Asrama (PENGHUNI)</option>
            <option value="MONITOR">Penjaga Hall (MONITOR)</option>
            <option value="ADMIN">Administrator (ADMIN)</option>
          </SelectField>

          {addRole === "PENGHUNI" ? (
            <>
              <Item className="soft-inset flex items-start gap-2.5 rounded-2xl p-3 text-xs text-muted">
                <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  Akun login otomatis dibuatkan dengan username <strong>NIM</strong> dan kata sandi awal{" "}
                  <strong>11111111</strong>.
                </span>
              </Item>
              <Field
                label="NIM resmi"
                inputMode="numeric"
                placeholder="105022010xxx"
                value={addForm.nim}
                error={addFieldErrors.nim}
                onChange={(e) => {
                  setAddForm({ ...addForm, nim: e.target.value.replace(/\s+/g, "") });
                  setAddErr("");
                  setAddFieldErrors((f) => ({ ...f, nim: "" }));
                }}
              />
              <Field
                label="Nama lengkap penghuni"
                placeholder="Nama sesuai akademik"
                value={addForm.fullName}
                error={addFieldErrors.fullName}
                onChange={(e) => {
                  setAddForm({ ...addForm, fullName: e.target.value });
                  setAddErr("");
                  setAddFieldErrors((f) => ({ ...f, fullName: "" }));
                }}
              />
              <Field
                label="Kamar asrama"
                placeholder="Contoh: B-204"
                value={addForm.room}
                onChange={(e) => setAddForm({ ...addForm, room: e.target.value })}
              />
            </>
          ) : (
            <>
              <Field
                label="Username login"
                placeholder="Contoh: penjaga.a1"
                value={addForm.username}
                error={addFieldErrors.username}
                onChange={(e) => {
                  setAddForm({ ...addForm, username: e.target.value.toLowerCase().replace(/\s+/g, ".") });
                  setAddErr("");
                  setAddFieldErrors((f) => ({ ...f, username: "" }));
                }}
              />
              <Field
                label="Email (opsional)"
                type="email"
                placeholder="petugas@unklab.ac.id"
                value={addForm.email}
                error={addFieldErrors.email}
                onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
              />
              <Field
                label="Kata sandi awal (min. 8 karakter)"
                type={showAddPw ? "text" : "password"}
                placeholder="Masukkan kata sandi awal"
                value={addForm.password}
                error={addFieldErrors.password}
                onChange={(e) => {
                  setAddForm({ ...addForm, password: e.target.value });
                  setAddErr("");
                  setAddFieldErrors((f) => ({ ...f, password: "" }));
                }}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowAddPw((s) => !s)}
                    aria-label={showAddPw ? "Sembunyikan sandi" : "Tampilkan sandi"}
                    className="grid size-8 place-items-center rounded-full text-muted hover:text-ink"
                  >
                    {showAddPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                }
              />
              {addRole === "MONITOR" && (
                <SelectField
                  label="Penugasan Hall Asrama"
                  value={addForm.hallName || "Hall A1"}
                  onChange={(e) => setAddForm({ ...addForm, hallName: e.target.value })}
                >
                  {HALL_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </SelectField>
              )}
            </>
          )}

          {addErr && <p className="text-xs font-semibold text-danger">{addErr}</p>}

          <Button type="submit" block size="lg" disabled={adding}>
            {adding ? "Menyimpan…" : `Buat Akun ${formatRoleLabel(addRole)}`}
          </Button>

          {addRole === "PENGHUNI" && (
            <button
              type="button"
              onClick={() => {
                setOpenAdd(false);
                nav("/admin/pengguna/impor");
              }}
              className="flex w-full items-center justify-center gap-1.5 pt-1 text-xs font-semibold text-primary hover:underline"
            >
              <FileUp className="size-3.5" aria-hidden /> Impor banyak penghuni sekaligus (CSV)
            </button>
          )}
        </form>
      </Sheet>

      {/* Modal Edit Pengguna */}
      <Sheet
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `Edit ${formatDisplayName(editTarget)}` : "Edit pengguna"}
      >
        {editTarget && (
          <form onSubmit={handleSaveEdit} className="space-y-3.5" noValidate>
            {editTarget.role === "PENGHUNI" && editTarget.residentId ? (
              <>
                <Field
                  label="NIM resmi"
                  inputMode="numeric"
                  value={editForm.nim}
                  error={editFieldErrors.nim}
                  onChange={(e) => {
                    setEditForm({ ...editForm, nim: e.target.value.replace(/\s+/g, "") });
                    setEditFieldErrors((f) => ({ ...f, nim: "" }));
                  }}
                />
                <Field
                  label="Nama lengkap penghuni"
                  value={editForm.fullName}
                  error={editFieldErrors.fullName}
                  onChange={(e) => {
                    setEditForm({ ...editForm, fullName: e.target.value });
                    setEditFieldErrors((f) => ({ ...f, fullName: "" }));
                  }}
                />
                <Field
                  label="Kamar asrama"
                  placeholder="Contoh: B-204"
                  value={editForm.room}
                  onChange={(e) => setEditForm({ ...editForm, room: e.target.value })}
                />
              </>
            ) : (
              <>
                <Field label="Username" value={editTarget.username} disabled />
                <SelectField
                  label="Peran pengguna"
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                >
                  <option value="MONITOR">Penjaga Hall (MONITOR)</option>
                  <option value="ADMIN">Administrator (ADMIN)</option>
                </SelectField>
                {editForm.role === "MONITOR" && (
                  <SelectField
                    label="Penugasan Hall Asrama"
                    value={editForm.hallName || "Hall A1"}
                    onChange={(e) => setEditForm({ ...editForm, hallName: e.target.value })}
                  >
                    {HALL_OPTIONS.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </SelectField>
                )}
              </>
            )}

            <div className="soft-inset flex items-center justify-between rounded-2xl px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-ink">Status Akun Aktif</p>
                <p className="text-[11px] text-muted">Mengaktifkan akun sekaligus membuka kunci login (jika terkunci)</p>
              </div>
              <Switch
                checked={editForm.isActive}
                onChange={(v) => setEditForm({ ...editForm, isActive: v })}
                label="Status akun aktif"
              />
            </div>

            {editTarget.role === "PENGHUNI" || editForm.role === "MONITOR" ? (
              <div className="soft-inset flex items-center justify-between rounded-2xl px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-ink">Reset Kata Sandi ke Default</p>
                  <p className="text-[11px] text-muted">
                    Mengembalikan kata sandi menjadi <code className="font-semibold text-ink">11111111</code>{" "}
                    (tidak dapat diisi sandi custom)
                  </p>
                </div>
                <Switch
                  checked={editForm.resetDefaultPw}
                  onChange={(v) => setEditForm({ ...editForm, resetDefaultPw: v })}
                  label="Reset kata sandi ke 11111111"
                />
              </div>
            ) : (
              <Field
                label="Atur ulang kata sandi (opsional, min. 8 karakter)"
                type={showEditPw ? "text" : "password"}
                placeholder="Kosongkan jika tidak ingin mengubah kata sandi"
                value={editForm.newPassword}
                error={editFieldErrors.newPassword}
                onChange={(e) => {
                  setEditForm({ ...editForm, newPassword: e.target.value });
                  setEditFieldErrors((f) => ({ ...f, newPassword: "" }));
                }}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowEditPw((s) => !s)}
                    aria-label={showEditPw ? "Sembunyikan sandi" : "Tampilkan sandi"}
                    className="grid size-8 place-items-center rounded-full text-muted hover:text-ink"
                  >
                    {showEditPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                }
              />
            )}

            {editErr && <p className="text-xs font-semibold text-danger">{editErr}</p>}

            <Button type="submit" block size="lg" disabled={savingEdit}>
              {savingEdit ? "Menyimpan…" : "Simpan Perubahan"}
            </Button>
          </form>
        )}
      </Sheet>

      {/* Modal Konfirmasi Reset Sandi Default */}
      <Sheet
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title="Reset kata sandi ke default"
      >
        {resetTarget && (
          <div className="space-y-4">
            <Item className="soft-inset flex items-start gap-2.5 rounded-2xl p-3.5 text-xs text-muted">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                Kata sandi akun{" "}
                <strong>{formatDisplayName(resetTarget)}</strong> ({resetTarget.username}) akan dikembalikan
                menjadi <strong className="text-ink">11111111</strong> dan sesi login aktif pengguna ini akan
                dicabut otomatis.
              </span>
            </Item>
            <div className="flex gap-2.5">
              <Button variant="glass" block onClick={() => setResetTarget(null)} disabled={resettingPw}>
                Batal
              </Button>
              <Button block onClick={() => void handleResetDefaultPassword()} disabled={resettingPw}>
                {resettingPw ? "Mereset…" : "Reset ke 11111111"}
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      {/* Modal Konfirmasi Hapus */}
      <Sheet open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Hapus akun pengguna">
        {deleteTarget && (
          <div className="space-y-4">
            <Item className="soft-inset flex items-start gap-2.5 rounded-2xl p-3.5 text-xs text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {deleteTarget.residentId ? (
                <span>
                  Sesuai kriteria <strong>A-03</strong>: Profil wajah dan akun login{" "}
                  <strong>{formatDisplayName(deleteTarget)}</strong> ({deleteTarget.username}) akan dihapus, namun{" "}
                  <strong>riwayat presensi yang sudah tercatat tetap dipertahankan</strong>.
                </span>
              ) : (
                <span>
                  Akun petugas <strong>@{deleteTarget.username}</strong> ({formatRoleLabel(deleteTarget.role)}) akan
                  dihapus permanen. Sesi atau log historis yang pernah dibuat tetap aman tercatat.
                </span>
              )}
            </Item>
            <div className="flex gap-2.5">
              <Button variant="glass" block onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Batal
              </Button>
              <Button variant="danger" block onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? "Menghapus…" : "Hapus Pengguna"}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </Page>
  );
}
