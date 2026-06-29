import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-2xl border border-white/14 bg-white/[0.07] px-4 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl transition-all duration-300 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-white/32 focus-visible:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/18 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
