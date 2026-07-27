/**
 * StadiumButton — стадион-pill кнопки в стиле Stealth.
 *
 * Варианты (вдохновлено Hundler VPN):
 *   - primary    — solid red, белый текст, red glow вокруг
 *   - white      — БЕЛЫЙ фон, чёрный текст (для главного Buy CTA)
 *   - outline    — прозрачный, с border, белый текст
 *   - ghost      — без border, hover/active заливка
 *   - highlight  — тёмный + красный glow border (focused/recommended item)
 *
 * Радиус всегда `rounded-full` (полностью pill), высота 52px на mobile, 56px на md+.
 */

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "white" | "outline" | "ghost" | "highlight";
type Size = "md" | "lg" | "sm";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const VARIANT_STYLES: Record<Variant, string> = {
  primary:
    "bg-rose-600 text-white font-semibold shadow-sm hover:bg-rose-500 active:bg-rose-700",
  white:
    "bg-white text-zinc-950 font-semibold shadow-sm hover:bg-zinc-100 active:bg-zinc-200",
  outline:
    "bg-transparent text-white font-medium border border-slate-600 hover:bg-slate-800 active:bg-slate-900",
  ghost:
    "bg-slate-800 text-white font-medium border border-slate-700 hover:bg-slate-700 active:bg-slate-900",
  highlight:
    "bg-slate-800 text-white font-semibold border border-rose-500 shadow-sm hover:bg-slate-700 active:bg-slate-900",
};

const SIZE_STYLES: Record<Size, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-13 px-5 text-sm md:h-14 md:px-6 md:text-base",
  lg: "h-14 px-6 text-base md:h-16 md:px-8",
};

export const StadiumButton = forwardRef<HTMLButtonElement, Props>(function StadiumButton(
  { variant = "primary", size = "md", fullWidth = true, iconLeft, iconRight, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-xl transition-colors duration-150",
        "disabled:opacity-50 disabled:pointer-events-none",
        "focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:ring-offset-2 focus:ring-offset-[#020202]",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
});
