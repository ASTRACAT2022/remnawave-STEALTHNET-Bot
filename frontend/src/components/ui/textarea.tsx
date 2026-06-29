import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[88px] w-full rounded-2xl border border-white/12 bg-white/[0.045] px-4 py-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-md transition-[background,border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-white/28 focus-visible:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/14 disabled:cursor-not-allowed disabled:opacity-50",
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
