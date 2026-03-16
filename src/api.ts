export type PlanCode = 'free' | 'one_time' | 'plan10' | 'plan15' | 'plan30';

export type PlanDefinition = {
  code: Exclude<PlanCode, 'free'>;
  title: string;
  short: string;
  posts: number;
  themes: number;
  ideaRegen: number;
  textRegen: number;
  price: number;
  highlight?: boolean;
};

export type UserState = {
  vkUserId: string;
  planCode: PlanCode;
  postsTotal: number;
  postsUsed: number;
  themesCapacityTotal: number;
  ideaRegenTotal: number;
  ideaRegenUsed: number;
  textRegenTotal: number;
  textRegenUsed: number;
  selectedCommunityId: number | null;
  selectedCommunityUrl: string;
  selectedCommunityName: string;
  customBusinessInfo?: string;
};

export type Topic = {
  id: string;
  seqNo: number;
  title: string;
  short: string;
  source: 'auto' | 'custom' | string;
};

export type GeneratedPost = {
  variant: number;
  text: string;
};

export type AppState = {
  user: UserState;
  topics: Topic[];
};

export type ApiResult = {
  state?: AppState;
  message?: string;
  plans?: PlanDefinition[];
  ok?: boolean;
  promo?: PromoPreview | null;
  amount?: number;
  baseAmount?: number;
};

export type AdminSession = {
  vkUserId: string;
  role: string;
  isAdmin: boolean;
  canManageAdmins: boolean;
};

export type AdminAccount = {
  vkUserId: string;
  role: string;
  isActive: boolean;
  addedBy: string;
  updatedAt: string;
};

export type AdminUserSnapshot = {
  vkUserId: string;
  exists: boolean;
  planCode: PlanCode | null;
  postsTotal: number;
  postsUsed: number;
  themesCapacityTotal: number;
  ideaRegenTotal: number;
  ideaRegenUsed: number;
  textRegenTotal: number;
  textRegenUsed: number;
  selectedCommunityUrl: string;
  selectedCommunityName: string;
  topicsCount: number;
  purchasesCount: number;
  supportCount: number;
};

export type PromoRecord = {
  code: string;
  discountPercent: number;
  isActive: boolean;
  maxUses: number | null;
  usedCount: number;
  allowedPlan: string;
  expiresAt: string | null;
  note: string;
  createdBy: string;
  updatedAt: string;
};

export type PromoPreview = {
  code: string;
  discountPercent: number;
  allowedPlan: string;
  maxUses: number | null;
  usedCount: number;
  baseAmount: number | null;
  finalAmount: number | null;
  savingsAmount: number | null;
};

export type AdminResult = ApiResult & {
  me?: AdminSession;
  admins?: AdminAccount[];
  userSnapshot?: AdminUserSnapshot;
  promos?: PromoRecord[];
};

export type LimitsPatch = {
  posts?: number;
  themes?: number;
  idea?: number;
  text?: number;
};

export type PromoInput = {
  code: string;
  percent?: number;
  maxUses?: number | null;
  allowedPlan?: string;
  days?: number | null;
  note?: string;
  active?: boolean;
};

const PLAN_CATALOG: PlanDefinition[] = [
  {
    code: 'one_time',
    title: 'Разовый доступ',
    short: '1 тема + 3 варианта поста',
    posts: 1,
    themes: 1,
    ideaRegen: 0,
    textRegen: 0,
    price: 99,
  },
  {
    code: 'plan10',
    title: '10 постов',
    short: 'Для регулярного контента',
    posts: 10,
    themes: 10,
    ideaRegen: 2,
    textRegen: 3,
    price: 590,
  },
  {
    code: 'plan15',
    title: '15 постов (Рекомендуем)',
    short: 'Оптимальный тариф',
    posts: 15,
    themes: 20,
    ideaRegen: 5,
    textRegen: 5,
    price: 790,
    highlight: true,
  },
  {
    code: 'plan30',
    title: '30 постов',
    short: 'Для активного контент-плана',
    posts: 30,
    themes: 40,
    ideaRegen: 10,
    textRegen: 10,
    price: 1290,
  },
];

const REQUEST_TIMEOUT_MS = 40000;
const LONG_REQUEST_TIMEOUT_MS = 180000;
const TOPIC_POSTS_TIMEOUT_MS = 65000;

function isLocalHost(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

function normalizeApiBaseUrl(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }
  try {
    const parsed = new URL(value);
    const isLocal = isLocalHost(parsed.hostname);
    if (parsed.protocol === 'https:') {
      return parsed.toString().replace(/\/+$/, '');
    }
    if (parsed.protocol === 'http:' && isLocal) {
      return parsed.toString().replace(/\/+$/, '');
    }
    return '';
  } catch {
    return '';
  }
}

const backendApiBase =
  normalizeApiBaseUrl(String(import.meta.env.VITE_BACKEND_API_URL || '')) ||
  normalizeApiBaseUrl(String(import.meta.env.NEXT_PUBLIC_BACKEND_API_URL || ''));
const backendApiKey = String(
  import.meta.env.VITE_BACKEND_API_KEY || import.meta.env.NEXT_PUBLIC_BACKEND_API_KEY || '',
).trim();

function requireBackendApiBase(): string {
  if (!backendApiBase) {
    throw new Error('Backend API is not configured. Set VITE_BACKEND_API_URL.');
  }
  return backendApiBase;
}

function readLaunchParams(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const candidates = [
    String(window.location.search || '').replace(/^\?/, '').trim(),
    String(window.location.hash || '')
      .replace(/^#/, '')
      .split('?')[1] || '',
  ];

  for (const raw of candidates) {
    const value = String(raw || '').trim();
    if (!value) {
      continue;
    }
    if (value.includes('vk_user_id=') && value.includes('sign=')) {
      return value;
    }
  }
  return '';
}

async function requestJson<T>(
  method: 'GET' | 'POST',
  path: string,
  payload?: Record<string, unknown>,
  vkUserId?: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const base = requireBackendApiBase();
  const isSupabaseFunctions = /\.supabase\.co\/functions\/v1(?:\/|$)/i.test(base);
  if (isSupabaseFunctions && !backendApiKey) {
    throw new Error('Backend API key is not configured. Set VITE_BACKEND_API_KEY.');
  }
  const launchParams = readLaunchParams();
  const body: Record<string, unknown> = { ...(payload || {}) };
  if (launchParams) {
    body.launchParams = launchParams;
  } else if (vkUserId) {
    body.vkUserId = String(vkUserId);
  }

  const controller = new AbortController();
  const safeTimeout = Math.max(3000, Number(timeoutMs) || REQUEST_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), safeTimeout);

  try {
    const headers: Record<string, string> = {};
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }
    if (backendApiKey) {
      headers.Authorization = `Bearer ${backendApiKey}`;
      headers.apikey = backendApiKey;
    }

    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const msg =
        typeof data === 'object' && data && 'message' in data
          ? String((data as { message?: string }).message || '')
          : '';
      throw new Error(msg || `HTTP ${response.status}`);
    }
    return ((data || {}) as T);
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw new Error('Request timeout. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  async getPlans(): Promise<ApiResult> {
    if (!backendApiBase) {
      return { plans: PLAN_CATALOG };
    }
    return requestJson<ApiResult>('GET', '/api/plans');
  },

  async getState(vkUserId: string): Promise<{ state: AppState }> {
    return requestJson<{ state: AppState }>('POST', '/api/state', {}, vkUserId);
  },

  async updateBusinessInfo(vkUserId: string, text: string): Promise<ApiResult> {
    return requestJson<ApiResult>('POST', '/api/user/business-info', { text }, vkUserId);
  },

  async connectCommunity(vkUserId: string, communityUrl: string): Promise<ApiResult> {
    return requestJson<ApiResult>('POST', '/api/community/connect', { communityUrl }, vkUserId, LONG_REQUEST_TIMEOUT_MS);
  },

  async disconnectCommunity(vkUserId: string): Promise<ApiResult> {
    return requestJson<ApiResult>('POST', '/api/community/disconnect', {}, vkUserId);
  },

  async purchasePlan(vkUserId: string, planCode: Exclude<PlanCode, 'free'>): Promise<ApiResult> {
    return requestJson<ApiResult>('POST', '/api/purchase', { planCode }, vkUserId);
  },

  async buyViaVkChat(
    vkUserId: string,
    planCode: Exclude<PlanCode, 'free'>,
    promoCode?: string,
  ): Promise<ApiResult> {
    return requestJson<ApiResult>('POST', '/api/purchase/vk-chat', { planCode, promoCode: promoCode || '' }, vkUserId);
  },

  async previewPromo(
    vkUserId: string,
    promoCode: string,
    planCode?: Exclude<PlanCode, 'free'>,
  ): Promise<ApiResult> {
    return requestJson<ApiResult>('POST', '/api/promo/preview', { code: promoCode, planCode: planCode || '' }, vkUserId);
  },

  async generateMore(vkUserId: string): Promise<ApiResult> {
    return requestJson<ApiResult>('POST', '/api/topics/more', {}, vkUserId, LONG_REQUEST_TIMEOUT_MS);
  },

  async regeneratePage(vkUserId: string, page: number): Promise<ApiResult> {
    return requestJson<ApiResult>('POST', '/api/topics/regenerate-page', { page }, vkUserId, LONG_REQUEST_TIMEOUT_MS);
  },

  async regenerateTopic(vkUserId: string, topicId: string, fallbackPage?: number): Promise<ApiResult> {
    try {
      return await requestJson<ApiResult>('POST', '/api/topics/regenerate-one', { topicId }, vkUserId, LONG_REQUEST_TIMEOUT_MS);
    } catch (error) {
      const message = String((error as Error)?.message || '').trim();
      const shouldFallback = /^HTTP\s+404$/i.test(message) || /endpoint not found/i.test(message);
      if (shouldFallback && Number.isFinite(Number(fallbackPage)) && Number(fallbackPage) > 0) {
        return requestJson<ApiResult>('POST', '/api/topics/regenerate-page', { page: Number(fallbackPage) }, vkUserId, LONG_REQUEST_TIMEOUT_MS);
      }
      throw error;
    }
  },

  async addCustomTopic(vkUserId: string, title: string): Promise<ApiResult> {
    return requestJson<ApiResult>('POST', '/api/topics/custom', { title }, vkUserId);
  },

  async generateTopicPosts(
    vkUserId: string,
    topicId: string,
    timeoutMs = TOPIC_POSTS_TIMEOUT_MS,
  ): Promise<{ topic: Topic; posts: GeneratedPost[]; message: string }> {
    return requestJson<{ topic: Topic; posts: GeneratedPost[]; message: string }>(
      'POST',
      '/api/topics/posts',
      { topicId },
      vkUserId,
      timeoutMs,
    );
  },

  async getTopicPostsStatus(
    vkUserId: string,
    topicId: string,
  ): Promise<{ topic: Topic; posts: GeneratedPost[]; ready: boolean; message?: string }> {
    return requestJson<{ topic: Topic; posts: GeneratedPost[]; ready: boolean; message?: string }>(
      'POST',
      '/api/topics/posts/status',
      { topicId },
      vkUserId,
      REQUEST_TIMEOUT_MS,
    );
  },

  async regenerateTopicPosts(
    vkUserId: string,
    topicId: string,
    timeoutMs = TOPIC_POSTS_TIMEOUT_MS,
  ): Promise<{ topic: Topic; posts: GeneratedPost[]; state: AppState; message: string }> {
    return requestJson<{ topic: Topic; posts: GeneratedPost[]; state: AppState; message: string }>(
      'POST',
      '/api/topics/posts/regenerate',
      { topicId },
      vkUserId,
      timeoutMs,
    );
  },

  async sendSupport(vkUserId: string, text: string): Promise<ApiResult> {
    return requestJson<ApiResult>('POST', '/api/support', { text }, vkUserId);
  },

  async adminMe(vkUserId: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/me', {}, vkUserId);
  },
  async adminListAdmins(vkUserId: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/admins/list', {}, vkUserId);
  },
  async adminAddAdmin(vkUserId: string, targetUserRef: string, role = 'admin'): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/admins/add', { targetUserRef, role }, vkUserId);
  },
  async adminRemoveAdmin(vkUserId: string, targetUserRef: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/admins/remove', { targetUserRef }, vkUserId);
  },
  async adminGetUser(vkUserId: string, targetUserRef: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/users/get', { targetUserRef }, vkUserId);
  },
  async adminSetPlan(vkUserId: string, targetUserRef: string, planCode: PlanCode): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/users/set-plan', { targetUserRef, planCode }, vkUserId);
  },
  async adminUsageReset(vkUserId: string, targetUserRef: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/users/reset-usage', { targetUserRef }, vkUserId);
  },
  async adminLimitsSet(vkUserId: string, targetUserRef: string, limits: LimitsPatch): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/users/limits-set', { targetUserRef, limits }, vkUserId);
  },
  async adminLimitsAdd(vkUserId: string, targetUserRef: string, limits: LimitsPatch): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/users/limits-add', { targetUserRef, limits }, vkUserId);
  },
  async adminUnlinkUser(vkUserId: string, targetUserRef: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/users/unlink', { targetUserRef }, vkUserId);
  },
  async adminUnlinkGroup(vkUserId: string, groupRef: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/groups/unlink', { groupRef }, vkUserId);
  },
  async adminResetUser(vkUserId: string, targetUserRef: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/users/reset', { targetUserRef }, vkUserId);
  },
  async adminForgetUser(vkUserId: string, targetUserRef: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/users/forget', { targetUserRef }, vkUserId);
  },
  async adminPromoList(vkUserId: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/promos/list', {}, vkUserId);
  },
  async adminPromoAdd(vkUserId: string, input: PromoInput): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/promos/add', { input }, vkUserId);
  },
  async adminPromoSet(vkUserId: string, input: PromoInput): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/promos/set', { input }, vkUserId);
  },
  async adminPromoDelete(vkUserId: string, code: string): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/promos/delete', { code }, vkUserId);
  },
  async adminPromoToggle(vkUserId: string, code: string, active: boolean): Promise<AdminResult> {
    return requestJson<AdminResult>('POST', '/api/admin/promos/toggle', { code, active }, vkUserId);
  },
};
