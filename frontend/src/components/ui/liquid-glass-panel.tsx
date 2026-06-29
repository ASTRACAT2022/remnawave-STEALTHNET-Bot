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
  showRipples?: boolean;
  showBubbles?: boolean;
  effect?: "css" | "liquid" | "auto";
};

const strengthToMaterial: Record<LegacyStrength, GlassMaterial> = {
  soft: "clear",
  default: "regular",
  strong: "prominent",
};

const LIQUID_OPTICS: Record<Exclude<GlassMaterial, "none">, Partial<GlassOptics>> = {
  clear: {
    strength: 0.14,
    depth: 0.85,
    curvature: 0.55,
    dispersion: 0.28,
    bend: 0.38,
    bendWidth: 0.14,
    frost: 0.4,
    brightness: 0.42,
    sheen: 0.1,
    sheenWidth: 8,
    sheenFalloff: 0.6,
    glow: 0.02,
    glowSpread: 0.6,
    glowFalloff: 0.5,
    splay: 0.06,
    specular: 0.7,
  },
  regular: {
    strength: 0.18,
    depth: 0.92,
    curvature: 0.68,
    dispersion: 0.35,
    bend: 0.52,
    bendWidth: 0.16,
    frost: 0.6,
    brightness: 0.46,
    sheen: 0.14,
    sheenWidth: 10,
    sheenFalloff: 0.5,
    glow: 0.03,
    glowSpread: 0.7,
    glowFalloff: 0.4,
    splay: 0.08,
    specular: 0.8,
  },
  prominent: {
    strength: 0.24,
    depth: 1,
    curvature: 0.82,
    dispersion: 0.42,
    bend: 0.65,
    bendWidth: 0.18,
    frost: 0.8,
    brightness: 0.52,
    sheen: 0.18,
    sheenWidth: 12,
    sheenFalloff: 0.4,
    glow: 0.05,
    glowSpread: 0.8,
    glowFalloff: 0.3,
    splay: 0.12,
    specular: 0.9,
  },
};

function Bubbles() {
  return (
    <>
      <span
        className="liquid-bubble"
        style={{ width: 6, height: 6, left: "15%", bottom: 0, animation: "liquid-bubble-rise 12s ease-in infinite" }}
      />
      <span
        className="liquid-bubble"
        style={{ width: 4, height: 4, left: "45%", bottom: 0, animation: "liquid-bubble-rise 18s ease-in infinite 4s" }}
      />
      <span
        className="liquid-bubble"
        style={{ width: 5, height: 5, left: "75%", bottom: 0, animation: "liquid-bubble-rise 14s ease-in infinite 8s" }}
      />
      <span
        className="liquid-bubble"
        style={{ width: 3, height: 3, left: "30%", bottom: 0, animation: "liquid-bubble-rise 20s ease-in infinite 10s" }}
      />
      <span
        className="liquid-bubble"
        style={{ width: 7, height: 7, left: "60%", bottom: 0, animation: "liquid-bubble-rise 16s ease-in infinite 6s" }}
      />
    </>
  );
}

export const LiquidGlassView = React.forwardRef<HTMLDivElement, LiquidGlassPanelProps>(
  (
    {
      className,
      children,
      radius = 30,
      strength = "default",
      material,
      interactive = false,
      showRipples = true,
      showBubbles = true,
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
            optics={LIQUID_OPTICS[resolvedMaterial]}
          >
            <span className="block h-full w-full" />
          </Glass>
        ) : null}
        <div className="liquid-shimmer-layer" />
        {showRipples && <div className="liquid-ripple-layer" />}
        {showBubbles && <Bubbles />}
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);

LiquidGlassView.displayName = "LiquidGlassView";

export const LiquidGlassPanel = LiquidGlassView;
