import * as React from "react";
import { Glass, type GlassOptics } from "@samasante/liquid-glass";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const FIELD_OPTICS: Partial<GlassOptics> = {
  strength: 0.15,
  depth: 0.75,
  curvature: 0.55,
  dispersion: 0.28,
  bend: 0.38,
  bendWidth: 0.14,
  frost: 1.2,
  brightness: 0.45,
  sheen: 0.1,
  sheenWidth: 8,
  glow: 0.03,
  splay: 0.06,
  specular: 0.7,
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
