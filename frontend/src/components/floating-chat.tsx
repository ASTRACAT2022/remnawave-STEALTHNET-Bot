import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MessageCircle, Send, Sparkles, User, X } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  time: string;
};

function nowTime(): string {
  return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function buildWelcome(serviceName: string): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    text: `Привет! Я AI-ассистент ${serviceName}. Помогу с тарифами, подключением VPN и настройками кабинета.`,
    time: nowTime(),
  };
}

function buildFallbackReply(input: string, serviceName: string): string {
  const q = input.toLowerCase();
  if (q.includes("тариф")) {
    return "Откройте раздел «Тарифы», выберите план и оплатите удобным способом. После оплаты доступ активируется автоматически.";
  }
  if (q.includes("vpn") || q.includes("подключ")) {
    return "Перейдите в раздел «Подключение», скопируйте ссылку подписки и импортируйте ее в приложение (Happ/V2Ray/другое).";
  }
  if (q.includes("не работает") || q.includes("ошиб")) {
    return "Проверьте, что подписка активна, затем перевыпустите ссылку подписки и импортируйте заново. Если не поможет, перезайдите в приложение-клиент.";
  }
  if (q.includes("оплат") || q.includes("баланс")) {
    return "Пополнить баланс можно в профиле. Для покупки тарифа балансом откройте «Тарифы» и выберите оплату с баланса.";
  }
  if (q.includes("устройств") || q.includes("hwid")) {
    return "Управлять устройствами можно в боте: раздел «Мои устройства» (там же доступно переименование и отвязка).";
  }
  return `Принял. По этому вопросу в ${serviceName} обычно помогает раздел «Профиль» и «Подключение». Если нужно, уточните задачу в 1-2 фразах, и я дам точные шаги.`;
}

export function FloatingChat() {
  const { state } = useClientAuth();
  const config = useCabinetConfig();
  const serviceName = (config?.serviceName ?? "Сервис").trim() || "Сервис";
  const token = state.token ?? null;

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [buildWelcome("Сервис")]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length !== 1 || prev[0]?.id !== "welcome") return prev;
      const nextWelcome = buildWelcome(serviceName);
      if (prev[0].text === nextWelcome.text) return prev;
      return [nextWelcome];
    });
  }, [serviceName]);

  useEffect(() => {
    if (!isOpen) return;
    setUnread(0);
    const t = setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 60);
    return () => clearTimeout(t);
  }, [isOpen, messages.length]);

  const messagesForApi = useMemo(
    () =>
      messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.text })),
    [messages],
  );

  async function sendAiMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      text,
      time: nowTime(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    let replyText = "";
    if (token) {
      try {
        const res = await api.clientAiChat(token, {
          messages: [...messagesForApi, { role: "user", content: text }],
        });
        if (typeof res.reply === "string" && res.reply.trim()) {
          replyText = res.reply.trim();
        }
      } catch {
        // fallback below
      }
    }
    if (!replyText) {
      replyText = buildFallbackReply(text, serviceName);
    }

    const assistantMessage: ChatMessage = {
      id: `a_${Date.now()}`,
      role: "assistant",
      text: replyText,
      time: nowTime(),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    if (!isOpen) setUnread((v) => v + 1);
    setLoading(false);
  }

  return (
    <div className="fixed bottom-24 right-4 z-[100] sm:bottom-6 sm:right-6">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="ai-panel"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "fixed inset-0 sm:inset-auto sm:bottom-20 sm:right-0 z-50",
              "flex flex-col overflow-hidden border-0 sm:border sm:border-white/10",
              "h-[100dvh] w-full sm:h-[650px] sm:max-h-[85vh] sm:w-[450px] sm:rounded-3xl",
              "bg-background/80 backdrop-blur-3xl sm:bg-background/60 sm:shadow-2xl sm:shadow-black/40",
            )}
          >
            <div className="shrink-0 border-b border-black/5 bg-black/5 px-4 py-4 dark:border-white/5 dark:bg-white/5 pt-[max(env(safe-area-inset-top),16px)] sm:pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-base font-bold leading-tight">AI Ассистент</p>
                    <p className="text-xs text-muted-foreground">{serviceName}</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
                  aria-label="Закрыть AI чат"
                >
                  <X className="h-6 w-6 sm:h-5 sm:w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="space-y-4">
                {messages.map((m) => {
                  const isUser = m.role === "user";
                  return (
                    <div key={m.id} className={cn("flex max-w-[85%] gap-3", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}>
                      <div
                        className={cn(
                          "mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                          isUser ? "bg-primary/20 text-primary" : "bg-violet-500/20 text-violet-400",
                        )}
                      >
                        {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                      </div>
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm",
                          isUser
                            ? "rounded-tr-sm bg-primary text-primary-foreground"
                            : "rounded-tl-sm border border-white/5 bg-card/60 text-foreground",
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                        <p className={cn("mt-1.5 text-[10px] opacity-60", isUser ? "text-right" : "text-left text-muted-foreground")}>
                          {m.time}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
            </div>

            <div className="shrink-0 border-t border-black/5 bg-background/80 p-3 pb-[max(env(safe-area-inset-bottom),16px)] backdrop-blur-xl sm:p-4 sm:pb-4 dark:border-white/5 sm:bg-background/50">
              <div className="flex items-end gap-2 rounded-2xl border border-black/5 bg-black/5 p-1.5 transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 dark:border-white/10 dark:bg-black/20">
                <textarea
                  className="custom-scrollbar max-h-32 min-h-[40px] w-full flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  placeholder="Спросите у AI..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendAiMessage();
                    }
                  }}
                />
                <Button
                  size="icon"
                  className="mb-0.5 mr-0.5 h-10 w-10 shrink-0 rounded-xl"
                  onClick={() => void sendAiMessage()}
                  disabled={!input.trim() || loading}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          "relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-border/50",
          "bg-card/60 text-foreground shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-2xl transition-colors hover:bg-card/80",
          "sm:h-16 sm:w-16",
        )}
        aria-label={isOpen ? "Закрыть AI чат" : "Открыть AI чат"}
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.span
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <X className="h-7 w-7" />
            </motion.span>
          ) : (
            <motion.span
              key="open"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <MessageCircle className="h-7 w-7" />
            </motion.span>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {unread > 0 && !isOpen && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -right-1 -top-1 flex h-6 min-w-[24px] items-center justify-center rounded-full border-2 border-background bg-destructive px-1 text-[11px] font-bold text-white"
            >
              {unread}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
