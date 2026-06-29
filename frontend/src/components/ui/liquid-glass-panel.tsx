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
    strength: 0.1,
    depth: 0.44,
    curvature: 0.38,
    dispersion: 0.2,
    bend: 0.22,
    frost: 0.4,
    brightness: 0.4,
    sheen: 0.06,
    glow: 0.01,
  },
  regular: {
    strength: 0.14,
    depth: 0.5,
    curvature: 0.55,
    dispersion: 0.32,
    bend: 0.28,
    frost: 0.45,
    brightness: 0.45,
    sheen: 0.08,
    glow: 0.02,
  },
  prominent: {
    strength: 0.2,
    depth: 0.6,
    curvature: 0.65,
    dispersion: 0.4,
    bend: 0.34,
    frost: 0.6,
    brightness: 0.5,
    sheen: 0.1,
    glow: 0.03,
  },
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
        {resolvedMaterial !== "none" ? (
          <Glass
            aria-hidden
            className="liquid-glass-view__optic"
            radius={radius}
            optics={GLASS_OPTICS[resolvedMaterial]}
          >
            <span className="block h-full w-full" />
          </Glass>
        ) : null}
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);

LiquidGlassView.displayName = "LiquidGlassView";

export const LiquidGlassPanel = LiquidGlassView;
