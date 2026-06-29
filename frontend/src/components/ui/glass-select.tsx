import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

interface GlassSelectOption {
  value: string;
  label: string;
}

interface GlassSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: GlassSelectOption[];
  className?: string;
}

export function GlassSelect({ value, onChange, options, className }: GlassSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-between rounded-2xl border border-white/14 bg-white/[0.075] px-4 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-xl transition-all duration-300 hover:border-white/26 hover:bg-white/[0.11] focus:outline-none focus:ring-2 focus:ring-white/20"
      >
        <span>{selectedOption?.label ?? value}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        className={cn(
          "absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-2xl border border-white/16 bg-slate-950/70 shadow-2xl shadow-black/35 backdrop-blur-2xl transition-all duration-200 origin-top",
          open
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-95 pointer-events-none"
        )}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onChange(opt.value);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center px-4 py-2.5 text-sm transition-all duration-150",
              opt.value === value
                ? "bg-white/14 text-foreground font-medium"
                : "hover:bg-white/10 text-foreground/82"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
