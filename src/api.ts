import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

type UserRow = {
  vk_user_id: number;
  plan_code: string;
  posts_total: number;
  posts_used: number;
  themes_capacity_total: number;
  idea_regen_total: number;
  idea_regen_used: number;
  text_regen_total: number;
  text_regen_used: number;
  selected_community_id: number | null;
};

type CommunityRow = {
  id: number;
  community_url: string;
  community_screen: string;
  owner_vk_user_id: number;
};

type TopicRow = {
  id: number;
  seq_no: number;
  title: string;
  short: string;
  source: string;
};

const PLAN_CATALOG: PlanDefinition[] = [
  {
    code: 'one_time',
    title: '⚡ Разовый доступ',
    short: 'Для быстрого теста',
    posts: 1,
    themes: 1,
    ideaRegen: 0,
    textRegen: 0,
    price: 99,
  },
  {
    code: 'plan10',
    title: '📌 10 постов',
    short: 'Старт для регулярного контента',
    posts: 10,
    themes: 10,
    ideaRegen: 2,
    textRegen: 3,
    price: 590,
  },
  {
    code: 'plan15',
    title: '⭐ 15 постов (Рекомендуем)',
    short: 'Оптимальный баланс цены и возможностей',
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
    short: 'Для стабильного контент-потока',
    posts: 30,
    themes: 40,
    ideaRegen: 10,
    textRegen: 10,
    price: 1290,
  },
  {
    code: 'unlim',
    title: '⚡ Безлимит',
    short: 'Максимум свободы и экспериментов',
    posts: 100,
    themes: 100,
    ideaRegen: 100,
    textRegen: 100,
    price: 2490,
  },
];

const PLAN_MAP = new Map(PLAN_CATALOG.map((plan) => [plan.code, plan]));

const PAGE_SIZE = 10;

const supabaseUrl =
  String(import.meta.env.VITE_SUPABASE_URL || '') ||
  String(import.meta.env.NEXT_PUBLIC_SUPABASE_URL || '');
const supabaseKey =
  String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '') ||
  String(import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '') ||
  String(import.meta.env.VITE_SUPABASE_ANON_KEY || '') ||
  String(import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');

let supabase: SupabaseClient | null = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function client(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase не настроен. Укажите VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  return supabase;
}

function asVkId(vkUserId: string): number {
  const id = Number(vkUserId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Некорректный vkUserId.');
  }
  return id;
}

function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeVkUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return '';
  }
  const hasProtocol = /^https?:\/\//i.test(trimmed);
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!/vk\.com$/i.test(parsed.hostname)) {
      return '';
    }
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!path || path === '/') {
      return '';
    }
    return `https://vk.com${path}`;
  } catch {
    return '';
  }
}

function extractCommunityName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, '').split('/')[0] || 'community';
  } catch {
    return 'community';
  }
}

function topicTemplate(index: number, communityName: string): { title: string; short: string } {
  const templates = [
    {
      title: `Знакомство с ${communityName}`,
      short: 'Кто вы, чем полезны клиенту и почему к вам стоит обратиться.',
    },
    {
      title: `Типичная ошибка клиентов в ${communityName}`,
      short: 'Разбор частой ошибки и короткий практический совет для подписчиков.',
    },
    {
      title: `Кейс для ${communityName}: было / стало`,
      short: 'Покажите исходную задачу, ваш подход и измеримый результат.',
    },
    {
      title: `FAQ по услугам ${communityName}`,
      short: 'Ответьте на 3-5 вопросов, которые чаще всего задают в сообщениях.',
    },
    {
      title: `Как выбрать лучшее решение в ${communityName}`,
      short: 'Дайте простые критерии выбора без сложной терминологии.',
    },
    {
      title: `Мифы о ${communityName}`,
      short: 'Опровергните популярные заблуждения и покажите правильный подход.',
    },
    {
      title: `Пошаговый план: первый шаг в ${communityName}`,
      short: 'Опишите понятный алгоритм действий для нового клиента.',
    },
    {
      title: `Что важно перед заказом в ${communityName}`,
      short: 'Чек-лист подготовки, чтобы получить лучший результат.',
    },
    {
      title: `Ошибки после старта в ${communityName}`,
      short: 'Разберите, что чаще всего мешает получить эффект и как это исправить.',
    },
    {
      title: `История клиента ${communityName}`,
      short: 'Короткий живой рассказ с акцентом на путь и результат.',
    },
  ];
  return templates[index % templates.length];
}

function createAutoTopics(count: number, startFrom: number, communityName: string) {
  return Array.from({ length: count }, (_, idx) => {
    const sequence = startFrom + idx;
    const tpl = topicTemplate(sequence - 1, communityName);
    return {
      seq_no: sequence,
      title: tpl.title,
      short: tpl.short,
      source: 'auto',
    };
  });
}

function mapState(user: UserRow, community: CommunityRow | null, topics: TopicRow[]): AppState {
  return {
    user: {
      vkUserId: String(user.vk_user_id),
      planCode: (String(user.plan_code || 'free') as PlanCode) || 'free',
      postsTotal: toInt(user.posts_total, 0),
      postsUsed: toInt(user.posts_used, 0),
      themesCapacityTotal: toInt(user.themes_capacity_total, 0),
      ideaRegenTotal: toInt(user.idea_regen_total, 0),
      ideaRegenUsed: toInt(user.idea_regen_used, 0),
      textRegenTotal: toInt(user.text_regen_total, 0),
      textRegenUsed: toInt(user.text_regen_used, 0),
      selectedCommunityId: community ? toInt(community.id, 0) : null,
      selectedCommunityUrl: community?.community_url || '',
      selectedCommunityName: community?.community_screen || '',
    },
    topics: topics.map((topic) => ({
      id: String(topic.id),
      seqNo: toInt(topic.seq_no, 0),
      title: String(topic.title || ''),
      short: String(topic.short || ''),
      source: String(topic.source || 'auto'),
    })),
  };
}

async function loadUser(vkId: number): Promise<UserRow> {
  const db = client();
  await db.from('app_users').upsert({ vk_user_id: vkId }, { onConflict: 'vk_user_id', ignoreDuplicates: true });
  const { data, error } = await db.from('app_users').select('*').eq('vk_user_id', vkId).single<UserRow>();
  if (error || !data) {
    throw new Error(`Не удалось загрузить пользователя: ${error?.message || 'пустой ответ'}`);
  }
  return data;
}

async function loadCommunity(vkId: number): Promise<CommunityRow | null> {
  const db = client();
  const { data, error } = await db
    .from('communities')
    .select('id,community_url,community_screen,owner_vk_user_id')
    .eq('owner_vk_user_id', vkId)
    .maybeSingle<CommunityRow>();
  if (error) {
    throw new Error(`Не удалось загрузить сообщество: ${error.message}`);
  }
  return data || null;
}

async function loadTopics(vkId: number): Promise<TopicRow[]> {
  const db = client();
  const { data, error } = await db
    .from('topics')
    .select('id,seq_no,title,short,source')
    .eq('vk_user_id', vkId)
    .order('seq_no', { ascending: true });
  if (error) {
    throw new Error(`Не удалось загрузить темы: ${error.message}`);
  }
  return (data || []) as TopicRow[];
}

async function loadState(vkId: number): Promise<AppState> {
  const [user, community, topics] = await Promise.all([loadUser(vkId), loadCommunity(vkId), loadTopics(vkId)]);
  return mapState(user, community, topics);
}

function getToPageEdge(topicsCount: number): number {
  const rem = topicsCount % PAGE_SIZE;
  return rem === 0 ? PAGE_SIZE : PAGE_SIZE - rem;
}

export const api = {
  async getPlans() {
    return { plans: PLAN_CATALOG };
  },

  async getState(vkUserId: string) {
    const vkId = asVkId(vkUserId);
    const state = await loadState(vkId);
    return { state };
  },

  async connectCommunity(vkUserId: string, communityUrl: string): Promise<ApiResult> {
    const vkId = asVkId(vkUserId);
    const db = client();
    await loadUser(vkId);

    const normalizedUrl = normalizeVkUrl(communityUrl);
    if (!normalizedUrl) {
      throw new Error('Укажите корректную ссылку на VK-сообщество.');
    }

    const { data: byUrl, error: byUrlError } = await db
      .from('communities')
      .select('id,owner_vk_user_id')
      .eq('community_url', normalizedUrl)
      .maybeSingle<{ id: number; owner_vk_user_id: number }>();
    if (byUrlError) {
      throw new Error(byUrlError.message);
    }
    if (byUrl && Number(byUrl.owner_vk_user_id) !== vkId) {
      throw new Error(
        'Это сообщество уже подключено к другому аккаунту. Одно сообщество можно привязать только к одному пользователю.',
      );
    }

    const currentCommunity = await loadCommunity(vkId);
    if (currentCommunity && currentCommunity.community_url !== normalizedUrl) {
      const { error: deleteError } = await db.from('communities').delete().eq('id', currentCommunity.id);
      if (deleteError) {
        throw new Error(deleteError.message);
      }
      await db.from('topics').delete().eq('vk_user_id', vkId);
      await db
        .from('app_users')
        .update({ selected_community_id: null })
        .eq('vk_user_id', vkId);
    }

    const communityScreen = extractCommunityName(normalizedUrl);
    const { data: upsertedCommunity, error: upsertError } = await db
      .from('communities')
      .upsert(
        {
          community_url: normalizedUrl,
          community_screen: communityScreen,
          owner_vk_user_id: vkId,
        },
        { onConflict: 'owner_vk_user_id' },
      )
      .select('id')
      .single<{ id: number }>();
    if (upsertError || !upsertedCommunity) {
      throw new Error(upsertError?.message || 'Не удалось сохранить сообщество.');
    }

    const { error: setCommunityError } = await db
      .from('app_users')
      .update({ selected_community_id: upsertedCommunity.id })
      .eq('vk_user_id', vkId);
    if (setCommunityError) {
      throw new Error(setCommunityError.message);
    }

    let state = await loadState(vkId);
    let generatedCount = 0;
    if (state.topics.length === 0) {
      const remainingPosts = Math.max(0, state.user.postsTotal - state.user.postsUsed);
      const remainingThemeSlots = Math.max(0, state.user.themesCapacityTotal - state.topics.length);
      generatedCount = Math.min(3, remainingPosts, remainingThemeSlots);
      if (generatedCount > 0) {
        const generated = createAutoTopics(generatedCount, 1, state.user.selectedCommunityName || communityScreen);
        const rows = generated.map((item) => ({
          vk_user_id: vkId,
          community_id: upsertedCommunity.id,
          seq_no: item.seq_no,
          title: item.title,
          short: item.short,
          source: item.source,
        }));
        const { error: insertTopicsError } = await db.from('topics').insert(rows);
        if (insertTopicsError) {
          throw new Error(insertTopicsError.message);
        }
        const { error: updateUserError } = await db
          .from('app_users')
          .update({ posts_used: state.user.postsUsed + generatedCount })
          .eq('vk_user_id', vkId);
        if (updateUserError) {
          throw new Error(updateUserError.message);
        }
        state = await loadState(vkId);
      }
    }

    return {
      state,
      message:
        generatedCount > 0
          ? `Сообщество подключено. Сгенерировано стартовых тем: ${generatedCount}.`
          : 'Сообщество подключено. Лимит тем исчерпан, выберите тариф для продолжения.',
    };
  },

  async disconnectCommunity(vkUserId: string): Promise<ApiResult> {
    const vkId = asVkId(vkUserId);
    const db = client();
    await loadUser(vkId);
    const community = await loadCommunity(vkId);
    if (community) {
      const { error: deleteCommunityError } = await db.from('communities').delete().eq('id', community.id);
      if (deleteCommunityError) {
        throw new Error(deleteCommunityError.message);
      }
    }
    await db.from('topics').delete().eq('vk_user_id', vkId);
    await db.from('app_users').update({ selected_community_id: null }).eq('vk_user_id', vkId);
    const state = await loadState(vkId);
    return { state, message: 'Сообщество отключено. Теперь можно привязать новое.' };
  },

  async purchasePlan(vkUserId: string, planCode: Exclude<PlanCode, 'free'>): Promise<ApiResult> {
    const vkId = asVkId(vkUserId);
    const db = client();
    const plan = PLAN_MAP.get(planCode);
    if (!plan) {
      throw new Error('Неизвестный тариф.');
    }
    const user = await loadUser(vkId);
    const { error: updateError } = await db
      .from('app_users')
      .update({
        plan_code: plan.code,
        posts_total: user.posts_total + plan.posts,
        themes_capacity_total: user.themes_capacity_total + plan.themes,
        idea_regen_total: user.idea_regen_total + plan.ideaRegen,
        text_regen_total: user.text_regen_total + plan.textRegen,
      })
      .eq('vk_user_id', vkId);
    if (updateError) {
      throw new Error(updateError.message);
    }
    const { error: purchaseError } = await db
      .from('purchases')
      .insert({ vk_user_id: vkId, plan_code: plan.code, amount_rub: plan.price });
    if (purchaseError) {
      throw new Error(purchaseError.message);
    }
    const state = await loadState(vkId);
    return { state, message: `Тариф «${plan.title}» активирован. Лимиты начислены.` };
  },

  async generateMore(vkUserId: string): Promise<ApiResult> {
    const vkId = asVkId(vkUserId);
    const db = client();
    const state = await loadState(vkId);
    if (!state.user.selectedCommunityId) {
      throw new Error('Сначала подключите сообщество.');
    }
    const remainingPosts = Math.max(0, state.user.postsTotal - state.user.postsUsed);
    const remainingThemeSlots = Math.max(0, state.user.themesCapacityTotal - state.topics.length);
    const count = Math.min(remainingPosts, remainingThemeSlots, getToPageEdge(state.topics.length));
    if (count <= 0) {
      throw new Error('Лимит тем исчерпан. Выберите тариф для продолжения.');
    }
    const generated = createAutoTopics(
      count,
      state.topics.length + 1,
      state.user.selectedCommunityName || 'сообщества',
    );
    const rows = generated.map((topic) => ({
      vk_user_id: vkId,
      community_id: state.user.selectedCommunityId,
      seq_no: topic.seq_no,
      title: topic.title,
      short: topic.short,
      source: topic.source,
    }));
    const { error: insertError } = await db.from('topics').insert(rows);
    if (insertError) {
      throw new Error(insertError.message);
    }
    const { error: updateError } = await db
      .from('app_users')
      .update({ posts_used: state.user.postsUsed + count })
      .eq('vk_user_id', vkId);
    if (updateError) {
      throw new Error(updateError.message);
    }
    const nextState = await loadState(vkId);
    return { state: nextState, message: `Добавлено тем: ${count}.` };
  },

  async regeneratePage(vkUserId: string, page: number): Promise<ApiResult> {
    const vkId = asVkId(vkUserId);
    const db = client();
    const state = await loadState(vkId);
    if (!state.user.selectedCommunityId) {
      throw new Error('Сначала подключите сообщество.');
    }
    const safePage = Math.max(1, toInt(page, 1));
    const start = (safePage - 1) * PAGE_SIZE;
    const chunk = state.topics.slice(start, start + PAGE_SIZE);
    if (!chunk.length) {
      throw new Error('На текущей странице нет тем для перегенерации.');
    }
    const required = chunk.length;
    const remainingIdeaRegens = Math.max(0, state.user.ideaRegenTotal - state.user.ideaRegenUsed);
    if (remainingIdeaRegens < required) {
      throw new Error(
        `Недостаточно перегенераций тем. Нужно: ${required}, доступно: ${remainingIdeaRegens}.`,
      );
    }
    for (const topic of chunk) {
      const nextTitle = topic.title.includes('(обновлено)') ? topic.title : `${topic.title} (обновлено)`;
      const { error } = await db
        .from('topics')
        .update({
          title: nextTitle,
          short: 'Перегенерировано с учетом контекста сообщества и уже существующих тем.',
        })
        .eq('vk_user_id', vkId)
        .eq('seq_no', topic.seqNo);
      if (error) {
        throw new Error(error.message);
      }
    }
    const { error: userError } = await db
      .from('app_users')
      .update({ idea_regen_used: state.user.ideaRegenUsed + required })
      .eq('vk_user_id', vkId);
    if (userError) {
      throw new Error(userError.message);
    }
    const nextState = await loadState(vkId);
    return { state: nextState, message: `Перегенерировано тем: ${required}.` };
  },

  async addCustomTopic(vkUserId: string, title: string): Promise<ApiResult> {
    const vkId = asVkId(vkUserId);
    const db = client();
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      throw new Error('Введите тему для своего поста.');
    }
    const state = await loadState(vkId);
    if (!state.user.selectedCommunityId) {
      throw new Error('Сначала подключите сообщество.');
    }
    const remainingPosts = Math.max(0, state.user.postsTotal - state.user.postsUsed);
    const remainingThemeSlots = Math.max(0, state.user.themesCapacityTotal - state.topics.length);
    if (remainingPosts <= 0 || remainingThemeSlots <= 0) {
      throw new Error('Лимит тем исчерпан. Выберите тариф для продолжения.');
    }
    const { error: insertError } = await db.from('topics').insert({
      vk_user_id: vkId,
      community_id: state.user.selectedCommunityId,
      seq_no: state.topics.length + 1,
      title: cleanTitle,
      short: 'Пользовательская тема, добавлена через кнопку «Свой пост».',
      source: 'custom',
    });
    if (insertError) {
      throw new Error(insertError.message);
    }
    const { error: updateError } = await db
      .from('app_users')
      .update({ posts_used: state.user.postsUsed + 1 })
      .eq('vk_user_id', vkId);
    if (updateError) {
      throw new Error(updateError.message);
    }
    const nextState = await loadState(vkId);
    return { state: nextState, message: 'Тема добавлена в контент-план.' };
  },

  async sendSupport(vkUserId: string, text: string): Promise<ApiResult> {
    const vkId = asVkId(vkUserId);
    const db = client();
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      throw new Error('Введите текст обращения.');
    }
    await loadUser(vkId);
    const { error } = await db.from('support_requests').insert({ vk_user_id: vkId, text: cleanText });
    if (error) {
      throw new Error(error.message);
    }
    return { ok: true, message: 'Обращение сохранено.' };
  },
};
