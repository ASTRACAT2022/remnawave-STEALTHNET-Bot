import * as React from "react";
import { Glass, type GlassOptics } from "@samasante/liquid-glass";
import { cn } from "@/lib/utils";

type GlassMaterial = "clear" | "regular" | "prominent" | "none";
type LegacyStrength = "soft" | "default" | "strong";

type LiquidGlassPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  radius?: number;
  strength?: LegacyStrength;
  material?: GlassMaterial;
  interactive?: boolean;
  effect?: "css" | "liquid" | "auto";
};

const strengthToMaterial: Record<LegacyStrength, GlassMaterial> = {
  soft: "clear",
  default: "regular",
  strong: "prominent",
};

const GLASS_OPTICS: Record<Exclude<GlassMaterial, "none">, Partial<GlassOptics>> = {
  clear: {
    strength: 0.09,
    depth: 0.42,
    curvature: 0.18,
    dispersion: 0.12,
    bend: 0.28,
    frost: 2.5,
    brightness: 1.04,
    sheen: 0.24,
    glow: 0.16,
  },
  regular: {
    strength: 0.12,
    depth: 0.52,
    curvature: 0.24,
    dispersion: 0.16,
    bend: 0.34,
    frost: 3.5,
    brightness: 1.06,
    sheen: 0.32,
    glow: 0.2,
  },
  prominent: {
    strength: 0.16,
    depth: 0.64,
    curvature: 0.32,
    dispersion: 0.22,
    bend: 0.42,
    frost: 4.5,
    brightness: 1.08,
    sheen: 0.42,
    glow: 0.26,
  },
};

const shouldPreferStaticGlass = () => {
  if (typeof window === "undefined") return true;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const narrowScreen = window.matchMedia("(max-width: 768px)").matches;
  const lowCoreCount = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const lowMemory = typeof deviceMemory === "number" && deviceMemory <= 4;

  return reducedMotion || narrowScreen || lowCoreCount || lowMemory;
};

const useOpticalGlass = (material: GlassMaterial, effect: LiquidGlassPanelProps["effect"]) => {
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    if (material === "none" || effect === "css") {
      setEnabled(false);
      return;
    }

    if (effect === "liquid") {
      setEnabled(!shouldPreferStaticGlass());
      return;
    }

    setEnabled(material === "prominent" && !shouldPreferStaticGlass());
  }, [effect, material]);

  return enabled;
};

export const LiquidGlassView = React.forwardRef<HTMLDivElement, LiquidGlassPanelProps>(
  (
    {
      className,
      children,
      radius = 30,
      strength = "default",
      material,
      interactive = false,
      effect: _effect,
      ...props
    },
    ref
  ) => {
    const resolvedMaterial = material ?? strengthToMaterial[strength];
    const opticalGlass = useOpticalGlass(resolvedMaterial, _effect);

    return (
      <div
        ref={ref}
        data-glass-material={resolvedMaterial}
        {...props}
        className={cn(
          "liquid-glass-panel liquid-glass-view relative overflow-hidden rounded-[var(--glass-radius)] border text-foreground transition-[background,border-color,box-shadow,transform,opacity] duration-180 ease-out",
          resolvedMaterial === "none" && "liquid-glass-view--none",
          resolvedMaterial === "clear" && "liquid-glass-view--clear",
          resolvedMaterial === "regular" && "liquid-glass-view--regular",
          resolvedMaterial === "prominent" && "liquid-glass-view--prominent",
          interactive && "liquid-glass-view--interactive",
          className
        )}
        style={{ "--glass-radius": `${radius}px`, ...props.style } as React.CSSProperties}
      >
        {opticalGlass && resolvedMaterial !== "none" ? (
          <Glass
            aria-hidden
            className="liquid-glass-view__optic"
            radius={radius}
            optics={GLASS_OPTICS[resolvedMaterial]}
            behind="transparent"
          >
            <span className="block h-full w-full" />
          </Glass>
        ) : null}
        <div className="liquid-glass-view__highlight" aria-hidden />
        <div className="liquid-glass-view__rim" aria-hidden />
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);

LiquidGlassView.displayName = "LiquidGlassView";

export const LiquidGlassPanel = LiquidGlassView;
