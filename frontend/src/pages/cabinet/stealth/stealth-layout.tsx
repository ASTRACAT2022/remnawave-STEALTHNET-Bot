/**
 * Stealth-layout — обёртка для всех страниц нового дизайна кабинета.
 *
 * Структура:
 *   ┌─────────────────────────────┐
 *   │  Header (бренд по центру)    │
 *   │─────────────────────────────│
 *   │  <Outlet/> — контент стр.   │
 *   │─────────────────────────────│
 *   │  BottomTabs (Главная/...)    │
 *   └─────────────────────────────┘
 *
 * + NetworkBg (фикс. фон) на весь экран позади всего.
 */

import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, type PublicConfig } from "@/lib/api";
import { NetworkBg } from "@/components/stealth/network-bg";
import { BottomTabs } from "@/components/stealth/bottom-tabs";

export function StealthLayout() {
  const [config, setConfig] = useState<PublicConfig | null>(null);

  useEffect(() => {
    api.getPublicConfig().then(setConfig).catch(() => {});
  }, []);

  const brand = (config?.serviceName ?? "STEALTHNET").toUpperCase();

  return (
    <div className="min-h-screen w-full text-white relative overflow-x-hidden">
      <NetworkBg />

      <header className="relative border-b border-slate-800 bg-slate-950 px-4 pb-3 pt-5 text-center">
        <div className="inline-block relative">
          <h1
            className="text-sm md:text-base font-bold tracking-[0.14em] text-white"
            style={{ fontFamily: '"Syncopate", "Inter", system-ui, sans-serif' }}
          >
            {brand}
          </h1>
        </div>
      </header>

      <main className="relative pb-24 max-w-md mx-auto">
        <Outlet />
      </main>

      <BottomTabs />
    </div>
  );
}
