/**
 * CinematicFooter — adapted from the provided "motion-footer" component.
 * Project changes:
 *  - content is props-driven (Indonesian copy, app actions instead of store links)
 *  - pinned to the 430px app column instead of the full window
 *  - project tokens + fonts (no external @import, no emoji icons)
 *  - GSAP scroll effects are skipped when the user prefers reduced motion
 *  - magnetic hover only runs on devices that actually hover (fine pointer)
 */
import * as React from "react";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const STYLES = `
.cine-footer {
  --pill-bg: rgba(255,255,255,.07);
  --pill-border: rgba(255,255,255,.14);
  --pill-border-hover: rgba(255,255,255,.32);
}
@keyframes cine-breathe {
  0% { transform: translate(-50%, -50%) scale(1); opacity: .55; }
  100% { transform: translate(-50%, -50%) scale(1.15); opacity: .95; }
}
.cine-breathe { animation: cine-breathe 7s ease-in-out infinite alternate; }
.cine-grid {
  background-size: 30px 30px;
  background-image:
    linear-gradient(to right, rgba(184,181,245,.07) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(184,181,245,.07) 1px, transparent 1px);
  mask-image: linear-gradient(to bottom, transparent, black 30%, black 70%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, black 30%, black 70%, transparent);
}
.cine-aurora {
  background: radial-gradient(circle at 50% 50%, rgba(217,70,239,.45) 0%, rgba(124,58,237,.35) 38%, transparent 70%);
}
.cine-pill {
  background: var(--pill-bg);
  border: 1px solid var(--pill-border);
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.12);
  transition: border-color .35s cubic-bezier(.16,1,.3,1), background-color .35s cubic-bezier(.16,1,.3,1);
}
.cine-pill:hover { border-color: var(--pill-border-hover); background: rgba(255,255,255,.12); }
.cine-pill-solid { background: var(--grad-accent); color: white; box-shadow: 0 16px 30px -14px rgba(217,70,239,.8); }
.cine-giant {
  font-family: var(--font-display);
  font-size: 34vw;
  line-height: .75;
  font-weight: 800;
  letter-spacing: -0.05em;
  color: transparent;
  -webkit-text-stroke: 1px rgba(196,181,253,.18);
  background: linear-gradient(180deg, rgba(196,181,253,.22) 0%, transparent 70%);
  -webkit-background-clip: text;
  background-clip: text;
}
@media (min-width: 430px) { .cine-giant { font-size: 146px; } }
`;

/* ---------- Magnetic button ---------- */
export type MagneticButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    as?: React.ElementType;
  };

export const MagneticButton = React.forwardRef<HTMLElement, MagneticButtonProps>(({ className, children, as: Component = "button", ...props }, forwardedRef) => {
  const localRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = localRef.current;
    if (!element || !canHover() || prefersReducedMotion()) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      gsap.to(element, { x: x * 0.3, y: y * 0.3, rotationX: -y * 0.12, rotationY: x * 0.12, scale: 1.04, ease: "power2.out", duration: 0.4 });
    };
    const handleMouseLeave = () => {
      gsap.to(element, { x: 0, y: 0, rotationX: 0, rotationY: 0, scale: 1, ease: "elastic.out(1, 0.3)", duration: 1.2 });
    };
    element.addEventListener("mousemove", handleMouseMove);
    element.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      element.removeEventListener("mousemove", handleMouseMove);
      element.removeEventListener("mouseleave", handleMouseLeave);
      gsap.killTweensOf(element);
    };
  }, []);

  return (
    <Component
      ref={(node: HTMLElement | null) => {
        localRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      className={cn("cursor-pointer", className)}
      {...props}
    >
      {children}
    </Component>
  );
});
MagneticButton.displayName = "MagneticButton";

/* ---------- Footer ---------- */
export interface FooterAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}

export function CinematicFooter({
  heading,
  sub,
  primary,
  secondary,
  links = [],
  marquee,
  giantText = "HADIR",
  credit,
}: {
  heading: React.ReactNode;
  sub?: string;
  primary: FooterAction;
  secondary?: FooterAction;
  links?: FooterAction[];
  marquee: string[];
  giantText?: string;
  credit?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const giantTextRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wrapperRef.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        giantTextRef.current,
        { y: "8vh", scale: 0.85, opacity: 0 },
        { y: "0vh", scale: 1, opacity: 1, ease: "power1.out", scrollTrigger: { trigger: wrapperRef.current, start: "top 85%", end: "bottom bottom", scrub: 1 } },
      );
      gsap.fromTo(
        [headingRef.current, linksRef.current],
        { y: 48, opacity: 0 },
        { y: 0, opacity: 1, stagger: 0.15, ease: "power3.out", scrollTrigger: { trigger: wrapperRef.current, start: "top 55%", end: "bottom bottom", scrub: 1 } },
      );
    }, wrapperRef);
    return () => ctx.revert();
  }, []);

  const row = [...marquee, ...marquee];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      {/* Curtain-reveal wrapper: in normal flow, clips the fixed footer to its own box. */}
      <div ref={wrapperRef} className="relative h-[100dvh] w-full" style={{ clipPath: "polygon(0% 0, 100% 0%, 100% 100%, 0 100%)" }}>
        <footer style={{ background: "var(--grad-night)" }} className="cine-footer fixed inset-x-0 bottom-0 mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col justify-between overflow-hidden text-white">
          <div className="cine-aurora cine-breathe pointer-events-none absolute left-1/2 top-1/2 z-0 h-[55vh] w-[120%] rounded-[50%] blur-[70px]" />
          <div className="cine-grid pointer-events-none absolute inset-0 z-0" />

          <div ref={giantTextRef} className="cine-giant pointer-events-none absolute -bottom-[3vh] left-1/2 z-0 -translate-x-1/2 select-none whitespace-nowrap" aria-hidden>
            {giantText}
          </div>

          {/* diagonal marquee */}
          <div className="absolute left-0 top-14 z-10 w-full -rotate-3 scale-110 overflow-hidden border-y border-white/10 bg-[#14123a]/80 py-3" aria-hidden>
            <div className="marquee flex w-max">
              {row.map((t, i) => (
                <span key={i} className="flex items-center gap-6 px-3 font-display text-[12px] font-medium uppercase tracking-[0.18em] text-night-muted">
                  {t}
                  <span className="size-1.5 rounded-full bg-[#e879f9]" />
                </span>
              ))}
            </div>
          </div>

          <div className="relative z-10 mx-auto mt-24 flex w-full flex-1 flex-col items-center justify-center px-6">
            <div ref={headingRef} className="text-center">
              <h2 className="text-[52px] font-bold leading-[0.95] tracking-[-0.04em] text-white">{heading}</h2>
              {sub && <p className="mx-auto mt-4 max-w-[30ch] text-[15px] text-night-muted">{sub}</p>}
            </div>

            <div ref={linksRef} className="mt-9 flex w-full flex-col items-center gap-3">
              <MagneticButton onClick={primary.onClick} className="cine-pill-solid flex h-14 w-full items-center justify-center gap-2.5 rounded-full font-display text-base font-semibold">
                {primary.icon}
                {primary.label}
              </MagneticButton>
              {secondary && (
                <MagneticButton onClick={secondary.onClick} className="cine-pill flex h-14 w-full items-center justify-center gap-2.5 rounded-full font-display text-base font-semibold">
                  {secondary.icon}
                  {secondary.label}
                </MagneticButton>
              )}
              {links.length > 0 && (
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {links.map((l) => (
                    <MagneticButton key={l.label} onClick={l.onClick} className="cine-pill h-10 rounded-full px-5 text-[13px] font-medium">
                      {l.label}
                    </MagneticButton>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="relative z-20 flex w-full items-center justify-between gap-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <p className="font-display text-[11px] text-night-muted">{credit ?? `© ${new Date().getFullYear()} Asrama UNKLAB`}</p>
            <MagneticButton
              onClick={() => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" })}
              aria-label="Kembali ke atas"
              className="cine-pill group grid size-12 place-items-center rounded-full"
            >
              <ArrowUp className="size-5 transition-transform duration-300 group-hover:-translate-y-1" aria-hidden />
            </MagneticButton>
          </div>
        </footer>
      </div>
    </>
  );
}
