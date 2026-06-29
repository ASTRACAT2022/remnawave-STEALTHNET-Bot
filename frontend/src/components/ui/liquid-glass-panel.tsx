import * as React from "react";
import LiquidGlass from "liquid-glass-react";
import { cn } from "@/lib/utils";

type LiquidGlassPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  radius?: number;
  strength?: "soft" | "default" | "strong";
  interactive?: boolean;
};

const GLASS_PARAMS = {
  soft: { displacementScale: 28, blurAmount: 0.025, saturation: 135, aberrationIntensity: 0.7, elasticity: 0.1 },
  default: { displacementScale: 44, blurAmount: 0.04, saturation: 150, aberrationIntensity: 1.1, elasticity: 0.16 },
  strong: { displacementScale: 58, blurAmount: 0.055, saturation: 165, aberrationIntensity: 1.6, elasticity: 0.22 },
} as const;

export const LiquidGlassPanel = React.forwardRef<HTMLDivElement, LiquidGlassPanelProps>(
  ({ className, children, radius = 30, strength = "default", interactive = false, ...props }, ref) => {
    const params = GLASS_PARAMS[strength];

    return (
      <div
        ref={ref}
        {...props}
        className={cn(
          "liquid-glass-panel group/liquid relative overflow-hidden rounded-[var(--glass-radius)] border border-white/18 bg-white/[0.055] text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition-all duration-300",
          interactive && "hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.075] hover:shadow-[0_30px_100px_rgba(0,0,0,0.34)] active:translate-y-0 active:scale-[0.995]",
          className
        )}
        style={{ "--glass-radius": `${radius}px`, ...props.style } as React.CSSProperties}
      >
        <LiquidGlass
          className="liquid-glass-fill pointer-events-none absolute left-1/2 top-1/2 h-full w-full opacity-80"
          style={{ position: "absolute", width: "100%", height: "100%" }}
          cornerRadius={radius}
          padding="0"
          mode="standard"
          {...params}
        >
          <span aria-hidden className="block h-full w-full" />
        </LiquidGlass>
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(135deg,rgba(255,255,255,0.22),rgba(255,255,255,0.055)_38%,rgba(255,255,255,0.02)_62%,rgba(255,255,255,0.14))]" />
        <div className="pointer-events-none absolute inset-px rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(255,255,255,0.08)]" />
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);
LiquidGlassPanel.displayName = "LiquidGlassPanel";
