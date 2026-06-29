import * as React from "react";
import { Glass, type GlassOptics } from "@samasante/liquid-glass";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const FIELD_OPTICS: Partial<GlassOptics> = {
  strength: 0.2,
  depth: 0.9,
  curvature: 0.7,
  dispersion: 0.35,
  bend: 0.5,
  bendWidth: 0.12,
  frost: 0.8,
  brightness: 0.05,
  sheen: 0.15,
  sheenWidth: 10,
  glow: 0.04,
  glowSpread: 0.5,
  splay: 0.08,
  specular: 0.8,
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <Glass
        className={cn("liquid-glass-field flex min-h-[88px] w-full rounded-2xl", className)}
        radius={16}
        optics={FIELD_OPTICS}
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
