import { useEffect, useMemo, useRef, useState } from 'react';
import bridge from '@vkontakte/vk-bridge';
import {
  AppRoot,
  Banner,
  Button,
  Card,
  CardGrid,
  Div,
  FormItem,
  Group,
  Header,
  Input,
  Panel,
  PanelHeader,
  Placeholder,
  SimpleCell,
  Snackbar,
  SplitCol,
  SplitLayout,
  Text,
  Textarea,
  Title,
} from '@vkontakte/vkui';
import {
  api,
  type AdminAccount,
  type AdminSession,
  type AdminUserSnapshot,
  type AppState,
  type GeneratedPost,
  type PlanCode,
  type PlanDefinition,
  type PromoInput,
  type PromoPreview,
  type PromoRecord,
  type Topic,
  type UserState,
} from './api';

type TabId = 'home' | 'plan' | 'cabinet' | 'tariffs' | 'admin';
type ConnectMode = 'idle' | 'connect';

const PAGE_SIZE = 10;
const TOPIC_POSTS_DIRECT_FALLBACK_TIMEOUT_MS = 45000;
const TOPIC_POSTS_DIRECT_FALLBACK_EVERY_ATTEMPT = 6;
const TOPIC_POSTS_DIRECT_FALLBACK_MAX_CALLS = 8;
const TOPIC_SUFFIX_EMOJIS = ['✨', '🔥', '💡', '🚀', '🎯', '📌', '💬', '🌊', '🧠', '✅'];
const TOPIC_EMOJI_DIGITS: Record<string, string> = {
  '0': '0️⃣',
  '1': '1️⃣',
  '2': '2️⃣',
  '3': '3️⃣',
  '4': '4️⃣',
  '5': '5️⃣',
  '6': '6️⃣',
  '7': '7️⃣',
  '8': '8️⃣',
  '9': '9️⃣',
};

const MAIN_TAB_OPTIONS = [
  { label: 'Главная', value: 'home' },
  { label: 'Контент-план', value: 'plan' },
  { label: 'Кабинет', value: 'cabinet' },
  { label: 'Тарифы', value: 'tariffs' },
];

const PLAN_FALLBACK: PlanDefinition[] = [
  {
    code: 'one_time',
    title: '⚡ Разовый доступ',
    short: '1 тема + 3 варианта поста для быстрого теста',
    posts: 1,
    themes: 1,
    ideaRegen: 0,
    textRegen: 0,
    price: 99,
  },
  {
    code: 'plan10',
    title: '📌 10 постов',
    short: 'Для стабильного старта и регулярных публикаций',
    posts: 10,
    themes: 10,
    ideaRegen: 2,
    textRegen: 3,
    price: 590,
  },
  {
    code: 'plan15',
    title: '⭐ 15 постов (Рекомендуем)',
    short: 'Оптимальный тариф по цене и объёму',
    posts: 15,
    themes: 20,
    ideaRegen: 5,
    textRegen: 5,
    price: 790,
    highlight: true,
  },
  {
    code: 'plan30',
    title: '🚀 30 постов',
    short: 'Для активного контент-плана на несколько недель',
    posts: 30,
    themes: 40,
    ideaRegen: 10,
    textRegen: 10,
    price: 1290,
  },
];

const PLAN_TEXT_BY_CODE: Record<
  Exclude<PlanCode, 'free'>,
  Pick<PlanDefinition, 'title' | 'short' | 'highlight'>
> = {
  one_time: {
    title: '⚡ Разовый доступ',
    short: '1 тема + 3 варианта поста для быстрого теста',
    highlight: false,
  },
  plan10: {
    title: '📌 10 постов',
    short: 'Для стабильного старта и регулярных публикаций',
    highlight: false,
  },
  plan15: {
    title: '⭐ 15 постов (Рекомендуем)',
    short: 'Оптимальный тариф по цене и объёму',
    highlight: true,
  },
  plan30: {
    title: '🚀 30 постов',
    short: 'Для активного контент-плана на несколько недель',
    highlight: false,
  },
};

function isLocalDevHost() {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

const privacyPolicyUrl = 'https://vk.com/@smmind-politika-konfidencialnosti';
const publicOfferUrl = 'https://vk.com/@smmind-publichnaya-oferta';

function fallbackVkUserId() {
  if (!isLocalDevHost()) {
    return '';
  }
  const key = 'vk_miniapp_uid';
  const existing = localStorage.getItem(key);
  if (existing && /^\d{3,20}$/.test(existing)) {
    return existing;
  }
  const generated = '900000001';
  localStorage.setItem(key, generated);
  return generated;
}

async function resolveVkUserId() {
  try {
    const info = (await bridge.send('VKWebAppGetUserInfo')) as { id?: number };
    if (info && info.id) {
      return String(info.id);
    }
  } catch {
    // Fallback for local run outside VK.
  }
  const fallback = fallbackVkUserId();
  if (fallback) {
    return fallback;
  }
  throw new Error('Не удалось определить ваш VK ID. Откройте мини-приложение внутри ВК.');
}

function getPlanTitle(planCode: PlanCode, plans: PlanDefinition[]) {
  if (planCode === 'free') {
    return 'FREE';
  }
  return plans.find((plan) => plan.code === planCode)?.title || planCode;
}

function toEmojiNumber(value: number): string {
  const safe = Math.max(1, Math.trunc(Number(value) || 1));
  return String(safe)
    .split('')
    .map((digit) => TOPIC_EMOJI_DIGITS[digit] || digit)
    .join('');
}

function trimTopicDecor(rawTitle: string): string {
  const source = String(rawTitle || '').trim();
  if (!source) {
    return 'Тема контент-плана';
  }
  return source
    .replace(/^\s*(?:[#№]?\d+\s*[\).:\-])\s*/u, '')
    .replace(/^\s*(?:\d(?:\uFE0F)?\u20E3)\s*/u, '')
    .replace(/^\s*[✨🔥💡🚀🎯📌💬🌊🧠✅]+\s*/u, '')
    .trim();
}

function hasEmoji(value: string): boolean {
  return /[\p{Extended_Pictographic}]/u.test(String(value || ''));
}

function formatTopicTitle(topic: Topic): string {
  const seqNo = Math.max(1, Math.trunc(Number(topic.seqNo) || 1));
  const prefix = toEmojiNumber(seqNo);
  const base = trimTopicDecor(topic.title);
  const suffix = hasEmoji(base) ? '' : ` ${TOPIC_SUFFIX_EMOJIS[(seqNo - 1) % TOPIC_SUFFIX_EMOJIS.length]}`;
  return `${prefix} ${base}${suffix}`.trim();
}

function formatDraftText(text: string, variant: number): string {
  const source = String(text || '')
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
    .trim();
  if (!source || hasEmoji(source)) {
    return source;
  }
  const leadEmoji = ['✨', '📌', '💡'][(Math.max(1, variant) - 1) % 3];
  const ctaEmoji = ['🚀', '✅', '📩'][(Math.max(1, variant) - 1) % 3];
  const lines = source.split('\n');
  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmpty >= 0) {
    lines[firstNonEmpty] = `${leadEmoji} ${lines[firstNonEmpty]}`.trim();
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim().length === 0) continue;
    lines[i] = hasEmoji(lines[i]) ? lines[i] : `${lines[i]} ${ctaEmoji}`;
    break;
  }
  return lines.join('\n');
}

function formatErrorMessage(error: unknown) {
  const message = String((error as { message?: string })?.message || error || 'Ошибка запроса.').trim();
  if (!message) {
    return 'Сейчас не получилось выполнить действие. Попробуйте еще раз.';
  }

  const safeUserMessage =
    /^(Сначала|Введите|Укажите|Лимит|Тема|Промокод|Сообщество|Недостаточно|Пользователь|Администратор|Роль|Тариф|Это сообщество|Некорректный|Обращение сохранено)/i;
  if (safeUserMessage.test(message)) {
    return message;
  }

  if (message.includes('Supabase не настроен')) {
    return 'Сервис временно недоступен. Попробуйте позже.';
  }
  if (/permission|jwt|policy|schema|relation|column|sql|postgres|syntax|constraint|duplicate/i.test(message)) {
    return 'Сейчас не получилось выполнить действие. Повторите чуть позже.';
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return 'Генерация занимает больше обычного. Мы продолжаем обработку, результат появится автоматически.';
  }
  if (/failed to fetch|network/i.test(message)) {
    return 'Проблема с интернет-соединением. Проверьте сеть и повторите.';
  }
  const httpMatch = message.match(/^HTTP\s+(\d{3})$/i);
  if (httpMatch) {
    return 'Сейчас не получилось выполнить действие. Повторите через минуту.';
  }
  return message.slice(0, 240);
}

function normalizePlanDefinition(plan: PlanDefinition): PlanDefinition {
  const fallback = PLAN_TEXT_BY_CODE[plan.code];
  if (!fallback) {
    return plan;
  }
  return {
    ...plan,
    title: fallback.title,
    short: fallback.short,
    highlight: fallback.highlight ?? plan.highlight,
  };
}

function normalizePlans(input: PlanDefinition[]): PlanDefinition[] {
  return input.map((plan) => normalizePlanDefinition(plan));
}

function normalizePromoAllowedPlan(raw: string): string {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (!value || value === 'all' || value === 'any' || value === '*' || value === 'unlim') {
    return 'all';
  }
  return value;
}

function promoAppliesToPlan(promo: PromoPreview | null, planCode: Exclude<PlanCode, 'free'>): boolean {
  if (!promo) return false;
  const allowed = normalizePromoAllowedPlan(promo.allowedPlan);
  return allowed === 'all' || allowed === String(planCode || '').toLowerCase();
}

function calcPlanPriceWithPromo(
  plan: PlanDefinition,
  promo: PromoPreview | null,
): { baseAmount: number; finalAmount: number; savingsAmount: number; hasDiscount: boolean } {
  const baseAmount = Math.max(0, Math.trunc(Number(plan.price) || 0));
  if (!promo || !promoAppliesToPlan(promo, plan.code)) {
    return { baseAmount, finalAmount: baseAmount, savingsAmount: 0, hasDiscount: false };
  }
  const discountPercent = Math.max(1, Math.min(95, Math.trunc(Number(promo.discountPercent) || 0)));
  const savingsAmount = Math.max(0, Math.round((baseAmount * discountPercent) / 100));
  const finalAmount = Math.max(1, baseAmount - savingsAmount);
  return {
    baseAmount,
    finalAmount,
    savingsAmount: Math.max(0, baseAmount - finalAmount),
    hasDiscount: finalAmount < baseAmount,
  };
}

function isStatusEndpointMissingError(error: unknown): boolean {
  const raw = String((error as { message?: string })?.message || error || '')
    .trim()
    .toLowerCase();
  if (!raw) return false;
  return /^http\s+404$/i.test(raw) || raw.includes('endpoint not found');
}

export function App() {
  const isAdminPanelMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('mode') === 'admin';
  const [activeTab, setActiveTab] = useState<TabId>(isAdminPanelMode ? 'admin' : 'home');
  const [plans, setPlans] = useState<PlanDefinition[]>(normalizePlans(PLAN_FALLBACK));
  const [user, setUser] = useState<UserState | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [vkUserId, setVkUserId] = useState('');
  const [page, setPage] = useState(1);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [snackbarText, setSnackbarText] = useState('');
  const [connectMode, setConnectMode] = useState<ConnectMode>('idle');
  const [communityInput, setCommunityInput] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [selectedTopicPosts, setSelectedTopicPosts] = useState<GeneratedPost[]>([]);
  const [selectedTopicPostsCache, setSelectedTopicPostsCache] = useState<Record<string, GeneratedPost[]>>({});
  const [topicPostsLoading, setTopicPostsLoading] = useState(false);
  const topicPostsRequestRef = useRef(0);
  const topicPostsPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialTopicsPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState('');
  const [businessInfoInput, setBusinessInfoInput] = useState('');
  const [businessInfoDirty, setBusinessInfoDirty] = useState(false);
  const [tariffPromoCodeInput, setTariffPromoCodeInput] = useState('');
  const [tariffPromoPreview, setTariffPromoPreview] = useState<PromoPreview | null>(null);
  const [tariffPromoBusy, setTariffPromoBusy] = useState(false);
  const [adminMe, setAdminMe] = useState<AdminSession | null>(null);
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>([]);
  const [adminPromos, setAdminPromos] = useState<PromoRecord[]>([]);
  const [adminUserSnapshot, setAdminUserSnapshot] = useState<AdminUserSnapshot | null>(null);
  const [adminLog, setAdminLog] = useState('');
  const [adminUserRef, setAdminUserRef] = useState('');
  const [adminGroupRef, setAdminGroupRef] = useState('');
  const [adminRoleTargetRef, setAdminRoleTargetRef] = useState('');
  const [adminRoleValue, setAdminRoleValue] = useState('admin');
  const [adminPlanCode, setAdminPlanCode] = useState<PlanCode>('plan15');
  const [adminPostsInput, setAdminPostsInput] = useState('');
  const [adminThemesInput, setAdminThemesInput] = useState('');
  const [adminIdeaInput, setAdminIdeaInput] = useState('');
  const [adminTextInput, setAdminTextInput] = useState('');
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoPercentInput, setPromoPercentInput] = useState('');
  const [promoMaxUsesInput, setPromoMaxUsesInput] = useState('');
  const [promoPlanInput, setPromoPlanInput] = useState('any');
  const [promoDaysInput, setPromoDaysInput] = useState('');
  const [promoNoteInput, setPromoNoteInput] = useState('');

  const totalPages = Math.max(1, Math.ceil(Math.max(1, topics.length) / PAGE_SIZE));
  const currentPage = Math.min(totalPages, Math.max(1, page));
  const pagedTopics = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return topics.slice(start, start + PAGE_SIZE);
  }, [topics, currentPage]);

  const hasCommunity = Boolean(user?.selectedCommunityUrl);
  const hasPaidPlan = (user?.planCode || 'free') !== 'free';
  const remainingPosts = Math.max(0, (user?.postsTotal || 0) - (user?.postsUsed || 0));
  const remainingThemeSlots = Math.max(0, (user?.themesCapacityTotal || 0) - topics.length);
  const remainingIdeaRegens = Math.max(0, (user?.ideaRegenTotal || 0) - (user?.ideaRegenUsed || 0));
  const remainingTextRegens = Math.max(0, (user?.textRegenTotal || 0) - (user?.textRegenUsed || 0));

  const showMessage = (text: string) => setSnackbarText(text);
  const beginBusy = (hint: string) => {
    setBusyHint(hint);
    setBusy(true);
  };
  const endBusy = () => {
    setBusy(false);
    setBusyHint('');
  };
  const showPurchaseNotice = async (text: string) => {
    try {
      await (bridge as any).send('VKWebAppShowAlert', { message: text });
      return;
    } catch {
      // Fallback to snackbar when bridge alert is unavailable.
    }
    showMessage(text);
  };
  const appendAdminLog = (text: string) => {
    const stamp = new Date().toLocaleTimeString();
    setAdminLog((prev) => `[${stamp}] ${text}\n${prev}`.trim());
  };

  const parseOptionalInt = (raw: string): number | undefined => {
    const value = raw.trim();
    if (!value) {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error('Введите корректное число.');
    }
    return Math.trunc(parsed);
  };

  function applyState(state: AppState) {
    setUser(state.user);
    setTopics(state.topics);
    if (selectedTopic) {
      const nextSelected = state.topics.find((topic) => topic.id === selectedTopic.id) || null;
      if (!nextSelected) {
        if (topicPostsPollTimerRef.current) {
          clearTimeout(topicPostsPollTimerRef.current);
          topicPostsPollTimerRef.current = null;
        }
        setSelectedTopic(null);
        setSelectedTopicPosts([]);
        setTopicPostsLoading(false);
        endBusy();
      } else {
        setSelectedTopic(nextSelected);
      }
    }
    setPage((prev) => {
      const pages = Math.max(1, Math.ceil(Math.max(1, state.topics.length) / PAGE_SIZE));
      return Math.min(Math.max(1, prev), pages);
    });
  }

  async function runAction(
    task: () => Promise<{ state?: AppState; message?: string }>,
    options?: { pendingText?: string },
  ) {
    beginBusy(options?.pendingText || 'Выполняем действие…');
    try {
      const result = await task();
      if (result.state) {
        applyState(result.state);
      }
      if (result.message) {
        showMessage(result.message);
      }
      return result;
    } catch (error: any) {
      showMessage(formatErrorMessage(error));
      return null;
    } finally {
      endBusy();
    }
  }

  async function runAdminAction<T extends { message?: string; state?: AppState }>(task: () => Promise<T>) {
    const result = await runAction(task);
    if (result?.message) {
      appendAdminLog(result.message);
    }
    return result as T | null;
  }

  async function loadInitial() {
    setInitialLoading(true);
    try {
      const resolvedUserId = await resolveVkUserId();
      setVkUserId(resolvedUserId);

      const plansResult = await api.getPlans();
      if (plansResult?.plans?.length) {
        setPlans(normalizePlans(plansResult.plans));
      }

      const stateResult = await api.getState(resolvedUserId);
      applyState(stateResult.state);

      // Keep fallback plans.
      try {
        const meResult = await api.adminMe(resolvedUserId);
        setAdminMe(meResult.me || null);

        const [adminsResult, promosResult] = await Promise.all([
          api.adminListAdmins(resolvedUserId),
          api.adminPromoList(resolvedUserId),
        ]);
        setAdminAccounts(adminsResult.admins || []);
        setAdminPromos(promosResult.promos || []);
      } catch {
        setAdminMe(null);
        setAdminAccounts([]);
        setAdminPromos([]);
      }
    } catch (error: any) {
      showMessage(`Не удалось загрузить данные: ${formatErrorMessage(error)}`);
    } finally {
      setInitialLoading(false);
    }
  }

  useEffect(() => {
    void loadInitial();
  }, []);

  useEffect(() => {
    if (!businessInfoDirty) {
      setBusinessInfoInput(String(user?.customBusinessInfo || ''));
    }
  }, [user?.customBusinessInfo, businessInfoDirty]);

  useEffect(() => {
    return () => {
      if (topicPostsPollTimerRef.current) {
        clearTimeout(topicPostsPollTimerRef.current);
      }
      if (initialTopicsPollTimerRef.current) {
        clearTimeout(initialTopicsPollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!vkUserId || !hasCommunity) {
      if (initialTopicsPollTimerRef.current) {
        clearTimeout(initialTopicsPollTimerRef.current);
        initialTopicsPollTimerRef.current = null;
      }
      return;
    }
    if (busy || topics.length > 0 || remainingPosts <= 0) {
      if (initialTopicsPollTimerRef.current) {
        clearTimeout(initialTopicsPollTimerRef.current);
        initialTopicsPollTimerRef.current = null;
      }
      return;
    }

    const poll = async () => {
      try {
        const next = await api.getState(vkUserId);
        if (next?.state) {
          applyState(next.state);
        }
      } catch {
        // Keep polling silently: this is background sync after community connect.
      } finally {
        initialTopicsPollTimerRef.current = setTimeout(poll, 3500);
      }
    };

    initialTopicsPollTimerRef.current = setTimeout(poll, 2500);
    return () => {
      if (initialTopicsPollTimerRef.current) {
        clearTimeout(initialTopicsPollTimerRef.current);
        initialTopicsPollTimerRef.current = null;
      }
    };
  }, [vkUserId, hasCommunity, busy, topics.length, remainingPosts]);

  const openConnectForm = (mode: ConnectMode) => {
    setConnectMode(mode);
    setCommunityInput(user?.selectedCommunityUrl || '');
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  };

  const closeConnectForm = () => {
    setConnectMode('idle');
    setCommunityInput('');
  };

  const connectCommunity = async () => {
    const communityUrl = communityInput.trim();
    if (!communityUrl) {
      showMessage('Введите ссылку на VK-сообщество.');
      return;
    }
    setActiveTab('plan');
    closeConnectForm();
    const result = await runAction(() => api.connectCommunity(vkUserId, communityUrl), {
      pendingText: 'Подключаем сообщество и готовим контент-план…',
    });
    if (result?.state) {
      closeConnectForm();
      setActiveTab('plan');
    }
  };

  const disconnectCommunity = async () => {
    const result = await runAction(() => api.disconnectCommunity(vkUserId), {
      pendingText: 'Отключаем сообщество…',
    });
    if (result?.state) {
      closeConnectForm();
      setPage(1);
    }
  };

  const confirmDisconnectCommunity = async () => {
    const warningMessage =
      '⚠️ ВНИМАНИЕ\n\n' +
      'При отключении сообщества будут удалены темы и сгенерированные посты для текущего сообщества.\n\n' +
      'Это действие нельзя отменить.';

    try {
      const response = (await (bridge as any).send('VKWebAppShowConfirm', {
        title: 'Отключить сообщество?',
        message: warningMessage,
      })) as { result?: boolean };
      if (!response?.result) {
        return;
      }
    } catch {
      const accepted = typeof window !== 'undefined' ? window.confirm(warningMessage) : false;
      if (!accepted) {
        return;
      }
    }

    await disconnectCommunity();
  };

  const clearTariffPromo = () => {
    setTariffPromoCodeInput('');
    setTariffPromoPreview(null);
  };

  const applyTariffPromo = async () => {
    const code = tariffPromoCodeInput.trim();
    if (!code) {
      showMessage('Введите промокод.');
      return;
    }
    if (!vkUserId) {
      showMessage('Не удалось определить VK ID. Перезапустите мини-приложение.');
      return;
    }
    setTariffPromoBusy(true);
    try {
      const result = await api.previewPromo(vkUserId, code);
      const promo = (result?.promo || null) as PromoPreview | null;
      if (!promo) {
        throw new Error(String(result?.message || 'Промокод не найден.'));
      }
      setTariffPromoPreview(promo);
      showMessage(
        String(
          result?.message ||
            `Промокод ${promo.code} применён: скидка ${Math.max(1, Math.trunc(Number(promo.discountPercent) || 0))}%.`,
        ),
      );
    } catch (error: any) {
      setTariffPromoPreview(null);
      showMessage(formatErrorMessage(error));
    } finally {
      setTariffPromoBusy(false);
    }
  };

  const purchasePlan = async (plan: PlanDefinition) => {
    if (!vkUserId) {
      showMessage('Не удалось определить VK ID. Перезапустите мини-приложение.');
      return;
    }

    beginBusy('Формируем ссылку на оплату…');
    try {
      const promoCode = tariffPromoCodeInput.trim();
      const payload = (await api.buyViaVkChat(vkUserId, plan.code, promoCode)) as {
        ok?: boolean;
        message?: string;
        amount?: number;
        baseAmount?: number;
        promo?: PromoPreview | null;
      };
      if (payload?.ok === false) {
        throw new Error(String(payload.message || 'VK отклонил запрос на отправку ссылки.'));
      }
      if (payload?.promo) {
        setTariffPromoPreview(payload.promo);
      }
      const pricingNote =
        Number(payload?.amount || 0) > 0 && Number(payload?.baseAmount || 0) > Number(payload?.amount || 0)
          ? ` Итог к оплате: ${payload.amount} ₽ вместо ${payload.baseAmount} ₽.`
          : '';
      if (pricingNote) {
        showMessage(pricingNote.trim());
      }
      await showPurchaseNotice(
        String(payload?.message || 'Ссылка на оплату отправлена в диалог ВК от имени группы.'),
      );
    } catch (error: any) {
      await showPurchaseNotice(`Не удалось отправить ссылку на оплату: ${formatErrorMessage(error)}`);
    } finally {
      endBusy();
    }
  };

  const clearTopicPostsPolling = () => {
    if (topicPostsPollTimerRef.current) {
      clearTimeout(topicPostsPollTimerRef.current);
      topicPostsPollTimerRef.current = null;
    }
  };

  const scheduleTopicPostsPolling = (
    topic: Topic,
    requestId: number,
    attempt = 0,
    directFallback = false,
    directFallbackCalls = 0,
  ) => {
    if (topicPostsRequestRef.current !== requestId) {
      return;
    }
    if (attempt === 90) {
      endBusy();
      showMessage('Генерация занимает больше времени, чем обычно. Продолжаем в фоне, результат появится автоматически.');
    }

    const pollDelayMs = attempt < 20 ? 2500 : attempt < 80 ? 3500 : 5000;
    clearTopicPostsPolling();
    topicPostsPollTimerRef.current = setTimeout(async () => {
      if (topicPostsRequestRef.current !== requestId) {
        return;
      }
      let nextDirectFallback = directFallback;
      let nextDirectFallbackCalls = directFallbackCalls;
      const canTryDirectFallback =
        nextDirectFallback &&
        nextDirectFallbackCalls < TOPIC_POSTS_DIRECT_FALLBACK_MAX_CALLS &&
        attempt % TOPIC_POSTS_DIRECT_FALLBACK_EVERY_ATTEMPT === 0;
      try {
        if (canTryDirectFallback) {
          const result = await api.generateTopicPosts(vkUserId, topic.id, TOPIC_POSTS_DIRECT_FALLBACK_TIMEOUT_MS);
          nextDirectFallbackCalls += 1;
          if (topicPostsRequestRef.current !== requestId) {
            return;
          }
          if (result.posts?.length) {
            setSelectedTopicPosts(result.posts);
            setSelectedTopicPostsCache((prev) => ({ ...prev, [topic.id]: result.posts }));
            setTopicPostsLoading(false);
            endBusy();
            return;
          }
        } else {
          const status = await api.getTopicPostsStatus(vkUserId, topic.id);
          if (topicPostsRequestRef.current !== requestId) {
            return;
          }
          if (status.ready && status.posts?.length) {
            setSelectedTopicPosts(status.posts);
            setSelectedTopicPostsCache((prev) => ({ ...prev, [topic.id]: status.posts }));
            setTopicPostsLoading(false);
            endBusy();
            return;
          }
        }
      } catch (error) {
        if (!nextDirectFallback && isStatusEndpointMissingError(error)) {
          nextDirectFallback = true;
        }
      }
      if (!nextDirectFallback && attempt >= 12) {
        nextDirectFallback = true;
      }
      scheduleTopicPostsPolling(topic, requestId, attempt + 1, nextDirectFallback, nextDirectFallbackCalls);
    }, pollDelayMs);
  };

  const openTopicPosts = async (topic: Topic) => {
    clearTopicPostsPolling();
    setSelectedTopic(topic);
    const requestId = topicPostsRequestRef.current + 1;
    topicPostsRequestRef.current = requestId;
    const cached = selectedTopicPostsCache[topic.id];
    if (cached?.length) {
      setTopicPostsLoading(false);
      setSelectedTopicPosts(cached);
      return;
    }
    setSelectedTopicPosts([]);
    setTopicPostsLoading(true);
    beginBusy('Генерируем 3 варианта поста…');
    let keepPolling = false;
    try {
      const result = await api.generateTopicPosts(vkUserId, topic.id);
      if (topicPostsRequestRef.current !== requestId) {
        return;
      }
      setSelectedTopicPosts(result.posts);
      setSelectedTopicPostsCache((prev) => ({ ...prev, [topic.id]: result.posts }));
      if (result.message) {
        showMessage(result.message);
      }
    } catch (error: any) {
      if (topicPostsRequestRef.current !== requestId) {
        return;
      }
      const raw = String(error?.message || '').toLowerCase();
      if (raw.includes('timeout') || raw.includes('timed out') || raw.includes('abort')) {
        keepPolling = true;
        setBusyHint('Генерируем посты… Обычно до 1 минуты');
        showMessage('Генерация идет дольше обычного. Продолжаем, результат появится автоматически.');
        scheduleTopicPostsPolling(topic, requestId, 0);
      } else {
        showMessage(formatErrorMessage(error));
      }
    } finally {
      if (topicPostsRequestRef.current === requestId && !keepPolling) {
        setTopicPostsLoading(false);
        endBusy();
      }
    }
  };

  const regenerateSelectedTopicPosts = async () => {
    if (!selectedTopic) {
      showMessage('Сначала выберите тему.');
      return;
    }

    clearTopicPostsPolling();
    beginBusy('Перегенерируем 3 варианта поста…');
    const requestId = topicPostsRequestRef.current + 1;
    topicPostsRequestRef.current = requestId;
    setSelectedTopicPosts([]);
    setTopicPostsLoading(true);
    let keepPolling = false;
    try {
      const result = await api.regenerateTopicPosts(vkUserId, selectedTopic.id);
      if (topicPostsRequestRef.current !== requestId) {
        return;
      }
      setSelectedTopicPosts(result.posts);
      setSelectedTopicPostsCache((prev) => ({ ...prev, [selectedTopic.id]: result.posts }));
      if (result.state) {
        applyState(result.state);
      }
      if (result.message) {
        showMessage(result.message);
      }
    } catch (error: any) {
      if (topicPostsRequestRef.current !== requestId) {
        return;
      }
      const raw = String(error?.message || '').toLowerCase();
      if (raw.includes('timeout') || raw.includes('timed out') || raw.includes('abort')) {
        keepPolling = true;
        setBusyHint('Продолжаем генерировать посты…');
        showMessage('Перегенерация занимает больше времени. Продолжаем, результат подтянется автоматически.');
        scheduleTopicPostsPolling(selectedTopic, requestId, 0);
      } else {
        showMessage(formatErrorMessage(error));
      }
    } finally {
      if (topicPostsRequestRef.current === requestId && !keepPolling) {
        setTopicPostsLoading(false);
        endBusy();
      }
    }
  };

  const generateMoreTopics = async () => {
    const result = await runAction(() => api.generateMore(vkUserId), {
      pendingText: 'Догенерируем темы…',
    });
    if (result?.state) {
      const pages = Math.max(1, Math.ceil(Math.max(1, result.state.topics.length) / PAGE_SIZE));
      setPage(pages);
    }
  };

  const regenerateSelectedTopicIdea = async () => {
    if (!selectedTopic) {
      showMessage('Сначала выберите тему из списка.');
      return;
    }
    if (remainingIdeaRegens <= 0) {
      showMessage('Лимит обновления тем исчерпан.');
      return;
    }
    const result = await runAction(() => api.regenerateTopic(vkUserId, selectedTopic.id, currentPage), {
      pendingText: 'Обновляем выбранную тему…',
    });
    if (result?.state) {
      setSelectedTopicPosts([]);
      setTopicPostsLoading(false);
      setSelectedTopicPostsCache((prev) => {
        const next = { ...prev };
        delete next[selectedTopic.id];
        return next;
      });
      const nextTopic = result.state.topics.find((topic) => topic.id === selectedTopic.id) || null;
      setSelectedTopic(nextTopic);
    }
  };

  const appendCustomTopic = async () => {
    const text = customTopicInput.trim();
    if (!text) {
      showMessage('Введите тему для своего поста.');
      return;
    }
    const result = await runAction(() => api.addCustomTopic(vkUserId, text), {
      pendingText: 'Добавляем тему в контент-план…',
    });
    if (result?.state) {
      setCustomTopicInput('');
      const pages = Math.max(1, Math.ceil(Math.max(1, result.state.topics.length) / PAGE_SIZE));
      setPage(pages);
    }
  };

  const saveBusinessInfo = async () => {
    const result = await runAction(() => api.updateBusinessInfo(vkUserId, businessInfoInput), {
      pendingText: 'Сохраняем информацию о бизнесе…',
    });
    if (result?.state) {
      setBusinessInfoDirty(false);
    }
  };

  const clearBusinessInfo = async () => {
    const result = await runAction(() => api.updateBusinessInfo(vkUserId, ''), {
      pendingText: 'Удаляем дополнительную информацию…',
    });
    if (result?.state) {
      setBusinessInfoInput('');
      setBusinessInfoDirty(false);
    }
  };

  const refreshAdminData = async () => {
    const result = await runAdminAction(() => api.adminListAdmins(vkUserId));
    if (result?.admins) {
      setAdminAccounts(result.admins);
    }
    if ((result as { me?: AdminSession } | null)?.me) {
      setAdminMe((result as { me?: AdminSession }).me || null);
    }

    const promosResult = await runAdminAction(() => api.adminPromoList(vkUserId));
    if (promosResult?.promos) {
      setAdminPromos(promosResult.promos);
    }
  };

  const requireAdminUserRef = () => {
    const value = adminUserRef.trim();
    if (!value) {
      showMessage('Укажите пользователя (ID, id123 или ссылку vk.com/id123).');
      return null;
    }
    return value;
  };

  const handleAdminGetUser = async () => {
    const ref = requireAdminUserRef();
    if (!ref) {
      return;
    }
    const result = await runAdminAction(() => api.adminGetUser(vkUserId, ref));
    if (result?.userSnapshot) {
      setAdminUserSnapshot(result.userSnapshot);
    }
  };

  const handleAdminSetPlan = async () => {
    const ref = requireAdminUserRef();
    if (!ref) {
      return;
    }
    await runAdminAction(() => api.adminSetPlan(vkUserId, ref, adminPlanCode));
    await handleAdminGetUser();
  };

  const handleAdminUsageReset = async () => {
    const ref = requireAdminUserRef();
    if (!ref) {
      return;
    }
    await runAdminAction(() => api.adminUsageReset(vkUserId, ref));
    await handleAdminGetUser();
  };

  const handleAdminLimitsSet = async () => {
    const ref = requireAdminUserRef();
    if (!ref) {
      return;
    }
    try {
      const posts = parseOptionalInt(adminPostsInput);
      const themes = parseOptionalInt(adminThemesInput);
      const idea = parseOptionalInt(adminIdeaInput);
      const text = parseOptionalInt(adminTextInput);
      await runAdminAction(() => api.adminLimitsSet(vkUserId, ref, { posts, themes, idea, text }));
      await handleAdminGetUser();
    } catch (error: any) {
      showMessage(formatErrorMessage(error));
    }
  };

  const handleAdminLimitsAdd = async () => {
    const ref = requireAdminUserRef();
    if (!ref) {
      return;
    }
    try {
      const posts = parseOptionalInt(adminPostsInput);
      const themes = parseOptionalInt(adminThemesInput);
      const idea = parseOptionalInt(adminIdeaInput);
      const text = parseOptionalInt(adminTextInput);
      await runAdminAction(() => api.adminLimitsAdd(vkUserId, ref, { posts, themes, idea, text }));
      await handleAdminGetUser();
    } catch (error: any) {
      showMessage(formatErrorMessage(error));
    }
  };

  const handleAdminUnlinkUser = async () => {
    const ref = requireAdminUserRef();
    if (!ref) {
      return;
    }
    await runAdminAction(() => api.adminUnlinkUser(vkUserId, ref));
    await handleAdminGetUser();
  };

  const handleAdminResetUser = async () => {
    const ref = requireAdminUserRef();
    if (!ref) {
      return;
    }
    await runAdminAction(() => api.adminResetUser(vkUserId, ref));
    await handleAdminGetUser();
  };

  const handleAdminForgetUser = async () => {
    const ref = requireAdminUserRef();
    if (!ref) {
      return;
    }
    await runAdminAction(() => api.adminForgetUser(vkUserId, ref));
    setAdminUserSnapshot(null);
  };

  const handleAdminUnlinkGroup = async () => {
    const ref = adminGroupRef.trim();
    if (!ref) {
      showMessage('Укажите ссылку или screen_name сообщества.');
      return;
    }
    await runAdminAction(() => api.adminUnlinkGroup(vkUserId, ref));
  };

  const handleAdminAddAdmin = async () => {
    const ref = adminRoleTargetRef.trim();
    if (!ref) {
      showMessage('Укажите VK ID администратора.');
      return;
    }
    await runAdminAction(() => api.adminAddAdmin(vkUserId, ref, adminRoleValue));
    await refreshAdminData();
  };

  const handleAdminRemoveAdmin = async () => {
    const ref = adminRoleTargetRef.trim();
    if (!ref) {
      showMessage('Укажите VK ID администратора.');
      return;
    }
    await runAdminAction(() => api.adminRemoveAdmin(vkUserId, ref));
    await refreshAdminData();
  };

  const buildPromoInput = (): PromoInput => {
    const input: PromoInput = {
      code: promoCodeInput,
    };

    const percent = parseOptionalInt(promoPercentInput);
    const maxUses = parseOptionalInt(promoMaxUsesInput);
    const days = parseOptionalInt(promoDaysInput);

    if (percent !== undefined) {
      input.percent = percent;
    }
    if (maxUses !== undefined) {
      input.maxUses = maxUses;
    }
    if (days !== undefined) {
      input.days = days;
    }
    if (promoPlanInput.trim()) {
      input.allowedPlan = promoPlanInput.trim();
    }
    if (promoNoteInput.trim()) {
      input.note = promoNoteInput.trim();
    }

    return input;
  };

  const handlePromoAdd = async () => {
    try {
      await runAdminAction(() => api.adminPromoAdd(vkUserId, buildPromoInput()));
      await refreshAdminData();
    } catch (error: any) {
      showMessage(formatErrorMessage(error));
    }
  };

  const handlePromoSet = async () => {
    try {
      await runAdminAction(() => api.adminPromoSet(vkUserId, buildPromoInput()));
      await refreshAdminData();
    } catch (error: any) {
      showMessage(formatErrorMessage(error));
    }
  };

  const handlePromoToggle = async (active: boolean) => {
    const code = promoCodeInput.trim();
    if (!code) {
      showMessage('Укажите код промокода.');
      return;
    }
    await runAdminAction(() => api.adminPromoToggle(vkUserId, code, active));
    await refreshAdminData();
  };

  const handlePromoDelete = async () => {
    const code = promoCodeInput.trim();
    if (!code) {
      showMessage('Укажите код промокода.');
      return;
    }
    await runAdminAction(() => api.adminPromoDelete(vkUserId, code));
    await refreshAdminData();
  };

  const renderConnectForm = () => {
    if (connectMode === 'idle') {
      return null;
    }
    const title = 'Подключить сообщество';
    return (
      <Group header={<Header size="s">{title}</Header>}>
        <FormItem top="Ссылка на VK-сообщество">
          <Input
            value={communityInput}
            onChange={(event) => setCommunityInput(event.target.value)}
            placeholder="https://vk.com/club123456"
            disabled={busy}
          />
        </FormItem>
        <Div>
          <Button stretched onClick={connectCommunity} disabled={busy}>
            Сохранить
          </Button>
          <Button stretched mode="secondary" onClick={closeConnectForm} disabled={busy}>
            Отмена
          </Button>
        </Div>
      </Group>
    );
  };

  const renderHome = () => (
    <>
      <Group>
        <CardGrid size="l">
          <Card mode="outline" className="hero-card">
            <Div className="home-hero">
              <Title level="2" weight="2">
                SMMind AI для ВКонтакте
              </Title>
              <Text>
                Привет! Я SMMind AI, ваш AI-ассистент по контенту для ВК. Помогаю продвигать сообщество
                через контент-планы и готовые посты, которые звучат по-человечески, а не как шаблон бота.
              </Text>
              <Text className="hero-subline">Аккаунт VK: id{vkUserId || '...'}</Text>
              {!hasCommunity ? (
                <Button size="l" stretched onClick={() => openConnectForm('connect')} disabled={busy}>
                  Подключить сообщество
                </Button>
              ) : (
                <Button size="l" stretched onClick={() => setActiveTab('plan')} disabled={busy}>
                  Перейти в контент-план
                </Button>
              )}
            </Div>
          </Card>
        </CardGrid>
      </Group>

      {renderConnectForm()}

      <Group header={<Header size="s">Как это работает</Header>}>
        <Div className="steps-list">
          <div className="step-item">
            <span className="step-dot" aria-hidden="true" />
            <Text>
              <b>Подключите сообщество ВК.</b> Ассистент анализирует его и подстраивает темы под ваш бизнес.
            </Text>
          </div>
          <div className="step-item">
            <span className="step-dot" aria-hidden="true" />
            <Text>
              <b>Получите контент-план и посты.</b> Выбираете тему и получаете 3 готовых варианта текста для публикации.
            </Text>
          </div>
          <div className="step-item">
            <span className="step-dot" aria-hidden="true" />
            <Text>
              <b>Расширяйте объём по мере роста.</b> Тарифы можно докупать, лимиты суммируются.
            </Text>
          </div>
          <div className="step-item">
            <span className="step-dot" aria-hidden="true" />
            <Text>
              <b>Важно:</b> в одном аккаунте одновременно подключено одно сообщество.
            </Text>
          </div>
        </Div>
      </Group>

      {!hasCommunity ? (
        <Group header={<Header size="s">Старт</Header>}>
          <Banner
            title="Новым пользователям доступно 3 бесплатные темы"
            subtitle="Нажмите «Подключить сообщество» и начните генерацию."
          />
        </Group>
      ) : null}
    </>
  );

  const renderPlan = () => {
    const initialTopicsInProgress = hasCommunity && topics.length === 0 && remainingPosts > 0;

    if (!hasCommunity) {
      return (
        <>
          <Group header={<Header size="s">Контент-план</Header>}>
            {busy ? (
              <Placeholder>
                <div className="inline-loading">
                  <span className="inline-spinner" />
                  <span>Подключаем сообщество и готовим контент-план…</span>
                </div>
              </Placeholder>
            ) : (
              <Placeholder>Сначала подключите сообщество, чтобы начать генерацию тем.</Placeholder>
            )}
            <Div>
              <Button stretched onClick={() => openConnectForm('connect')} disabled={busy}>
                🔗 Подключить сообщество
              </Button>
            </Div>
          </Group>
          {renderConnectForm()}
        </>
      );
    }

    return (
      <>
        <Group header={<Header size="s">Контент-план</Header>}>
          <Banner
            title={`Страница ${currentPage} из ${totalPages}`}
            subtitle={`Тем в плане: ${topics.length}. Доступно генераций: ${remainingPosts}. Можно добавить сейчас: ${Math.min(remainingPosts, remainingThemeSlots)}.`}
            actions={
              <div className="banner-actions">
                <Button
                  size="s"
                  mode="secondary"
                  disabled={busy || currentPage <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Назад
                </Button>
                <Button
                  size="s"
                  mode="secondary"
                  disabled={busy || currentPage >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                >
                  Вперед
                </Button>
              </div>
            }
          />

          {hasPaidPlan ? (
            <Div className="plan-controls">
              <Button onClick={generateMoreTopics} disabled={busy}>
                ➕ Еще темы
              </Button>
              <Button
                mode="secondary"
                onClick={regenerateSelectedTopicIdea}
                disabled={busy || !selectedTopic || remainingIdeaRegens <= 0}
              >
                🔄 Обновить выбранную тему
              </Button>
            </Div>
          ) : (
            <Banner
              title="Дополнительные действия доступны в платном тарифе"
              subtitle="Подключите тариф, чтобы добавлять новые темы, обновлять текущие и создавать темы вручную."
              actions={
                <Button size="s" onClick={() => setActiveTab('tariffs')} disabled={busy}>
                  Выбрать тариф
                </Button>
              }
            />
          )}
        </Group>

        <Group header={<Header size="s">Темы</Header>}>
          {pagedTopics.length === 0 ? (
            <Placeholder>
              {initialTopicsInProgress ? (
                <div className="inline-loading">
                  <span className="inline-spinner" />
                  <span>Формируем стартовые темы. Обычно это занимает до 1 минуты…</span>
                </div>
              ) : (
                'Тем пока нет.'
              )}
            </Placeholder>
          ) : (
            pagedTopics.map((topic) => (
              <SimpleCell
                key={topic.id}
                multiline
                onClick={() => openTopicPosts(topic)}
                className={selectedTopic?.id === topic.id ? 'topic-cell-active' : ''}
                subtitle={topic.short}
              >
                {formatTopicTitle(topic)}
              </SimpleCell>
            ))
          )}
        </Group>

        {selectedTopic ? (
          <Group header={<Header size="s">Посты по теме</Header>}>
            <Banner title={formatTopicTitle(selectedTopic)} subtitle={selectedTopic.short} />
            {hasPaidPlan ? (
              <Div className="plan-controls">
                <Button
                  mode="secondary"
                  onClick={regenerateSelectedTopicPosts}
                  disabled={busy || topicPostsLoading || remainingTextRegens <= 0}
                >
                  🔄 Перегенерировать 3 поста
                </Button>
              </Div>
            ) : null}
            {topicPostsLoading ? (
              <Placeholder>
                <div className="inline-loading">
                  <span className="inline-spinner" />
                  <span>Идет генерация постов. Обычно это занимает до 1 минуты…</span>
                </div>
              </Placeholder>
            ) : selectedTopicPosts.length ? (
              <Div className="drafts-grid">
                {selectedTopicPosts.map((draft) => (
                  <Card key={`${selectedTopic.id}-${draft.variant}`} mode="outline">
                    <Div>
                      <Text className="status-label">Вариант {draft.variant}</Text>
                      <Text className="draft-text">{formatDraftText(draft.text, draft.variant)}</Text>
                    </Div>
                  </Card>
                ))}
              </Div>
            ) : (
              <Placeholder>Посты для темы еще готовятся. Останьтесь на этой странице, результат подтянется автоматически.</Placeholder>
            )}
          </Group>
        ) : (
          <Group header={<Header size="s">Посты по теме</Header>}>
            <Placeholder>Нажмите на тему, чтобы получить 3 варианта поста.</Placeholder>
          </Group>
        )}

        {hasPaidPlan ? (
          <Group header={<Header size="s">Свой пост</Header>}>
            <FormItem top="Введите тему вручную">
              <Input
                value={customTopicInput}
                onChange={(event) => setCustomTopicInput(event.target.value)}
                placeholder="Например: Как выбрать подрядчика без переплат"
                disabled={busy}
              />
            </FormItem>
            <Div>
              <Button stretched onClick={appendCustomTopic} disabled={busy}>
                Добавить в контент-план
              </Button>
            </Div>
          </Group>
        ) : null}
      </>
    );
  };

  const renderCabinet = () => (
    <>
      <Group header={<Header size="s">Статус аккаунта</Header>}>
        <CardGrid size="l">
          <Card mode="outline">
            <Div>
              <Text className="status-label">Тариф</Text>
              <Title level="2" weight="2">
                {getPlanTitle(user?.planCode || 'free', plans)}
              </Title>
              <Text>Доступно генераций: {remainingPosts}</Text>
            </Div>
          </Card>
          <Card mode="outline">
            <Div>
              <Text className="status-label">Сообщество</Text>
              <Title level="2" weight="2">
                {hasCommunity ? 'Подключено' : 'Не подключено'}
              </Title>
              <Text>{hasCommunity ? user?.selectedCommunityUrl : 'Подключите сообщество в этом разделе.'}</Text>
            </Div>
          </Card>
        </CardGrid>
      </Group>

      <Group header={<Header size="s">Лимиты и использование</Header>}>
        <SimpleCell subtitle="Посты (использовано / всего)">
          {`${user?.postsUsed || 0} / ${user?.postsTotal || 0}`}
        </SimpleCell>
        <SimpleCell subtitle="Темы в плане (занято / емкость)">
          {`${topics.length} / ${user?.themesCapacityTotal || 0}`}
        </SimpleCell>
        <SimpleCell subtitle="Обновление тем (использовано / всего)">
          {`${user?.ideaRegenUsed || 0} / ${user?.ideaRegenTotal || 0}`}
        </SimpleCell>
        <SimpleCell subtitle="Обновление текстов (использовано / всего)">
          {`${user?.textRegenUsed || 0} / ${user?.textRegenTotal || 0}`}
        </SimpleCell>
      </Group>

      <Group header={<Header size="s">Дополнительная информация о бизнесе</Header>}>
        <FormItem top="Уточнения для генерации (акции, ограничения, сезонность, приоритеты)">
          <Textarea
            value={businessInfoInput}
            onChange={(event) => {
              setBusinessInfoInput(event.target.value);
              setBusinessInfoDirty(true);
            }}
            disabled={busy}
            rows={5}
            placeholder="Например: До 30.03 действует акция — при заказе комплекта доставка бесплатно. Не используем формулировки «№1» и «гарантируем»."
          />
        </FormItem>
        <Div className="two-buttons">
          <Button stretched onClick={saveBusinessInfo} disabled={busy || !businessInfoDirty}>
            Сохранить информацию
          </Button>
          <Button stretched mode="secondary" onClick={clearBusinessInfo} disabled={busy || !String(user?.customBusinessInfo || '').trim()}>
            Очистить
          </Button>
        </Div>
        <Div>
          <Text>
            Эти данные добавляются к анализу сообщества и учитываются при генерации следующих тем и постов.
          </Text>
        </Div>
      </Group>

      <Group header={<Header size="s">Управление сообществом</Header>}>
        {hasCommunity ? (
          <>
            <SimpleCell subtitle="Подключено">{user?.selectedCommunityUrl || ''}</SimpleCell>
            <Div>
              <Button stretched mode="secondary" onClick={confirmDisconnectCommunity} disabled={busy}>
                Отключить сообщество
              </Button>
            </Div>
          </>
        ) : (
          <>
            <Placeholder>Сейчас сообщество не подключено.</Placeholder>
            <Div>
              <Button stretched onClick={() => openConnectForm('connect')} disabled={busy}>
                Подключить сообщество
              </Button>
            </Div>
          </>
        )}
      </Group>

      {renderConnectForm()}
    </>
  );

  const renderTariffs = () => (
    <>
      <Group header={<Header size="s">Тарифы</Header>}>
        <Banner
          title="Выберите тариф доступа"
          subtitle="Лимиты суммируются: можно покупать несколько раз подряд, остатки не теряются."
        />
        <Div>
          <Text>
            Перед оплатой ознакомьтесь с документами:{' '}
            <a href={publicOfferUrl} target="_blank" rel="noopener noreferrer">
              Публичная оферта
            </a>{' '}
            и{' '}
            <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
              Политика конфиденциальности
            </a>
            . Оплачивая тариф, вы подтверждаете согласие с их условиями.
          </Text>
        </Div>
      </Group>

      <Group header={<Header size="s">Промокод</Header>}>
        <FormItem top="Введите промокод перед оплатой">
          <Input
            value={tariffPromoCodeInput}
            onChange={(event) => {
              setTariffPromoCodeInput(event.target.value);
              setTariffPromoPreview(null);
            }}
            disabled={busy || tariffPromoBusy}
            placeholder="Например: MARCH20"
          />
        </FormItem>
        <Div className="two-buttons">
          <Button stretched onClick={applyTariffPromo} disabled={busy || tariffPromoBusy || !tariffPromoCodeInput.trim()}>
            Применить
          </Button>
          <Button
            stretched
            mode="secondary"
            onClick={clearTariffPromo}
            disabled={busy || tariffPromoBusy || (!tariffPromoCodeInput.trim() && !tariffPromoPreview)}
          >
            Сбросить
          </Button>
        </Div>
        {tariffPromoPreview ? (
          <Div>
            <Text>
              Активный промокод: {tariffPromoPreview.code} (скидка {tariffPromoPreview.discountPercent}%)
            </Text>
          </Div>
        ) : null}
      </Group>

      <Group header={<Header size="s">Доступные планы</Header>}>
        <Div className="tariff-grid">
          {plans.map((plan) => {
            const pricing = calcPlanPriceWithPromo(plan, tariffPromoPreview);
            return (
              <Card key={plan.code} mode="outline" className={plan.highlight ? 'plan-highlight' : ''}>
                <Div className="plan-card">
                  <Title level="3" weight="2">
                    {plan.title}
                  </Title>
                  <Text className="plan-short">{plan.short}</Text>
                  <Text>• Тем в контент-плане: {plan.themes}</Text>
                  <Text>• Обновлений тем: {plan.ideaRegen}</Text>
                  <Text>• Обновлений текста: {plan.textRegen}</Text>
                  <Text>
                    • Цена: {pricing.finalAmount} ₽{pricing.hasDiscount ? ` (вместо ${pricing.baseAmount} ₽)` : ''}
                  </Text>
                  {pricing.hasDiscount ? <Text>• Экономия: {pricing.savingsAmount} ₽</Text> : null}
                  <Button
                    stretched
                    size="m"
                    mode={plan.highlight ? 'primary' : 'secondary'}
                    onClick={() => purchasePlan(plan)}
                    disabled={busy || tariffPromoBusy}
                  >
                    Купить за {pricing.finalAmount} ₽
                  </Button>
                </Div>
              </Card>
            );
          })}
        </Div>
      </Group>
    </>
  );

  const renderAdmin = () => {
    if (!adminMe?.isAdmin) {
      return (
        <Group header={<Header size="s">Админ</Header>}>
          <Placeholder>
            Доступ к админ-панели закрыт. Если вы администратор, проверьте выдачу прав в базе.
          </Placeholder>
        </Group>
      );
    }

    return (
      <>
        <Group header={<Header size="s">Роль и права</Header>}>
          <Banner
            title={`Вы вошли как: ${adminMe.role}`}
            subtitle={`VK ID: ${adminMe.vkUserId}. ${adminMe.canManageAdmins ? 'Можно управлять админами.' : 'Без прав owner.'}`}
          />
          <Div>
            <Button stretched mode="secondary" onClick={refreshAdminData} disabled={busy}>
              Обновить данные админки
            </Button>
          </Div>
        </Group>

        <Group header={<Header size="s">Пользователи</Header>}>
          <FormItem top="VK user (ID, id123 или ссылка)">
            <Input value={adminUserRef} onChange={(event) => setAdminUserRef(event.target.value)} disabled={busy} />
          </FormItem>

          <Div className="admin-buttons-grid">
            <Button onClick={handleAdminGetUser} disabled={busy}>
              Проверить пользователя
            </Button>
            <Button mode="secondary" onClick={handleAdminUsageReset} disabled={busy}>
              Сбросить использование
            </Button>
            <Button mode="secondary" onClick={handleAdminUnlinkUser} disabled={busy}>
              Отвязать сообщество
            </Button>
            <Button mode="secondary" onClick={handleAdminResetUser} disabled={busy}>
              Сбросить пользователя
            </Button>
            <Button mode="secondary" onClick={handleAdminForgetUser} disabled={busy}>
              Полностью удалить пользователя
            </Button>
          </Div>

          <FormItem top="Тариф (free / one_time / plan10 / plan15 / plan30)">
            <Input
              value={adminPlanCode}
              onChange={(event) => setAdminPlanCode(event.target.value as PlanCode)}
              disabled={busy}
            />
          </FormItem>
          <Div>
            <Button stretched onClick={handleAdminSetPlan} disabled={busy}>
              Установить тариф
            </Button>
          </Div>

          <FormItem top="Лимиты: posts / themes / idea / text">
            <Div className="admin-limits-grid">
              <Input
                value={adminPostsInput}
                onChange={(event) => setAdminPostsInput(event.target.value)}
                placeholder="posts"
                disabled={busy}
              />
              <Input
                value={adminThemesInput}
                onChange={(event) => setAdminThemesInput(event.target.value)}
                placeholder="themes"
                disabled={busy}
              />
              <Input
                value={adminIdeaInput}
                onChange={(event) => setAdminIdeaInput(event.target.value)}
                placeholder="idea"
                disabled={busy}
              />
              <Input
                value={adminTextInput}
                onChange={(event) => setAdminTextInput(event.target.value)}
                placeholder="text"
                disabled={busy}
              />
            </Div>
          </FormItem>
          <Div>
            <Button stretched onClick={handleAdminLimitsSet} disabled={busy}>
              Установить лимиты
            </Button>
            <Button stretched mode="secondary" onClick={handleAdminLimitsAdd} disabled={busy}>
              Добавить лимиты
            </Button>
          </Div>

          {adminUserSnapshot ? (
            <Div className="admin-snapshot">
              <Text>
                {adminUserSnapshot.exists
                  ? `Пользователь ${adminUserSnapshot.vkUserId}: тариф=${adminUserSnapshot.planCode}, использовано постов ${adminUserSnapshot.postsUsed}/${adminUserSnapshot.postsTotal}, тем=${adminUserSnapshot.topicsCount}, покупок=${adminUserSnapshot.purchasesCount}`
                  : `Пользователь ${adminUserSnapshot.vkUserId}: не найден`}
              </Text>
            </Div>
          ) : null}
        </Group>

        <Group header={<Header size="s">Сообщества</Header>}>
          <FormItem top="Ссылка или screen_name сообщества">
            <Input value={adminGroupRef} onChange={(event) => setAdminGroupRef(event.target.value)} disabled={busy} />
          </FormItem>
          <Div>
            <Button stretched mode="secondary" onClick={handleAdminUnlinkGroup} disabled={busy}>
              Отвязать сообщество
            </Button>
          </Div>
        </Group>

        <Group header={<Header size="s">Админы</Header>}>
          <FormItem top="VK user для выдачи / снятия прав">
            <Input
              value={adminRoleTargetRef}
              onChange={(event) => setAdminRoleTargetRef(event.target.value)}
              disabled={busy}
            />
          </FormItem>
          <FormItem top="Роль (admin/support)">
            <Input value={adminRoleValue} onChange={(event) => setAdminRoleValue(event.target.value)} disabled={busy} />
          </FormItem>
          <Div>
            <Button stretched onClick={handleAdminAddAdmin} disabled={busy}>
              Выдать права
            </Button>
            <Button stretched mode="secondary" onClick={handleAdminRemoveAdmin} disabled={busy}>
              Снять права
            </Button>
          </Div>

          {adminAccounts.length ? (
            adminAccounts.map((item) => (
              <SimpleCell
                key={item.vkUserId}
                subtitle={`роль: ${item.role}; статус: ${item.isActive ? 'активен' : 'отключен'}`}
              >
                {item.vkUserId}
              </SimpleCell>
            ))
          ) : (
            <Placeholder>Список админов пуст.</Placeholder>
          )}
        </Group>

        <Group header={<Header size="s">Промокоды</Header>}>
          <FormItem top="Код">
            <Input value={promoCodeInput} onChange={(event) => setPromoCodeInput(event.target.value)} disabled={busy} />
          </FormItem>
          <FormItem top="Скидка (%) / Макс. использований / План / Срок (дней)">
            <Div className="admin-limits-grid">
              <Input
                value={promoPercentInput}
                onChange={(event) => setPromoPercentInput(event.target.value)}
                placeholder="скидка"
                disabled={busy}
              />
              <Input
                value={promoMaxUsesInput}
                onChange={(event) => setPromoMaxUsesInput(event.target.value)}
                placeholder="макс. использований"
                disabled={busy}
              />
              <Input
                value={promoPlanInput}
                onChange={(event) => setPromoPlanInput(event.target.value)}
                placeholder="any"
                disabled={busy}
              />
              <Input
                value={promoDaysInput}
                onChange={(event) => setPromoDaysInput(event.target.value)}
                placeholder="дней"
                disabled={busy}
              />
            </Div>
          </FormItem>
          <FormItem top="Комментарий">
            <Input value={promoNoteInput} onChange={(event) => setPromoNoteInput(event.target.value)} disabled={busy} />
          </FormItem>
          <Div className="admin-buttons-grid">
            <Button onClick={handlePromoAdd} disabled={busy}>
              Создать промокод
            </Button>
            <Button mode="secondary" onClick={handlePromoSet} disabled={busy}>
              Обновить промокод
            </Button>
            <Button mode="secondary" onClick={() => handlePromoToggle(true)} disabled={busy}>
              Включить
            </Button>
            <Button mode="secondary" onClick={() => handlePromoToggle(false)} disabled={busy}>
              Выключить
            </Button>
            <Button mode="secondary" onClick={handlePromoDelete} disabled={busy}>
              Удалить промокод
            </Button>
          </Div>

          {adminPromos.length ? (
            adminPromos.map((promo) => (
              <SimpleCell
                key={promo.code}
                subtitle={`скидка: -${promo.discountPercent}% | статус: ${promo.isActive ? 'вкл' : 'выкл'} | использовано: ${promo.usedCount}`}
              >
                {promo.code}
              </SimpleCell>
            ))
          ) : (
            <Placeholder>Промокодов пока нет.</Placeholder>
          )}
        </Group>

        <Group header={<Header size="s">Логи админки</Header>}>
          <Div className="admin-log">{adminLog || 'Операций пока нет.'}</Div>
        </Group>
      </>
    );
  };

  return (
    <AppRoot mode="full">
      <SplitLayout>
        <SplitCol autoSpaced>
          <Panel id="main">
            <PanelHeader>SMMind AI</PanelHeader>
            {isAdminPanelMode ? (
              <Group>
                <Div>
                  <Banner
                    title="Админ-панель"
                    subtitle="Служебный режим управления пользователями, тарифами и промокодами."
                  />
                </Div>
              </Group>
            ) : (
              <Group>
                <Div>
                  <div className="main-tabs">
                    {MAIN_TAB_OPTIONS.map((tab) => {
                      const isActive = activeTab === (tab.value as TabId);
                      return (
                        <Button
                          key={tab.value}
                          size="s"
                          mode={isActive ? 'primary' : 'secondary'}
                          className="main-tab-button"
                          onClick={() => setActiveTab(tab.value as TabId)}
                        >
                          {tab.label}
                        </Button>
                      );
                    })}
                  </div>
                </Div>
              </Group>
            )}

            {initialLoading ? (
              <Group>
                <Placeholder>Загружаю состояние из базы данных...</Placeholder>
              </Group>
            ) : (
              isAdminPanelMode ? (
                renderAdmin()
              ) : (
                <>
                  {activeTab === 'home' && renderHome()}
                  {activeTab === 'plan' && renderPlan()}
                  {activeTab === 'cabinet' && renderCabinet()}
                  {activeTab === 'tariffs' && renderTariffs()}
                </>
              )
            )}
          </Panel>
        </SplitCol>
      </SplitLayout>

      {busy ? (
        <div className="busy-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="busy-overlay-card">
            <span className="busy-spinner" />
            <Text>{busyHint || 'Подождите, выполняем действие…'}</Text>
          </div>
        </div>
      ) : null}

      {snackbarText ? <Snackbar onClose={() => setSnackbarText('')}>{snackbarText}</Snackbar> : null}
    </AppRoot>
  );
}



