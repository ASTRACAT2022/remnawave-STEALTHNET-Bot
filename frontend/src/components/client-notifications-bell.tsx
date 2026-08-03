/**
 * ClientNotificationsBell — колокольчик уведомлений в шапке клиентского кабинета.
 *
 * Показывает badge с количеством непрочитанных ответов поддержки (запросов).
 * По клику — popover со списком обращений, где есть непрочитанные ответы.
 * Клик по записи открывает чат тикета (/cabinet/tickets?ticket=<id>).
 *
 * Использует api.getUnreadTicketsCount + api.getTickets (unreadCount).
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Headset, Loader2, ChevronRight } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REFRESH_MS = 15_000;

interface TicketItem {
  id: string;
  subject: string;
  status: string;
  unreadCount?: number;
  updatedAt: string;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const isToday = new Date().toDateString() === d.toDateString();
    if (isToday) return "Сегодня, " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function ClientNotificationsBell() {
  const { state } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const ticketsEnabled = config?.ticketsEnabled !== false;

  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const loadUnread = () => {
    if (!token || !ticketsEnabled) return;
    api.getUnreadTicketsCount(token).then((r) => setUnread(r.count)).catch(() => {});
  };

  const loadList = () => {
    if (!token || !ticketsEnabled) return;
    setLoading(true);
    api
      .getTickets(token)
      .then((r) => {
        setItems(Array.isArray(r.items) ? r.items : []);
        const total = (Array.isArray(r.items) ? r.items : []).reduce(
          (acc, t) => acc + (typeof t.unreadCount === "number" ? t.unreadCount : 0),
          0,
        );
        setUnread(total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token || !ticketsEnabled) return;
    loadUnread();
    const id = window.setInterval(loadUnread, REFRESH_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ticketsEnabled]);

  // Закрытие по клику вне попапа
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  const unreadItems = items.filter((t) => (t.unreadCount ?? 0) > 0);
  const showBadge = unread > 0;

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative shrink-0 bg-background/20 hover:bg-background/40 text-muted-foreground hover:text-foreground"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) loadList();
        }}
        title="Уведомления"
        aria-label="Уведомления"
      >
        <Bell className="h-5 w-5" />
        {showBadge && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white ring-2 ring-background">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-full z-50 mt-3 w-[calc(100vw-2rem)] sm:w-[360px] max-w-[360px] rounded-[1.5rem] border border-white/40 dark:border-white/10 bg-slate-200/60 dark:bg-slate-900/60 backdrop-blur-[32px] shadow-[0_10px_60px_rgba(0,0,0,0.15)] dark:shadow-[0_10px_60px_rgba(0,0,0,0.5)] p-3",
          )}
        >
          <div className="flex items-center justify-between px-2 pb-2">
            <h4 className="text-sm font-semibold tracking-tight text-foreground">Уведомления</h4>
            <button
              onClick={() => loadList()}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {loading ? "Обновление…" : "Обновить"}
            </button>
          </div>

          {unreadItems.length === 0 && !loading && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Новых уведомлений нет.
            </div>
          )}

          <div className="space-y-1.5">
            {unreadItems.map((t) => (
              <Link
                key={t.id}
                to={`/cabinet/tickets?ticket=${t.id}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Headset className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">{t.subject || "Без темы"}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    Новый ответ поддержки · {fmtTime(t.updatedAt)}
                  </div>
                </div>
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                  {t.unreadCount}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
