import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useInView, useReducedMotion, type HTMLMotionProps, type Variants } from "motion/react";
import { ChevronDown, Loader2, X, type LucideIcon } from "lucide-react";
import { cn, initials } from "../../lib/utils";

/* ==========================================================================
   Motion tokens — springs for anything the finger touches, eased curves for
   entrances. Exits always shorter than entrances.
   ========================================================================== */
export const spring = { type: "spring", bounce: 0.22, visualDuration: 0.4 } as const;
export const springSnappy = { type: "spring", bounce: 0.18, visualDuration: 0.24 } as const;
export const easeOut = [0.16, 1, 0.3, 1] as const;

/* Elements entering the viewport in the same frame cascade instead of popping together. */
let lastReveal = 0;
let revealIdx = 0;
function nextRevealDelay() {
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  if (now - lastReveal > 90) revealIdx = 0;
  lastReveal = now;
  return Math.min(revealIdx++, 9) * 0.06;
}
export const reveal: Variants = {
  hidden: { opacity: 0, y: 22, scale: 0.97 },
  show: () => ({ opacity: 1, y: 0, scale: 1, transition: { ...spring, delay: nextRevealDelay() } }),
};
export const inViewProps = { initial: "hidden", whileInView: "show", viewport: { once: true, margin: "0px 0px -6% 0px" } } as const;
export const list = { hidden: {}, show: {} };
export const item = reveal;

/* ---------- Gradient icon paints (rendered once in App) ---------- */
export function GradientDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        <linearGradient id="g-violet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d946ef" />
          <stop offset="1" stopColor="#5b21b6" />
        </linearGradient>
        <linearGradient id="g-amber" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#ea7a0c" />
        </linearGradient>
        <linearGradient id="g-sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id="g-rose" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb7185" />
          <stop offset="1" stopColor="#be185d" />
        </linearGradient>
        <linearGradient id="g-mint" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
      </defs>
    </svg>
  );
}
export type Paint = "violet" | "amber" | "sky" | "rose" | "mint";

/** Raised squircle with a gradient-stroked icon — the "3D icon" tiles from the references. */
export function IconTile({ icon: I, paint = "violet", size = 56, className, night }: { icon: LucideIcon; paint?: Paint; size?: number; className?: string; night?: boolean }) {
  return (
    <span
      className={cn("grid shrink-0 place-items-center", night ? "night-card" : "soft-sm", className)}
      style={{ width: size, height: size, borderRadius: size * 0.36 }}
      aria-hidden
    >
      <I style={{ width: size * 0.46, height: size * 0.46 }} stroke={`url(#g-${paint})`} strokeWidth={2.2} />
    </span>
  );
}

/* ---------- Button ---------- */
type BtnVariant = "primary" | "glass" | "ghost" | "danger" | "light";
interface BtnProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: BtnVariant;
  size?: "md" | "lg" | "sm";
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  block?: boolean;
}
const variants: Record<BtnVariant, string> = {
  primary: "grad-accent",
  glass: "soft-sm text-foreground",
  light: "bg-white text-night shadow-[0_12px_26px_-14px_rgba(0,0,0,.6)]",
  ghost: "text-primary hover:bg-primary-soft",
  danger: "bg-gradient-to-r from-[#e0446a] to-[#9f1239] text-white shadow-[0_12px_24px_-12px_rgba(190,24,93,.7)]",
};
const sizes = { sm: "h-10 px-4 text-sm", md: "h-12 px-6 text-[15px]", lg: "h-14 px-7 text-base" };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "primary", size = "md", loading, icon, children, block, className, disabled, ...rest },
  ref,
) {
  const off = disabled || loading;
  return (
    <motion.button
      ref={ref}
      whileTap={off ? undefined : { scale: 0.96 }}
      whileHover={off ? undefined : { y: -1 }}
      transition={springSnappy}
      disabled={off}
      className={cn(
        "relative inline-flex select-none items-center justify-center gap-2 rounded-full font-display font-semibold tracking-[-0.01em] transition-[opacity,filter] duration-200 hover:brightness-[1.06] disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50",
        variants[variant],
        sizes[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {loading ? (
          <motion.span key="l" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
            <Loader2 className="spin size-5" aria-hidden />
          </motion.span>
        ) : (
          icon && (
            <motion.span key="i" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} className="flex">
              {icon}
            </motion.span>
          )
        )}
      </AnimatePresence>
      {children}
    </motion.button>
  );
});

export function IconButton({ label, children, className, tone = "glass", ...rest }: HTMLMotionProps<"button"> & { label: string; tone?: "glass" | "navy" | "plain" | "solid" }) {
  return (
    <motion.button
      aria-label={label}
      whileTap={{ scale: 0.88 }}
      transition={springSnappy}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full transition-[filter] duration-200",
        tone === "glass" && "soft-sm text-foreground",
        tone === "navy" && "night-card text-white",
        tone === "plain" && "text-primary hover:bg-primary-soft",
        tone === "solid" && "grad-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/* ---------- Surfaces ---------- */
export function Card({ className, children, navy, ...rest }: HTMLMotionProps<"div"> & { navy?: boolean }) {
  return (
    <motion.div variants={reveal} {...inViewProps} className={cn(navy ? "glass-navy" : "soft", "rounded-[var(--radius-card)] p-5", className)} {...rest}>
      {children}
    </motion.div>
  );
}

export function PressCard({ className, children, ...rest }: HTMLMotionProps<"button">) {
  return (
    <motion.button
      variants={reveal}
      {...inViewProps}
      whileTap={{ scale: 0.97 }}
      transition={springSnappy}
      className={cn("soft w-full rounded-[var(--radius-card)] p-5 text-left transition-shadow duration-200 active:shadow-[var(--sh-inset)]", className)}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
export function Item({ children, className, ...rest }: HTMLMotionProps<"div">) {
  return (
    <motion.div variants={reveal} {...inViewProps} className={className} {...rest}>
      {children}
    </motion.div>
  );
}
export const Reveal = Item;

/** Count up once when scrolled into view. */
export function Num({ value, decimals = 0, suffix = "", className }: { value: number; decimals?: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (!seen || reduce) {
      setShown(value);
      return;
    }
    const c = animate(0, value, { duration: 1, ease: easeOut, onUpdate: setShown });
    return () => c.stop();
  }, [seen, value, reduce]);
  return (
    <span ref={ref} className={cn("tabular", className)}>
      {shown.toLocaleString("id-ID", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return <span className={cn("live-dot shrink-0", className)} aria-hidden />;
}

/* ---------- Badge ---------- */
type Tone = "success" | "danger" | "warning" | "info" | "neutral" | "navy";
const tones: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  info: "bg-primary-soft text-primary",
  neutral: "soft-inset text-muted",
  navy: "bg-white/12 text-white",
};
export function Badge({ tone = "neutral", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
export function methodTone(m: string): Tone {
  return m === "Scan" ? "info" : m === "Manual" ? "warning" : "success";
}

/* ---------- Avatar ---------- */
const AVATAR_GRAD = [
  "linear-gradient(135deg,#a78bfa,#6d28d9)",
  "linear-gradient(135deg,#f0abfc,#a21caf)",
  "linear-gradient(135deg,#93c5fd,#4338ca)",
  "linear-gradient(135deg,#fda4af,#be185d)",
];
export function Avatar({ name, size = 44, className }: { name: string; size?: number; className?: string }) {
  const bg = AVATAR_GRAD[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_GRAD.length];
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-display font-semibold text-white ring-[3px] ring-white/70", className)}
      style={{ width: size, height: size, fontSize: size * 0.36, background: bg }}
    >
      {initials(name)}
    </span>
  );
}

/* ---------- Form fields (inset wells) ---------- */
const well = "soft-inset flex h-14 items-center gap-3 rounded-2xl px-4 transition-shadow duration-200 focus-within:shadow-[var(--sh-inset),0_0_0_2px_#a78bfa]";
const wellErr = "shadow-[var(--sh-inset),0_0_0_2px_#e0446a]";

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
}
export function Field({ label, error, hint, icon, trailing, className, id, ...rest }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={className}>
      <label htmlFor={fid} className="mb-2 ml-1 block text-[13px] font-semibold text-muted">
        {label}
      </label>
      <div className={cn(well, error && wellErr)}>
        {icon && (
          <span className="text-subtle" aria-hidden>
            {icon}
          </span>
        )}
        <input
          id={fid}
          aria-invalid={!!error}
          aria-describedby={error ? `${fid}-e` : hint ? `${fid}-h` : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-medium text-foreground outline-none placeholder:font-normal placeholder:text-subtle"
          {...rest}
        />
        {trailing}
      </div>
      <FieldMsg id={fid} error={error} hint={hint} />
    </div>
  );
}

function FieldMsg({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {error ? (
        <motion.p key="e" id={`${id}-e`} role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="ml-1 mt-1.5 text-[13px] font-medium text-danger">
          {error}
        </motion.p>
      ) : hint ? (
        <motion.p key="h" id={`${id}-h`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="ml-1 mt-1.5 text-[13px] text-muted">
          {hint}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

export function TextArea({ label, error, hint, className, id, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={className}>
      <label htmlFor={fid} className="mb-2 ml-1 block text-[13px] font-semibold text-muted">
        {label}
      </label>
      <textarea
        id={fid}
        rows={3}
        aria-invalid={!!error}
        className={cn(
          "soft-inset w-full resize-none rounded-2xl px-4 py-3.5 text-[15px] font-medium outline-none transition-shadow placeholder:font-normal placeholder:text-subtle focus:shadow-[var(--sh-inset),0_0_0_2px_#a78bfa]",
          error && wellErr,
        )}
        {...rest}
      />
      <FieldMsg id={fid} error={error} hint={hint} />
    </div>
  );
}

export function SelectField({ label, children, className, id, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={className}>
      <label htmlFor={fid} className="mb-2 ml-1 block text-[13px] font-semibold text-muted">
        {label}
      </label>
      <div className={cn(well, "relative px-0")}>
        <select id={fid} className="h-full w-full appearance-none bg-transparent px-4 pr-10 text-[15px] font-medium outline-none" {...rest}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 size-4 text-muted" aria-hidden />
      </div>
    </div>
  );
}

/* ---------- Segmented: inset track, raised thumb ---------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  dark,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  dark?: boolean;
}) {
  const id = useId();
  return (
    <div role="tablist" className={cn("flex rounded-full p-1.5", dark ? "night-inset" : "soft-inset", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-3 font-display text-[14px] font-semibold transition-colors duration-200",
              on ? (dark ? "text-night" : "text-primary") : dark ? "text-night-muted hover:text-white" : "text-muted hover:text-foreground",
            )}
          >
            {on && <motion.span layoutId={`seg-${id}`} transition={spring} className={cn("absolute inset-0 rounded-full", dark ? "bg-white" : "soft-sm")} />}
            <span className="relative">{o.label}</span>
            {o.count !== undefined && <span className={cn("relative rounded-full px-1.5 text-[11px] tabular", on ? "bg-primary-soft" : "bg-black/5")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Chip ---------- */
export function Chip({ on, children, onClick, className }: { on?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      transition={springSnappy}
      onClick={onClick}
      aria-pressed={on}
      className={cn("h-10 shrink-0 rounded-full px-4 font-display text-[13px] font-semibold transition-colors duration-200", on ? "grad-accent" : "soft-sm text-muted hover:text-foreground", className)}
    >
      {children}
    </motion.button>
  );
}

/* ---------- Switch: the "ON" pill from the reference ---------- */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative flex h-8 w-[58px] shrink-0 items-center rounded-full p-1 transition-colors duration-300", checked ? "grad-accent" : "soft-inset")}
    >
      <span className={cn("absolute font-display text-[10px] font-bold transition-opacity duration-200", checked ? "left-2 text-white opacity-100" : "right-2 text-subtle opacity-100")}>
        {checked ? "ON" : "OFF"}
      </span>
      <motion.span layout transition={springSnappy} className={cn("relative block size-6 rounded-full bg-[#f6f6fc] shadow-[2px_3px_6px_rgba(40,30,90,.35)]", checked && "ml-auto")} />
    </button>
  );
}

/* ---------- Bottom sheet ---------- */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div className="absolute inset-0 bg-[#120f33]/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }} onClick={onClose} />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: "spring", bounce: 0.12, visualDuration: 0.45 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => (i.offset.y > 120 || i.velocity.y > 600) && onClose()}
            className="relative max-h-[88dvh] w-full max-w-[430px] overflow-y-auto rounded-t-[34px] bg-surface px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
          >
            <div className="mx-auto mb-3 h-1.5 w-11 rounded-full soft-inset" aria-hidden />
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">{title}</h2>
              <IconButton label="Tutup" onClick={onClose} className="size-10">
                <X className="size-5" aria-hidden />
              </IconButton>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Section title ---------- */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <motion.div {...inViewProps} variants={{ hidden: {}, show: {} }} className="mb-4 mt-9 flex items-center justify-between gap-3">
      <motion.h2 variants={reveal} className="flex items-center gap-2.5 text-[19px] font-semibold">
        <motion.span
          aria-hidden
          variants={{ hidden: { scaleY: 0 }, show: { scaleY: 1, transition: { ...spring, delay: 0.05 } } }}
          className="h-5 w-1.5 origin-bottom rounded-full"
          style={{ background: "var(--grad-accent)" }}
        />
        {children}
      </motion.h2>
      {action && <motion.div variants={reveal}>{action}</motion.div>}
    </motion.div>
  );
}

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <Item className="soft-inset flex flex-col items-center rounded-[var(--radius-card)] px-6 py-10 text-center">
      <div className="soft-sm mb-4 grid size-14 place-items-center rounded-[20px] text-primary">{icon}</div>
      <p className="font-display text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </Item>
  );
}

export function Countdown({ until, className }: { until: number; className?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((until - now) / 1000));
  return <span className={cn("tabular font-display", className)}>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-[10px] transition-all duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-primary",
          checked ? "grad-accent" : "soft-inset",
        )}
      >
        <motion.svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="white" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: checked ? 1 : 0 }} transition={{ duration: 0.25 }} />
        </motion.svg>
      </span>
      <span className="text-sm font-medium leading-snug">{children}</span>
    </label>
  );
}

/* ---------- Slider-style progress (reference: 71% bar with knob) ---------- */
export function Meter({ value, className, night }: { value: number; className?: string; night?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={cn("relative h-3 rounded-full", night ? "night-inset" : "soft-inset", className)}>
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: "var(--grad-accent)" }}
        initial={{ width: "0%" }}
        whileInView={{ width: `${v * 100}%` }}
        viewport={{ once: true }}
        transition={{ duration: 1.1, ease: easeOut, delay: 0.15 }}
      />
      <motion.span
        className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-[#7c83f7] shadow-[0_3px_8px_rgba(60,40,140,.45)]"
        initial={{ left: "0%" }}
        whileInView={{ left: `${v * 100}%` }}
        viewport={{ once: true }}
        transition={{ duration: 1.1, ease: easeOut, delay: 0.15 }}
        aria-hidden
      />
    </div>
  );
}
