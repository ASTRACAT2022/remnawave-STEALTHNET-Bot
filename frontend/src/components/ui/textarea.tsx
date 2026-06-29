import * as React from "react";
import { Glass, type GlassOptics } from "@samasante/liquid-glass";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const FIELD_OPTICS: Partial<GlassOptics> = {
  strength: 0.09,
  depth: 0.42,
  curvature: 0.18,
  dispersion: 0.12,
  bend: 0.28,
  frost: 2.5,
  brightness: 1.04,
  sheen: 0.22,
  glow: 0.14,
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <Glass
        className={cn("liquid-glass-field flex min-h-[88px] w-full rounded-2xl", className)}
        radius={16}
        optics={FIELD_OPTICS}
        behind="transparent"
      >
        <textarea
          className="relative z-10 flex min-h-[88px] w-full rounded-2xl border-0 bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          ref={ref}
          {...props}
        />
      </Glass>
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
