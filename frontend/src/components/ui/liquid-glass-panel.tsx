import * as React from "react";
import LiquidGlass from "liquid-glass-react";
import { cn } from "@/lib/utils";

type LiquidGlassPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  radius?: number;
  strength?: "soft" | "default" | "strong";
  interactive?: boolean;
  effect?: "css" | "liquid" | "auto";
};

const GLASS_PARAMS = {
  soft: { displacementScale: 12, blurAmount: 0.014, saturation: 118, aberrationIntensity: 0.25, elasticity: 0.045 },
  default: { displacementScale: 18, blurAmount: 0.018, saturation: 126, aberrationIntensity: 0.35, elasticity: 0.065 },
  strong: { displacementScale: 24, blurAmount: 0.022, saturation: 134, aberrationIntensity: 0.5, elasticity: 0.085 },
} as const;

const shouldPreferCssGlass = () => {
  if (typeof window === "undefined") return true;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const narrowScreen = window.matchMedia("(max-width: 768px)").matches;
  const lowCoreCount = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const lowMemory = typeof deviceMemory === "number" && deviceMemory <= 4;

  return reducedMotion || narrowScreen || lowCoreCount || lowMemory;
};

const useLiquidGlassEnabled = (effect: LiquidGlassPanelProps["effect"]) => {
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    if (effect === "css") {
      setEnabled(false);
      return;
    }

    if (effect === "liquid") {
      setEnabled(!shouldPreferCssGlass());
      return;
    }

    setEnabled(!shouldPreferCssGlass());
  }, [effect]);

  return enabled;
};

export const LiquidGlassPanel = React.forwardRef<HTMLDivElement, LiquidGlassPanelProps>(
  ({ className, children, radius = 30, strength = "default", interactive = false, effect = "css", ...props }, ref) => {
    const params = GLASS_PARAMS[strength];
    const liquidEnabled = useLiquidGlassEnabled(effect);

    return (
      <div
        ref={ref}
        {...props}
        className={cn(
          "liquid-glass-panel group/liquid relative overflow-hidden rounded-[var(--glass-radius)] border border-white/14 bg-white/[0.035] text-foreground shadow-[0_18px_55px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-[background,border-color,box-shadow,transform] duration-200 ease-out",
          liquidEnabled && "liquid-glass-panel--active",
          interactive && "hover:-translate-y-px hover:border-white/24 hover:bg-white/[0.052] hover:shadow-[0_24px_72px_rgba(0,0,0,0.25)] active:translate-y-0 active:scale-[0.998]",
          className
        )}
        style={{ "--glass-radius": `${radius}px`, ...props.style } as React.CSSProperties}
      >
        {liquidEnabled ? (
          <LiquidGlass
            className="liquid-glass-fill pointer-events-none absolute left-1/2 top-1/2 h-full w-full opacity-45"
            style={{ position: "absolute", width: "100%", height: "100%" }}
            cornerRadius={radius}
            padding="0"
            mode="standard"
            {...params}
          >
            <span aria-hidden className="block h-full w-full" />
          </LiquidGlass>
        ) : null}
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(135deg,rgba(255,255,255,0.22),rgba(255,255,255,0.055)_38%,rgba(255,255,255,0.02)_62%,rgba(255,255,255,0.14))]" />
        <div className="pointer-events-none absolute inset-px rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(255,255,255,0.08)]" />
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);
LiquidGlassPanel.displayName = "LiquidGlassPanel";
