import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, CalendarClock, LogIn, ScanFace, ShieldCheck, ShieldUser, UserPlus, UserRound, UsersRound } from "lucide-react";
import { NightHeader, Page, ScanArt } from "../../components/layout";
import { Button, IconTile, Item, LiveDot, SectionTitle, easeOut, spring, type Paint } from "../../components/ui";
import { CinematicFooter } from "../../components/ui/motion-footer";
import { wita } from "../../lib/utils";

const STEPS: { icon: typeof ScanFace; paint: Paint; title: string; text: string }[] = [
  { icon: CalendarClock, paint: "amber", title: "Sesi dibuka", text: "Tombol presensi aktif tepat di jam mulai sesi." },
  { icon: ShieldCheck, paint: "violet", title: "Liveness", text: "Memastikan wajah asli, bukan foto atau rekaman." },
  { icon: ScanFace, paint: "sky", title: "Dicocokkan", text: "Hadir tercatat dalam hitungan detik." },
];

const ROLES: { k: string; d: string; icon: typeof ScanFace; paint: Paint }[] = [
  { k: "Penghuni", d: "Presensi mandiri & riwayat", icon: UserRound, paint: "violet" },
  { k: "Penjaga", d: "Pantau sesi & bantu scan", icon: UsersRound, paint: "amber" },
  { k: "Admin", d: "Data, akun & audit", icon: ShieldUser, paint: "rose" },
];

export default function Welcome() {
  const nav = useNavigate();
  const w = wita();
  const words = ["Hadir", "cukup", "dengan"];

  return (
    <Page nav={false} className="!pb-0">
      <NightHeader className="pb-24">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOut }} className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2.5">
            <span className="night-card grid size-10 place-items-center rounded-2xl">
              <ScanFace className="size-5" stroke="url(#g-violet)" strokeWidth={2.4} aria-hidden />
            </span>
            <span className="font-display text-[17px] font-semibold text-white">Presensi Asrama</span>
          </div>
          <span className="night-inset flex items-center gap-2 rounded-full px-3 py-1.5 font-display text-xs text-night-ink tabular">
            <LiveDot /> {w.time} WITA
          </span>
        </motion.div>

        <h1 className="mt-10 text-[46px] font-bold leading-[1] tracking-[-0.035em] text-white" aria-label="Hadir cukup dengan wajahmu.">
          {words.map((word, i) => (
            <span key={word} className="inline-block overflow-hidden pb-1 align-bottom">
              <motion.span aria-hidden className="inline-block" initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ duration: 0.75, ease: easeOut, delay: 0.15 + i * 0.08 }}>
                {word}&nbsp;
              </motion.span>
            </span>
          ))}
          <span className="inline-block overflow-hidden pb-1 align-bottom">
            <motion.span
              aria-hidden
              className="inline-block bg-gradient-to-r from-[#f0abfc] via-[#c084fc] to-[#818cf8] bg-clip-text text-transparent"
              initial={{ y: "110%" }}
              animate={{ y: 0 }}
              transition={{ duration: 0.75, ease: easeOut, delay: 0.4 }}
            >
              wajahmu.
            </motion.span>
          </span>
        </h1>
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOut, delay: 0.55 }} className="mt-4 max-w-[30ch] text-[15px] leading-relaxed text-night-muted">
          Presensi sesi asrama UNKLAB diverifikasi liveness dan pengenalan wajah. Tidak bisa dititipkan.
        </motion.p>
      </NightHeader>

      <section className="-mt-6">
        <ScanArt className="w-64" />
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.6 }} className="mt-8 space-y-4">
          <Button block size="lg" onClick={() => nav("/masuk")} icon={<LogIn className="size-5" />}>
            Masuk
          </Button>
          <Button block size="lg" variant="glass" onClick={() => nav("/daftar")} icon={<UserPlus className="size-5" />}>
            Buat akun penghuni
          </Button>
        </motion.div>
      </section>

      <SectionTitle>Cara kerjanya</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        {STEPS.map((s, i) => (
          <Item key={s.title} className="flex flex-col items-center text-center">
            <motion.div whileTap={{ scale: 0.92 }}>
              <IconTile icon={s.icon} paint={s.paint} size={84} />
            </motion.div>
            <span className="mt-3 font-display text-[11px] font-semibold text-subtle tabular">0{i + 1}</span>
            <h3 className="font-display text-[15px] font-semibold">{s.title}</h3>
            <p className="mt-1 text-[12px] leading-snug text-muted">{s.text}</p>
          </Item>
        ))}
      </div>

      <SectionTitle>Masuk sebagai</SectionTitle>
      <div className="space-y-3 pb-10">
        {ROLES.map((r) => (
          <Item key={r.k}>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => nav(`/masuk?peran=${r.k.toLowerCase()}`)}
              className="soft flex w-full items-center gap-4 rounded-[26px] p-3 pr-5 text-left active:shadow-[var(--sh-inset)]"
            >
              <IconTile icon={r.icon} paint={r.paint} size={52} />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[16px] font-semibold">{r.k}</span>
                <span className="block truncate text-[13px] text-muted">{r.d}</span>
              </span>
              <span className="soft-inset grid size-9 place-items-center rounded-full text-primary">
                <ArrowRight className="size-4" aria-hidden />
              </span>
            </motion.button>
          </Item>
        ))}
      </div>

      <div className="-mx-5">
        <CinematicFooter
          heading={
            <>
              Siap
              <br />
              hadir?
            </>
          }
          sub="Masuk dengan NIM, atau buat akun jika NIM Anda ada di daftar penghuni resmi."
          primary={{ label: "Masuk sekarang", onClick: () => nav("/masuk"), icon: <LogIn className="size-5" aria-hidden /> }}
          secondary={{ label: "Buat akun penghuni", onClick: () => nav("/daftar"), icon: <UserPlus className="size-5" aria-hidden /> }}
          links={[
            { label: "Penjaga", onClick: () => nav("/masuk?peran=penjaga") },
            { label: "Admin", onClick: () => nav("/masuk?peran=admin") },
          ]}
          marquee={["Liveness anti-spoofing", "Pengenalan wajah", "Sesi terjadwal", "Waktu WITA", "Rekap CSV", "Audit log"]}
          giantText="HADIR"
        />
      </div>
    </Page>
  );
}
