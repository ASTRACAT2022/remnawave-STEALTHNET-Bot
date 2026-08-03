import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Archive, Bell, CalendarClock, ChevronDown, CircleHelp, ClipboardList, CreditCard, Gauge, Gift, LayoutDashboard, LifeBuoy, Menu, MoreHorizontal, Package, PanelLeftClose, Paperclip, Plus, ReceiptText, RotateCcw, Send, Settings, ShieldCheck, Smartphone, Ticket, Trash2, Users, Wallet, X } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientDeviceItem, type ClientPayer, type ClientPayment, type ClientTeamMember, type ClientVisit, type PublicSellOption, type PublicTariff, type PublicTariffCategory, type TicketMessageDto, type WdttClientCategoryItem, type WdttClientSlotItem } from "@/lib/api";
import { openTelegramStarsInvoice, preparePaymentRedirect } from "@/lib/open-payment-url";
import { BrandLoadingScreen } from "@/components/brand-loading-screen";
import { Button, Checkbox, EmptyState, FormField, IconButton, Input, Modal, Select, StatusBadge, Stepper, Switcher, Textarea } from "@/components/astracat/dragon";
import "./astracat-billing.css";

type PageId = "home" | "profile" | "roles" | "payers" | "referrals" | "cart" | "orders" | "methods" | "discounts" | "preferences" | "subscriptions" | "options" | "olcrtc" | "payments" | "expenses" | "renewals" | "usage" | "tickets" | "archive" | "statistics" | "visits" | "help" | "refunds" | "devices";
type RefundRecord = { id: string; paymentId: string; amount: number; currency: string; status: "pending" | "approved" | "rejected"; reason: string; subscriptionId: string; subscriptionName: string; createdAt: string };
type ModalName = "topup" | "ticket" | "order" | "olcrtcOrder" | "payer" | "member" | null;
type SubscriptionRow = { id: string; service: string; plan: string; status: string; expiresAt: string | null; days: number | null; traffic: string; devices: string; autoRenew: boolean; type: "root" | "secondary"; tariffId: string | null; subscriptionUrl: string | null; usedBytes: number | null; limitBytes: number | null; deviceLimit: number | null; devicesUsed: number | null };
type TicketRow = { id: string; subject: string; status: string; createdAt: string; updatedAt: string };
type TicketDetail = { id: string; subject: string; status: string; createdAt: string; updatedAt: string; messages: TicketMessageDto[] };
const TICKET_MAX_FILES = 5;

const groups: { label?: string; items: Array<{ id: PageId; label: string; icon: typeof LayoutDashboard }>}[] = [
  { items: [{ id: "home", label: "Главная", icon: LayoutDashboard }] },
  { label: "Клиент", items: [{ id: "profile", label: "Профиль", icon: Users }, { id: "roles", label: "Роли пользователей", icon: ShieldCheck }, { id: "payers", label: "Плательщики", icon: Users }, { id: "referrals", label: "Реферальная программа", icon: Gift }, { id: "cart", label: "Корзина", icon: ReceiptText }, { id: "orders", label: "Заказы", icon: ClipboardList }, { id: "methods", label: "Способы оплаты", icon: CreditCard }, { id: "discounts", label: "Скидки", icon: Gift }, { id: "preferences", label: "Настройки пользователя", icon: Settings }] },
  { label: "Товары / Услуги", items: [{ id: "subscriptions", label: "Подписки ASTRACAT", icon: Package }, { id: "options", label: "Доп. опции", icon: Plus }, { id: "olcrtc", label: "WDTT", icon: Gauge }] },
  { label: "Финансы", items: [{ id: "payments", label: "Платежи", icon: Wallet }, { id: "expenses", label: "Расходы", icon: ReceiptText }, { id: "renewals", label: "Автопродление услуг", icon: CalendarClock }, { id: "usage", label: "Потребление ресурсов", icon: Gauge }, { id: "refunds", label: "Возвраты", icon: RotateCcw }] },
  { label: "Устройства", items: [{ id: "devices", label: "Управление устройствами", icon: Smartphone }] },
  { label: "Поддержка", items: [{ id: "tickets", label: "Запросы", icon: Ticket }, { id: "archive", label: "Архив запросов", icon: Archive }] },
  { label: "Инструменты", items: [{ id: "statistics", label: "Статистика", icon: Gauge }, { id: "visits", label: "Журнал посещений", icon: ClipboardList }] },
  { items: [{ id: "help", label: "Справка", icon: CircleHelp }] },
];

const labels = Object.fromEntries(groups.flatMap((group) => group.items.map((item) => [item.id, item.label]))) as Record<PageId, string>;

function parseSubscription(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  if (raw.response && typeof raw.response === "object") return raw.response as Record<string, unknown>;
  if (raw.data && typeof raw.data === "object" && (raw.data as Record<string, unknown>).response && typeof (raw.data as Record<string, unknown>).response === "object") return (raw.data as Record<string, unknown>).response as Record<string, unknown>;
  return raw;
}
function numberValue(value: unknown): number | null { const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isFinite(n) ? n : null; }
function bytes(value: number | null) { if (value == null) return "—"; if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} ГБ`; if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} МБ`; return `${Math.round(value / 1024)} КБ`; }
function date(value: string | null) { return value ? new Date(value).toLocaleDateString("ru-RU") : "—"; }
function money(value: number, currency: string) { return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency.toUpperCase() === "RUB" ? "RUB" : currency.toUpperCase() === "EUR" ? "EUR" : "USD", maximumFractionDigits: 2 }).format(value); }
function daysUntil(value: string | null) { if (!value) return null; const result = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000); return Number.isFinite(result) ? Math.max(0, result) : null; }

function useBillingData(token: string | null) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; profile: Awaited<ReturnType<typeof api.clientMe>> | null; subscriptions: SubscriptionRow[]; payments: ClientPayment[]; tickets: TicketRow[]; devices: number; tariffs: PublicTariff[]; tariffCategories: PublicTariffCategory[]; olcrtcCategories: WdttClientCategoryItem[]; olcrtcSlots: WdttClientSlotItem[]; referrals: { total: number; earned: number } | null; payers: ClientPayer[]; members: ClientTeamMember[]; visits: ClientVisit[] }>({ loading: true, error: null, profile: null, subscriptions: [], payments: [], tickets: [], devices: 0, tariffs: [], tariffCategories: [], olcrtcCategories: [], olcrtcSlots: [], referrals: null, payers: [], members: [], visits: [] });
  const reload = async () => {
    if (!token) return;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const [profile, subscriptionsRes, paymentsRes, ticketsRes, devicesRes, tariffsRes, referralsRes, payersRes, membersRes, visitsRes, olcrtcTariffsRes, olcrtcSlotsRes] = await Promise.all([api.clientMe(token), api.clientAllSubscriptions(token), api.clientPayments(token), api.getTickets(token).catch(() => ({ items: [] })), api.getMyAllDevices(token).catch(() => ({ total: 0, items: [] })), api.getPublicTariffs(), api.getClientReferralStats(token).catch(() => null), api.getClientPayers(token).catch(() => ({ items: [] })), api.getClientTeamMembers(token).catch(() => ({ items: [] })), api.getClientVisits(token).catch(() => ({ items: [] })), api.getWdttClientTariffs(token).catch(() => ({ items: [] })), api.getWdttSlots(token).catch(() => ({ items: [] }))]);
      const subscriptions = subscriptionsRes.items.map((item): SubscriptionRow => {
        const raw = parseSubscription(item.subscription); const traffic = raw.userTraffic && typeof raw.userTraffic === "object" ? raw.userTraffic as Record<string, unknown> : {};
        const expiresAt = typeof raw.expireAt === "string" ? raw.expireAt : null; const limit = numberValue(raw.trafficLimitBytes); const used = numberValue(traffic.usedTrafficBytes ?? raw.trafficUsed ?? raw.usedTrafficBytes);
        const subUrlRaw = typeof raw.subscriptionUrl === "string" ? raw.subscriptionUrl : typeof raw.subscription_url === "string" ? raw.subscription_url : null;
        const deviceLimitRaw = numberValue(raw.hwidDeviceLimit ?? raw.deviceLimit ?? raw.device_limit);
        const devicesUsedRaw = numberValue(raw.devicesUsed ?? raw.devices_used);
        return { id: item.id, service: item.type === "root" ? "VPN-подписка" : `Дополнительная подписка №${item.subscriptionIndex ?? "—"}`, plan: item.tariffDisplayName || "Без тарифа", status: item.status || (typeof raw.status === "string" ? raw.status : "PENDING"), expiresAt, days: daysUntil(expiresAt), traffic: limit == null || limit <= 0 ? "Безлимит" : `${bytes(used)} / ${bytes(limit)}`, devices: `${deviceLimitRaw ?? "—"}`, autoRenew: Boolean(item.autoRenewEnabled), type: item.type, tariffId: item.tariffId ?? null, subscriptionUrl: subUrlRaw, usedBytes: used, limitBytes: limit, deviceLimit: deviceLimitRaw, devicesUsed: devicesUsedRaw };
      });
      const referral = referralsRes as { referrals?: unknown[]; totalEarned?: number; totalEarnings?: number } | null;
      setState({ loading: false, error: null, profile, subscriptions, payments: paymentsRes.items, tickets: ticketsRes.items, devices: devicesRes.total, tariffs: tariffsRes.items.flatMap((group) => group.tariffs), tariffCategories: tariffsRes.items, olcrtcCategories: olcrtcTariffsRes.items, olcrtcSlots: olcrtcSlotsRes.items, referrals: referral ? { total: referral.referrals?.length ?? 0, earned: numberValue(referral.totalEarned ?? referral.totalEarnings) ?? 0 } : null, payers: payersRes.items, members: membersRes.items, visits: visitsRes.items });
    } catch (error) { setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : "Не удалось загрузить данные" })); }
  };
  useEffect(() => { void reload(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (token) void api.recordClientVisit(token).catch(() => {}); }, [token]);
  return { ...state, reload };
}

function savedTabs(): PageId[] { try { const value = JSON.parse(localStorage.getItem("astracat-tabs-client") ?? "[]") as PageId[]; return value.filter((id) => id in labels).length ? value.filter((id) => id in labels) : ["home"]; } catch { return ["home"]; } }

export function AstracatBillingPage() {
  const { state: auth, refreshProfile, logout } = useClientAuth(); const data = useBillingData(auth.token);
  const [searchParams] = useSearchParams();
  const [theme, setTheme] = useState<"light" | "dark">("dark"); const [collapsed, setCollapsed] = useState(false); const [mobileMenuOpen, setMobileMenuOpen] = useState(false); const [tabs, setTabs] = useState<PageId[]>(savedTabs); const [active, setActive] = useState<PageId>(() => savedTabs()[0]); const [modal, setModal] = useState<ModalName>(null); const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { localStorage.setItem("astracat-tabs-client", JSON.stringify(tabs)); }, [tabs]);
  useEffect(() => { const requested = searchParams.get("page"); if (!requested || !(requested in labels)) return; const page = requested as PageId; setTabs((current) => current.includes(page) ? current : [...current, page]); setActive(page); }, [searchParams]);
  const open = (id: PageId) => { setTabs((current) => current.includes(id) ? current : [...current, id]); setActive(id); setMobileMenuOpen(false); };
  const close = (id: PageId) => setTabs((current) => { const next = current.filter((value) => value !== id); if (id === active) setActive(next[next.length - 1] ?? "home"); return next.length ? next : ["home"]; });
  const inform = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(null), 4000); };
  const toggleSidebar = () => { if (window.matchMedia("(max-width: 768px)").matches) setMobileMenuOpen((isOpen) => !isOpen); else setCollapsed((isCollapsed) => !isCollapsed); };
  useEffect(() => { if (!mobileMenuOpen) return; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileMenuOpen(false); }; document.addEventListener("keydown", closeOnEscape); return () => document.removeEventListener("keydown", closeOnEscape); }, [mobileMenuOpen]);
  if (!auth.token) return <main className="astracat"><section className="ac-page"><EmptyState title="Требуется вход" text="Войдите в клиентский кабинет, чтобы открыть биллинг." action={<Button onClick={() => { window.location.href = "/cabinet/login"; }}>Войти</Button>} /></section></main>;
  if (data.loading && !data.profile) return <main className="astracat astracat--dark" style={{ display: "block" }}><BrandLoadingScreen dark label="Загрузка кабинета" description="Получаем данные из ASTRACAT API." /></main>;
  return <main className={`astracat ${theme === "dark" ? "astracat--dark" : ""} ${collapsed ? "astracat--collapsed" : ""}`}>
    <header className="ac-top-header"><button className="ac-brand" onClick={() => open("home")} aria-label="ASTRACAT Billing: главная"><span>✦</span> ASTRACAT <small>BILLING</small></button><div className="ac-top-actions"><button className="ac-balance" onClick={() => setModal("topup")}>Баланс: <strong>{money(data.profile?.balance ?? 0, data.profile?.preferredCurrency ?? "USD")}</strong><span>Пополнить</span></button><IconButton label="Уведомления"><Bell size={18} /><b>{data.tickets.filter((ticket) => ticket.status === "open").length}</b></IconButton><button className="ac-user" onClick={() => void logout()}>{data.profile?.email ?? data.profile?.telegramUsername ?? "Клиент"}<ChevronDown size={15} /></button></div></header>
    <div className="ac-sub-header"><IconButton className="ac-sidebar-toggle ac-sidebar-toggle--desktop" label={collapsed ? "Развернуть меню" : "Свернуть меню"} onClick={toggleSidebar}>{collapsed ? <Menu size={18} /> : <PanelLeftClose size={18} />}</IconButton><IconButton className="ac-sidebar-toggle ac-sidebar-toggle--mobile" label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={mobileMenuOpen} onClick={toggleSidebar}>{mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}</IconButton><span>Клиентский кабинет</span><div><button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Тёмная тема" : "Светлая тема"}</button><button onClick={() => void data.reload()}>Обновить</button></div></div>
    {mobileMenuOpen && <button className="ac-mobile-nav-scrim" aria-label="Закрыть меню" onClick={() => setMobileMenuOpen(false)} />}
    <aside className={`ac-sidebar ${mobileMenuOpen ? "ac-sidebar--mobile-open" : ""}`} aria-label="Основная навигация"><header className="ac-mobile-drawer-header"><span>Навигация</span><IconButton label="Закрыть меню" onClick={() => setMobileMenuOpen(false)}><X size={18} /></IconButton></header><nav>{groups.map((group, index) => <section key={`${group.label ?? "root"}-${index}`} className="ac-sidebar-group">{group.label && <h2>{group.label}</h2>}{group.items.map((item) => <button key={item.id} className={active === item.id ? "is-active" : ""} onClick={() => open(item.id)} title={collapsed ? item.label : undefined}><item.icon size={17} /><span>{item.label}</span></button>)}</section>)}</nav><footer><CircleHelp size={16} /><span>Справка и поддержка</span></footer></aside>
    <section className="ac-workspace"><nav className="ac-tabbar" aria-label="Открытые разделы">{tabs.map((tab) => <button key={tab} className={active === tab ? "is-active" : ""} onClick={() => setActive(tab)}><span>{labels[tab]}</span>{tab !== "home" && <X size={14} onClick={(event) => { event.stopPropagation(); close(tab); }} aria-label={`Закрыть ${labels[tab]}`} />}</button>)}<button className="ac-tab-more" onClick={() => setTabs([active])} title="Закрыть остальные вкладки"><MoreHorizontal size={18} /></button></nav>{notice && <div className="ac-toast" role="status">{notice}</div>}{data.error && <div className="ac-toast" role="alert">{data.error}</div>}<BillingPage page={active} data={data} token={auth.token} open={open} modal={setModal} inform={inform} refreshProfile={refreshProfile} /></section>
    {modal && <BillingModal name={modal} token={auth.token} tariffCategories={data.tariffCategories} olcrtcCategories={data.olcrtcCategories} subscriptions={data.subscriptions} close={() => setModal(null)} inform={inform} reload={data.reload} />}
  </main>;
}

function Frame({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) { return <article className="ac-page"><header className="ac-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="ac-page-actions">{actions}</div>}</header>{children}</article>; }
function BillingPage({ page, data, token, open, modal, inform, refreshProfile }: { page: PageId; data: ReturnType<typeof useBillingData>; token: string; open: (page: PageId) => void; modal: (name: ModalName) => void; inform: (message: string) => void; refreshProfile: () => Promise<void> }) {
  if (page === "home") return <Dashboard data={data} open={open} modal={modal} />;
  if (page === "subscriptions") return <Subscriptions data={data} token={token} modal={modal} reload={data.reload} inform={inform} />;
  if (page === "payments" || page === "orders") return <Payments payments={data.payments} order={page === "orders"} modal={modal} />;
  if (page === "options") return <ExtraOptions data={data} token={token} reload={data.reload} refreshProfile={refreshProfile} inform={inform} />;
  if (page === "tickets" || page === "archive") return <Tickets tickets={data.tickets.filter((ticket) => page === "archive" ? ticket.status === "closed" : ticket.status !== "closed")} token={token} modal={modal} reload={data.reload} />;
  if (page === "profile") return <Profile token={token} profile={data.profile} refresh={refreshProfile} inform={inform} />;
  if (page === "payers") return <Payers payers={data.payers} token={token} modal={modal} reload={data.reload} inform={inform} />;
  if (page === "roles") return <TeamMembers members={data.members} token={token} modal={modal} reload={data.reload} inform={inform} />;
  if (page === "visits") return <Visits visits={data.visits} />;
  if (page === "discounts") return <Discounts token={token} profile={data.profile} inform={inform} />;
  if (page === "olcrtc") return <OlcRtc categories={data.olcrtcCategories} slots={data.olcrtcSlots} token={token} modal={modal} reload={data.reload} inform={inform} />;
  if (page === "renewals") return <Renewals data={data} token={token} reload={data.reload} inform={inform} />;
  if (page === "usage") return <Usage data={data} />;
  if (page === "refunds") return <Refunds payments={data.payments} subscriptions={data.subscriptions} token={token} profile={data.profile} reload={data.reload} inform={inform} />;
  if (page === "devices") return <DeviceManager subscriptions={data.subscriptions} token={token} inform={inform} />;
  if (page === "referrals") return <Frame title="Реферальная программа"><section className="ac-widget-grid"><Widget title="Приглашено" icon={<Users size={18} />}><strong className="ac-money">{data.referrals?.total ?? 0}</strong></Widget><Widget title="Доход" icon={<Gift size={18} />}><strong className="ac-money">{money(data.referrals?.earned ?? 0, data.profile?.preferredCurrency ?? "USD")}</strong></Widget></section></Frame>;
  if (page === "methods") return <Frame title="Способы оплаты"><EmptyState title={data.profile?.yookassaPaymentMethodTitle ? data.profile.yookassaPaymentMethodTitle : "Сохранённых способов оплаты нет"} text="Сохранённый способ появляется после успешного платежа через подключённый шлюз." /></Frame>;
  if (page === "cart") return <Frame title="Корзина"><EmptyState title="Корзина пуста" text="Заказ создаётся через мастер услуги и фиксируется в существующем журнале платежей." action={<Button onClick={() => modal("order")}><Plus size={16} /> Заказать услугу</Button>} /></Frame>;
  if (page === "statistics") return <Frame title="Статистика"><section className="ac-widget-grid"><Widget title="Подписки" icon={<Package size={18} />}><strong className="ac-money">{data.subscriptions.length}</strong></Widget><Widget title="Платежи" icon={<Wallet size={18} />}><strong className="ac-money">{data.payments.length}</strong></Widget></section></Frame>;
  if (page === "preferences") return <Preferences />;
  return <Frame title={labels[page]}><EmptyState title="Нет данных" text="Этот раздел не содержит отдельных сущностей в текущей модели сервиса; демонстрационные записи не показываются." /></Frame>;
}

function extraOptionLabel(option: PublicSellOption) {
  if (option.kind === "traffic") return `+${option.trafficGb} ГБ трафика`;
  if (option.kind === "devices") return `+${option.deviceCount} устройств`;
  return `${option.trafficGb ? `+${option.trafficGb} ГБ · ` : ""}дополнительный сервер`;
}

function ExtraOptions({ data, token, reload, refreshProfile, inform }: { data: ReturnType<typeof useBillingData>; token: string; reload: () => Promise<void>; refreshProfile: () => Promise<void>; inform: (message: string) => void }) {
  const [options, setOptions] = useState<PublicSellOption[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [selected, setSelected] = useState<PublicSellOption | null>(null);
  const [targetSubscriptionId, setTargetSubscriptionId] = useState("");
  const [method, setMethod] = useState<CheckoutMethod>("balance");
  const [plategaMethod, setPlategaMethod] = useState(2);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paymentCreationRef = useRef(false);
  const { methods, plategaMethods, loading: loadingMethods } = useAvailableCheckoutMethods(true);

  useEffect(() => {
    void api.getPublicConfig().then((config) => {
      setEnabled(Boolean(config.sellOptionsEnabled));
      setOptions(config.sellOptions ?? []);
    }).catch(() => { setEnabled(false); setOptions([]); }).finally(() => setLoadingOptions(false));
  }, []);
  useEffect(() => { if (data.subscriptions.length && !targetSubscriptionId) setTargetSubscriptionId(data.subscriptions[0].id); }, [data.subscriptions, targetSubscriptionId]);
  useEffect(() => { if (methods.length && !methods.some((item) => item.id === method)) setMethod(methods[0].id); }, [methods, method]);
  useEffect(() => { if (plategaMethods.length) setPlategaMethod(plategaMethods[0].id); }, [plategaMethods]);

  const close = () => { setSelected(null); setPaymentUrl(null); setError(null); };
  const startPayment = async () => {
    if (!selected || !targetSubscriptionId || paymentUrl || paymentCreationRef.current) return;
    paymentCreationRef.current = true;
    setError(null);
    const extraOption = { kind: selected.kind, productId: selected.id, targetSubscriptionId };
    try {
      if (method === "balance") {
        await api.clientPayOptionByBalance(token, { extraOption: { kind: selected.kind, productId: selected.id }, targetSubscriptionId });
        await Promise.all([reload(), refreshProfile()]);
        inform("Дополнительная опция оплачена и применена к подписке");
        close();
        return;
      }
      if (method === "telegram-stars") {
        const result = await api.clientCreateStarsPayment(token, { extraOption });
        const opened = openTelegramStarsInvoice(result.invoiceUrl);
        if (!opened) { setError("Оплата через Telegram Stars доступна только при запуске из Telegram (мини-приложение)."); return; }
        inform(`Оплата через Telegram Stars (${result.starsCount} ⭐). Подтвердите платёж в Telegram.`);
        close();
        return;
      }
      const url = await startExternalPayment(token, method, { extraOption }, plategaMethod);
      setPaymentUrl(url);
      inform("Ссылка на оплату создана");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать платёж");
    } finally {
      paymentCreationRef.current = false;
    }
  };

  if (loadingOptions) return <Frame title="Доп. опции"><EmptyState title="Загрузка" text="Получаем доступные дополнительные опции." /></Frame>;
  if (!enabled || options.length === 0) return <Frame title="Доп. опции" description="Трафик, устройства и серверы, настроенные администратором."><EmptyState title={enabled ? "Опции пока не настроены" : "Продажа дополнительных опций отключена"} text={enabled ? "Как только администратор добавит товары, они появятся здесь." : "Обратитесь к администратору, чтобы подключить эту возможность."} /></Frame>;

  return <><Frame title="Доп. опции" description="Улучшайте конкретную подписку: добавляйте трафик, устройства или серверы."><section className="ac-option-grid">{options.map((option) => <article className="ac-option-card" key={`${option.kind}-${option.id}`}><div><StatusBadge tone="neutral">{option.kind === "traffic" ? "ТРАФИК" : option.kind === "devices" ? "УСТРОЙСТВА" : "СЕРВЕР"}</StatusBadge><h2>{option.name || extraOptionLabel(option)}</h2><p>{extraOptionLabel(option)}</p></div><footer><strong>{money(option.price, option.currency)}</strong><Button onClick={() => { setSelected(option); setPaymentUrl(null); setError(null); }}>Выбрать</Button></footer></article>)}</section></Frame>{selected && <Modal title={`Оплата: ${selected.name || extraOptionLabel(selected)}`} onClose={close}><div className="ac-modal-body"><section className="ac-order-summary"><span>{extraOptionLabel(selected)}</span><strong>{money(selected.price, selected.currency)}</strong><small>Итоговая цена и скидка подтверждаются сервером при создании платежа.</small></section>{data.subscriptions.length > 0 ? <FormField label="Применить к подписке"><Select value={targetSubscriptionId} disabled={Boolean(paymentUrl)} onChange={(event) => setTargetSubscriptionId(event.target.value)}>{data.subscriptions.map((subscription) => <option key={subscription.id} value={subscription.id}>{subscription.plan} · {subscription.service}</option>)}</Select></FormField> : <p className="text-destructive">Сначала оформите хотя бы одну VPN-подписку: опция должна быть применена к существующей услуге.</p>}<FormField label="Способ оплаты"><Select value={method} disabled={Boolean(paymentUrl) || loadingMethods || methods.length === 0} onChange={(event) => setMethod(event.target.value as CheckoutMethod)}>{methods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></FormField>{method === "platega" && plategaMethods.length > 0 && <FormField label="Способ оплаты Platega"><Select value={String(plategaMethod)} disabled={Boolean(paymentUrl)} onChange={(event) => setPlategaMethod(Number(event.target.value))}>{plategaMethods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></FormField>}{method === "balance" && <p className="ac-hint">Текущий баланс: {money(data.profile?.balance ?? 0, data.profile?.preferredCurrency ?? selected.currency)}</p>}{paymentUrl && <ExternalPaymentLink url={paymentUrl} />}{!loadingMethods && methods.length === 0 && <p className="text-destructive">Нет подключённых платёжных систем.</p>}{error && <p className="text-destructive">{error}</p>}<div className="ac-modal-actions"><Button tone="secondary" onClick={close}>{paymentUrl ? "Закрыть" : "Отмена"}</Button>{!paymentUrl && <Button disabled={!targetSubscriptionId || loadingMethods || methods.length === 0} onClick={() => void startPayment()}>{method === "balance" ? "Оплатить с баланса" : "Создать ссылку на оплату"}</Button>}</div></div></Modal>}</>;
}

function Widget({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) { return <section className="ac-widget"><header><h2>{icon}{title}</h2></header>{children}</section>; }
function Dashboard({ data, open, modal }: { data: ReturnType<typeof useBillingData>; open: (page: PageId) => void; modal: (name: ModalName) => void }) { const first = data.subscriptions[0]; const last = data.payments[0]; return <Frame title="Главная" description="Актуальные данные вашего аккаунта" actions={<Button onClick={() => modal("order")}><Plus size={16} /> Заказать услугу</Button>}><section className="ac-quick-actions"><h2>Быстрый доступ</h2><button onClick={() => modal("order")}><Package /> Заказать VPN</button><button onClick={() => modal("topup")}><Wallet /> Пополнить баланс</button><button onClick={() => modal("ticket")}><LifeBuoy /> Задать вопрос</button><button onClick={() => open("profile")}><Settings /> Настройки</button></section><section className="ac-widget-grid"><Widget title="Мой баланс" icon={<Wallet size={18} />}><strong className="ac-money">{money(data.profile?.balance ?? 0, data.profile?.preferredCurrency ?? "USD")}</strong></Widget><Widget title="Активные услуги" icon={<Package size={18} />}>{first ? <><div className="ac-widget-line"><span>{first.plan}</span><StatusBadge tone={first.status === "ACTIVE" ? "success" : "warning"}>{first.status}</StatusBadge></div><p>до {date(first.expiresAt)} · {first.days ?? "—"} дней</p></> : <p>Активных услуг нет</p>}</Widget><Widget title="Последний платёж" icon={<ReceiptText size={18} />}>{last ? <><strong>{money(last.amount, last.currency)}</strong><p>{date(last.paidAt ?? last.createdAt)} · {last.status}</p></> : <p>Платежей пока нет</p>}</Widget><Widget title="Обращения" icon={<LifeBuoy size={18} />}><strong className="ac-money">{data.tickets.filter((ticket) => ticket.status !== "closed").length}</strong><p>Открытых запросов</p></Widget></section></Frame>; }
function Subscriptions({ data, token, modal, reload, inform }: { data: ReturnType<typeof useBillingData>; token: string; modal: (name: ModalName) => void; reload: () => Promise<void>; inform: (message: string) => void }) { const [query, setQuery] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [detail, setDetail] = useState<SubscriptionRow | null>(null); const [copied, setCopied] = useState(false); const [deleting, setDeleting] = useState(false); const rows = useMemo(() => data.subscriptions.filter((row) => `${row.service} ${row.plan}`.toLowerCase().includes(query.toLowerCase())), [data.subscriptions, query]); const toggleRenew = async () => { const row = data.subscriptions.find((item) => item.id === selected[0]); if (!row) return; try { await api.clientUpdateAutoRenew(token, { enabled: !row.autoRenew }); await reload(); inform("Настройка автопродления сохранена"); } catch (error) { inform(error instanceof Error ? error.message : "Не удалось изменить автопродление"); } }; const copyLink = async (url: string) => { try { await navigator.clipboard.writeText(url); setCopied(true); inform("Ссылка подписки скопирована"); window.setTimeout(() => setCopied(false), 2000); } catch { window.prompt("Скопируйте ссылку подписки", url); } }; const removeSubscription = async (row: SubscriptionRow) => { if (!window.confirm(`Удалить подписку «${row.plan}»? Ссылка перестанет работать, а подписка исчезнет из кабинета.`)) return; setDeleting(true); try { await api.clientDeleteSubscription(token, row.id); await reload(); setDetail(null); inform("Неактивная подписка удалена"); } catch (error) { inform(error instanceof Error ? error.message : "Не удалось удалить подписку"); } finally { setDeleting(false); } }; return <><Frame title="Подписки ASTRACAT" description="Нажмите на активную услугу, чтобы скопировать ссылку и посмотреть статистику" actions={<Button onClick={() => modal("order")}><Plus size={16} /> Заказать услугу</Button>}><section className="ac-toolbar"><div><Button tone="secondary" disabled={selected.length !== 1} onClick={toggleRenew}>Автопродление</Button></div><Input aria-label="Поиск подписок" placeholder="Поиск" value={query} onChange={(event) => setQuery(event.target.value)} /></section><div className="ac-table-wrap"><table className="ac-table"><thead><tr><th><Checkbox aria-label="Выбрать все" checked={rows.length > 0 && selected.length === rows.length} onChange={() => setSelected(selected.length === rows.length ? [] : rows.map((row) => row.id))} /></th><th>Услуга</th><th>Тариф</th><th>Статус</th><th>Окончание</th><th>Дней</th><th>Потребление</th><th>Устройства</th><th>Авто</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={`${selected.includes(row.id) ? "is-selected" : ""} ac-sub-row`} onClick={() => setDetail(row)}><td onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`Выбрать ${row.plan}`} checked={selected.includes(row.id)} onChange={() => setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></td><td>{row.service}</td><td>{row.plan}</td><td><StatusBadge tone={row.status === "ACTIVE" ? "success" : "warning"}>{row.status}</StatusBadge></td><td>{date(row.expiresAt)}</td><td>{row.days ?? "—"}</td><td>{row.traffic}</td><td>{row.devices}</td><td>{row.autoRenew ? "Включено" : "Выключено"}</td></tr>)}</tbody></table></div>{rows.length === 0 && <EmptyState title="Подписок нет" text="Оформите услугу, чтобы она появилась здесь после оплаты." />}</Frame>{detail && <Modal title={`${detail.service}${detail.plan ? ` · ${detail.plan}` : ""}`} onClose={() => setDetail(null)}><div className="ac-modal-body"><section className="ac-sub-detail"><div className="ac-widget-line"><span>Статус</span><StatusBadge tone={detail.status === "ACTIVE" ? "success" : "warning"}>{detail.status}</StatusBadge></div><div className="ac-widget-line"><span>Окончание</span><strong>{date(detail.expiresAt)}{detail.days !== null ? ` · ${detail.days} дн.` : ""}</strong></div><div className="ac-widget-line"><span>Автопродление</span><strong>{detail.autoRenew ? "Включено" : "Выключено"}</strong></div></section>{detail.subscriptionUrl ? <section className="ac-sub-link"><span>Ссылка подписки</span><div className="ac-sub-link-row"><code>{detail.subscriptionUrl}</code><Button tone="secondary" onClick={() => void copyLink(detail.subscriptionUrl!)}>{copied ? "Скопировано ✓" : "Копировать"}</Button></div><a className="ac-button ac-button--primary" href={detail.subscriptionUrl} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); window.open(detail.subscriptionUrl!, "_blank", "noopener"); }}>Открыть ссылку</a></section> : <p className="ac-hint">Ссылка подписки недоступна — проверьте статус услуги.</p>}<section className="ac-sub-stats"><h3>Статистика</h3>{detail.limitBytes !== null && detail.limitBytes > 0 ? <div className="ac-stat"><div className="ac-widget-line"><span>Трафик</span><strong>{bytes(detail.usedBytes)} / {bytes(detail.limitBytes)}</strong></div><div className="ac-progress"><i style={{ width: `${Math.min(100, ((detail.usedBytes ?? 0) / detail.limitBytes) * 100)}%` }} /></div></div> : <div className="ac-widget-line"><span>Трафик</span><strong>Безлимит</strong></div>}<div className="ac-stat"><div className="ac-widget-line"><span>Устройства</span><strong>{detail.deviceLimit ?? "—"}{detail.devicesUsed !== null ? ` · занято ${detail.devicesUsed}` : ""}</strong></div>{detail.deviceLimit !== null && detail.deviceLimit > 0 && <div className="ac-progress"><i style={{ width: `${Math.min(100, ((detail.devicesUsed ?? 0) / detail.deviceLimit) * 100)}%` }} /></div>}</div></section>{["EXPIRED", "DISABLED", "ON_HOLD", "PENDING"].includes(detail.status) && <section className="ac-sub-danger"><p className="ac-hint">Подписка неактивна. Удалите её, чтобы убрать из кабинета — ссылка перестанет работать.</p><Button tone="danger" disabled={deleting} onClick={() => void removeSubscription(detail)}>{deleting ? "Удаляем…" : "Удалить подписку"}</Button></section>}</div></Modal>}</>; }
function Payments({ payments, order, modal }: { payments: ClientPayment[]; order: boolean; modal: (name: ModalName) => void }) { return <Frame title={order ? "Заказы" : "Платежи"} actions={order ? <Button onClick={() => modal("order")}><Plus size={16} /> Заказать услугу</Button> : <Button onClick={() => modal("topup")}><Plus size={16} /> Пополнить</Button>}><div className="ac-table-wrap"><table className="ac-table"><thead><tr><th>Номер</th><th>Сумма</th><th>Статус</th><th>Создан</th><th>Оплачен</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{order ? payment.orderId : payment.id}</td><td>{money(payment.amount, payment.currency)}</td><td><StatusBadge tone={payment.status === "PAID" ? "success" : "warning"}>{payment.status}</StatusBadge></td><td>{date(payment.createdAt)}</td><td>{date(payment.paidAt)}</td></tr>)}</tbody></table></div>{payments.length === 0 && <EmptyState title="Записей нет" text="После создания платежа запись появится в этом журнале." />}</Frame>; }
function Tickets({ tickets, token, modal, reload }: { tickets: TicketRow[]; token: string; modal: (name: ModalName) => void; reload: () => Promise<void> }) {
  const [chatId, setChatId] = useState<string | null>(null);
  return <Frame title="Запросы" actions={<Button onClick={() => modal("ticket")}><Plus size={16} /> Создать запрос</Button>}><div className="ac-table-wrap"><table className="ac-table"><thead><tr><th>Тема</th><th>Статус</th><th>Обновлён</th></tr></thead><tbody>{tickets.map((ticket) => <tr key={ticket.id} className="ac-row-click" title="Открыть переписку" onClick={() => setChatId(ticket.id)}><td><strong>{ticket.subject}</strong></td><td><StatusBadge tone={ticket.status === "closed" ? "neutral" : "success"}>{ticket.status}</StatusBadge></td><td>{date(ticket.updatedAt)}</td></tr>)}</tbody></table></div>{tickets.length === 0 && <EmptyState title="Обращений нет" text="Создайте запрос — он будет сохранён в системе поддержки." />}{chatId && <TicketChatModal key={chatId} token={token} ticketId={chatId} onClose={() => setChatId(null)} onUpdated={() => { void reload(); }} />}</Frame>;
}
function TicketChatModal({ token, ticketId, onClose, onUpdated }: { token: string; ticketId: string; onClose: () => void; onUpdated: () => void }) {
  const [data, setData] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { try { const result = await api.getTicket(token, ticketId); setData(result); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : "Не удалось загрузить тикет"); } }, [token, ticketId]);
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); const interval = window.setInterval(() => { void load(); }, 8000); return () => window.clearInterval(interval); }, [load]);
  useEffect(() => { if (data?.messages?.length && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [data?.messages?.length]);
  const pickFiles = (list: FileList | null) => { if (!list) return; const arr = Array.from(list).slice(0, TICKET_MAX_FILES - files.length).filter((f) => f.type.startsWith("image/")); setFiles((prev) => [...prev, ...arr].slice(0, TICKET_MAX_FILES)); };
  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));
  const send = async () => { const trimmed = reply.trim(); if (!trimmed && files.length === 0) return; setSending(true); setErr(null); try { await api.replyTicket(token, ticketId, { content: trimmed, files: files.length > 0 ? files : undefined }); setReply(""); setFiles([]); await load(); onUpdated(); } catch (e) { setErr(e instanceof Error ? e.message : "Не удалось отправить"); } finally { setSending(false); } };
  const isClosed = data?.status === "closed";
  return <Modal title={data?.subject ?? "Обращение"} onClose={onClose} wide><div className="ac-modal-body"><div className="ac-chat-meta"><StatusBadge tone={isClosed ? "neutral" : "success"}>{isClosed ? "Закрыт" : "Открыт"}</StatusBadge>{data && <span className="ac-hint">Обновлён: {date(data.updatedAt)}</span>}</div><div ref={scrollRef} className="ac-chat-log">{loading && !data ? <div className="ac-chat-state"><span className="ac-device-spinner" /></div> : err && !data ? <div className="ac-chat-state">{err}</div> : data?.messages?.length === 0 ? <div className="ac-chat-state">Сообщений пока нет</div> : data?.messages?.map((m) => { const mine = m.authorType !== "support"; return <div key={m.id} className={`ac-msg ac-msg--${mine ? "mine" : "theirs"}`}><div className="ac-msg-bubble">{m.content && <p className="ac-msg-text">{m.content}</p>}{m.attachments && m.attachments.length > 0 && <div className="ac-msg-files">{m.attachments.map((att, i) => <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="ac-msg-file">{att.mime.startsWith("image/") ? <img src={att.url} alt={att.name ?? "attachment"} loading="lazy" /> : <span><Paperclip size={13} />{att.name ?? "файл"}</span>}</a>)}</div>}<div className="ac-msg-time">{new Date(m.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div></div></div>; })}</div>{err && data && <p className="text-destructive" style={{ margin: 0 }}>{err}</p>}{isClosed && <p className="ac-hint">Тикет закрыт — отправка ответа откроет его заново.</p>}<div className="ac-chat-reply"><input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => pickFiles(e.target.files)} />{files.length > 0 && <div className="ac-msg-files">{files.map((f, idx) => <div key={idx} className="ac-msg-file ac-msg-file--pending"><img src={URL.createObjectURL(f)} alt={f.name} /><button type="button" aria-label="Удалить" onClick={() => removeFile(idx)}><X size={12} /></button></div>)}</div>}<div className="ac-chat-reply-row"><IconButton label="Прикрепить фото" onClick={() => fileInputRef.current?.click()} disabled={files.length >= TICKET_MAX_FILES || sending}><Paperclip size={18} /></IconButton><textarea className="ac-textarea" rows={1} placeholder="Сообщение…" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} /><Button onClick={() => void send()} disabled={sending || (!reply.trim() && files.length === 0)}>{sending ? "Отправка…" : <><Send size={15} /> Отправить</>}</Button></div></div></div></Modal>;
}
function Payers({ payers, token, modal, reload, inform }: { payers: ClientPayer[]; token: string; modal: (name: ModalName) => void; reload: () => Promise<void>; inform: (message: string) => void }) { const run = async (work: () => Promise<unknown>, success: string) => { try { await work(); await reload(); inform(success); } catch (error) { inform(error instanceof Error ? error.message : "Операция не выполнена"); } }; return <Frame title="Плательщики" description="Реквизиты хранятся в вашем аккаунте и доступны для оформления услуг." actions={<Button onClick={() => modal("payer")}><Plus size={16} /> Добавить плательщика</Button>}><div className="ac-table-wrap"><table className="ac-table"><thead><tr><th>Наименование</th><th>Тип</th><th>Страна</th><th>ИНН / Tax ID</th><th>По умолчанию</th><th></th></tr></thead><tbody>{payers.map((payer) => <tr key={payer.id}><td><strong>{payer.name}</strong><br /><small>{payer.email ?? payer.address ?? "—"}</small></td><td>{payer.type === "COMPANY" ? "Компания" : "Физлицо"}</td><td>{payer.country}</td><td>{payer.taxId ?? "—"}</td><td>{payer.isDefault ? <StatusBadge tone="success">Основной</StatusBadge> : <Button tone="secondary" onClick={() => void run(() => api.updateClientPayer(token, payer.id, { isDefault: true }), "Основной плательщик обновлён")}>Сделать основным</Button>}</td><td><Button tone="secondary" onClick={() => { if (window.confirm(`Удалить плательщика «${payer.name}»?`)) void run(() => api.deleteClientPayer(token, payer.id), "Плательщик удалён"); }}>Удалить</Button></td></tr>)}</tbody></table></div>{payers.length === 0 && <EmptyState title="Плательщиков пока нет" text="Добавьте физлицо или компанию — запись будет сохранена в базе ASTRACAT." action={<Button onClick={() => modal("payer")}><Plus size={16} /> Добавить</Button>} />}</Frame>; }
function TeamMembers({ members, token, modal, reload, inform }: { members: ClientTeamMember[]; token: string; modal: (name: ModalName) => void; reload: () => Promise<void>; inform: (message: string) => void }) { const roleLabels: Record<ClientTeamMember["role"], string> = { VIEWER: "Просмотр", BILLING: "Биллинг", SUPPORT: "Поддержка", ADMIN: "Администратор" }; const run = async (work: () => Promise<unknown>, success: string) => { try { await work(); await reload(); inform(success); } catch (error) { inform(error instanceof Error ? error.message : "Операция не выполнена"); } }; return <Frame title="Роли пользователей" description="Контакты и назначенные роли дополнительных пользователей вашего аккаунта." actions={<Button onClick={() => modal("member")}><Plus size={16} /> Добавить пользователя</Button>}><div className="ac-table-wrap"><table className="ac-table"><thead><tr><th>Пользователь</th><th>Роль</th><th>Статус</th><th>Добавлен</th><th></th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><strong>{member.name}</strong><br /><small>{member.email}</small></td><td><Select value={member.role} onChange={(event) => void run(() => api.updateClientTeamMember(token, member.id, { role: event.target.value as ClientTeamMember["role"] }), "Роль обновлена")}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></td><td><Button tone="secondary" onClick={() => void run(() => api.updateClientTeamMember(token, member.id, { isActive: !member.isActive }), member.isActive ? "Пользователь отключён" : "Пользователь включён")}>{member.isActive ? "Активен" : "Отключён"}</Button></td><td>{date(member.createdAt)}</td><td><Button tone="secondary" onClick={() => { if (window.confirm(`Удалить пользователя «${member.email}»?`)) void run(() => api.deleteClientTeamMember(token, member.id), "Пользователь удалён"); }}>Удалить</Button></td></tr>)}</tbody></table></div>{members.length === 0 && <EmptyState title="Дополнительных пользователей нет" text="Добавьте пользователя и назначьте ему роль для ведения клиентского аккаунта." action={<Button onClick={() => modal("member")}><Plus size={16} /> Добавить</Button>} />}</Frame>; }
function Visits({ visits }: { visits: ClientVisit[] }) { return <Frame title="Журнал посещений" description="Записи создаёт сервер при входе и открытии клиентского кабинета."><div className="ac-table-wrap"><table className="ac-table"><thead><tr><th>Дата и время</th><th>Способ</th><th>IP-адрес</th><th>Устройство</th></tr></thead><tbody>{visits.map((visit) => <tr key={visit.id}><td>{new Date(visit.createdAt).toLocaleString("ru-RU")}</td><td>{visit.authMethod}</td><td>{visit.ip ?? "—"}</td><td title={visit.userAgent ?? undefined}>{visit.userAgent ?? "—"}</td></tr>)}</tbody></table></div>{visits.length === 0 && <EmptyState title="Посещений ещё нет" text="После первой авторизации здесь появится защищённая серверная запись." />}</Frame>; }
function Discounts({ token, profile, inform }: { token: string; profile: Awaited<ReturnType<typeof api.clientMe>> | null; inform: (message: string) => void }) { const [code, setCode] = useState(""); const [result, setResult] = useState<{ type: string; discountPercent?: number | null; discountFixed?: number | null; durationDays?: number | null; name: string } | null>(null); const [error, setError] = useState<string | null>(null); const check = async () => { try { setError(null); setResult(await api.clientCheckPromoCode(token, code.trim())); } catch (reason) { setResult(null); setError(reason instanceof Error ? reason.message : "Не удалось проверить промокод"); } }; const activate = async () => { try { const response = await api.clientActivatePromoCode(token, code.trim()); inform(response.message); setResult(null); setCode(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось активировать промокод"); } }; return <Frame title="Скидки и промокоды" description="Проверка и применение выполняются существующим серверным сервисом промокодов."><section className="ac-widget-grid"><Widget title="Персональная скидка" icon={<Gift size={18} />}><strong className="ac-money">{profile?.personalDiscountPercent ? `${profile.personalDiscountPercent}%` : "Нет"}</strong><p>{profile?.personalDiscountPercent ? "Учтётся сервером при оплате услуги." : "Администратор ещё не назначал персональную скидку."}</p></Widget><Widget title="Промокод" icon={<ReceiptText size={18} />}><div className="ac-widget-line"><Input placeholder="Введите код" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /><Button disabled={!code.trim()} onClick={() => void check()}>Проверить</Button></div>{error && <p className="text-destructive">{error}</p>}{result && <p>{result.type === "DISCOUNT" ? `${result.name}: ${result.discountPercent ? `${result.discountPercent}%` : money(result.discountFixed ?? 0, profile?.preferredCurrency ?? "RUB")}` : `${result.name}: ${result.durationDays} дней`}</p>}{result?.type === "FREE_DAYS" && <Button onClick={() => void activate()}>Активировать дни</Button>}{result?.type === "DISCOUNT" && <p className="ac-hint">Введите этот код в мастере заказа — сервер применит скидку при создании платежа.</p>}</Widget></section></Frame>; }
function OlcRtc({ categories, slots, token, modal, reload, inform }: { categories: WdttClientCategoryItem[]; slots: WdttClientSlotItem[]; token: string; modal: (name: ModalName) => void; reload: () => Promise<void>; inform: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const activeSlots = slots.filter((slot) => slot.status === "ACTIVE" && !slot.requiresConfiguration);
  const pendingSlots = slots.filter((slot) => slot.requiresConfiguration);
  const expiringSoon = slots.filter((slot) => { const days = daysUntil(slot.expiresAt); return days !== null && days <= 7; });
  const copyLink = async (slot: WdttClientSlotItem) => { try { await navigator.clipboard.writeText(slot.wdttLink); inform("Ссылка WDTT скопирована"); } catch { window.prompt("Скопируйте ссылку WDTT", slot.wdttLink); } };
  const recover = async () => { setBusy(true); try { const result = await api.recoverWdttSlots(token); await reload(); inform(result.slotsCreated ? `Восстановлено подключений: ${result.slotsCreated}` : "Пропущенных оплаченных подключений не найдено"); } catch (error) { inform(error instanceof Error ? error.message : "Не удалось проверить покупки"); } finally { setBusy(false); } };
  return <><Frame title="WDTT" description="Управляйте персональными WDTT-доступами и копируйте готовые ссылки." actions={<><Button tone="secondary" disabled={busy} onClick={() => void recover()}>Восстановить покупку</Button><Button onClick={() => modal("olcrtcOrder")}><Plus size={16} /> Купить WDTT</Button></>}><section className="ac-widget-grid"><Widget title="Активные подключения" icon={<Gauge size={18} />}><strong className="ac-money">{activeSlots.length}</strong><p>Готовы к использованию</p></Widget><Widget title="Ожидают переноса" icon={<Settings size={18} />}><strong className="ac-money">{pendingSlots.length}</strong><p>{pendingSlots.length ? "Будут перенесены администратором" : "Все доступы готовы"}</p></Widget><Widget title="Заканчиваются за 7 дней" icon={<CalendarClock size={18} />}><strong className="ac-money">{expiringSoon.length}</strong><p>Продлите услугу заранее</p></Widget></section><section className="ac-olcrtc-slots">{slots.map((slot) => { const used = numberValue(slot.trafficUsedBytes); const limit = numberValue(slot.trafficLimitBytes); const days = daysUntil(slot.expiresAt); const isWdtt = slot.wdttLink.startsWith("wdtt://"); return <article className="ac-olcrtc-slot" key={slot.id}><header><div><strong>{slot.nodeName}</strong><small>{slot.publicHost ?? "Персональное подключение"}</small></div><StatusBadge tone={slot.requiresConfiguration ? "warning" : slot.status === "ACTIVE" ? "success" : "neutral"}>{!isWdtt ? "ОЖИДАЕТ ПЕРЕНОСА" : slot.status}</StatusBadge></header><dl><div><dt>Действует до</dt><dd>{date(slot.expiresAt)}{days !== null ? ` · ${days} дн.` : ""}</dd></div><div><dt>Трафик</dt><dd>{limit === null || limit <= 0 ? "Безлимит" : `${bytes(used)} / ${bytes(limit)}`}</dd></div></dl>{slot.status === "PROVISION_FAILED" && slot.revokeReason ? <p className="text-destructive">Ошибка запуска: {slot.revokeReason}</p> : null}{!isWdtt ? <p className="ac-hint">Этот доступ ожидает переноса в WDTT. Новая ссылка появится автоматически.</p> : <label className="ac-olcrtc-link"><span>Ссылка WDTT</span><Input value={slot.wdttLink} readOnly onFocus={(event) => event.currentTarget.select()} /></label>}<footer>{!isWdtt ? <Button tone="secondary" disabled>Ожидает переноса в WDTT</Button> : <Button tone="secondary" disabled={busy} onClick={() => void copyLink(slot)}>Скопировать ссылку</Button>}</footer></article>; })}</section>{slots.length === 0 && <EmptyState title="WDTT-доступов нет" text="Выберите тариф — после успешной оплаты сервер автоматически создаст персональный WDTT-доступ. Ожидающие переноса доступы будут заменены новой WDTT-ссылкой без новой оплаты." action={<Button onClick={() => modal("olcrtcOrder")}>Выбрать тариф WDTT</Button>} />}{categories.length > 0 && <section className="ac-olcrtc-tariffs"><h2>Доступные тарифы</h2><div className="ac-widget-grid">{categories.map((category) => <Widget key={category.id} title={category.name} icon={<Gauge size={18} />}>{category.tariffs.map((tariff) => <div className="ac-widget-line" key={tariff.id}><span>{tariff.name} · {tariff.durationDays} дней</span><strong>{money(tariff.price, tariff.currency)}</strong></div>)}{category.tariffs.length === 0 && <p>Нет доступных тарифов</p>}</Widget>)}</div></section>}</Frame></>;
}
function ChangePassword({ token, inform }: { token: string; inform: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const close = () => { setOpen(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setError(null); setSuccess(false); };
  const submit = async () => {
    setError(null);
    if (!currentPassword.trim()) { setError("Введите текущий пароль"); return; }
    if (newPassword.length < 6) { setError("Новый пароль должен быть минимум 6 символов"); return; }
    if (newPassword !== confirmPassword) { setError("Пароли не совпадают"); return; }
    setBusy(true);
    try {
      await api.clientChangePassword(token, { currentPassword, newPassword });
      setSuccess(true);
      inform("Пароль изменён");
      setTimeout(() => close(), 1600);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить пароль");
    } finally {
      setBusy(false);
    }
  };
  return <><Button tone="secondary" onClick={() => setOpen(true)}>Сменить пароль</Button>
    {open && <Modal title="Смена пароля" onClose={close}><div className="ac-modal-body"><section className="ac-form-grid">
      <FormField label="Текущий пароль"><Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></FormField>
      <FormField label="Новый пароль"><Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></FormField>
      <FormField label="Повторите пароль"><Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></FormField>
    </section>{success && <p style={{ color: "#16a34a", marginBottom: 8 }}>Пароль изменён.</p>}{error && <p style={{ color: "#dc2626", marginBottom: 8 }}>{error}</p>}<div className="ac-modal-actions"><Button tone="secondary" onClick={close} disabled={busy}>Отмена</Button><Button disabled={busy} onClick={() => void submit()}>{busy ? "Сохраняем…" : "Сохранить"}</Button></div></div></Modal>}</>;
}
function Profile({ token, profile, refresh, inform }: { token: string; profile: Awaited<ReturnType<typeof api.clientMe>> | null; refresh: () => Promise<void>; inform: (message: string) => void }) { const [language, setLanguage] = useState(profile?.preferredLang ?? "ru"); const [currency, setCurrency] = useState(profile?.preferredCurrency ?? "USD"); const [autoRenew, setAutoRenew] = useState(Boolean(profile?.autoRenewEnabled)); const save = async () => { try { await api.clientUpdateProfile(token, { preferredLang: language, preferredCurrency: currency }); await refresh(); inform("Профиль сохранён"); } catch (error) { inform(error instanceof Error ? error.message : "Не удалось сохранить профиль"); } }; const changeRenew = async (enabled: boolean) => { try { await api.clientUpdateAutoRenew(token, { enabled }); setAutoRenew(enabled); inform("Настройка автопродления сохранена"); } catch (error) { inform(error instanceof Error ? error.message : "Не удалось сохранить настройку"); } }; return <Frame title="Профиль" actions={<Button onClick={() => void save()}>Сохранить</Button>}><section className="ac-form-grid"><FormField label="Email"><Input value={profile?.email ?? ""} disabled /></FormField><FormField label="Telegram"><Input value={profile?.telegramUsername ?? profile?.telegramId ?? "Не привязан"} disabled /></FormField><FormField label="Язык"><Select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="ru">Русский</option><option value="en">English</option></Select></FormField><FormField label="Валюта"><Select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="RUB">RUB</option><option value="USD">USD</option><option value="EUR">EUR</option></Select></FormField></section><section className="ac-security"><h2>Безопасность и продление</h2><Switcher label="Автопродление услуг" checked={autoRenew} onChange={(value) => void changeRenew(value)} /><ChangePassword token={token} inform={inform} /></section></Frame>; }
function Renewals({ data, token, reload, inform }: { data: ReturnType<typeof useBillingData>; token: string; reload: () => Promise<void>; inform: (message: string) => void }) { const enabled = Boolean(data.profile?.autoRenewEnabled); return <Frame title="Автопродление услуг"><section className="ac-widget-grid"><Widget title="Статус" icon={<CalendarClock size={18} />}><StatusBadge tone={enabled ? "success" : "neutral"}>{enabled ? "Включено" : "Выключено"}</StatusBadge><p>{data.profile?.autoRenewPromoCode ? `Промокод: ${data.profile.autoRenewPromoCode}` : "Промокод не выбран"}</p></Widget><Widget title="Активные подписки" icon={<Package size={18} />}><strong className="ac-money">{data.subscriptions.length}</strong></Widget></section><Button className="mt-3" onClick={async () => { try { await api.clientUpdateAutoRenew(token, { enabled: !enabled }); await reload(); inform("Автопродление обновлено"); } catch (error) { inform(error instanceof Error ? error.message : "Не удалось обновить настройку"); } }}>{enabled ? "Отключить" : "Включить"}</Button></Frame>; }
function Usage({ data }: { data: ReturnType<typeof useBillingData> }) { return <Frame title="Потребление ресурсов"><div className="ac-table-wrap"><table className="ac-table"><thead><tr><th>Подписка</th><th>Тариф</th><th>Трафик</th><th>Устройства</th></tr></thead><tbody>{data.subscriptions.map((row) => <tr key={row.id}><td>{row.service}</td><td>{row.plan}</td><td>{row.traffic}</td><td>{row.devices}</td></tr>)}</tbody></table></div><p className="ac-hint">Всего зарегистрированных устройств: {data.devices}</p></Frame>; }
function Preferences() { const [rows, setRows] = useState(localStorage.getItem("astracat-rows") ?? "25"); return <Frame title="Настройки пользователя"><section className="ac-form-grid"><FormField label="Строк на странице"><Select value={rows} onChange={(event) => { setRows(event.target.value); localStorage.setItem("astracat-rows", event.target.value); }}><option value="25">25</option><option value="50">50</option></Select></FormField></section><p className="ac-hint">Параметры интерфейса хранятся только на этом устройстве.</p></Frame>; }

// ─── Утилиты для возвратов ───
const REFUND_WINDOW_DAYS = 3;
const REFUND_MIN_AMOUNT = 100;
const REFUNDS_STORAGE_KEY = "astracat-refund-history";

function loadRefunds(): RefundRecord[] {
  try { return JSON.parse(localStorage.getItem(REFUNDS_STORAGE_KEY) ?? "[]") as RefundRecord[]; } catch { return []; }
}
function saveRefunds(records: RefundRecord[]) {
  localStorage.setItem(REFUNDS_STORAGE_KEY, JSON.stringify(records));
}
function canRefund(payment: ClientPayment): { ok: boolean; reason?: string } {
  if (payment.status !== "PAID") return { ok: false, reason: "Платёж ещё не оплачен" };
  if (payment.amount < REFUND_MIN_AMOUNT) return { ok: false, reason: `Возврат доступен только для платежей от ${REFUND_MIN_AMOUNT} ₽` };
  const paidAt = new Date(payment.paidAt ?? payment.createdAt).getTime();
  const daysAgo = (Date.now() - paidAt) / 86_400_000;
  if (daysAgo > REFUND_WINDOW_DAYS) return { ok: false, reason: `Срок возврата (${REFUND_WINDOW_DAYS} дня) истёк` };
  return { ok: true };
}

function refundStatusLabel(status: RefundRecord["status"]) {
  if (status === "pending") return { label: "Обрабатывается", tone: "warning" as const };
  if (status === "approved") return { label: "Одобрен", tone: "success" as const };
  return { label: "Отклонён", tone: "danger" as const };
}

function Refunds({ payments, subscriptions, token, profile, reload, inform }: { payments: ClientPayment[]; subscriptions: SubscriptionRow[]; token: string; profile: Awaited<ReturnType<typeof api.clientMe>> | null; reload: () => Promise<void>; inform: (message: string) => void }) {
  const [history, setHistory] = useState<RefundRecord[]>(loadRefunds);
  const [selected, setSelected] = useState<ClientPayment | null>(null);
  const [subId, setSubId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const paidPayments = payments.filter((p) => p.status === "PAID");
  const alreadyRefunded = new Set(history.map((r) => r.paymentId));

  const openRefund = (payment: ClientPayment) => {
    setSelected(payment);
    setSubId(subscriptions[0]?.id ?? "");
    setError(null);
    setConfirm(false);
  };

  const submitRefund = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Вызываем реальный API возврата — деактивирует подписку + зачисляет баланс
      const result = await api.clientRefund(token, { paymentId: selected.id, subscriptionId: subId || undefined });

      const record: RefundRecord = {
        id: `rfnd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        paymentId: selected.id,
        amount: selected.amount,
        currency: selected.currency,
        status: result.ok ? "approved" : "pending",
        reason: "Возврат оформлен через личный кабинет",
        subscriptionId: subId,
        subscriptionName: subscriptions.find((s) => s.id === subId)?.plan ?? "—",
        createdAt: new Date().toISOString(),
      };
      const updated = [record, ...history];
      setHistory(updated);
      saveRefunds(updated);
      await reload();
      inform(result.message);
      setSelected(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось оформить возврат");
    } finally {
      setBusy(false);
    }
  };


  return (
    <>
      <Frame title="Возвраты" description={`Возврат доступен в течение ${REFUND_WINDOW_DAYS} дней с момента оплаты для платежей от ${REFUND_MIN_AMOUNT} ₽. Средства зачисляются на баланс кабинета.`}>
        <section className="ac-widget-grid" style={{ marginBottom: 16 }}>
          <Widget title="Всего возвратов" icon={<RotateCcw size={18} />}><strong className="ac-money">{history.length}</strong></Widget>
          <Widget title="Сумма возвратов" icon={<Wallet size={18} />}><strong className="ac-money">{money(history.filter((r) => r.status === "approved").reduce((sum, r) => sum + r.amount, 0), profile?.preferredCurrency ?? "RUB")}</strong></Widget>
        </section>
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead><tr><th>Платёж</th><th>Сумма</th><th>Статус платежа</th><th>Оплачен</th><th>Дней до истечения</th><th>Действие</th></tr></thead>
            <tbody>
              {paidPayments.map((payment) => {
                const check = canRefund(payment);
                const refunded = alreadyRefunded.has(payment.id);
                const paidAt = new Date(payment.paidAt ?? payment.createdAt).getTime();
                const daysLeft = Math.max(0, REFUND_WINDOW_DAYS - Math.floor((Date.now() - paidAt) / 86_400_000));
                return (
                  <tr key={payment.id}>
                    <td><code style={{ fontFamily: "monospace", fontSize: 11 }}>{payment.orderId || payment.id.slice(0, 8)}</code></td>
                    <td><strong>{money(payment.amount, payment.currency)}</strong></td>
                    <td><StatusBadge tone="success">{payment.status}</StatusBadge></td>
                    <td>{date(payment.paidAt ?? payment.createdAt)}</td>
                    <td>
                      {check.ok ? (
                        <span className="ac-refund-countdown">
                          <span className="ac-refund-countdown-dot" />
                          {daysLeft === 0 ? "Последний день" : `${daysLeft} дн.`}
                        </span>
                      ) : <span style={{ color: "var(--ac-secondary)", fontSize: 12 }}>—</span>}
                    </td>
                    <td>
                      {refunded ? (
                        <StatusBadge tone="neutral">Заявка подана</StatusBadge>
                      ) : check.ok ? (
                        <Button tone="secondary" onClick={() => openRefund(payment)}><RotateCcw size={14} /> Вернуть</Button>
                      ) : (
                        <span className="ac-refund-reason" title={check.reason}>{check.reason}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {paidPayments.length === 0 && <EmptyState title="Оплаченных платежей нет" text="После успешной оплаты здесь появится список платежей, по которым можно оформить возврат." />}
      </Frame>

      {history.length > 0 && (
        <Frame title="История возвратов" description="Все оформленные заявки на возврат средств.">
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead><tr><th>Дата</th><th>Платёж</th><th>Подписка</th><th>Сумма</th><th>Статус</th></tr></thead>
              <tbody>
                {history.map((record) => {
                  const { label, tone } = refundStatusLabel(record.status);
                  return (
                    <tr key={record.id}>
                      <td>{date(record.createdAt)}</td>
                      <td><code style={{ fontFamily: "monospace", fontSize: 11 }}>{record.paymentId.slice(0, 12)}…</code></td>
                      <td>{record.subscriptionName}</td>
                      <td><strong>{money(record.amount, record.currency)}</strong></td>
                      <td><StatusBadge tone={tone}>{label}</StatusBadge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Frame>
      )}

      {selected && (
        <Modal title="Оформить возврат" onClose={() => { setSelected(null); setConfirm(false); }}>
          <div className="ac-modal-body">
            <div className="ac-refund-warning">
              <RotateCcw size={20} />
              <div>
                <strong>Внимание!</strong>
                <p>После подтверждения возврата подписка будет деактивирована, а {money(selected.amount, selected.currency)} будут зачислены на баланс кабинета в течение 1–2 рабочих дней.</p>
              </div>
            </div>
            <section className="ac-order-summary">
              <div className="ac-widget-line"><span>Платёж</span><strong>{selected.orderId || selected.id.slice(0, 12)}</strong></div>
              <div className="ac-widget-line"><span>Сумма к возврату</span><strong>{money(selected.amount, selected.currency)}</strong></div>
              <div className="ac-widget-line"><span>Зачисление</span><strong>На баланс кабинета</strong></div>
            </section>
            {subscriptions.length > 0 && (
              <FormField label="К какой подписке относится платёж">
                <Select value={subId} onChange={(e) => setSubId(e.target.value)}>
                  {subscriptions.map((sub) => <option key={sub.id} value={sub.id}>{sub.plan} · {sub.service}</option>)}
                </Select>
              </FormField>
            )}
            <label className="ac-refund-confirm-label">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              Я понимаю, что после возврата подписка будет деактивирована
            </label>
            {error && <p className="text-destructive">{error}</p>}
            <div className="ac-modal-actions">
              <Button tone="secondary" onClick={() => { setSelected(null); setConfirm(false); }}>Отмена</Button>
              <Button tone="danger" disabled={!confirm || busy} onClick={() => void submitRefund()}>
                {busy ? "Оформляем…" : "Подтвердить возврат"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── Управление устройствами ───
function DeviceManager({ subscriptions, token, inform }: { subscriptions: SubscriptionRow[]; token: string; inform: (message: string) => void }) {
  const [selectedSubId, setSelectedSubId] = useState<string>(subscriptions[0]?.id ?? "");
  const [devices, setDevices] = useState<ClientDeviceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deletingHwid, setDeletingHwid] = useState<string | null>(null);

  const selectedSub = subscriptions.find((s) => s.id === selectedSubId);

  const loadDevices = useCallback(async () => {
    if (!selectedSubId) return;
    setLoading(true);
    try {
      const result = await api.getMyAllDevices(token);
      setDevices(result.items.filter((d) => d.subscriptionId === selectedSubId));
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, [token, selectedSubId]);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  const deleteDevice = async (hwid: string) => {
    if (busy) return;
    setBusy(true);
    setDeletingHwid(hwid);
    try {
      await api.deleteClientDevice(token, hwid, selectedSub ? { type: selectedSub.type, id: selectedSub.id } : undefined);
      inform("Устройство удалено. При следующем подключении оно привяжется заново.");
      await loadDevices();
    } catch (reason) {
      inform(reason instanceof Error ? reason.message : "Не удалось удалить устройство");
    } finally {
      setBusy(false);
      setDeletingHwid(null);
    }
  };

  const resetAllDevices = async () => {
    if (busy || !selectedSub) return;
    setBusy(true);
    try {
      // Удаляем все устройства по одному
      for (const device of devices) {
        await api.deleteClientDevice(token, device.hwid, { type: selectedSub.type, id: selectedSub.id });
      }
      inform(`Все устройства сброшены (${devices.length} шт.). При следующем подключении они привяжутся заново.`);
      await loadDevices();
    } catch (reason) {
      inform(reason instanceof Error ? reason.message : "Не удалось сбросить устройства");
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  };

  function platformIcon(platform?: string) {
    if (!platform) return "📱";
    const p = platform.toLowerCase();
    if (p.includes("ios") || p.includes("mac")) return "🍎";
    if (p.includes("android")) return "🤖";
    if (p.includes("win")) return "🪟";
    if (p.includes("linux")) return "🐧";
    return "💻";
  }

  return (
    <>
      <Frame
        title="Управление устройствами"
        description="Устройства, привязанные к вашим подпискам. После удаления устройство автоматически привяжется заново при следующем подключении."
        actions={
          <>
            {subscriptions.length > 1 && (
              <Select value={selectedSubId} onChange={(e) => setSelectedSubId(e.target.value)} style={{ minWidth: 200 }}>
                {subscriptions.map((sub) => <option key={sub.id} value={sub.id}>{sub.plan} · {sub.service}</option>)}
              </Select>
            )}
            <Button tone="danger" disabled={devices.length === 0 || busy} onClick={() => setConfirmReset(true)}>
              <Trash2 size={15} /> Сбросить все
            </Button>
          </>
        }
      >
        {selectedSub && (
          <div className="ac-device-sub-info">
            <div className="ac-device-sub-badge">
              <Smartphone size={15} />
              <span>{selectedSub.plan}</span>
              <StatusBadge tone={selectedSub.status === "ACTIVE" ? "success" : "warning"}>{selectedSub.status}</StatusBadge>
            </div>
            <span className="ac-device-sub-limit">
              Устройств: <strong>{devices.length}</strong> из <strong>{selectedSub.deviceLimit ?? "∞"}</strong>
            </span>
          </div>
        )}

        {loading ? (
          <div className="ac-device-loading"><div className="ac-device-spinner" /><span>Загружаем список устройств…</span></div>
        ) : devices.length === 0 ? (
          <EmptyState title="Устройств нет" text="К этой подписке пока не привязано ни одного устройства. Подключитесь через приложение — устройство появится автоматически." />
        ) : (
          <div className="ac-device-grid">
            {devices.map((device) => (
              <article className="ac-device-card" key={device.hwid}>
                <div className="ac-device-card-icon">{platformIcon(device.platform)}</div>
                <div className="ac-device-card-body">
                  <strong className="ac-device-name">
                    {device.deviceModel || device.appName || "Устройство"}
                  </strong>
                  <span className="ac-device-os">{device.platform || "ОС неизвестна"}</span>
                  {device.appName && device.appName !== device.deviceModel && (
                    <span className="ac-device-app">{device.appName}</span>
                  )}
                  <div className="ac-device-dates">
                    <span>Привязано: {device.createdAt ? date(device.createdAt) : "—"}</span>
                  </div>
                  <code className="ac-device-hwid" title="Hardware ID">{device.hwid.slice(0, 20)}…</code>
                </div>
                <button
                  className="ac-device-delete"
                  disabled={busy}
                  title="Удалить устройство"
                  onClick={() => void deleteDevice(device.hwid)}
                >
                  {deletingHwid === device.hwid ? <div className="ac-device-spinner ac-device-spinner--sm" /> : <Trash2 size={15} />}
                </button>
              </article>
            ))}
          </div>
        )}
      </Frame>

      {confirmReset && (
        <Modal title="Сбросить все устройства" onClose={() => setConfirmReset(false)}>
          <div className="ac-modal-body">
            <div className="ac-refund-warning">
              <Trash2 size={20} />
              <div>
                <strong>Подтвердите действие</strong>
                <p>Будут удалены все <strong>{devices.length}</strong> устройств, привязанных к подписке «{selectedSub?.plan}». При следующем подключении устройства привяжутся заново автоматически.</p>
              </div>
            </div>
            <div className="ac-modal-actions">
              <Button tone="secondary" onClick={() => setConfirmReset(false)}>Отмена</Button>
              <Button tone="danger" disabled={busy} onClick={() => void resetAllDevices()}>
                {busy ? "Сбрасываем…" : `Удалить все (${devices.length})`}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function BillingModal({ name, token, tariffCategories, olcrtcCategories, subscriptions, close, inform, reload }: { name: Exclude<ModalName, null>; token: string; tariffCategories: PublicTariffCategory[]; olcrtcCategories: WdttClientCategoryItem[]; subscriptions: SubscriptionRow[]; close: () => void; inform: (message: string) => void; reload: () => Promise<void> }) { const [amount, setAmount] = useState(""); const [subject, setSubject] = useState(""); const [message, setMessage] = useState(""); const [payerName, setPayerName] = useState(""); const [payerCountry, setPayerCountry] = useState("RU"); const [payerType, setPayerType] = useState<ClientPayer["type"]>("PERSON"); const [payerTaxId, setPayerTaxId] = useState(""); const [payerEmail, setPayerEmail] = useState(""); const [payerAddress, setPayerAddress] = useState(""); const [memberName, setMemberName] = useState(""); const [memberEmail, setMemberEmail] = useState(""); const [memberRole, setMemberRole] = useState<ClientTeamMember["role"]>("VIEWER"); const [error, setError] = useState<string | null>(null); const [paymentUrl, setPaymentUrl] = useState<string | null>(null); const paymentCreationRef = useRef(false); const { methods: topupMethods, plategaMethods: topupPlategaMethods, loading: loadingTopupMethods } = useAvailableCheckoutMethods(false); const [topupMethod, setTopupMethod] = useState<Exclude<CheckoutMethod, "balance">>("yookassa"); const [topupPlategaMethod, setTopupPlategaMethod] = useState(2); useEffect(() => { if (topupMethods.length && !topupMethods.some((item) => item.id === topupMethod)) setTopupMethod(topupMethods[0].id as Exclude<CheckoutMethod, "balance">); }, [topupMethods, topupMethod]); useEffect(() => { if (topupPlategaMethods.length) setTopupPlategaMethod(topupPlategaMethods[0].id); }, [topupPlategaMethods]); const createTopup = async () => { if (paymentUrl || paymentCreationRef.current || !Number(amount)) return; paymentCreationRef.current = true; setError(null); try { if (topupMethod === "telegram-stars") { const result = await api.clientCreateStarsPayment(token, { amount: Number(amount), currency: "RUB" }); const opened = openTelegramStarsInvoice(result.invoiceUrl); if (!opened) { setError("Оплата через Telegram Stars доступна только при запуске из Telegram (мини-приложение)."); return; } inform(`Оплата через Telegram Stars (${result.starsCount} ⭐). Подтвердите платёж в Telegram.`); close(); return; } const url = await startExternalPayment(token, topupMethod, { amount: Number(amount), currency: "RUB" }, topupPlategaMethod); setPaymentUrl(url); inform("Ссылка на оплату создана"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать платёж"); } finally { paymentCreationRef.current = false; } }; const submit = async (work: () => Promise<void>) => { try { setError(null); await work(); await reload(); close(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Операция не выполнена"); } };
  if (name === "payer") return <Modal title="Новый плательщик" onClose={close}><div className="ac-modal-body"><section className="ac-form-grid"><FormField label="Тип"><Select value={payerType} onChange={(event) => setPayerType(event.target.value as ClientPayer["type"])}><option value="PERSON">Физическое лицо</option><option value="COMPANY">Компания</option></Select></FormField><FormField label="Страна (ISO-2)"><Input maxLength={2} value={payerCountry} onChange={(event) => setPayerCountry(event.target.value.toUpperCase())} /></FormField><FormField label={payerType === "COMPANY" ? "Название компании" : "ФИО"}><Input value={payerName} onChange={(event) => setPayerName(event.target.value)} /></FormField><FormField label="ИНН / Tax ID"><Input value={payerTaxId} onChange={(event) => setPayerTaxId(event.target.value)} /></FormField><FormField label="Email"><Input type="email" value={payerEmail} onChange={(event) => setPayerEmail(event.target.value)} /></FormField><FormField label="Адрес"><Input value={payerAddress} onChange={(event) => setPayerAddress(event.target.value)} /></FormField></section>{error && <p className="text-destructive">{error}</p>}<div className="ac-modal-actions"><Button tone="secondary" onClick={close}>Отмена</Button><Button disabled={!payerName.trim() || payerCountry.length !== 2} onClick={() => void submit(async () => { await api.createClientPayer(token, { type: payerType, country: payerCountry, name: payerName.trim(), taxId: payerTaxId.trim() || null, email: payerEmail.trim() || null, address: payerAddress.trim() || null, isDefault: false }); inform("Плательщик добавлен"); })}>Сохранить</Button></div></div></Modal>;
  if (name === "member") return <Modal title="Новый пользователь" onClose={close}><div className="ac-modal-body"><section className="ac-form-grid"><FormField label="Имя"><Input value={memberName} onChange={(event) => setMemberName(event.target.value)} /></FormField><FormField label="Email"><Input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} /></FormField><FormField label="Роль"><Select value={memberRole} onChange={(event) => setMemberRole(event.target.value as ClientTeamMember["role"])}><option value="VIEWER">Просмотр</option><option value="BILLING">Биллинг</option><option value="SUPPORT">Поддержка</option><option value="ADMIN">Администратор</option></Select></FormField></section><p className="ac-hint">Роль и контакт будут сохранены в клиентском аккаунте.</p>{error && <p className="text-destructive">{error}</p>}<div className="ac-modal-actions"><Button tone="secondary" onClick={close}>Отмена</Button><Button disabled={!memberName.trim() || !memberEmail.trim()} onClick={() => void submit(async () => { await api.createClientTeamMember(token, { name: memberName.trim(), email: memberEmail.trim(), role: memberRole, isActive: true }); inform("Пользователь добавлен"); })}>Сохранить</Button></div></div></Modal>;
  if (name === "topup") return <Modal title="Пополнение баланса" onClose={close}><div className="ac-modal-body"><FormField label="Сумма"><Input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={Boolean(paymentUrl)} /></FormField><FormField label="Платёжная система"><Select value={topupMethod} disabled={Boolean(paymentUrl) || loadingTopupMethods || topupMethods.length === 0} onChange={(event) => setTopupMethod(event.target.value as Exclude<CheckoutMethod, "balance">)}>{topupMethods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></FormField>{topupMethod === "platega" && topupPlategaMethods.length > 0 && <FormField label="Способ оплаты Platega"><Select value={String(topupPlategaMethod)} disabled={Boolean(paymentUrl)} onChange={(event) => setTopupPlategaMethod(Number(event.target.value))}>{topupPlategaMethods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></FormField>}<p className="ac-hint">Показываются только платёжные системы, подключённые администратором.</p>{paymentUrl && <ExternalPaymentLink url={paymentUrl} />}{!loadingTopupMethods && topupMethods.length === 0 && <p className="text-destructive">Нет подключённых платёжных систем.</p>}{error && <p className="text-destructive">{error}</p>}<div className="ac-modal-actions"><Button tone="secondary" onClick={close}>{paymentUrl ? "Закрыть" : "Отмена"}</Button>{!paymentUrl && <Button disabled={!Number(amount) || loadingTopupMethods || topupMethods.length === 0} onClick={() => void createTopup()}>Создать ссылку на оплату</Button>}</div></div></Modal>;
  if (name === "ticket") return <Modal title="Новое обращение" onClose={close}><div className="ac-modal-body"><FormField label="Тема"><Input value={subject} onChange={(event) => setSubject(event.target.value)} /></FormField><FormField label="Сообщение"><Textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} /></FormField>{error && <p className="text-destructive">{error}</p>}<div className="ac-modal-actions"><Button tone="secondary" onClick={close}>Отмена</Button><Button disabled={!subject.trim() || !message.trim()} onClick={() => void submit(async () => { await api.createTicket(token, { subject: subject.trim(), message: message.trim() }); inform("Обращение создано"); })}>Отправить</Button></div></div></Modal>;
  return <OrderModal token={token} tariffCategories={tariffCategories} olcrtcCategories={olcrtcCategories} subscriptions={subscriptions} initialProduct={name === "olcrtcOrder" ? "olcrtc" : "vpn"} close={close} reload={reload} inform={inform} />;
}

type CheckoutMethod = "balance" | "yookassa" | "yoomoney" | "cryptopay" | "heleket" | "lava" | "lavatop" | "freekassa-sbp" | "freekassa-card" | "overpay" | "platega" | "telegram-stars";
type CheckoutProduct = "vpn" | "olcrtc";

function useAvailableCheckoutMethods(includeBalance: boolean) {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof api.getPublicConfig>> | null>(null);
  useEffect(() => { void api.getPublicConfig().then(setConfig).catch(() => setConfig(null)); }, []);
  const methods = useMemo(() => {
    const result: Array<{ id: CheckoutMethod; label: string }> = includeBalance ? [{ id: "balance", label: "Баланс ASTRACAT" }] : [];
    if (!config) return result;
    if (config.yookassaEnabled) result.push({ id: "yookassa", label: "ЮKassa" });
    if (config.yoomoneyEnabled) result.push({ id: "yoomoney", label: "ЮMoney" });
    if (config.cryptopayEnabled) result.push({ id: "cryptopay", label: "Crypto Pay" });
    if (config.heleketEnabled) result.push({ id: "heleket", label: "Heleket" });
    if (config.lavaEnabled) result.push({ id: "lava", label: "LAVA" });
    if (config.lavatopEnabled) result.push({ id: "lavatop", label: "Lava.top" });
    if (config.freekassaEnabled) {
      result.push({ id: "freekassa-sbp", label: "FreeKassa (СБП)" });
      result.push({ id: "freekassa-card", label: "FreeKassa (Карта)" });
    }
    if (config.overpayEnabled) result.push({ id: "overpay", label: "Overpay" });
    if (config.plategaMethods?.length) result.push({ id: "platega", label: "Platega" });
    if (config.telegramStarsEnabled) result.push({ id: "telegram-stars", label: "Telegram Stars" });
    return result;
  }, [config, includeBalance]);
  return { methods, plategaMethods: config?.plategaMethods ?? [], loading: config === null };
}

async function startExternalPayment(token: string, method: Exclude<CheckoutMethod, "balance">, payload: { amount?: number; currency?: string; tariffId?: string; wdttTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string; targetSubscriptionId?: string }; extendsSecondarySubId?: string; asAdditional?: boolean }, plategaMethod: number): Promise<string> {
  if (method === "yookassa") { const result = await api.yookassaCreatePayment(token, payload); return result.confirmationUrl; }
  if (method === "yoomoney") { const result = await api.yoomoneyCreateFormPayment(token, { ...payload, paymentType: "AC" }); return result.paymentUrl; }
  if (method === "cryptopay") { const result = await api.cryptopayCreatePayment(token, payload); return result.payUrl; }
  if (method === "heleket") { const result = await api.heleketCreatePayment(token, payload); return result.payUrl; }
  if (method === "lava") { const result = await api.lavaCreatePayment(token, payload); return result.payUrl; }
  if (method === "lavatop") { const result = await api.lavatopCreatePayment(token, payload); return result.payUrl; }
  if (method === "freekassa-sbp") { const result = await api.freekassaCreatePayment(token, { ...payload, method: "sbp" }); return result.payUrl; }
  if (method === "freekassa-card") { const result = await api.freekassaCreatePayment(token, { ...payload, method: "cardRub" }); return result.payUrl; }
  if (method === "overpay") { const result = await api.overpayCreatePayment(token, payload); return result.payUrl; }
  const result = await api.clientCreatePlategaPayment(token, { ...payload, paymentMethod: plategaMethod }); return result.paymentUrl;
}

function ExternalPaymentLink({ url }: { url: string }) {
  return <a className="ac-button ac-button--primary" href={url} onClick={(event) => { event.preventDefault(); preparePaymentRedirect().open(url); }}>Открыть страницу оплаты</a>;
}

function OrderModal({ token, tariffCategories, olcrtcCategories, subscriptions, initialProduct, close, reload, inform }: { token: string; tariffCategories: PublicTariffCategory[]; olcrtcCategories: WdttClientCategoryItem[]; subscriptions: SubscriptionRow[]; initialProduct: CheckoutProduct; close: () => void; reload: () => Promise<void>; inform: (message: string) => void }) {
  const [step, setStep] = useState(1); const [product, setProduct] = useState<CheckoutProduct>(initialProduct); const [categoryId, setCategoryId] = useState(""); const [planId, setPlanId] = useState(""); const [method, setMethod] = useState<CheckoutMethod>("balance"); const [promoCode, setPromoCode] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [paymentUrl, setPaymentUrl] = useState<string | null>(null); const paymentCreationRef = useRef(false);
  // Выбор «Продлить существующую подписку / Купить новую» — только для VPN (как в боте).
  // null — ещё не выбрано; "renew" — продлить конкретную (extendsSecondarySubId); "add" — новая (asAdditional).
  const [purchaseKind, setPurchaseKind] = useState<"renew" | "add" | null>(null);
  const [renewSubId, setRenewSubId] = useState("");
  const { methods: configuredMethods, plategaMethods } = useAvailableCheckoutMethods(true); const [plategaMethod, setPlategaMethod] = useState(2);
  const categories = product === "vpn" ? tariffCategories : olcrtcCategories;
  const availableMethods = configuredMethods.filter((item) => !(product === "olcrtc" && item.id === "lavatop"));
  const category = categories.find((item) => item.id === categoryId);
  const plans = category?.tariffs ?? [];
  const plan = plans.find((item) => item.id === planId);
  // Подписки клиента с тем же тарифом — кандидаты на продление.
  const matchingSubs = useMemo(() => subscriptions.filter((sub) => sub.tariffId === planId && sub.status !== "CLOSED" && sub.status !== "TERMINATED"), [subscriptions, planId]);
  const setProductAndReset = (value: CheckoutProduct) => { setProduct(value); setCategoryId(""); setPlanId(""); setPurchaseKind(null); setRenewSubId(""); setStep(1); };
  const chooseCategory = (value: string) => { setCategoryId(value); setPlanId(""); setPurchaseKind(null); setRenewSubId(""); };
  useEffect(() => { if (matchingSubs.length && !matchingSubs.some((sub) => sub.id === renewSubId)) setRenewSubId(matchingSubs[0].id); }, [matchingSubs, renewSubId]);
  useEffect(() => { if (matchingSubs.length && purchaseKind === null) setPurchaseKind("renew"); else if (!matchingSubs.length && purchaseKind !== null) setPurchaseKind(null); }, [matchingSubs, purchaseKind]);
  useEffect(() => { if (availableMethods.length && !availableMethods.some((item) => item.id === method)) setMethod(availableMethods[0].id); }, [availableMethods, method]);
  useEffect(() => { if (plategaMethods.length) setPlategaMethod(plategaMethods[0].id); }, [plategaMethods]);
  const execute = async () => {
    if (!plan || paymentUrl || paymentCreationRef.current) return; paymentCreationRef.current = true; setBusy(true); setError(null);
    const multiFlags = purchaseKind === "renew" && renewSubId ? { extendsSecondarySubId: renewSubId } : purchaseKind === "add" ? { asAdditional: true } : {};
    const payload = product === "vpn" ? { tariffId: plan.id, promoCode: promoCode.trim() || undefined, ...multiFlags } : { wdttTariffId: plan.id, promoCode: promoCode.trim() || undefined };
    try {
      if (method === "balance") { const result = await api.clientPayByBalance(token, payload); inform(result.message); await reload(); close(); return; }
      if (method === "telegram-stars") { const result = await api.clientCreateStarsPayment(token, payload); const opened = openTelegramStarsInvoice(result.invoiceUrl); if (!opened) { setError("Оплата через Telegram Stars доступна только при запуске из Telegram (мини-приложение)."); return; } inform(`Оплата через Telegram Stars (${result.starsCount} ⭐). Подтвердите платёж в Telegram.`); close(); return; }
      const url = await startExternalPayment(token, method, payload, plategaMethod); setPaymentUrl(url); inform("Ссылка на оплату создана");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать платёж"); } finally { paymentCreationRef.current = false; setBusy(false); }
  };
  return <Modal title={product === "olcrtc" ? "Заказ WDTT" : "Заказ услуги"} onClose={close}><div className="ac-modal-body"><Stepper step={step} total={3} />{step === 1 && <section className="ac-form-grid"><FormField label="Продукт"><Select value={product} onChange={(event) => setProductAndReset(event.target.value as CheckoutProduct)}><option value="vpn">VPN-подписка</option><option value="olcrtc">WDTT</option></Select></FormField><FormField label="Категория"><Select value={categoryId} onChange={(event) => chooseCategory(event.target.value)}><option value="">Выберите категорию</option>{categories.map((item) => <option key={item.id} value={item.id}>{"emoji" in item && item.emoji ? `${item.emoji} ${item.name}` : item.name}</option>)}</Select></FormField><FormField label="Тариф"><Select value={planId} disabled={!categoryId} onChange={(event) => setPlanId(event.target.value)}><option value="">Выберите тариф</option>{plans.map((item) => <option key={item.id} value={item.id}>{item.name} — {money(item.price, item.currency)}</option>)}</Select></FormField></section>}{step === 2 && <section className="ac-form-grid"><section className="ac-order-summary"><span>{plan?.name}</span><span>{plan?.durationDays} дней</span><strong>{plan ? money(plan.price, plan.currency) : "—"}</strong></section>{product === "vpn" && matchingSubs.length > 0 && <section className="ac-order-choice"><h3>У вас уже есть подписка с этим тарифом</h3><p className="ac-hint">Выберите, что сделать с покупкой.</p><label className={`ac-choice ${purchaseKind === "renew" ? "is-active" : ""}`}><input type="radio" name="purchase-kind" checked={purchaseKind === "renew"} onChange={() => setPurchaseKind("renew")} /> <div><strong>Продлить подписку</strong><span>Дни добавятся к существующей</span></div></label>{purchaseKind === "renew" && <FormField label="Какая подписка"><Select value={renewSubId} onChange={(event) => setRenewSubId(event.target.value)}>{matchingSubs.map((sub) => <option key={sub.id} value={sub.id}>{sub.service}{sub.plan ? ` · ${sub.plan}` : ""}{sub.expiresAt ? ` · до ${date(sub.expiresAt)}` : ""}</option>)}</Select></FormField>}<label className={`ac-choice ${purchaseKind === "add" ? "is-active" : ""}`}><input type="radio" name="purchase-kind" checked={purchaseKind === "add"} onChange={() => setPurchaseKind("add")} /> <div><strong>Купить новую подписку</strong><span>Создаст дополнительную подписку</span></div></label></section>}<FormField label="Промокод"><Input placeholder="Необязательно" value={promoCode} onChange={(event) => setPromoCode(event.target.value.toUpperCase())} /></FormField><p className="ac-hint">Персональная скидка и промокод проверяются и рассчитываются на сервере при создании платежа.</p></section>}{step === 3 && <section className="ac-form-grid"><FormField label="Способ оплаты"><Select value={method} disabled={Boolean(paymentUrl)} onChange={(event) => setMethod(event.target.value as CheckoutMethod)}>{availableMethods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></FormField>{method === "platega" && plategaMethods.length > 0 && <FormField label="Способ оплаты Platega"><Select value={String(plategaMethod)} disabled={Boolean(paymentUrl)} onChange={(event) => setPlategaMethod(Number(event.target.value))}>{plategaMethods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></FormField>}{paymentUrl && <ExternalPaymentLink url={paymentUrl} />}</section>}{error && <p className="text-destructive">{error}</p>}<div className="ac-modal-actions"><Button tone="secondary" disabled={busy || step === 1} onClick={() => setStep((current) => current - 1)}>{paymentUrl ? "Назад" : "Назад"}</Button>{!paymentUrl && <Button disabled={busy || !planId || (step === 3 && availableMethods.length === 0)} onClick={() => step < 3 ? setStep((current) => current + 1) : void execute()}>{step === 3 ? busy ? "Создаём платёж…" : "Создать ссылку на оплату" : "Далее"}</Button>}</div></div></Modal>;
}
