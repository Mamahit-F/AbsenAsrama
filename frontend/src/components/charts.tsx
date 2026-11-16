import { useId } from "react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import { easeOut } from "./ui";

/* ---------- Gradient ring (reference: 75% donut with an inner soft disc) ---------- */
export function Ring({ value, size = 96, stroke = 10, dark, children }: { value: number; size?: number; stroke?: number; dark?: boolean; children?: React.ReactNode }) {
  const id = useId();
  const r = (size - stroke) / 2;
  const inner = size - stroke * 2 - 10;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={`rg-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3CC4AE" />
            <stop offset="0.52" stopColor="#0E8F7E" />
            <stop offset="1" stopColor="#0A5C51" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track, #d6d8e9)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#rg-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: Math.max(0.001, value) }}
          transition={{ duration: 0.75, ease: easeOut, delay: 0.05 }}
        />
      </svg>
      {inner > 20 && (
        <span
          className="absolute rounded-full"
          style={{
            width: inner,
            height: inner,
            background: dark ? "var(--ring-inner-bg, linear-gradient(145deg,#f6f6fc,#e3e4ef))" : "var(--ring-inner-bg, linear-gradient(145deg,#f6f6fc,#e3e4ef))",
            boxShadow: "var(--icon-well-shadow, var(--sh-raise-sm))",
          }}
          aria-hidden
        />
      )}
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/* ---------- Metric bar with knob (reference: 71% slider) ---------- */
export function MetricBar({ label, value, target, unit = "%", lowerIsBetter = true, max = 20 }: { label: string; value: number; target: number; unit?: string; lowerIsBetter?: boolean; max?: number }) {
  const pass = lowerIsBetter ? value <= target : value >= target;
  const pct = Math.min(1, value / max) * 100;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="font-display text-[14px] tabular">
          <span className={cn("font-semibold", pass ? "text-success" : "text-danger")}>
            {value}
            {unit}
          </span>
          <span className="text-subtle">
            {" "}
            / maks {target}
            {unit}
          </span>
        </span>
      </div>
      <div className="soft-inset relative h-3 rounded-full">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: pass ? "var(--grad-accent)" : "linear-gradient(90deg,#fb7185,#be123c)" }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.65, ease: easeOut }}
        />
        <span className="absolute -top-1 h-5 w-0.5 rounded-full bg-foreground/50" style={{ left: `${(target / max) * 100}%` }} aria-hidden />
      </div>
    </div>
  );
}
