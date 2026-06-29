import * as React from "react";
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
        <div className="liquid-glass-view__highlight" aria-hidden />
        <div className="liquid-glass-view__rim" aria-hidden />
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);

LiquidGlassView.displayName = "LiquidGlassView";

export const LiquidGlassPanel = LiquidGlassView;
