import { useTheme, ACCENT_PALETTES } from "@/contexts/theme";
import { useLocation } from "react-router-dom";

function isGuestPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/admin/login" ||
    pathname === "/cabinet" ||
    pathname === "/cabinet/login" ||
    pathname === "/cabinet/register" ||
    pathname.startsWith("/cabinet/verify") ||
    pathname.startsWith("/gift/")
  );
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 100, g: 100, b: 255 };
}

export function AnimatedBackground({ variant = "fixed", intensity = "normal" }: { variant?: "fixed" | "absolute", intensity?: "normal" | "weak" }) {
  const { config, resolvedMode } = useTheme();
  const location = useLocation();
  const disabled = location.pathname === "/admin" && variant === "fixed";
  const lowPower = variant === "fixed" && isGuestPath(location.pathname);

  if (disabled) return null;

  const palette = ACCENT_PALETTES[config.accent] || ACCENT_PALETTES.default;
  const rgb = hexToRgb(palette.swatch !== "#1e293b" ? palette.swatch : "#2563eb");
  const isDark = resolvedMode === "dark";
  const base = isDark ? "#0f172a" : "#f8fafc";
  const soft = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${lowPower ? 0.04 : 0.06})`;
  const surface = isDark ? "rgba(15, 23, 42, 0.98)" : "rgba(248, 250, 252, 0.98)";

  return (
    <div className={`${variant === "fixed" ? "fixed" : "absolute"} inset-0 ${variant === "fixed" ? "-z-50" : "z-0"} overflow-hidden ${intensity === "weak" ? "opacity-30" : ""}`} aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background:
            `linear-gradient(180deg, ${base} 0%, ${surface} 46%, ${base} 100%), ` +
            `radial-gradient(circle at 20% 0%, ${soft} 0, transparent 32%)`,
        }}
      />
    </div>
  );
}
