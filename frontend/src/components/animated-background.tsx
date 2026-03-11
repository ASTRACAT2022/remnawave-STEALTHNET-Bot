import { useEffect, useRef } from "react";
import { useTheme, ACCENT_PALETTES } from "@/contexts/theme";

type OrbConfig = {
  x: number;
  y: number;
  r: number;
  dx: number;
  dy: number;
  dur: number;
};

const ORBS: OrbConfig[] = [
  { x: 0.15, y: 0.2, r: 320, dx: 80, dy: 60, dur: 18 },
  { x: 0.8, y: 0.1, r: 280, dx: -70, dy: 80, dur: 22 },
  { x: 0.6, y: 0.7, r: 350, dx: -90, dy: -70, dur: 26 },
  { x: 0.1, y: 0.8, r: 260, dx: 60, dy: -80, dur: 20 },
  { x: 0.9, y: 0.55, r: 300, dx: -60, dy: 70, dur: 24 },
  { x: 0.45, y: 0.4, r: 240, dx: 70, dy: -60, dur: 30 },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 100, g: 100, b: 255 };
  return {
    r: Number.parseInt(result[1], 16),
    g: Number.parseInt(result[2], 16),
    b: Number.parseInt(result[3], 16),
  };
}

export function AnimatedBackground() {
  const { config, resolvedMode } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const palette = ACCENT_PALETTES[config.accent] || ACCENT_PALETTES.default;
    const baseHex = palette.swatch !== "#1e293b" ? palette.swatch : "#6366f1";
    const rgb = hexToRgb(baseHex);

    const isDark = resolvedMode === "dark";
    const bgColor = isDark ? "#0a0a10" : "#f8fafc";
    const orbColors = ORBS.map((_, i) => {
      const r = Math.min(255, Math.max(0, rgb.r + (i % 3 === 0 ? 30 : -20)));
      const g = Math.min(255, Math.max(0, rgb.g + (i % 2 === 0 ? 20 : -30)));
      const b = Math.min(255, Math.max(0, rgb.b + (i % 4 === 0 ? 40 : -10)));
      return {
        center: `rgba(${r}, ${g}, ${b}, ${isDark ? "0.5" : "0.3"})`,
        edge: `rgba(${r}, ${g}, ${b}, 0)`,
      };
    });

    const draw = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const t = (ts - startRef.current) / 1000;
      const W = canvas.width;
      const H = canvas.height;
      const scale = Math.max(0.45, Math.min(W, H) / 1000);

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, W, H);

      for (let i = 0; i < ORBS.length; i += 1) {
        const o = ORBS[i]!;
        const colors = orbColors[i]!;
        const phase = (t / o.dur) * Math.PI * 2;
        const scaledDx = o.dx * scale;
        const scaledDy = o.dy * scale;
        const scaledR = o.r * scale;
        const cx = o.x * W + Math.sin(phase) * scaledDx;
        const cy = o.y * H + Math.cos(phase * 0.7) * scaledDy;

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, scaledR);
        grad.addColorStop(0, colors.center);
        grad.addColorStop(1, colors.edge);

        ctx.beginPath();
        ctx.arc(cx, cy, scaledR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [config.accent, resolvedMode]);

  return (
    <div className="fixed inset-0 -z-50 overflow-hidden pointer-events-none" aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-background/20 backdrop-blur-[100px]" />
    </div>
  );
}
