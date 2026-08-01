import { Loader2 } from "lucide-react";
import { useTheme } from "@/contexts/theme";

type BrandLoadingScreenProps = {
  label?: string;
  description?: string;
  compact?: boolean;
  dark?: boolean;
};

/** Единый экран ожидания: логотип подбирается по реальной активной теме. */
export function BrandLoadingScreen({
  label = "Загрузка…",
  description,
  compact = false,
  dark,
}: BrandLoadingScreenProps) {
  const { resolvedMode } = useTheme();
  const useDarkLogo = dark ?? resolvedMode === "dark";

  return (
    <div className={compact ? "flex min-h-[55vh] w-full items-center justify-center px-4" : "min-h-svh flex items-center justify-center px-4"}>
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <img
          src={useDarkLogo ? "/astracat-logo-white.png" : "/astracat-logo-black.png"}
          alt="ASTRACAT Networks"
          className="h-56 w-auto max-w-full object-contain"
        />
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

