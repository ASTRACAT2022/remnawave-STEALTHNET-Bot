import * as React from "react";
import { Glass, type GlassOptics } from "@samasante/liquid-glass";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const FIELD_OPTICS: Partial<GlassOptics> = {
  strength: 0.07,
  depth: 0.34,
  curvature: 0.14,
  dispersion: 0.08,
  bend: 0.22,
  frost: 1.8,
  brightness: 0.78,
  sheen: 0.18,
  glow: 0.08,
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <Glass
        className={cn("liquid-glass-field flex h-11 w-full rounded-2xl", className)}
        radius={16}
        optics={FIELD_OPTICS}
        behind="transparent"
      >
        <input
          type={type}
          className="relative z-10 flex h-full w-full rounded-2xl border-0 bg-transparent px-4 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          ref={ref}
          {...props}
        />
      </Glass>
    );
  }
);
Input.displayName = "Input";

export { Input };
