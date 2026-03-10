export type PlanCode = 'free' | 'one_time' | 'plan10' | 'plan15' | 'plan30' | 'unlim';

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
};

export type Topic = {
  id: string;
  seqNo: number;
  title: string;
  short: string;
  source: 'auto' | 'custom' | string;
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
};

const API_BASE = String(import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787').replace(
  /\/+$/,
  '',
);

async function request<T = ApiResult>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload.error === 'string' && payload.error) ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export const api = {
  getPlans() {
    return request<{ plans: PlanDefinition[] }>('/api/plans');
  },

  getState(vkUserId: string) {
    return request<{ state: AppState }>(`/api/state?vkUserId=${encodeURIComponent(vkUserId)}`);
  },

  connectCommunity(vkUserId: string, communityUrl: string) {
    return request<ApiResult>('/api/community/connect', {
      method: 'POST',
      body: JSON.stringify({ vkUserId, communityUrl }),
    });
  },

  disconnectCommunity(vkUserId: string) {
    return request<ApiResult>('/api/community/disconnect', {
      method: 'POST',
      body: JSON.stringify({ vkUserId }),
    });
  },

  purchasePlan(vkUserId: string, planCode: Exclude<PlanCode, 'free'>) {
    return request<ApiResult>('/api/plans/purchase', {
      method: 'POST',
      body: JSON.stringify({ vkUserId, planCode }),
    });
  },

  generateMore(vkUserId: string) {
    return request<ApiResult>('/api/topics/generate-more', {
      method: 'POST',
      body: JSON.stringify({ vkUserId }),
    });
  },

  regeneratePage(vkUserId: string, page: number) {
    return request<ApiResult>('/api/topics/regenerate-page', {
      method: 'POST',
      body: JSON.stringify({ vkUserId, page }),
    });
  },

  addCustomTopic(vkUserId: string, title: string) {
    return request<ApiResult>('/api/topics/custom', {
      method: 'POST',
      body: JSON.stringify({ vkUserId, title }),
    });
  },

  sendSupport(vkUserId: string, text: string) {
    return request<ApiResult>('/api/support', {
      method: 'POST',
      body: JSON.stringify({ vkUserId, text }),
    });
  },
};
