import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[88px] w-full rounded-2xl border border-white/14 bg-white/[0.07] px-4 py-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl transition-all duration-300 placeholder:text-muted-foreground focus-visible:border-white/32 focus-visible:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/18 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
