/**
 * NetworkBg — легкий статичный фон для мобильного кабинета.
 * Без blur, canvas и анимаций: старые WebView не тратят ресурсы на фон.
 */

import { useId } from "react";

interface Props {
  /** Базовый цвет линий/точек. По умолчанию красный (бренд STEALTHNET). */
  accent?: string;
  /** Прозрачность сетки (0..1). По умолчанию 0.18 — еле заметно. */
  opacity?: number;
  /** Если true — без blob'ов, только сетка (для модалок). */
  flatten?: boolean;
}

export function NetworkBg({ accent = "#ff2357", opacity = 0.18, flatten = false }: Props) {
  const patternId = useId();
  return (
    <>
      <div className="fixed inset-0 -z-30 bg-[#0f172a] pointer-events-none" />
      <div
        className="fixed inset-0 -z-20 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, #111827 0%, #0f172a 42%, #111827 100%)," +
            `radial-gradient(circle at 85% 0%, ${accent}1a 0, transparent 32%)`,
        }}
      />

      {/* SVG-сетка (триангуляция) */}
      <svg
        className="fixed inset-0 -z-10 w-full h-full pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <pattern id={patternId} width="160" height="160" patternUnits="userSpaceOnUse">
            {/* Triangulated network: 4 узла + линии между ними */}
            <g stroke={accent} strokeOpacity={opacity} strokeWidth="0.6" fill="none">
              <line x1="0" y1="0" x2="160" y2="80" />
              <line x1="0" y1="0" x2="80" y2="160" />
              <line x1="160" y1="0" x2="0" y2="80" />
              <line x1="160" y1="0" x2="160" y2="160" />
              <line x1="80" y1="0" x2="160" y2="80" />
              <line x1="0" y1="160" x2="80" y2="80" />
              <line x1="80" y1="160" x2="160" y2="80" />
              <line x1="160" y1="160" x2="80" y2="80" />
              <line x1="0" y1="80" x2="80" y2="80" />
              <line x1="80" y1="0" x2="80" y2="80" />
            </g>
            {/* Узлы */}
            <g fill={accent} fillOpacity={Math.min(opacity * 3, 0.85)}>
              <circle cx="0" cy="0" r="1.2" />
              <circle cx="80" cy="80" r="1.6" />
              <circle cx="160" cy="0" r="1.2" />
              <circle cx="0" cy="160" r="1.2" />
              <circle cx="160" cy="160" r="1.2" />
              <circle cx="80" cy="0" r="1" />
              <circle cx="0" cy="80" r="1" />
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>

      {!flatten && <div className="fixed inset-x-0 bottom-0 -z-10 h-40 bg-black/10 pointer-events-none" />}
    </>
  );
}
