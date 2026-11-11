/**
 * CircleMenu — adapted from the provided component.
 * Project changes:
 *  - `motion/react` instead of `framer-motion` (same API, already installed; avoids two copies)
 *  - items are buttons with `onSelect` (SPA navigation) instead of <a href> wrapping a <button>
 *  - labels are always visible when open: there is no hover on phones
 *  - every item has an accessible name; trigger exposes aria-expanded
 *  - colours come from project tokens; honours reduced motion
 */
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const CONSTANTS = {
  itemSize: 52,
  containerSize: 236,
  openStagger: 0.03,
  closeStagger: 0.06,
};

const pointOnCircle = (i: number, n: number, r: number, cx = 0, cy = 0) => {
  const theta = (2 * Math.PI * i) / n - Math.PI / 2;
  return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
};

export interface CircleMenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

interface MenuItemProps extends CircleMenuItem {
  index: number;
  totalItems: number;
  isOpen: boolean;
}

const MenuItem = ({ icon, label, onSelect, index, totalItems, isOpen }: MenuItemProps) => {
  const { x, y } = pointOnCircle(index, totalItems, CONSTANTS.containerSize / 2 - CONSTANTS.itemSize / 2);
  return (
    <motion.button
      type="button"
      aria-label={label}
      tabIndex={isOpen ? 0 : -1}
      aria-hidden={!isOpen}
      onClick={onSelect}
      initial={false}
      animate={{ x: isOpen ? x : 0, y: isOpen ? y : 0, scale: isOpen ? 1 : 0.4, opacity: isOpen ? 1 : 0 }}
      whileTap={{ scale: 0.9 }}
      transition={{
        delay: isOpen ? index * CONSTANTS.openStagger : (totalItems - index) * CONSTANTS.closeStagger * 0.5,
        type: "spring",
        stiffness: 320,
        damping: 26,
      }}
      style={{ height: CONSTANTS.itemSize, width: CONSTANTS.itemSize }}
      className={cn(
        "soft-sm absolute flex items-center justify-center rounded-full text-primary",
        !isOpen && "pointer-events-none",
      )}
    >
      {icon}
      <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap font-display text-[11px] font-semibold text-foreground">{label}</span>
    </motion.button>
  );
};

interface MenuTriggerProps {
  setIsOpen: (isOpen: boolean) => void;
  isOpen: boolean;
  itemsLength: number;
  closeAnimationCallback: () => void;
  openIcon?: ReactNode;
  closeIcon?: ReactNode;
  label: string;
}

const MenuTrigger = ({ setIsOpen, isOpen, itemsLength, closeAnimationCallback, openIcon, closeIcon, label }: MenuTriggerProps) => {
  const animate = useAnimationControls();
  const shakeAnimation = useAnimationControls();
  const reduce = useReducedMotion();

  const scaleTransition = Array.from({ length: Math.max(1, itemsLength - 1) }, (_, index) => 1 + index * 0.12);

  // The original "wind-up" close: the trigger swells and shakes once per item, then snaps back.
  const closeAnimation = async () => {
    if (reduce) return;
    shakeAnimation.start({
      translateX: [0, 2, -2, 0, 2, -2, 0],
      transition: { duration: CONSTANTS.closeStagger, ease: "linear", repeat: Infinity, repeatType: "loop" },
    });
    for (let i = 0; i < scaleTransition.length; i++) {
      const size = Math.min(CONSTANTS.itemSize * scaleTransition[i], CONSTANTS.itemSize * 1.4);
      await animate.start({
        height: size,
        width: size,
        backgroundColor: `color-mix(in srgb, #211e55 ${Math.max(100 - i * 12, 40)}%, #c026d3)`,
        transition: { duration: CONSTANTS.closeStagger / 2, ease: "linear" },
      });
      if (i !== scaleTransition.length - 1) await new Promise((resolve) => setTimeout(resolve, CONSTANTS.closeStagger * 1000));
    }
    shakeAnimation.stop();
    shakeAnimation.start({ translateX: 0, transition: { duration: 0 } });
    animate.start({
      height: CONSTANTS.itemSize,
      width: CONSTANTS.itemSize,
      backgroundColor: "#211e55",
      transition: { duration: 0.12, ease: "backInOut" },
    });
  };

  return (
    <motion.div animate={shakeAnimation} className="z-50">
      <motion.button
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        animate={animate}
        whileTap={{ scale: 0.92 }}
        style={{ height: CONSTANTS.itemSize, width: CONSTANTS.itemSize, backgroundColor: "#211e55" }}
        className="z-50 flex items-center justify-center rounded-full text-white outline-none ring-[6px] ring-[#eeeff7] shadow-[0_14px_26px_-10px_rgba(20,16,60,.8),inset_0_2px_0_rgba(255,255,255,.14)] transition-[filter] duration-100 hover:brightness-125"
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
            closeAnimationCallback();
            closeAnimation();
          } else {
            setIsOpen(true);
          }
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={isOpen ? "menu-close" : "menu-open"}
            initial={{ opacity: 0, filter: "blur(8px)", rotate: -45 }}
            animate={{ opacity: 1, filter: "blur(0px)", rotate: 0 }}
            exit={{ opacity: 0, filter: "blur(8px)", rotate: 45 }}
            transition={{ duration: 0.2 }}
            className="flex"
          >
            {isOpen ? closeIcon : openIcon}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </motion.div>
  );
};

export const CircleMenu = ({
  items,
  label = "Menu aksi cepat",
  openIcon = <Menu size={20} />,
  closeIcon = <X size={20} />,
  defaultOpen = false,
  className,
}: {
  items: CircleMenuItem[];
  label?: string;
  openIcon?: ReactNode;
  closeIcon?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const animate = useAnimationControls();
  const reduce = useReducedMotion();

  const closeAnimationCallback = async () => {
    if (reduce) return;
    await animate.start({ rotate: -360, filter: "blur(1px)", transition: { duration: CONSTANTS.closeStagger * (items.length + 2), ease: "linear" } });
    await animate.start({ rotate: 0, filter: "blur(0px)", transition: { duration: 0 } });
  };

  return (
    <div style={{ width: CONSTANTS.containerSize, height: CONSTANTS.containerSize }} className={cn("relative flex items-center justify-center place-self-center", className)}>
      {/* orbit guide */}
      <motion.span
        aria-hidden
        initial={false}
        animate={{ scale: isOpen ? 1 : 0.3, opacity: isOpen ? 1 : 0 }}
        transition={{ type: "spring", bounce: 0.15, visualDuration: 0.4 }}
        className="soft-inset absolute rounded-full"
        style={{ inset: CONSTANTS.itemSize / 2 }}
      />
      <MenuTrigger
        setIsOpen={setIsOpen}
        isOpen={isOpen}
        itemsLength={items.length}
        closeAnimationCallback={closeAnimationCallback}
        openIcon={openIcon}
        closeIcon={closeIcon}
        label={label}
      />
      <motion.div animate={animate} className="absolute inset-0 z-0 flex items-center justify-center">
        {items.map((item, index) => (
          <MenuItem key={item.label} {...item} index={index} totalItems={items.length} isOpen={isOpen} />
        ))}
      </motion.div>
    </div>
  );
};
