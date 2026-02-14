import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

// ═══ Типы ═══

export type ThemeMode = "light" | "dark" | "system";
export type ThemeAccent =
  | "default"
  | "blue"
  | "violet"
  | "rose"
  | "orange"
  | "green"
  | "emerald"
  | "cyan"
  | "amber"
  | "red"
  | "pink"
  | "indigo";

export interface ThemeConfig {
  mode: ThemeMode;
  accent: ThemeAccent;
}

// ═══ Палитры акцентов (HSL без deg/%) — подставляются в CSS-переменные ═══

interface AccentPalette {
  label: string;
  /** Preview swatch color (hex) */
  swatch: string;
  light: Record<string, string>;
  dark: Record<string, string>;
}

export const ACCENT_PALETTES: Record<ThemeAccent, AccentPalette> = {
  default: {
    label: "Стандарт",
    swatch: "#1e293b",
    light: {},
    dark: {},
  },
  blue: {
    label: "Синяя",
    swatch: "#3b82f6",
    light: {
      "--primary": "217.2 91.2% 59.8%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "217.2 91.2% 59.8%",
    },
    dark: {
      "--primary": "217.2 91.2% 59.8%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "217.2 91.2% 59.8%",
    },
  },
  violet: {
    label: "Фиолетовая",
    swatch: "#8b5cf6",
    light: {
      "--primary": "262.1 83.3% 57.8%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "262.1 83.3% 57.8%",
    },
    dark: {
      "--primary": "263.4 70% 50.4%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "263.4 70% 50.4%",
    },
  },
  rose: {
    label: "Розовая",
    swatch: "#f43f5e",
    light: {
      "--primary": "346.8 77.2% 49.8%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "346.8 77.2% 49.8%",
    },
    dark: {
      "--primary": "346.8 77.2% 49.8%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "346.8 77.2% 49.8%",
    },
  },
  orange: {
    label: "Оранжевая",
    swatch: "#f97316",
    light: {
      "--primary": "24.6 95% 53.1%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "24.6 95% 53.1%",
    },
    dark: {
      "--primary": "20.5 90.2% 48.2%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "20.5 90.2% 48.2%",
    },
  },
  green: {
    label: "Зелёная",
    swatch: "#22c55e",
    light: {
      "--primary": "142.1 76.2% 36.3%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "142.1 76.2% 36.3%",
    },
    dark: {
      "--primary": "142.1 70.6% 45.3%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "142.1 70.6% 45.3%",
    },
  },
  emerald: {
    label: "Изумрудная",
    swatch: "#10b981",
    light: {
      "--primary": "160.1 84.1% 39.4%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "160.1 84.1% 39.4%",
    },
    dark: {
      "--primary": "160.1 84.1% 39.4%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "160.1 84.1% 39.4%",
    },
  },
  cyan: {
    label: "Голубая",
    swatch: "#06b6d4",
    light: {
      "--primary": "187.7 85.7% 53.3%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "187.7 85.7% 53.3%",
    },
    dark: {
      "--primary": "187.7 85.7% 53.3%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "187.7 85.7% 53.3%",
    },
  },
  amber: {
    label: "Янтарная",
    swatch: "#f59e0b",
    light: {
      "--primary": "37.7 92.1% 50.2%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "37.7 92.1% 50.2%",
    },
    dark: {
      "--primary": "37.7 92.1% 50.2%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "37.7 92.1% 50.2%",
    },
  },
  red: {
    label: "Красная",
    swatch: "#ef4444",
    light: {
      "--primary": "0 84.2% 60.2%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "0 84.2% 60.2%",
    },
    dark: {
      "--primary": "0 72.2% 50.6%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "0 72.2% 50.6%",
    },
  },
  pink: {
    label: "Розовая",
    swatch: "#ec4899",
    light: {
      "--primary": "330.4 81.2% 60.4%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "330.4 81.2% 60.4%",
    },
    dark: {
      "--primary": "330.4 81.2% 60.4%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "330.4 81.2% 60.4%",
    },
  },
  indigo: {
    label: "Индиго",
    swatch: "#6366f1",
    light: {
      "--primary": "238.7 83.5% 66.7%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "238.7 83.5% 66.7%",
    },
    dark: {
      "--primary": "238.7 83.5% 66.7%",
      "--primary-foreground": "0 0% 100%",
      "--ring": "238.7 83.5% 66.7%",
    },
  },
};

// ═══ Контекст ═══

interface ThemeContextValue {
  config: ThemeConfig;
  resolvedMode: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
  setConfig: (cfg: ThemeConfig) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  config: { mode: "dark", accent: "default" },
  resolvedMode: "dark",
  setMode: () => {},
  setAccent: () => {},
  setConfig: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

// ═══ Provider ═══

const STORAGE_KEY = "stealthnet-theme";

function getSystemDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function loadTheme(): ThemeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.mode && parsed.accent) return parsed;
    }
  } catch {}
  return { mode: "dark", accent: "default" };
}

function saveTheme(cfg: ThemeConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {}
}

export function ThemeProvider({
  children,
  forcedAccent,
}: {
  children: ReactNode;
  /** Global accent from admin settings (overrides local) */
  forcedAccent?: ThemeAccent | null;
}) {
  const [config, setConfigState] = useState<ThemeConfig>(loadTheme);
  const [systemDark, setSystemDark] = useState(getSystemDark);

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Resolved effective mode
  const resolvedMode = config.mode === "system" ? (systemDark ? "dark" : "light") : config.mode;

  // Apply forced accent from admin settings
  const effectiveAccent = forcedAccent && forcedAccent !== "default" ? forcedAccent : config.accent;

  // Apply to DOM
  useEffect(() => {
    const root = document.documentElement;

    // Dark/light class
    root.classList.remove("light", "dark");
    root.classList.add(resolvedMode);

    // Remove all accent CSS variables first
    const allVars = new Set<string>();
    for (const p of Object.values(ACCENT_PALETTES)) {
      for (const k of Object.keys(p.light)) allVars.add(k);
      for (const k of Object.keys(p.dark)) allVars.add(k);
    }
    for (const v of allVars) root.style.removeProperty(v);

    // Apply accent palette
    if (effectiveAccent !== "default") {
      const palette = ACCENT_PALETTES[effectiveAccent];
      if (palette) {
        const vars = resolvedMode === "dark" ? palette.dark : palette.light;
        for (const [k, v] of Object.entries(vars)) {
          root.style.setProperty(k, v);
        }
      }
    }
  }, [resolvedMode, effectiveAccent]);

  const setConfig = useCallback((cfg: ThemeConfig) => {
    setConfigState(cfg);
    saveTheme(cfg);
  }, []);

  const setMode = useCallback((mode: ThemeMode) => {
    setConfigState((prev) => {
      const next = { ...prev, mode };
      saveTheme(next);
      return next;
    });
  }, []);

  const setAccent = useCallback((accent: ThemeAccent) => {
    setConfigState((prev) => {
      const next = { ...prev, accent };
      saveTheme(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ config: { ...config, accent: effectiveAccent }, resolvedMode, setMode, setAccent, setConfig }}>
      {children}
    </ThemeContext.Provider>
  );
}
