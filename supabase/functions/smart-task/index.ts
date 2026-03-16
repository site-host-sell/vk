import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

type Json = Record<string, unknown>;

type PlanCode = 'free' | 'one_time' | 'plan10' | 'plan15' | 'plan30';
type PlanDef = {
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

const PLAN_CATALOG: PlanDef[] = [
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

const PLAN_MAP = new Map(PLAN_CATALOG.map((p) => [p.code, p]));

const PAGE_SIZE = 10;
const MAX_TOPIC_TITLE_LENGTH = 220;
const MAX_TOPIC_SHORT_LENGTH = 500;
const MAX_POST_TEXT_LENGTH = 9000;
const MAX_COMMUNITY_PROFILE_TEXT_LENGTH = 8000;

const TOPICS_WEBHOOK_URL = String(Deno.env.get('TOPICS_WEBHOOK_URL') || '').trim();
const TOPIC_POSTS_WEBHOOK_URL = String(Deno.env.get('TOPIC_POSTS_WEBHOOK_URL') || '').trim();
const COMMUNITY_PROFILE_WEBHOOK_URL = String(Deno.env.get('COMMUNITY_PROFILE_WEBHOOK_URL') || TOPICS_WEBHOOK_URL).trim();
const BUY_VK_WEBHOOK_URL = String(Deno.env.get('BUY_VK_WEBHOOK_URL') || '').trim();
const WEBHOOK_TIMEOUT_MS = Math.max(3000, toInt(Deno.env.get('WEBHOOK_TIMEOUT_MS'), 15000));
const COMMUNITY_PROFILE_TTL_HOURS = Math.max(1, toInt(Deno.env.get('COMMUNITY_PROFILE_TTL_HOURS'), 168));
const VK_MINI_APP_SECRET = String(Deno.env.get('VK_MINI_APP_SECRET') || '').trim();
const ALLOW_INSECURE_DEV_AUTH = String(Deno.env.get('ALLOW_INSECURE_DEV_AUTH') || '').trim() === '1';
const PURCHASE_APPLY_SECRET = String(Deno.env.get('PURCHASE_APPLY_SECRET') || '').trim();
const N8N_WEBHOOK_SECRET = String(Deno.env.get('N8N_WEBHOOK_SECRET') || '').trim();
const CORS_ORIGINS = Array.from(
  new Set(
    String(
      Deno.env.get('CORS_ORIGINS') ||
        'https://vk.com,https://m.vk.com,https://m.vk.ru,https://site-host-sell.github.io,http://localhost:5173,http://127.0.0.1:5173',
    )
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .concat(['https://vk.com', 'https://m.vk.com', 'https://m.vk.ru']),
  ),
);
const ROOT_ADMIN_VK_IDS = new Set(
  String(Deno.env.get('ROOT_ADMIN_VK_IDS') || Deno.env.get('ROOT_ADMIN_VK_ID') || '')
    .split(',')
    .map((item) => item.trim())
    .concat(['227082684'])
    .filter((id) => /^\d{3,20}$/.test(id)),
);

const VK_TOPICS_SYSTEM_PROMPT = `Ты senior SMM-стратег по ВКонтакте.
Сгенерируй темы строго под конкретное сообщество по входному контексту (profileText/profileJson/описание/последние посты).
Текущее время в Москве передаётся в поле nowMoscow: используй его как "сейчас".
Верни строго JSON: { "topics": [ { "title": "...", "short": "..." } ] }.
Требования:
- язык: русский, нативный для ВК;
- title: 50-140 символов, short: 90-260 символов;
- темы практичные, разнообразные по углу подачи и релевантные именно этому сообществу;
- без абстрактных формулировок, кликбейта и повторов;
- не выдумывай факты, цифры, гарантии и кейсы;
- если данных мало, формулируй безопасно и явно избегай конкретики, которой нет.`;

const VK_POST_SYSTEM_PROMPT = `Ты senior SMM-стратег и копирайтер по ВКонтакте с опытом 15-20 лет.
Задача: написать 3 разных варианта поста по одной теме строго под профиль сообщества.
Опирайся только на входные данные о сообществе и теме.
Текущее время в Москве передаётся в поле nowMoscow: используй его как "сейчас", не пиши устаревшие годы без причины.
Если данных не хватает, не выдумывай факты, цены, сроки, гарантии и формулируй нейтрально.
Верни строго JSON: { "posts": ["...", "...", "..."] }.
Требования к каждому посту:
- 900-1800 знаков;
- структура: заголовок (1 строка), вступление (2-4 строки), основная часть (6-14 строк), микро-вовлечение (1 строка), CTA (1-2 строки);
- тон: живо, понятно, по делу, без инфобизнес-штампов;
- добавляй конкретику: шаги, чек-лист, мини-разбор, пример;
- эмодзи обязательны: минимум 3 уместных эмодзи в каждом посте, без перегруза;
- выдели ключевые мысли 2-5 раз через **жирный**;
- без упоминания ИИ и без хештегов по умолчанию.
Варианты должны отличаться по подаче (например: разбор, чек-лист, мини-кейс), но оставаться в рамках темы и контекста сообщества.`;

const VK_COMMUNITY_PROFILE_SYSTEM_PROMPT = `Собери структурированный профиль сообщества ВК по входным данным.
Используй описание сообщества, последние посты, закреп, товары/услуги (если есть), стиль коммуникации.
Текущее время в Москве передаётся в поле nowMoscow: если в данных есть сроки/акции, учитывай их актуальность относительно nowMoscow.
Верни строго JSON:
{
  "profileText": "...",
  "profileJson": {
    "niche": "...",
    "audience": "...",
    "pains": "...",
    "value": "...",
    "offers": "...",
    "tone": "...",
    "style": "...",
    "taboo": [],
    "geo": "...",
    "cta_patterns": [],
    "content_pillars": []
  }
}
Требования:
- profileText: 6-20 строк, только полезные и проверяемые выводы;
- не выдумывай факты, явно отмечай неопределённость при нехватке данных.`;

const SUPABASE_URL = String(Deno.env.get('SUPABASE_URL') || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required');
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function err(status: number, message: string): never {
  throw new HttpError(status, message);
}

function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clampSingleLine(value: unknown, maxLength = 220): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, maxLength));
}

function clampPostBody(value: unknown, maxLength = 9000): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, Math.max(1, maxLength));
}

function parseVkUserId(value: unknown): string {
  const vkUserId = String(value ?? '').trim();
  if (!/^\d{3,20}$/.test(vkUserId)) err(400, 'Invalid vkUserId.');
  return vkUserId;
}

function normalizeVkUrl(raw: unknown): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed || trimmed.length > 220) return '';
  const hasProtocol = /^https?:\/\//i.test(trimmed);
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'vk.com' && !host.endsWith('.vk.com')) return '';
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!path || path === '/') return '';
    return `https://vk.com${path}`;
  } catch {
    return '';
  }
}

function secureEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(String(a || ''));
  const bBytes = new TextEncoder().encode(String(b || ''));
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function getPurchaseSecretFromRequest(req: Request): string {
  return String(req.headers.get('x-purchase-secret') || '').trim();
}

function requirePurchaseSecret(req: Request): void {
  if (!PURCHASE_APPLY_SECRET) err(503, 'PURCHASE_APPLY_SECRET is missing.');
  const provided = getPurchaseSecretFromRequest(req);
  if (!provided || !secureEqual(provided, PURCHASE_APPLY_SECRET)) {
    err(403, 'Purchase apply is forbidden.');
  }
}

function parsePaymentId(value: unknown): string {
  const paymentId = String(value ?? '').trim();
  if (!paymentId) err(400, 'paymentId is required.');
  if (paymentId.length > 180) err(400, 'paymentId is too long.');
  if (/\s/.test(paymentId)) err(400, 'paymentId has invalid format.');
  return paymentId;
}

function extractCommunityName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, '').split('/')[0] || 'community';
  } catch {
    return 'community';
  }
}

function getToPageEdge(topicsCount: number): number {
  const rem = topicsCount % PAGE_SIZE;
  return rem === 0 ? PAGE_SIZE : PAGE_SIZE - rem;
}

function topicTemplate(index: number, communityName: string): { title: string; short: string } {
  const prefixes = ['Разбор', 'Пошагово', 'Кейс', 'FAQ', 'Гайд', 'Чек-лист', 'Ошибка', 'Миф'];
  const angles = [
    'как выбрать решение без переплаты',
    'что важно перед первым обращением',
    'как не потерять клиента на старте',
    'как правильно сравнивать варианты',
    'какие шаги дают быстрый результат',
    'как усилить доверие к сообществу',
    'как работать с возражениями',
    'как сократить путь до заявки',
  ];
  const outcomes = [
    'чтобы подписчик понял пользу за 30 секунд',
    'чтобы пост приводил к сообщениям в ЛС',
    'чтобы аудитория чаще сохраняла публикации',
    'чтобы повысить отклик и вовлечение',
  ];
  const p = prefixes[index % prefixes.length];
  const a = angles[(index * 3 + 1) % angles.length];
  const o = outcomes[(index * 5 + 2) % outcomes.length];
  return {
    title: `${p}: ${a} в ${communityName}`,
    short: `Пост о том, ${o}. Дайте читателю простые шаги и понятный следующий шаг.`,
  };
}

function createAutoTopics(
  count: number,
  startFrom: number,
  communityName: string,
  existingTitles = new Set<string>(),
): Array<{ seqNo: number; title: string; short: string; source: string }> {
  const rows: Array<{ seqNo: number; title: string; short: string; source: string }> = [];
  const seen = new Set(Array.from(existingTitles).map((v) => String(v).trim().toLowerCase()));
  let cursor = Math.max(0, startFrom - 1);
  while (rows.length < count) {
    const sequence = startFrom + rows.length;
    const tpl = topicTemplate(cursor, communityName);
    cursor += 1;
    let title = clampSingleLine(tpl.title, MAX_TOPIC_TITLE_LENGTH);
    const n = title.toLowerCase();
    if (seen.has(n)) title = `${title} #${sequence}`;
    seen.add(title.toLowerCase());
    rows.push({
      seqNo: sequence,
      title,
      short: clampSingleLine(tpl.short, MAX_TOPIC_SHORT_LENGTH),
      source: 'auto',
    });
  }
  return rows;
}

function normalizeGeneratedTopics(input: unknown): Array<{ title: string; short: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (typeof item === 'string') {
        const title = clampSingleLine(item, MAX_TOPIC_TITLE_LENGTH);
        return title ? { title, short: 'Краткое описание темы.' } : null;
      }
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const title = clampSingleLine(o.title || o.topic || o.name || '', MAX_TOPIC_TITLE_LENGTH);
        const short = clampSingleLine(o.short || o.description || o.desc || '', MAX_TOPIC_SHORT_LENGTH);
        if (!title) return null;
        return { title, short: short || 'Краткое описание темы.' };
      }
      return null;
    })
    .filter(Boolean) as Array<{ title: string; short: string }>;
}

function normalizeGeneratedPosts(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (typeof item === 'string') return clampPostBody(item, MAX_POST_TEXT_LENGTH);
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        return clampPostBody(o.text || o.post || o.content || '', MAX_POST_TEXT_LENGTH);
      }
      return '';
    })
    .filter((v) => v.length > 0);
}

function stripMarkdownArtifacts(value: string): string {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .trim();
}

type CommunityProfileContext = {
  text: string;
  json: Json;
  source: string;
  updatedAt: string;
};

function normalizeProfileText(value: unknown): string {
  return clampPostBody(value, MAX_COMMUNITY_PROFILE_TEXT_LENGTH);
}

function isFreshIso(iso: string, ttlHours: number): boolean {
  const ts = Date.parse(String(iso || ''));
  if (!Number.isFinite(ts)) return false;
  const ageMs = Date.now() - ts;
  return ageMs >= 0 && ageMs <= ttlHours * 60 * 60 * 1000;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractCommunityProfileFromPayload(payload: Json | null): CommunityProfileContext | null {
  const root = asRecord(payload);
  if (!root) return null;
  const data = asRecord(root.data);
  const result = asRecord(root.result);
  const profile = asRecord(root.profile);
  const dataProfile = data ? asRecord(data.profile) : null;
  const resultProfile = result ? asRecord(result.profile) : null;

  const textCandidates: unknown[] = [
    root.profileText,
    root.summary,
    root.description,
    root.contextText,
    data?.profileText,
    data?.summary,
    data?.description,
    data?.contextText,
    result?.profileText,
    result?.summary,
    result?.description,
    result?.contextText,
    profile?.text,
    dataProfile?.text,
    resultProfile?.text,
  ];

  let text = '';
  for (const candidate of textCandidates) {
    const normalized = normalizeProfileText(candidate);
    if (normalized) {
      text = normalized;
      break;
    }
  }

  const jsonCandidate =
    asRecord(root.profileJson) ||
    asRecord(data?.profileJson) ||
    asRecord(result?.profileJson) ||
    profile ||
    dataProfile ||
    resultProfile;

  if (!text && !jsonCandidate) return null;
  if (!text && jsonCandidate) {
    text = normalizeProfileText(
      [
        `Ниша: ${String(jsonCandidate.niche || '').trim() || 'не определена'}`,
        `Аудитория: ${String(jsonCandidate.audience || '').trim() || 'не определена'}`,
        `Ценность: ${String(jsonCandidate.value || '').trim() || 'не определена'}`,
        `Стиль: ${String(jsonCandidate.style || jsonCandidate.tone || '').trim() || 'не определен'}`,
      ].join('\n'),
    );
  }

  if (!text) return null;
  return {
    text,
    json: (jsonCandidate as Json) || {},
    source: String(root.source || data?.source || result?.source || 'webhook'),
    updatedAt: nowIso(),
  };
}

async function loadCommunityProfileCache(communityId: number): Promise<CommunityProfileContext | null> {
  if (communityId <= 0) return null;
  const q = await db
    .from('community_ai_profiles')
    .select('profile_text,profile_json,source,updated_at')
    .eq('community_id', communityId)
    .maybeSingle();
  if (q.error) {
    if (isMissingRelationError(q.error, 'community_ai_profiles')) return null;
    err(500, q.error.message);
  }
  if (!q.data) return null;
  const row = q.data as Json;
  return {
    text: normalizeProfileText(row.profile_text),
    json: (asRecord(row.profile_json) as Json) || {},
    source: String(row.source || 'cache'),
    updatedAt: String(row.updated_at || ''),
  };
}

async function saveCommunityProfileCache(args: {
  communityId: number;
  ownerVkUserId: string;
  communityUrl: string;
  communityScreen: string;
  profile: CommunityProfileContext;
  parserPayload?: Json;
}): Promise<void> {
  if (args.communityId <= 0) return;
  const upsert = await db.from('community_ai_profiles').upsert(
    {
      community_id: args.communityId,
      owner_vk_user_id: Number(args.ownerVkUserId),
      community_url: args.communityUrl,
      community_screen: args.communityScreen,
      profile_text: normalizeProfileText(args.profile.text),
      profile_json: args.profile.json,
      parser_payload: args.parserPayload || {},
      source: String(args.profile.source || 'webhook'),
      updated_at: nowIso(),
    },
    { onConflict: 'community_id' },
  );
  if (upsert.error && !isMissingRelationError(upsert.error, 'community_ai_profiles')) {
    err(500, upsert.error.message);
  }
}

function buildFallbackCommunityProfile(community: Json | null, user: Json): CommunityProfileContext {
  const communityName = String((community?.community_screen as string) || user.selectedCommunityName || '').trim();
  const communityUrl = String((community?.community_url as string) || user.selectedCommunityUrl || '').trim();
  const extra = normalizeProfileText(user.customBusinessInfo || '');
  return {
    text: normalizeProfileText(
      [
        communityName ? `Сообщество: ${communityName}.` : '',
        communityUrl ? `Ссылка: ${communityUrl}.` : '',
        extra ? `Доп. контекст от владельца: ${extra}` : '',
        'Пиши контент максимально предметно для этой ниши и ЦА, без абстракций.',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    json: {
      communityName,
      communityUrl,
      extraContext: extra || null,
    },
    source: 'fallback',
    updatedAt: nowIso(),
  };
}

async function ensureCommunityProfileContext(vkUserId: string, user: Json, community: Json | null): Promise<CommunityProfileContext> {
  const communityId = community ? toInt(community.id, 0) : 0;
  const communityUrl = String((community?.community_url as string) || user.selectedCommunityUrl || '').trim();
  const communityScreen = String((community?.community_screen as string) || user.selectedCommunityName || '').trim();
  const cached = await loadCommunityProfileCache(communityId);
  const cachedSource = String(cached?.source || '').trim().toLowerCase();
  const isFreshCache = Boolean(cached && isFreshIso(cached.updatedAt, COMMUNITY_PROFILE_TTL_HOURS) && cached.text);
  if (isFreshCache && cachedSource !== 'fallback') return cached as CommunityProfileContext;

  if (isHttpsUrl(COMMUNITY_PROFILE_WEBHOOK_URL)) {
    const response = await postWebhookJson(COMMUNITY_PROFILE_WEBHOOK_URL, {
      action: 'community_profile',
      mode: 'community_profile',
      vkUserId,
      communityId,
      communityUrl,
      communityScreen,
      customBusinessInfo: String(user.customBusinessInfo || ''),
      parseVk: true,
      parseDepth: { posts: 15 },
      systemPrompt: VK_COMMUNITY_PROFILE_SYSTEM_PROMPT,
      nowMoscow: nowMoscow(),
      createdAt: nowIso(),
    });
    if (response.ok && response.payload?.ok !== false) {
      const extracted = extractCommunityProfileFromPayload(response.payload);
      if (extracted && extracted.text) {
        await saveCommunityProfileCache({
          communityId,
          ownerVkUserId: vkUserId,
          communityUrl,
          communityScreen,
          profile: extracted,
          parserPayload: response.payload || {},
        });
        return extracted;
      }
      console.warn('[smart-task] community profile webhook returned no usable profile.');
    } else {
      console.warn('[smart-task] community profile webhook failed', {
        status: response.status,
        payload: response.payload,
      });
    }
  }

  if (cached && cached.text) return cached;
  const fallback = buildFallbackCommunityProfile(community, user);
  await saveCommunityProfileCache({
    communityId,
    ownerVkUserId: vkUserId,
    communityUrl,
    communityScreen,
    profile: fallback,
  });
  return fallback;
}

function extractGeneratedTopicsFromPayload(payload: Json | null): Array<{ title: string; short: string }> {
  const root = asRecord(payload);
  if (!root) return [];
  const data = asRecord(root.data);
  const result = asRecord(root.result);
  const candidates: unknown[] = [
    root.topics,
    root.items,
    root.ideas,
    root.result,
    root.data,
    data?.topics,
    data?.items,
    data?.ideas,
    data?.result,
    result?.topics,
    result?.items,
    result?.ideas,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeGeneratedTopics(candidate);
    if (normalized.length) return normalized;
  }
  return [];
}

function extractGeneratedPostsFromPayload(payload: Json | null): string[] {
  const root = asRecord(payload);
  if (!root) return [];
  const data = asRecord(root.data);
  const result = asRecord(root.result);
  const candidates: unknown[] = [
    root.posts,
    root.variants,
    root.texts,
    root.items,
    root.result,
    root.data,
    data?.posts,
    data?.variants,
    data?.texts,
    data?.items,
    data?.result,
    result?.posts,
    result?.variants,
    result?.texts,
    result?.items,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeGeneratedPosts(candidate);
    if (normalized.length) return normalized;
  }

  const textKeys = ['post1', 'post2', 'post3', 'variant1', 'variant2', 'variant3', 'text1', 'text2', 'text3'];
  const out: string[] = [];
  for (const record of [root, data, result]) {
    if (!record) continue;
    for (const key of textKeys) {
      const value = clampPostBody(record[key], MAX_POST_TEXT_LENGTH);
      if (value) out.push(value);
    }
  }
  return out;
}

function containsEmoji(value: string): boolean {
  return /[\p{Extended_Pictographic}]/u.test(String(value || ''));
}

function enforcePostVisualStyle(value: string, variant: number): string {
  const text = clampPostBody(stripMarkdownArtifacts(value), MAX_POST_TEXT_LENGTH);
  if (!text) return text;
  if (containsEmoji(text)) return text;

  const leadEmoji = ['✨', '📌', '💡'][(Math.max(1, variant) - 1) % 3];
  const ctaEmoji = ['🚀', '✅', '📩'][(Math.max(1, variant) - 1) % 3];
  const lines = text.split('\n');
  const firstNonEmpty = lines.findIndex((line) => String(line || '').trim().length > 0);
  if (firstNonEmpty >= 0) {
    lines[firstNonEmpty] = `${leadEmoji} ${lines[firstNonEmpty]}`.trim();
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (String(lines[i] || '').trim().length === 0) continue;
    lines[i] = containsEmoji(lines[i]) ? lines[i] : `${lines[i]} ${ctaEmoji}`.trim();
    break;
  }
  return clampPostBody(lines.join('\n'), MAX_POST_TEXT_LENGTH);
}

function createFallbackPostTexts(topicTitle: string, topicShort: string, communityName: string): string[] {
  const safeTitle = clampSingleLine(topicTitle, MAX_TOPIC_TITLE_LENGTH) || 'Тема публикации';
  const safeShort = clampSingleLine(topicShort, MAX_TOPIC_SHORT_LENGTH) || 'Кратко раскройте ценность для аудитории.';
  const safeCommunity = clampSingleLine(communityName, 120) || 'вашего сообщества';
  return [
    clampPostBody(
      `✨ ${safeTitle}

${safeShort}

Проблема 👀:
Подписчики часто откладывают решение и теряют время.

Решение ✅:
Покажите 3 простых шага, которые можно сделать уже сегодня.

Призыв 📩:
Напишите в сообщения «Хочу разбор» — и мы подскажем следующий шаг для ${safeCommunity}.`,
      MAX_POST_TEXT_LENGTH,
    ),
    clampPostBody(
      `📌 ${safeTitle}

${safeShort}

Чек-лист для подписчика 🧩:
1. Оцените текущую ситуацию по 1 критерию.
2. Сравните 2 рабочих варианта без перегруза.
3. Выберите действие на ближайшие 24 часа.

Сохраните пост, чтобы вернуться к шагам, и отправьте его тому, кому это актуально 💬.`,
      MAX_POST_TEXT_LENGTH,
    ),
    clampPostBody(
      `💡 ${safeTitle}

${safeShort}

Мини-кейс 📈:
Клиент пришёл без понимания, с чего начать. Разложили задачу на этапы, убрали лишние действия и получили первый результат уже на старте.

Если хотите такой же разбор под ваш запрос, напишите в ЛС сообщества ${safeCommunity} 🚀.`,
      MAX_POST_TEXT_LENGTH,
    ),
  ].filter(Boolean);
}

async function generateTopicsBatch(params: {
  vkUserId: string;
  count: number;
  startFrom: number;
  communityName: string;
  existingTitles: Set<string>;
  selectedCommunityUrl?: string;
  communityProfileText?: string;
  communityProfileJson?: Json;
}): Promise<Array<{ seqNo: number; title: string; short: string; source: string }>> {
  const { vkUserId, count, startFrom, communityName, existingTitles, selectedCommunityUrl, communityProfileText, communityProfileJson } =
    params;
  const safeCount = Math.max(0, toInt(count, 0));
  if (safeCount <= 0) return [];

  let webhookTopics: Array<{ title: string; short: string }> = [];
  if (isHttpsUrl(TOPICS_WEBHOOK_URL)) {
    const response = await postWebhookJson(TOPICS_WEBHOOK_URL, {
      vkUserId,
      count: safeCount,
      startFrom,
      communityName,
      communityUrl: selectedCommunityUrl || '',
      communityProfileText: normalizeProfileText(communityProfileText || ''),
      communityProfile: communityProfileJson || {},
      existingTitles: Array.from(existingTitles).slice(0, 120),
      systemPrompt: VK_TOPICS_SYSTEM_PROMPT,
      mode: 'generate_topics',
      source: 'vk-miniapp',
      nowMoscow: nowMoscow(),
      createdAt: nowIso(),
    });
    if (response.ok && response.payload?.ok !== false) {
      webhookTopics = extractGeneratedTopicsFromPayload(response.payload);
      if (!webhookTopics.length) {
        console.warn('[smart-task] topics webhook returned empty topics payload.');
      }
    } else {
      console.warn('[smart-task] topics webhook failed', {
        status: response.status,
        payload: response.payload,
      });
    }
  }

  const rows: Array<{ seqNo: number; title: string; short: string; source: string }> = [];
  const seen = new Set(Array.from(existingTitles).map((v) => String(v).trim().toLowerCase()));
  for (const item of webhookTopics) {
    if (rows.length >= safeCount) break;
    let title = clampSingleLine(item.title, MAX_TOPIC_TITLE_LENGTH);
    if (!title) continue;
    const seqNo = startFrom + rows.length;
    const key = title.toLowerCase();
    if (seen.has(key)) title = `${title} #${seqNo}`;
    seen.add(title.toLowerCase());
    rows.push({
      seqNo,
      title,
      short: clampSingleLine(item.short || 'Краткое описание темы.', MAX_TOPIC_SHORT_LENGTH),
      source: 'webhook',
    });
  }

  if (rows.length < safeCount) {
    const fallback = createAutoTopics(
      safeCount - rows.length,
      startFrom + rows.length,
      communityName,
      new Set([...existingTitles, ...rows.map((row) => row.title)]),
    );
    rows.push(...fallback);
  }
  return rows;
}

async function generatePostVariants(
  vkUserId: string,
  topic: Json,
  user: Json,
  reason: 'initial' | 'regenerate',
  communityProfileText = '',
  communityProfileJson: Json = {},
): Promise<Array<{ variant: number; text: string; source: string }>> {
  const topicTitle = String(topic.title || '');
  const topicShort = String(topic.short || '');
  const communityName = String(user.selectedCommunityName || 'вашего сообщества');
  const communityUrl = String(user.selectedCommunityUrl || '');
  let webhookPosts: string[] = [];

  if (isHttpsUrl(TOPIC_POSTS_WEBHOOK_URL)) {
    const response = await postWebhookJson(TOPIC_POSTS_WEBHOOK_URL, {
      vkUserId,
      topicId: toInt(topic.id, 0),
      topicTitle,
      topicShort,
      communityName,
      communityUrl,
      reason,
      desiredVariants: 3,
      minChars: 900,
      maxChars: 1800,
      communityProfileText: normalizeProfileText(communityProfileText),
      communityProfile: communityProfileJson || {},
      systemPrompt: VK_POST_SYSTEM_PROMPT,
      mode: 'generate_posts',
      source: 'vk-miniapp',
      nowMoscow: nowMoscow(),
      createdAt: nowIso(),
    });
    if (response.ok && response.payload?.ok !== false) {
      webhookPosts = extractGeneratedPostsFromPayload(response.payload);
      if (!webhookPosts.length) {
        console.warn('[smart-task] posts webhook returned empty posts payload.');
      }
    } else {
      console.warn('[smart-task] posts webhook failed', {
        status: response.status,
        payload: response.payload,
      });
    }
  }

  const webhookNormalized = webhookPosts.map((item) => clampPostBody(item, MAX_POST_TEXT_LENGTH)).filter(Boolean);
  const webhookKeys = new Set(webhookNormalized.map((item) => item.toLowerCase()));
  const fallbackPosts = createFallbackPostTexts(topicTitle, topicShort, communityName);
  const merged = [...webhookNormalized, ...fallbackPosts];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of merged) {
    const text = clampPostBody(item, MAX_POST_TEXT_LENGTH);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
    if (unique.length >= 3) break;
  }

  while (unique.length < 3) {
    const idx = unique.length;
    const base = fallbackPosts[idx % fallbackPosts.length] || `${topicTitle}\n\n${topicShort}`;
    const text = clampPostBody(`${base}\n\nВариант подачи: ${idx + 1}.`, MAX_POST_TEXT_LENGTH);
    const key = text.toLowerCase();
    if (seen.has(key)) {
      unique.push(clampPostBody(`${text}\n\nДополнение: акцентируйте выгоду и следующий шаг.`, MAX_POST_TEXT_LENGTH));
    } else {
      seen.add(key);
      unique.push(text);
    }
  }

  return unique.slice(0, 3).map((item, index) => {
    const rawText = clampPostBody(item, MAX_POST_TEXT_LENGTH);
    return {
      variant: index + 1,
      text: enforcePostVisualStyle(rawText, index + 1),
      source: webhookKeys.has(rawText.toLowerCase()) ? 'webhook' : 'fallback',
    };
  });
}

function isHttpsUrl(value: string): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function postWebhookJson(url: string, body: Json): Promise<{ ok: boolean; status: number; payload: Json | null }> {
  if (!isHttpsUrl(url)) return { ok: false, status: 0, payload: null };
  const bodyText = JSON.stringify(body);
  const webhookHeaders = await buildWebhookHeaders(bodyText);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...webhookHeaders,
      },
      body: bodyText,
      signal: ac.signal,
    });
    const text = await resp.text();
    let payload: Json | null = null;
    try {
      const p = JSON.parse(text);
      if (p && typeof p === 'object' && !Array.isArray(p)) payload = p as Json;
    } catch {
      payload = null;
    }
    return { ok: resp.ok, status: resp.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function buildWebhookHeaders(bodyText: string): Promise<Record<string, string>> {
  if (!N8N_WEBHOOK_SECRET) return {};
  const ts = String(Math.floor(Date.now() / 1000));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(N8N_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}.${bodyText}`));
  const signature = await toBase64Url(signed);
  return {
    'x-webhook-timestamp': ts,
    'x-webhook-signature': signature,
    'x-webhook-secret': N8N_WEBHOOK_SECRET,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function nowMoscow(): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return nowIso();
  }
}

function runBackgroundTask(task: Promise<unknown>, label: string): void {
  const wrapped = task.catch((e) => {
    console.error('[smart-task] background task failed', { label, error: e });
  });
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === 'function') {
    runtime.waitUntil(wrapped);
    return;
  }
  void wrapped;
}

function resolveCorsOrigin(req?: Request): string {
  const fallback = CORS_ORIGINS[0] || 'https://vk.com';
  if (!req) return fallback;
  const origin = String(req.headers.get('origin') || '').trim();
  if (!origin) return fallback;
  return CORS_ORIGINS.includes(origin) ? origin : 'null';
}

function json(status: number, payload: Json, req?: Request): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': resolveCorsOrigin(req),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,authorization,apikey,x-vk-launch-params',
  });
  headers.set('Vary', 'Origin');
  return new Response(JSON.stringify(payload), { status, headers });
}

function getRoute(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const marker = '/smart-task';
  const idx = pathname.indexOf(marker);
  const route = idx >= 0 ? pathname.slice(idx + marker.length) : pathname;
  return route || '/';
}

async function safeBody(req: Request): Promise<Json> {
  if (req.method !== 'POST') return {};
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? (b as Json) : {};
  } catch {
    return {};
  }
}

async function toBase64Url(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function verifyVkLaunchParams(launchParamsRaw: string): Promise<string> {
  if (!VK_MINI_APP_SECRET) err(503, 'VK_MINI_APP_SECRET is missing.');
  const prepared = String(launchParamsRaw || '').trim().replace(/^\?/, '');
  if (!prepared) err(401, 'Mini App launch params are missing.');

  const params = new URLSearchParams(prepared);
  const sign = String(params.get('sign') || '').trim();
  if (!sign) err(401, 'Mini App launch params do not contain sign.');

  const pairs: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'sign' && key.startsWith('vk_')) pairs.push([key, value]);
  }
  if (!pairs.length) err(401, 'Invalid launch params.');

  pairs.sort(([a], [b]) => a.localeCompare(b));
  const checkString = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(VK_MINI_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(checkString));
  const expected = await toBase64Url(signed);
  if (expected !== sign) err(401, 'Mini App launch signature verification failed.');
  return parseVkUserId(params.get('vk_user_id'));
}

async function resolveVkUserId(req: Request, body: Json): Promise<string> {
  const query = new URL(req.url).searchParams;
  const launchParams =
    String(req.headers.get('x-vk-launch-params') || '').trim() ||
    String(body.launchParams || '').trim() ||
    String(query.get('launchParams') || '').trim();

  if (launchParams) return verifyVkLaunchParams(launchParams);
  const hostname = String(new URL(req.url).hostname || '').toLowerCase();
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!ALLOW_INSECURE_DEV_AUTH || !isLocalHost) err(401, 'Mini App authorization is required.');
  return parseVkUserId(body.vkUserId ?? query.get('vkUserId'));
}

function mapUserRow(row: Json): Json {
  return {
    vkUserId: String(row.vk_user_id),
    planCode: String(row.plan_code || 'free'),
    postsTotal: toInt(row.posts_total, 0),
    postsUsed: toInt(row.posts_used, 0),
    themesCapacityTotal: toInt(row.themes_capacity_total, 0),
    ideaRegenTotal: toInt(row.idea_regen_total, 0),
    ideaRegenUsed: toInt(row.idea_regen_used, 0),
    textRegenTotal: toInt(row.text_regen_total, 0),
    textRegenUsed: toInt(row.text_regen_used, 0),
    customBusinessInfo: String(row.custom_business_info || ''),
    selectedCommunityId: row.selected_community_id ? toInt(row.selected_community_id, 0) : null,
  };
}

function mapTopicRow(row: Json): Json {
  return {
    id: String(row.id),
    seqNo: toInt(row.seq_no, 0),
    title: String(row.title || ''),
    short: String(row.short || ''),
    source: String(row.source || 'auto'),
  };
}

async function ensureUser(vkUserId: string): Promise<Json> {
  const upsert = await db.from('app_users').upsert({ vk_user_id: Number(vkUserId) }, { onConflict: 'vk_user_id' });
  if (upsert.error) err(500, upsert.error.message);
  const user = await db.from('app_users').select('*').eq('vk_user_id', Number(vkUserId)).single();
  if (user.error || !user.data) err(500, user.error?.message || 'Failed to load user state.');
  return mapUserRow(user.data as Json);
}

async function findCommunityByOwner(vkUserId: string): Promise<Json | null> {
  const q = await db
    .from('communities')
    .select('id,community_url,community_screen,owner_vk_user_id')
    .eq('owner_vk_user_id', Number(vkUserId))
    .maybeSingle();
  if (q.error) err(500, q.error.message);
  return (q.data as Json | null) || null;
}

async function listTopics(vkUserId: string): Promise<Json[]> {
  const q = await db
    .from('topics')
    .select('id,seq_no,title,short,source')
    .eq('vk_user_id', Number(vkUserId))
    .order('seq_no', { ascending: true });
  if (q.error) err(500, q.error.message);
  return (q.data || []).map((r) => mapTopicRow(r as Json));
}

async function buildState(vkUserId: string): Promise<Json> {
  const user = await ensureUser(vkUserId);
  const community = await findCommunityByOwner(vkUserId);
  const topics = await listTopics(vkUserId);
  return {
    user: {
      ...user,
      selectedCommunityId: community ? toInt(community.id, 0) : null,
      selectedCommunityUrl: community ? String(community.community_url || '') : '',
      selectedCommunityName: community ? String(community.community_screen || '') : '',
    },
    topics,
  };
}

function findPlan(planCode: unknown): PlanDef {
  const code = String(planCode || '').trim() as Exclude<PlanCode, 'free'>;
  const plan = PLAN_MAP.get(code);
  if (!plan) err(400, 'Unknown tariff.');
  return plan;
}

type PurchaseApplyResult = { applied: boolean; reason: string; ownerVkUserId: string | null };

type PaymentVerificationRow = {
  paymentId: string;
  status: string;
  vkUserId: string;
  planCode: string;
  amountRub: number;
  raw: Json;
};

type PromoEligibility = {
  code: string;
  discountPercent: number;
  allowedPlan: string;
  maxUses: number | null;
  usedCount: number;
};

type PromoPricing = PromoEligibility & {
  baseAmount: number;
  finalAmount: number;
  savingsAmount: number;
};

function normalizeAllowedPromoPlan(raw: unknown): string {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!value || value === 'all' || value === '*' || value === 'any' || value === 'unlim') return 'all';
  return value;
}

function isPromoAllowedForPlan(allowedPlanRaw: unknown, planCodeRaw: unknown): boolean {
  const allowedPlan = normalizeAllowedPromoPlan(allowedPlanRaw);
  const planCode = String(planCodeRaw ?? '')
    .trim()
    .toLowerCase();
  if (!planCode) return false;
  if (allowedPlan === 'all') return true;
  return allowedPlan === planCode;
}

function parsePromoCodeOptional(raw: unknown): string {
  const source = String(raw ?? '').trim();
  if (!source) return '';
  const normalized = source.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (normalized.length < 3 || normalized.length > 64) err(400, 'Некорректный промокод.');
  return normalized;
}

function normalizePromoCodeLoose(raw: unknown): string {
  const normalized = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (normalized.length < 3 || normalized.length > 64) return '';
  return normalized;
}

function isPromoExpired(rawIso: unknown): boolean {
  const iso = String(rawIso ?? '').trim();
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return false;
  return ts <= Date.now();
}

function calcDiscountedAmount(baseAmountRaw: unknown, discountPercentRaw: unknown): { baseAmount: number; finalAmount: number; savingsAmount: number } {
  const baseAmount = Math.max(0, toInt(baseAmountRaw, 0));
  const discountPercent = Math.max(1, Math.min(95, toInt(discountPercentRaw, 0)));
  const savingsAmount = Math.max(0, Math.round((baseAmount * discountPercent) / 100));
  const finalAmount = Math.max(1, baseAmount - savingsAmount);
  return { baseAmount, finalAmount, savingsAmount: Math.max(0, baseAmount - finalAmount) };
}

async function getPromoUseCountForUser(code: string, vkUserId: string): Promise<number> {
  const q = await db
    .from('vk_bot_promo_uses')
    .select('*', { head: true, count: 'exact' })
    .eq('code', code)
    .eq('vk_user_id', vkUserId);
  if (q.error) {
    if (isMissingRelationError(q.error, 'vk_bot_promo_uses')) {
      err(503, 'DB migration required: vk_bot_promo_uses is missing.');
    }
    err(500, q.error.message);
  }
  return Math.max(0, toInt(q.count, 0));
}

async function getPromoUseCountGlobal(code: string): Promise<number> {
  const q = await db.from('vk_bot_promo_uses').select('*', { head: true, count: 'exact' }).eq('code', code);
  if (q.error) {
    if (isMissingRelationError(q.error, 'vk_bot_promo_uses')) {
      err(503, 'DB migration required: vk_bot_promo_uses is missing.');
    }
    err(500, q.error.message);
  }
  return Math.max(0, toInt(q.count, 0));
}

async function resolvePromoEligibility(vkUserId: string, promoCodeRaw: unknown): Promise<PromoEligibility | null> {
  const code = parsePromoCodeOptional(promoCodeRaw);
  if (!code) return null;

  const q = await db
    .from('vk_bot_promos')
    .select('code,discount_percent,is_active,max_uses,used_count,allowed_plan,expires_at')
    .eq('code', code)
    .maybeSingle();
  if (q.error) {
    if (isMissingRelationError(q.error, 'vk_bot_promos')) {
      err(503, 'DB migration required: vk_bot_promos is missing.');
    }
    err(500, q.error.message);
  }
  if (!q.data) err(400, 'Промокод не найден.');

  const row = q.data as Json;
  if (!isTruthyFlag(row.is_active)) err(400, 'Промокод неактивен.');
  if (isPromoExpired(row.expires_at)) err(400, 'Срок действия промокода истёк.');

  const discountPercent = Math.max(1, Math.min(95, toInt(row.discount_percent, 0)));
  if (!Number.isFinite(discountPercent) || discountPercent < 1) err(400, 'Промокод невалиден.');

  const maxUses = row.max_uses == null ? null : Math.max(0, toInt(row.max_uses, 0));
  const usedCountFromTable = await getPromoUseCountGlobal(code);
  const usedCount = Math.max(usedCountFromTable, Math.max(0, toInt(row.used_count, 0)));
  if (maxUses != null && maxUses > 0 && usedCount >= maxUses) {
    err(400, 'Промокод исчерпан.');
  }

  const userUses = await getPromoUseCountForUser(code, vkUserId);
  if (userUses > 0) {
    err(400, 'Вы уже использовали этот промокод.');
  }

  return {
    code,
    discountPercent,
    allowedPlan: normalizeAllowedPromoPlan(row.allowed_plan),
    maxUses,
    usedCount,
  };
}

function toPromoPricing(plan: PlanDef, promo: PromoEligibility): PromoPricing {
  const pricing = calcDiscountedAmount(plan.price, promo.discountPercent);
  return {
    ...promo,
    ...pricing,
  };
}

function extractPromoCodeFromPaymentRaw(raw: unknown): string {
  const root = asRecord(raw);
  if (!root) return '';
  const object = asRecord(root.object);
  const metadata = asRecord(root.metadata) || (object ? asRecord(object.metadata) : null);
  const request = asRecord(root.request) || asRecord(root.body) || asRecord(root.input);
  const candidates: unknown[] = [
    root.promoCode,
    root.promo_code,
    metadata?.promoCode,
    metadata?.promo_code,
    request?.promoCode,
    request?.promo_code,
    object?.promoCode,
    object?.promo_code,
  ];
  for (const candidate of candidates) {
    const code = normalizePromoCodeLoose(candidate);
    if (code) return code;
  }
  return '';
}

async function markPromoUse(vkUserId: string, promoCodeRaw: unknown): Promise<void> {
  const code = parsePromoCodeOptional(promoCodeRaw);
  if (!code) return;

  const alreadyUsed = await getPromoUseCountForUser(code, vkUserId);
  if (alreadyUsed > 0) return;

  const ins = await db.from('vk_bot_promo_uses').insert({
    code,
    vk_user_id: vkUserId,
    created_at: nowIso(),
  });
  if (ins.error) {
    if (isMissingRelationError(ins.error, 'vk_bot_promo_uses')) {
      console.warn('[smart-task] promo uses table is missing, skip mark promo use.');
      return;
    }
    err(500, ins.error.message);
  }

  const usedCount = await getPromoUseCountGlobal(code);
  const upd = await db
    .from('vk_bot_promos')
    .update({ used_count: usedCount, updated_at: nowIso() })
    .eq('code', code);
  if (upd.error && !isMissingRelationError(upd.error, 'vk_bot_promos')) {
    err(500, upd.error.message);
  }
}

async function ensureVerifiedPayment(vkUserId: string, plan: PlanDef, paymentId: string): Promise<PaymentVerificationRow> {
  const q = await db
    .from('miniapp_payments')
    .select('payment_id,status,vk_user_id,plan_code,amount_rub,raw')
    .eq('payment_id', paymentId)
    .maybeSingle();
  if (q.error) {
    const msg = String(q.error.message || '').toLowerCase();
    if (msg.includes('miniapp_payments') && msg.includes('does not exist')) {
      err(503, 'DB migration required: miniapp_payments is missing.');
    }
    err(500, q.error.message);
  }
  if (!q.data) err(409, 'Payment is not verified.');

  const row = q.data as Json;
  const status = String(row.status || '').trim().toLowerCase();
  if (status !== 'succeeded') err(409, 'Payment is not completed.');

  const owner = String(row.vk_user_id || '').trim();
  if (!owner || owner !== vkUserId) err(409, 'Payment owner mismatch.');

  const planCode = String(row.plan_code || '').trim().toLowerCase();
  if (!planCode || planCode !== plan.code) err(409, 'Payment plan mismatch.');

  return {
    paymentId: String(row.payment_id || paymentId),
    status,
    vkUserId: owner,
    planCode,
    amountRub: Math.max(0, toInt(row.amount_rub, 0)),
    raw: (asRecord(row.raw) as Json) || {},
  };
}

async function applyPurchaseOnce(vkUserId: string, plan: PlanDef, paymentId: string, amountRub: number): Promise<PurchaseApplyResult> {
  const rpc = await db.rpc('apply_purchase_once', {
    p_vk_user_id: Number(vkUserId),
    p_plan_code: plan.code,
    p_posts_delta: toInt(plan.posts, 0),
    p_themes_delta: toInt(plan.themes, 0),
    p_idea_delta: toInt(plan.ideaRegen, 0),
    p_text_delta: toInt(plan.textRegen, 0),
    p_amount_rub: Math.max(0, toInt(amountRub, toInt(plan.price, 0))),
    p_external_payment_id: paymentId,
  });
  if (rpc.error) {
    const msg = String(rpc.error.message || '').toLowerCase();
    if (msg.includes('apply_purchase_once')) {
      err(503, 'DB migration required: apply_purchase_once() is missing.');
    }
    if (msg.includes('external_payment_id')) {
      err(503, 'DB migration required: purchases.external_payment_id is missing.');
    }
    err(500, rpc.error.message);
  }

  const row = Array.isArray(rpc.data) ? (rpc.data[0] as Json | undefined) : undefined;
  if (!row) err(500, 'Unexpected apply_purchase_once() result.');

  return {
    applied: Boolean(row.applied),
    reason: String(row.reason || 'unknown'),
    ownerVkUserId: row.owner_vk_user_id == null ? null : String(row.owner_vk_user_id),
  };
}

type AdminSession = {
  vkUserId: string;
  role: string;
  isAdmin: true;
  canManageAdmins: boolean;
};

type LimitsPatch = {
  posts?: number;
  themes?: number;
  idea?: number;
  text?: number;
};

function isMissingRelationError(error: unknown, relation: string): boolean {
  const obj = error as { code?: string; message?: string } | null;
  const code = String(obj?.code || '').trim().toUpperCase();
  if (code === '42P01') return true;
  const msg = String(obj?.message || '').toLowerCase();
  return msg.includes(String(relation || '').toLowerCase()) && msg.includes('does not exist');
}

function isTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') return true;
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  return text === 'true' || text === 'yes';
}

function mapAdminRowOut(row: Json): Json {
  return {
    vkUserId: String(row.vk_user_id || ''),
    role: String(row.role || 'admin').toLowerCase(),
    isActive: isTruthyFlag(row.is_active),
    addedBy: String(row.added_by || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function mapPromoRowOut(row: Json): Json {
  return {
    code: String(row.code || ''),
    discountPercent: toInt(row.discount_percent, 0),
    isActive: isTruthyFlag(row.is_active),
    maxUses: row.max_uses == null ? null : toInt(row.max_uses, 0),
    usedCount: toInt(row.used_count, 0),
    allowedPlan: String(row.allowed_plan || 'all'),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    note: String(row.note || ''),
    createdBy: String(row.created_by || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

async function ensureAdminAccess(vkUserId: string): Promise<AdminSession> {
  const uid = parseVkUserId(vkUserId);
  const adminQ = await db
    .from('vk_bot_admins')
    .select('vk_user_id,role,is_active,added_by,updated_at')
    .eq('vk_user_id', uid)
    .maybeSingle();
  if (adminQ.error) {
    if (isMissingRelationError(adminQ.error, 'vk_bot_admins')) {
      err(503, 'DB migration required: vk_bot_admins is missing.');
    }
    err(500, adminQ.error.message);
  }

  let row = (adminQ.data as Json | null) || null;
  if (!row && ROOT_ADMIN_VK_IDS.has(uid)) {
    const upsert = await db
      .from('vk_bot_admins')
      .upsert(
        {
          vk_user_id: uid,
          role: 'owner',
          is_active: 1,
          added_by: uid,
          updated_at: nowIso(),
        },
        { onConflict: 'vk_user_id' },
      )
      .select('vk_user_id,role,is_active,added_by,updated_at')
      .single();
    if (upsert.error || !upsert.data) {
      if (isMissingRelationError(upsert.error, 'vk_bot_admins')) {
        err(503, 'DB migration required: vk_bot_admins is missing.');
      }
      err(500, upsert.error?.message || 'Failed to upsert root admin.');
    }
    row = upsert.data as Json;
  }

  if (!row && ROOT_ADMIN_VK_IDS.size === 0) {
    err(503, 'Admin bootstrap required: set ROOT_ADMIN_VK_IDS or add a row to vk_bot_admins.');
  }

  if (!row || !isTruthyFlag(row.is_active)) {
    err(403, 'Admin access denied.');
  }

  const role = String(row.role || 'admin')
    .trim()
    .toLowerCase();
  return {
    vkUserId: String(row.vk_user_id || uid),
    role: role || 'admin',
    isAdmin: true,
    canManageAdmins: role === 'owner',
  };
}

function parseVkUserRef(raw: unknown): string {
  const input = String(raw ?? '').trim();
  if (!input) err(400, 'User reference is required.');
  if (input.length > 180) err(400, 'User reference is too long.');

  if (/^\d+$/.test(input)) return parseVkUserId(input);

  const idAlias = input.match(/^id(\d+)$/i);
  if (idAlias) return parseVkUserId(idAlias[1]);

  const normalizedUrl = normalizeVkUrl(input);
  if (normalizedUrl) {
    const screen = extractCommunityName(normalizedUrl);
    const match = screen.match(/^id(\d+)$/i);
    if (match) return parseVkUserId(match[1]);
    if (/^\d+$/.test(screen)) return parseVkUserId(screen);
  }

  err(400, 'Failed to parse VK user id from reference.');
}

function parseGroupRef(raw: unknown): { normalizedUrl: string; screenName: string } {
  const input = String(raw ?? '').trim();
  if (!input) err(400, 'Community reference is required.');
  if (input.length > 180) err(400, 'Community reference is too long.');

  const normalizedUrl = normalizeVkUrl(input);
  if (normalizedUrl) {
    return {
      normalizedUrl,
      screenName: extractCommunityName(normalizedUrl),
    };
  }

  const clean = input
    .replace(/^https?:\/\//i, '')
    .replace(/^vk\.com\//i, '')
    .replace(/^\/+/, '')
    .split('/')[0];
  if (!clean) err(400, 'Invalid community reference.');
  if (!/^[A-Za-z0-9_.-]{2,120}$/.test(clean)) err(400, 'Invalid community screen name format.');

  return {
    normalizedUrl: `https://vk.com/${clean}`,
    screenName: clean,
  };
}

function normalizePromoCode(raw: unknown): string {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (!code || code.length < 3) err(400, 'Promo code must contain at least 3 characters.');
  return code.slice(0, 64);
}

function normalizePromoPlan(raw: unknown): string {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!value || value === 'all' || value === '*' || value === 'any' || value === 'unlim') return 'all';
  if (value === 'free' || PLAN_MAP.has(value as Exclude<PlanCode, 'free'>)) return value;
  err(400, 'Invalid promo allowed plan.');
}

function normalizeDiscountPercent(value: unknown): number {
  const percent = Math.max(1, Math.min(95, toInt(value, 0)));
  if (!Number.isFinite(percent) || percent < 1) err(400, 'Promo discount must be between 1 and 95.');
  return percent;
}

function promoExpiresAtFromDays(days: unknown): string | null {
  if (days == null) return null;
  const n = Number(days);
  if (!Number.isFinite(n)) err(400, 'Promo days must be a number.');
  const safeDays = Math.max(1, Math.trunc(n));
  const date = new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

function limitsByPlanForAdmin(planCodeRaw: unknown): { posts: number; themes: number; idea: number; text: number } {
  const planCode = String(planCodeRaw || '')
    .trim()
    .toLowerCase();
  if (planCode === 'free') return { posts: 3, themes: 3, idea: 0, text: 0 };
  const plan = PLAN_MAP.get(planCode as Exclude<PlanCode, 'free'>);
  if (!plan) err(400, `Unknown plan: ${planCode}`);
  return {
    posts: toInt(plan.posts, 0),
    themes: toInt(plan.themes, 0),
    idea: toInt(plan.ideaRegen, 0),
    text: toInt(plan.textRegen, 0),
  };
}

function parseLimitsPatch(raw: unknown): LimitsPatch {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: LimitsPatch = {};
  if (typeof o.posts === 'number' && Number.isFinite(o.posts)) out.posts = Math.trunc(o.posts);
  if (typeof o.themes === 'number' && Number.isFinite(o.themes)) out.themes = Math.trunc(o.themes);
  if (typeof o.idea === 'number' && Number.isFinite(o.idea)) out.idea = Math.trunc(o.idea);
  if (typeof o.text === 'number' && Number.isFinite(o.text)) out.text = Math.trunc(o.text);
  return out;
}

function parseOptionalNumber(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) err(400, 'Expected a numeric value.');
  return Math.trunc(n);
}

async function findCommunityByUrl(url: string): Promise<Json | null> {
  const q = await db
    .from('communities')
    .select('id,community_url,community_screen,owner_vk_user_id')
    .eq('community_url', url)
    .maybeSingle();
  if (q.error) err(500, q.error.message);
  return (q.data as Json | null) || null;
}

async function findCommunityByScreen(screen: string): Promise<Json | null> {
  const q = await db
    .from('communities')
    .select('id,community_url,community_screen,owner_vk_user_id')
    .eq('community_screen', screen)
    .maybeSingle();
  if (q.error) err(500, q.error.message);
  return (q.data as Json | null) || null;
}

async function countRows(table: string, column: string, value: string | number): Promise<number> {
  const q = await db.from(table).select('*', { head: true, count: 'exact' }).eq(column, value);
  if (q.error) err(500, q.error.message);
  return Math.max(0, toInt(q.count, 0));
}

async function handleAdminRoute(route: string, body: Json, req: Request, reply: (status: number, payload: Json) => Response): Promise<Response> {
  const actorVkId = await resolveVkUserId(req, body);

  if (route === '/api/admin/me') {
    const me = await ensureAdminAccess(actorVkId);
    return reply(200, { me, message: `Role: ${me.role}.` });
  }

  if (route === '/api/admin/admins/list') {
    const me = await ensureAdminAccess(actorVkId);
    const rowsQ = await db
      .from('vk_bot_admins')
      .select('vk_user_id,role,is_active,added_by,updated_at')
      .order('vk_user_id', { ascending: true });
    if (rowsQ.error) {
      if (isMissingRelationError(rowsQ.error, 'vk_bot_admins')) {
        err(503, 'DB migration required: vk_bot_admins is missing.');
      }
      err(500, rowsQ.error.message);
    }
    const admins = (rowsQ.data || []).map((row) => mapAdminRowOut(row as Json));
    return reply(200, {
      me,
      admins,
      message: `Admins: ${admins.length}.`,
    });
  }

  if (route === '/api/admin/admins/add') {
    const me = await ensureAdminAccess(actorVkId);
    if (!me.canManageAdmins) err(403, 'Only owner can manage admin list.');
    const targetVkId = parseVkUserRef(body.targetUserRef);
    const role = String(body.role || 'admin')
      .trim()
      .toLowerCase();
    if (!['admin', 'owner'].includes(role)) err(400, 'Role must be admin or owner.');
    const upsert = await db.from('vk_bot_admins').upsert(
      {
        vk_user_id: targetVkId,
        role,
        is_active: 1,
        added_by: actorVkId,
        updated_at: nowIso(),
      },
      { onConflict: 'vk_user_id' },
    );
    if (upsert.error) err(500, upsert.error.message);
    return reply(200, { me, message: `Admin ${targetVkId} granted role ${role}.` });
  }

  if (route === '/api/admin/admins/remove') {
    const me = await ensureAdminAccess(actorVkId);
    if (!me.canManageAdmins) err(403, 'Only owner can manage admin list.');
    const targetVkId = parseVkUserRef(body.targetUserRef);
    const targetQ = await db.from('vk_bot_admins').select('role').eq('vk_user_id', targetVkId).maybeSingle();
    if (targetQ.error) err(500, targetQ.error.message);
    const targetRole = String((targetQ.data as Json | null)?.role || '').toLowerCase();
    if (targetRole === 'owner') err(400, 'Owner role cannot be removed.');
    const upd = await db
      .from('vk_bot_admins')
      .update({ is_active: 0, updated_at: nowIso() })
      .eq('vk_user_id', targetVkId);
    if (upd.error) err(500, upd.error.message);
    return reply(200, { me, message: `Admin ${targetVkId} was deactivated.` });
  }

  if (route === '/api/admin/users/get') {
    const me = await ensureAdminAccess(actorVkId);
    const targetVkId = parseVkUserRef(body.targetUserRef);
    const userQ = await db
      .from('app_users')
      .select(
        'vk_user_id,plan_code,posts_total,posts_used,themes_capacity_total,idea_regen_total,idea_regen_used,text_regen_total,text_regen_used',
      )
      .eq('vk_user_id', Number(targetVkId))
      .maybeSingle();
    if (userQ.error) err(500, userQ.error.message);

    if (!userQ.data) {
      return reply(200, {
        me,
        userSnapshot: {
          vkUserId: targetVkId,
          exists: false,
          planCode: null,
          postsTotal: 0,
          postsUsed: 0,
          themesCapacityTotal: 0,
          ideaRegenTotal: 0,
          ideaRegenUsed: 0,
          textRegenTotal: 0,
          textRegenUsed: 0,
          selectedCommunityUrl: '',
          selectedCommunityName: '',
          topicsCount: 0,
          purchasesCount: 0,
          supportCount: 0,
        },
        message: `User ${targetVkId} not found.`,
      });
    }

    const community = await findCommunityByOwner(targetVkId);
    const [topicsCount, purchasesCount, supportCount] = await Promise.all([
      countRows('topics', 'vk_user_id', Number(targetVkId)),
      countRows('purchases', 'vk_user_id', Number(targetVkId)),
      countRows('support_requests', 'vk_user_id', Number(targetVkId)),
    ]);
    const user = userQ.data as Json;
    return reply(200, {
      me,
      userSnapshot: {
        vkUserId: targetVkId,
        exists: true,
        planCode: String(user.plan_code || 'free'),
        postsTotal: toInt(user.posts_total, 0),
        postsUsed: toInt(user.posts_used, 0),
        themesCapacityTotal: toInt(user.themes_capacity_total, 0),
        ideaRegenTotal: toInt(user.idea_regen_total, 0),
        ideaRegenUsed: toInt(user.idea_regen_used, 0),
        textRegenTotal: toInt(user.text_regen_total, 0),
        textRegenUsed: toInt(user.text_regen_used, 0),
        selectedCommunityUrl: String(community?.community_url || ''),
        selectedCommunityName: String(community?.community_screen || ''),
        topicsCount,
        purchasesCount,
        supportCount,
      },
      message: `User snapshot loaded for ${targetVkId}.`,
    });
  }

  if (route === '/api/admin/users/set-plan') {
    const me = await ensureAdminAccess(actorVkId);
    const targetVkId = parseVkUserRef(body.targetUserRef);
    const planCode = String(body.planCode || '')
      .trim()
      .toLowerCase();
    const limits = limitsByPlanForAdmin(planCode);
    await ensureUser(targetVkId);

    const upd = await db
      .from('app_users')
      .update({
        plan_code: planCode,
        posts_total: limits.posts,
        posts_used: 0,
        themes_capacity_total: limits.themes,
        idea_regen_total: limits.idea,
        idea_regen_used: 0,
        text_regen_total: limits.text,
        text_regen_used: 0,
        updated_at: nowIso(),
      })
      .eq('vk_user_id', Number(targetVkId));
    if (upd.error) err(500, upd.error.message);

    if (planCode !== 'free') {
      const ins = await db.from('purchases').insert({
        vk_user_id: Number(targetVkId),
        plan_code: planCode,
        amount_rub: 0,
        created_at: nowIso(),
      });
      if (ins.error) err(500, ins.error.message);
    }

    return reply(200, { me, message: `Plan ${planCode} set for user ${targetVkId}.` });
  }

  if (route === '/api/admin/users/reset-usage') {
    const me = await ensureAdminAccess(actorVkId);
    const targetVkId = parseVkUserRef(body.targetUserRef);
    await ensureUser(targetVkId);
    const upd = await db
      .from('app_users')
      .update({ posts_used: 0, idea_regen_used: 0, text_regen_used: 0, updated_at: nowIso() })
      .eq('vk_user_id', Number(targetVkId));
    if (upd.error) err(500, upd.error.message);
    return reply(200, { me, message: `Usage counters reset for user ${targetVkId}.` });
  }

  if (route === '/api/admin/users/limits-set') {
    const me = await ensureAdminAccess(actorVkId);
    const targetVkId = parseVkUserRef(body.targetUserRef);
    const limits = parseLimitsPatch(body.limits);
    const userQ = await db
      .from('app_users')
      .select('posts_used,idea_regen_used,text_regen_used')
      .eq('vk_user_id', Number(targetVkId))
      .maybeSingle();
    if (userQ.error) err(500, userQ.error.message);
    if (!userQ.data) err(404, `User ${targetVkId} not found.`);
    const user = userQ.data as Json;

    const patch: Json = { updated_at: nowIso() };
    if (typeof limits.posts === 'number') {
      const next = Math.max(0, toInt(limits.posts, 0));
      patch.posts_total = next;
      patch.posts_used = Math.min(toInt(user.posts_used, 0), next);
    }
    if (typeof limits.themes === 'number') {
      patch.themes_capacity_total = Math.max(0, toInt(limits.themes, 0));
    }
    if (typeof limits.idea === 'number') {
      const next = Math.max(0, toInt(limits.idea, 0));
      patch.idea_regen_total = next;
      patch.idea_regen_used = Math.min(toInt(user.idea_regen_used, 0), next);
    }
    if (typeof limits.text === 'number') {
      const next = Math.max(0, toInt(limits.text, 0));
      patch.text_regen_total = next;
      patch.text_regen_used = Math.min(toInt(user.text_regen_used, 0), next);
    }
    if (Object.keys(patch).length <= 1) err(400, 'Provide at least one limit to set.');
    const upd = await db.from('app_users').update(patch).eq('vk_user_id', Number(targetVkId));
    if (upd.error) err(500, upd.error.message);
    return reply(200, { me, message: `Limits were set for user ${targetVkId}.` });
  }

  if (route === '/api/admin/users/limits-add') {
    const me = await ensureAdminAccess(actorVkId);
    const targetVkId = parseVkUserRef(body.targetUserRef);
    const limits = parseLimitsPatch(body.limits);
    const hasChanges =
      typeof limits.posts === 'number' ||
      typeof limits.themes === 'number' ||
      typeof limits.idea === 'number' ||
      typeof limits.text === 'number';
    if (!hasChanges) err(400, 'Provide at least one limit to add.');

    const userQ = await db
      .from('app_users')
      .select('posts_total,themes_capacity_total,idea_regen_total,text_regen_total,posts_used,idea_regen_used,text_regen_used')
      .eq('vk_user_id', Number(targetVkId))
      .maybeSingle();
    if (userQ.error) err(500, userQ.error.message);
    if (!userQ.data) err(404, `User ${targetVkId} not found.`);
    const user = userQ.data as Json;

    const nextPostsTotal = Math.max(0, toInt(user.posts_total, 0) + toInt(limits.posts, 0));
    const nextThemesTotal = Math.max(0, toInt(user.themes_capacity_total, 0) + toInt(limits.themes, 0));
    const nextIdeaTotal = Math.max(0, toInt(user.idea_regen_total, 0) + toInt(limits.idea, 0));
    const nextTextTotal = Math.max(0, toInt(user.text_regen_total, 0) + toInt(limits.text, 0));

    const upd = await db
      .from('app_users')
      .update({
        posts_total: nextPostsTotal,
        posts_used: Math.min(toInt(user.posts_used, 0), nextPostsTotal),
        themes_capacity_total: nextThemesTotal,
        idea_regen_total: nextIdeaTotal,
        idea_regen_used: Math.min(toInt(user.idea_regen_used, 0), nextIdeaTotal),
        text_regen_total: nextTextTotal,
        text_regen_used: Math.min(toInt(user.text_regen_used, 0), nextTextTotal),
        updated_at: nowIso(),
      })
      .eq('vk_user_id', Number(targetVkId));
    if (upd.error) err(500, upd.error.message);
    return reply(200, { me, message: `Limits were added for user ${targetVkId}.` });
  }

  if (route === '/api/admin/users/unlink') {
    const me = await ensureAdminAccess(actorVkId);
    const targetVkId = parseVkUserRef(body.targetUserRef);
    await ensureUser(targetVkId);
    const community = await findCommunityByOwner(targetVkId);
    if (community) {
      const del = await db.from('communities').delete().eq('id', toInt(community.id, 0));
      if (del.error) err(500, del.error.message);
    }
    const upd = await db
      .from('app_users')
      .update({ selected_community_id: null, updated_at: nowIso() })
      .eq('vk_user_id', Number(targetVkId));
    if (upd.error) err(500, upd.error.message);
    return reply(200, { me, message: `Community unlinked for user ${targetVkId}.` });
  }

  if (route === '/api/admin/groups/unlink') {
    const me = await ensureAdminAccess(actorVkId);
    const parsed = parseGroupRef(body.groupRef);
    let community = await findCommunityByUrl(parsed.normalizedUrl);
    if (!community) community = await findCommunityByScreen(parsed.screenName);
    if (!community) err(404, 'Community not found.');

    const ownerId = parseVkUserId((community as Json).owner_vk_user_id);
    const del = await db.from('communities').delete().eq('id', toInt((community as Json).id, 0));
    if (del.error) err(500, del.error.message);
    const upd = await db
      .from('app_users')
      .update({ selected_community_id: null, updated_at: nowIso() })
      .eq('vk_user_id', Number(ownerId));
    if (upd.error) err(500, upd.error.message);
    return reply(200, {
      me,
      message: `Community ${String((community as Json).community_url || parsed.normalizedUrl)} unlinked (owner: ${ownerId}).`,
    });
  }

  if (route === '/api/admin/users/reset') {
    const me = await ensureAdminAccess(actorVkId);
    const targetVkId = parseVkUserRef(body.targetUserRef);
    await ensureUser(targetVkId);
    const community = await findCommunityByOwner(targetVkId);
    if (community) {
      const del = await db.from('communities').delete().eq('id', toInt(community.id, 0));
      if (del.error) err(500, del.error.message);
    }

    const delTopics = await db.from('topics').delete().eq('vk_user_id', Number(targetVkId));
    if (delTopics.error) err(500, delTopics.error.message);
    const delPurchases = await db.from('purchases').delete().eq('vk_user_id', Number(targetVkId));
    if (delPurchases.error) err(500, delPurchases.error.message);
    const delSupport = await db.from('support_requests').delete().eq('vk_user_id', Number(targetVkId));
    if (delSupport.error) err(500, delSupport.error.message);
    const delPromoUses = await db.from('vk_bot_promo_uses').delete().eq('vk_user_id', targetVkId);
    if (delPromoUses.error) err(500, delPromoUses.error.message);

    const upd = await db
      .from('app_users')
      .update({
        plan_code: 'free',
        posts_total: 3,
        posts_used: 0,
        themes_capacity_total: 3,
        idea_regen_total: 0,
        idea_regen_used: 0,
        text_regen_total: 0,
        text_regen_used: 0,
        selected_community_id: null,
        updated_at: nowIso(),
      })
      .eq('vk_user_id', Number(targetVkId));
    if (upd.error) err(500, upd.error.message);
    return reply(200, { me, message: `User ${targetVkId} reset to FREE.` });
  }

  if (route === '/api/admin/users/forget') {
    const me = await ensureAdminAccess(actorVkId);
    const targetVkId = parseVkUserRef(body.targetUserRef);
    const delUser = await db.from('app_users').delete().eq('vk_user_id', Number(targetVkId));
    if (delUser.error) err(500, delUser.error.message);
    const delBotUser = await db.from('vk_bot_users').delete().eq('vk_user_id', targetVkId);
    if (delBotUser.error) err(500, delBotUser.error.message);
    const delPromoUses = await db.from('vk_bot_promo_uses').delete().eq('vk_user_id', targetVkId);
    if (delPromoUses.error) err(500, delPromoUses.error.message);
    return reply(200, { me, message: `User ${targetVkId} was fully deleted.` });
  }

  if (route === '/api/admin/promos/list') {
    const me = await ensureAdminAccess(actorVkId);
    const promosQ = await db
      .from('vk_bot_promos')
      .select('code,discount_percent,is_active,max_uses,used_count,allowed_plan,expires_at,note,created_by,updated_at')
      .order('code', { ascending: true });
    if (promosQ.error) {
      if (isMissingRelationError(promosQ.error, 'vk_bot_promos')) {
        err(503, 'DB migration required: vk_bot_promos is missing.');
      }
      err(500, promosQ.error.message);
    }
    const promos = (promosQ.data || []).map((row) => mapPromoRowOut(row as Json));
    return reply(200, { me, promos, message: `Promo codes: ${promos.length}.` });
  }

  if (route === '/api/admin/promos/add') {
    const me = await ensureAdminAccess(actorVkId);
    const input = body.input && typeof body.input === 'object' ? (body.input as Json) : {};
    const code = normalizePromoCode(input.code);
    const percent = normalizeDiscountPercent(parseOptionalNumber(input.percent) ?? 0);
    const maxUsesRaw = parseOptionalNumber(input.maxUses);
    const maxUses = maxUsesRaw == null ? null : Math.max(1, maxUsesRaw);
    const allowedPlan = normalizePromoPlan(input.allowedPlan);
    const expiresAt = promoExpiresAtFromDays(input.days);
    const note = String(input.note || '').trim();

    const ins = await db.from('vk_bot_promos').insert({
      code,
      discount_percent: percent,
      is_active: 1,
      max_uses: maxUses,
      used_count: 0,
      allowed_plan: allowedPlan,
      expires_at: expiresAt,
      note,
      created_by: actorVkId,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    if (ins.error) {
      const codeErr = String((ins.error as { code?: string }).code || '').toUpperCase();
      if (codeErr === '23505') err(409, `Promo code ${code} already exists.`);
      err(500, ins.error.message);
    }
    return reply(200, { me, message: `Promo code ${code} created.` });
  }

  if (route === '/api/admin/promos/set') {
    const me = await ensureAdminAccess(actorVkId);
    const input = body.input && typeof body.input === 'object' ? (body.input as Json) : {};
    const code = normalizePromoCode(input.code);
    const patch: Json = { updated_at: nowIso() };
    if (Object.prototype.hasOwnProperty.call(input, 'percent')) {
      patch.discount_percent = normalizeDiscountPercent(input.percent);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'maxUses')) {
      const maxUsesRaw = parseOptionalNumber(input.maxUses);
      patch.max_uses = maxUsesRaw == null ? null : Math.max(1, maxUsesRaw);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'allowedPlan')) {
      patch.allowed_plan = normalizePromoPlan(input.allowedPlan);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'days')) {
      patch.expires_at = promoExpiresAtFromDays(input.days);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'note')) {
      patch.note = String(input.note || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'active')) {
      patch.is_active = Boolean(input.active) ? 1 : 0;
    }
    if (Object.keys(patch).length <= 1) err(400, 'No fields provided for promo update.');

    const upd = await db.from('vk_bot_promos').update(patch).eq('code', code).select('code').maybeSingle();
    if (upd.error) err(500, upd.error.message);
    if (!upd.data) err(404, 'Promo code not found.');
    return reply(200, { me, message: `Promo code ${code} updated.` });
  }

  if (route === '/api/admin/promos/delete') {
    const me = await ensureAdminAccess(actorVkId);
    const code = normalizePromoCode(body.code);
    const del = await db.from('vk_bot_promos').delete().eq('code', code);
    if (del.error) err(500, del.error.message);
    return reply(200, { me, message: `Promo code ${code} deleted.` });
  }

  if (route === '/api/admin/promos/toggle') {
    const me = await ensureAdminAccess(actorVkId);
    const code = normalizePromoCode(body.code);
    const active = Boolean(body.active);
    const upd = await db
      .from('vk_bot_promos')
      .update({ is_active: active ? 1 : 0, updated_at: nowIso() })
      .eq('code', code)
      .select('code')
      .maybeSingle();
    if (upd.error) err(500, upd.error.message);
    if (!upd.data) err(404, 'Promo code not found.');
    return reply(200, { me, message: `Promo code ${code} ${active ? 'enabled' : 'disabled'}.` });
  }

  err(404, 'Admin endpoint not found.');
}

Deno.serve(async (req: Request) => {
  const reply = (status: number, payload: Json): Response => json(status, payload, req);
  if (req.method === 'OPTIONS') return reply(200, { ok: true });

  try {
    const route = getRoute(req);
    const method = req.method;
    const body = await safeBody(req);

    if (route === '/health' && method === 'GET') {
      return reply(200, { ok: true, now: nowIso() });
    }

    if (route === '/api/plans' && method === 'GET') {
      return reply(200, { plans: PLAN_CATALOG });
    }

    if (route.startsWith('/api/admin/') && method === 'POST') {
      return handleAdminRoute(route, body, req, reply);
    }

    if (route === '/api/community/connect' && method === 'POST') {
      const vkUserId = await resolveVkUserId(req, body);
      const normalizedUrl = normalizeVkUrl(body.communityUrl);
      if (!normalizedUrl) err(400, 'Provide a valid VK community URL.');

      await ensureUser(vkUserId);

      const byUrl = await db
        .from('communities')
        .select('id,owner_vk_user_id')
        .eq('community_url', normalizedUrl)
        .maybeSingle();
      if (byUrl.error) err(500, byUrl.error.message);
      if (byUrl.data && String((byUrl.data as Json).owner_vk_user_id) !== vkUserId) {
        err(409, 'Это сообщество уже подключено к другому аккаунту.');
      }

      const communityScreen = extractCommunityName(normalizedUrl);
      const upsert = await db
        .from('communities')
        .upsert(
          {
            community_url: normalizedUrl,
            community_screen: communityScreen,
            owner_vk_user_id: Number(vkUserId),
            updated_at: nowIso(),
          },
          { onConflict: 'owner_vk_user_id' },
        )
        .select('id')
        .single();
      if (upsert.error || !upsert.data) err(500, upsert.error?.message || 'Failed to save community.');

      const communityId = toInt((upsert.data as Json).id, 0);
      const setSelected = await db
        .from('app_users')
        .update({ selected_community_id: communityId, updated_at: nowIso() })
        .eq('vk_user_id', Number(vkUserId));
      if (setSelected.error) err(500, setSelected.error.message);

      const state = await buildState(vkUserId);
      const user = (state.user as Json) || {};
      const topics = (state.topics as Json[]) || [];
      const remainingPosts = Math.max(0, toInt(user.postsTotal, 0) - toInt(user.postsUsed, 0));
      const remainingThemeSlots = Math.max(0, toInt(user.themesCapacityTotal, 0) - topics.length);
      const shouldGenerateInitial = topics.length === 0 && Math.min(3, remainingPosts, remainingThemeSlots) > 0;

      if (shouldGenerateInitial) {
        runBackgroundTask(
          (async () => {
            const fresh = await buildState(vkUserId);
            const freshUser = (fresh.user as Json) || {};
            const freshTopics = (fresh.topics as Json[]) || [];
            if (freshTopics.length > 0) return;

            const freshRemainingPosts = Math.max(0, toInt(freshUser.postsTotal, 0) - toInt(freshUser.postsUsed, 0));
            const freshRemainingThemeSlots = Math.max(0, toInt(freshUser.themesCapacityTotal, 0) - freshTopics.length);
            const count = Math.min(3, freshRemainingPosts, freshRemainingThemeSlots);
            if (count <= 0) return;

            const profile = await ensureCommunityProfileContext(
              vkUserId,
              freshUser,
              {
                id: communityId,
                community_url: normalizedUrl,
                community_screen: String(freshUser.selectedCommunityName || communityScreen),
              },
            );
            const generated = await generateTopicsBatch({
              vkUserId,
              count,
              startFrom: 1,
              communityName: String(freshUser.selectedCommunityName || communityScreen),
              existingTitles: new Set(),
              selectedCommunityUrl: String(freshUser.selectedCommunityUrl || normalizedUrl),
              communityProfileText: profile.text,
              communityProfileJson: profile.json,
            });
            if (!generated.length) return;

            const rows = generated.map((t) => ({
              vk_user_id: Number(vkUserId),
              community_id: communityId,
              seq_no: t.seqNo,
              title: t.title,
              short: t.short,
              source: t.source,
              created_at: nowIso(),
              updated_at: nowIso(),
            }));
            const ins = await db.from('topics').insert(rows);
            if (ins.error) {
              console.error('[smart-task] initial topics insert failed', ins.error);
              return;
            }

            const upd = await db
              .from('app_users')
              .update({ posts_used: toInt(freshUser.postsUsed, 0) + generated.length, updated_at: nowIso() })
              .eq('vk_user_id', Number(vkUserId));
            if (upd.error) {
              console.error('[smart-task] initial topics usage update failed', upd.error);
            }
          })(),
          `connect-initial-topics:${vkUserId}:${communityId}`,
        );
      }

      return reply(200, {
        state,
        message: shouldGenerateInitial
          ? 'Сообщество подключено. Стартовые темы генерируются, это может занять до минуты.'
          : 'Сообщество подключено. Лимит тем исчерпан, выберите тариф.',
      });
    }

    if (route === '/api/community/disconnect' && method === 'POST') {
      const vkUserId = await resolveVkUserId(req, body);
      const community = await findCommunityByOwner(vkUserId);
      if (community) {
        const del = await db.from('communities').delete().eq('id', toInt(community.id, 0));
        if (del.error) err(500, del.error.message);
      }
      const upd = await db
        .from('app_users')
        .update({ selected_community_id: null, updated_at: nowIso() })
        .eq('vk_user_id', Number(vkUserId));
      if (upd.error) err(500, upd.error.message);
      const state = await buildState(vkUserId);
      return reply(200, { state, message: 'Сообщество отключено. Можно подключить новое.' });
    }

    if (route === '/api/purchase' && method === 'POST') {
      requirePurchaseSecret(req);
      const vkUserId = parseVkUserId(body.vkUserId ?? new URL(req.url).searchParams.get('vkUserId'));
      const plan = findPlan(body.planCode);
      const paymentId = parsePaymentId(body.paymentId || body.orderId || body.transactionId);
      const verifiedPayment = await ensureVerifiedPayment(vkUserId, plan, paymentId);
      const paymentAmount = Math.max(0, toInt(verifiedPayment.amountRub, toInt(plan.price, 0)));
      const amountRub = paymentAmount > 0 ? paymentAmount : toInt(plan.price, 0);
      const explicitPromoCode = parsePromoCodeOptional(body.promoCode || body.promo_code);
      const paymentPromoCode = explicitPromoCode || extractPromoCodeFromPaymentRaw(verifiedPayment.raw);

      const applied = await applyPurchaseOnce(vkUserId, plan, paymentId, amountRub);
      if (!applied.applied) {
        if (applied.reason === 'already_applied_other_user') {
          err(409, 'This payment is already applied to another user.');
        }
        return reply(200, {
          state: await buildState(vkUserId),
          message: 'Платёж уже был применён ранее. Повторно лимиты не начислены.',
        });
      }

      if (paymentPromoCode) {
        try {
          await markPromoUse(vkUserId, paymentPromoCode);
        } catch (promoError) {
          console.warn('[smart-task] failed to mark promo use', promoError);
        }
      }

      const paidWithDiscount = amountRub > 0 && amountRub < toInt(plan.price, 0);
      const promoNote =
        paymentPromoCode && paidWithDiscount ? ` Промокод ${paymentPromoCode} применён.` : '';
      return reply(200, {
        state: await buildState(vkUserId),
        message: `Тариф «${plan.title}» активирован. Лимиты начислены.${promoNote}`,
      });
    }

    const vkUserId = await resolveVkUserId(req, body);

    if (route === '/api/promo/preview' && method === 'POST') {
      const promo = await resolvePromoEligibility(vkUserId, body.code || body.promoCode || body.promo_code);
      if (!promo) err(400, 'Введите промокод.');

      const plan = body.planCode ? findPlan(body.planCode) : null;
      if (plan && !isPromoAllowedForPlan(promo.allowedPlan, plan.code)) {
        err(400, `Промокод не подходит для тарифа ${plan.title}.`);
      }

      const pricing = plan ? toPromoPricing(plan, promo) : null;
      return reply(200, {
        ok: true,
        promo: {
          code: promo.code,
          discountPercent: promo.discountPercent,
          allowedPlan: promo.allowedPlan,
          maxUses: promo.maxUses,
          usedCount: promo.usedCount,
          baseAmount: pricing ? pricing.baseAmount : null,
          finalAmount: pricing ? pricing.finalAmount : null,
          savingsAmount: pricing ? pricing.savingsAmount : null,
        },
        message: pricing
          ? `Промокод ${promo.code} применён: ${pricing.baseAmount} ₽ → ${pricing.finalAmount} ₽.`
          : `Промокод ${promo.code} проверен.`,
      });
    }

    if (route === '/api/purchase/vk-chat' && method === 'POST') {
      const plan = findPlan(body.planCode);
      if (!isHttpsUrl(BUY_VK_WEBHOOK_URL)) err(503, 'BUY_VK_WEBHOOK_URL is missing.');
      const promo = await resolvePromoEligibility(vkUserId, body.promoCode || body.promo_code);
      if (promo && !isPromoAllowedForPlan(promo.allowedPlan, plan.code)) {
        err(400, `Промокод не подходит для тарифа ${plan.title}.`);
      }
      const pricing = promo ? toPromoPricing(plan, promo) : null;
      const amountToPay = pricing ? pricing.finalAmount : toInt(plan.price, 0);

      const response = await postWebhookJson(BUY_VK_WEBHOOK_URL, {
        vkUserId,
        planCode: plan.code,
        amount: amountToPay,
        amountBase: toInt(plan.price, 0),
        discountPercent: pricing ? pricing.discountPercent : 0,
        promoCode: pricing ? pricing.code : '',
        title: plan.title,
        source: 'vk-miniapp',
        createdAt: nowIso(),
      });

      if (!response.ok) {
        err(502, `VK webhook failed with status ${response.status}.`);
      }
      const payload = response.payload || {};
      if (payload.ok === false) {
        err(502, String(payload.message || 'VK webhook rejected the request.'));
      }

      return reply(200, {
        ok: true,
        amount: amountToPay,
        baseAmount: toInt(plan.price, 0),
        promo: pricing
          ? {
              code: pricing.code,
              discountPercent: pricing.discountPercent,
              finalAmount: pricing.finalAmount,
              baseAmount: pricing.baseAmount,
              savingsAmount: pricing.savingsAmount,
              allowedPlan: pricing.allowedPlan,
            }
          : null,
        message: String(payload.message || 'Ссылка на оплату отправлена в диалог ВК от имени группы.'),
      });
    }

    if (route === '/api/state' && method === 'POST') {
      const state = await buildState(vkUserId);
      return reply(200, { state });
    }

    if (route === '/api/user/business-info' && method === 'POST') {
      const text = normalizeProfileText(body.text || '');
      const upd = await db
        .from('app_users')
        .update({ custom_business_info: text, updated_at: nowIso() })
        .eq('vk_user_id', Number(vkUserId));
      if (upd.error) err(500, upd.error.message);

      const community = await findCommunityByOwner(vkUserId);
      const communityId = toInt((community as Json | null)?.id, 0);
      if (communityId > 0) {
        const delCache = await db.from('community_ai_profiles').delete().eq('community_id', communityId);
        if (delCache.error && !isMissingRelationError(delCache.error, 'community_ai_profiles')) {
          err(500, delCache.error.message);
        }
      }

      return reply(200, {
        state: await buildState(vkUserId),
        message: text ? 'Дополнительная информация о бизнесе сохранена.' : 'Дополнительная информация удалена.',
      });
    }

    if (route === '/api/topics/more' && method === 'POST') {
      const state = await buildState(vkUserId);
      const user = (state.user as Json) || {};
      const topics = (state.topics as Json[]) || [];
      if (!user.selectedCommunityId) err(400, 'Сначала подключите сообщество.');

      const remainingPosts = Math.max(0, toInt(user.postsTotal, 0) - toInt(user.postsUsed, 0));
      const remainingThemeSlots = Math.max(0, toInt(user.themesCapacityTotal, 0) - topics.length);
      const count = Math.min(remainingPosts, remainingThemeSlots, getToPageEdge(topics.length));
      if (count <= 0) err(400, 'Лимит тем исчерпан. Выберите тариф.');
      const community = await findCommunityByOwner(vkUserId);
      const profile = await ensureCommunityProfileContext(vkUserId, user, community);

      const generated = await generateTopicsBatch({
        vkUserId,
        count,
        startFrom: topics.length + 1,
        communityName: String(user.selectedCommunityName || 'community'),
        existingTitles: new Set(topics.map((t) => String((t as Json).title || ''))),
        selectedCommunityUrl: String(user.selectedCommunityUrl || ''),
        communityProfileText: profile.text,
        communityProfileJson: profile.json,
      });
      const rows = generated.map((t) => ({
        vk_user_id: Number(vkUserId),
        community_id: toInt(user.selectedCommunityId, 0),
        seq_no: t.seqNo,
        title: t.title,
        short: t.short,
        source: t.source,
        created_at: nowIso(),
        updated_at: nowIso(),
      }));
      const ins = await db.from('topics').insert(rows);
      if (ins.error) err(500, ins.error.message);
      const upd = await db
        .from('app_users')
        .update({ posts_used: toInt(user.postsUsed, 0) + count, updated_at: nowIso() })
        .eq('vk_user_id', Number(vkUserId));
      if (upd.error) err(500, upd.error.message);
      return reply(200, { state: await buildState(vkUserId), message: `Добавлено тем: ${count}.` });
    }

    if (route === '/api/topics/posts' && method === 'POST') {
      const topicId = toInt(body.topicId, 0);
      if (topicId <= 0) err(400, 'Topic id is required.');
      const topicQ = await db
        .from('topics')
        .select('id,seq_no,title,short,source')
        .eq('vk_user_id', Number(vkUserId))
        .eq('id', topicId)
        .maybeSingle();
      if (topicQ.error) err(500, topicQ.error.message);
      if (!topicQ.data) err(404, 'Тема не найдена.');
      const topic = mapTopicRow(topicQ.data as Json);

      const existing = await db
        .from('topic_post_variants')
        .select('variant_no,text,source')
        .eq('topic_id', topicId)
        .order('variant_no', { ascending: true });
      if (existing.error) err(500, existing.error.message);
      const persisted = (existing.data || [])
        .map((r) => ({
          variant: toInt((r as Json).variant_no, 0),
          text: enforcePostVisualStyle(clampPostBody((r as Json).text, MAX_POST_TEXT_LENGTH), toInt((r as Json).variant_no, 0)),
          source: String((r as Json).source || 'fallback'),
        }))
        .filter((v) => v.variant >= 1 && v.variant <= 3 && v.text.length > 0);

      if (persisted.length >= 3) {
        const onlyFallback = persisted.every((item) => item.source === 'fallback');
        if (!onlyFallback) {
          return reply(200, { topic, posts: persisted.slice(0, 3), message: 'Показаны сохранённые варианты постов.' });
        }
      }

      const state = await buildState(vkUserId);
      const user = state.user as Json;
      const community = await findCommunityByOwner(vkUserId);
      const profile = await ensureCommunityProfileContext(vkUserId, user, community);
      const posts = await generatePostVariants(vkUserId, topic, user, 'initial', profile.text, profile.json);

      const del = await db.from('topic_post_variants').delete().eq('topic_id', topicId);
      if (del.error) err(500, del.error.message);
      const ins = await db.from('topic_post_variants').insert(
        posts.map((p) => ({
          topic_id: topicId,
          variant_no: p.variant,
          text: p.text,
          source: p.source,
          created_at: nowIso(),
          updated_at: nowIso(),
        })),
      );
      if (ins.error) err(500, ins.error.message);
      const hasWebhookPosts = posts.some((p) => p.source === 'webhook');
      return reply(200, {
        topic,
        posts,
        message: hasWebhookPosts ? 'Сгенерированы 3 варианта поста.' : 'Сгенерированы 3 варианта поста (резервный режим).',
      });
    }

    if (route === '/api/topics/posts/status' && method === 'POST') {
      const topicId = toInt(body.topicId, 0);
      if (topicId <= 0) err(400, 'Topic id is required.');
      const topicQ = await db
        .from('topics')
        .select('id,seq_no,title,short,source')
        .eq('vk_user_id', Number(vkUserId))
        .eq('id', topicId)
        .maybeSingle();
      if (topicQ.error) err(500, topicQ.error.message);
      if (!topicQ.data) err(404, 'Тема не найдена.');
      const topic = mapTopicRow(topicQ.data as Json);

      const existing = await db
        .from('topic_post_variants')
        .select('variant_no,text,source')
        .eq('topic_id', topicId)
        .order('variant_no', { ascending: true });
      if (existing.error) err(500, existing.error.message);
      const posts = (existing.data || [])
        .map((r) => ({
          variant: toInt((r as Json).variant_no, 0),
          text: enforcePostVisualStyle(clampPostBody((r as Json).text, MAX_POST_TEXT_LENGTH), toInt((r as Json).variant_no, 0)),
          source: String((r as Json).source || 'fallback'),
        }))
        .filter((v) => v.variant >= 1 && v.variant <= 3 && v.text.length > 0)
        .slice(0, 3);

      return reply(200, {
        topic,
        posts,
        ready: posts.length >= 3,
        message: posts.length >= 3 ? 'Посты готовы.' : 'Посты ещё генерируются.',
      });
    }

    if (route === '/api/topics/posts/regenerate' && method === 'POST') {
      const topicId = toInt(body.topicId, 0);
      if (topicId <= 0) err(400, 'Topic id is required.');

      const topicQ = await db
        .from('topics')
        .select('id,seq_no,title,short,source')
        .eq('vk_user_id', Number(vkUserId))
        .eq('id', topicId)
        .maybeSingle();
      if (topicQ.error) err(500, topicQ.error.message);
      if (!topicQ.data) err(404, 'Тема не найдена.');
      const topic = mapTopicRow(topicQ.data as Json);

      const state = await buildState(vkUserId);
      const user = state.user as Json;
      const remaining = Math.max(0, toInt(user.textRegenTotal, 0) - toInt(user.textRegenUsed, 0));
      if (remaining <= 0) err(400, 'Лимит перегенерации текстов исчерпан.');

      const community = await findCommunityByOwner(vkUserId);
      const profile = await ensureCommunityProfileContext(vkUserId, user, community);
      const posts = await generatePostVariants(vkUserId, topic, user, 'regenerate', profile.text, profile.json);

      const del = await db.from('topic_post_variants').delete().eq('topic_id', topicId);
      if (del.error) err(500, del.error.message);
      const ins = await db.from('topic_post_variants').insert(
        posts.map((p) => ({
          topic_id: topicId,
          variant_no: p.variant,
          text: p.text,
          source: p.source,
          created_at: nowIso(),
          updated_at: nowIso(),
        })),
      );
      if (ins.error) err(500, ins.error.message);

      const upd = await db
        .from('app_users')
        .update({ text_regen_used: toInt(user.textRegenUsed, 0) + 1, updated_at: nowIso() })
        .eq('vk_user_id', Number(vkUserId));
      if (upd.error) err(500, upd.error.message);

      return reply(200, {
        topic,
        posts,
        state: await buildState(vkUserId),
        message: posts.some((p) => p.source === 'webhook')
          ? 'Тексты перегенерированы и сохранены.'
          : 'Тексты перегенерированы в резервном режиме и сохранены.',
      });
    }

    if (route === '/api/topics/regenerate-one' && method === 'POST') {
      const topicId = toInt(body.topicId, 0);
      if (topicId <= 0) err(400, 'Topic id is required.');

      const state = await buildState(vkUserId);
      const user = (state.user as Json) || {};
      const topics = (state.topics as Json[]) || [];
      const selected = topics.find((item) => toInt((item as Json).id, 0) === topicId) as Json | undefined;
      if (!selected) err(404, 'Тема не найдена.');

      const remaining = Math.max(0, toInt(user.ideaRegenTotal, 0) - toInt(user.ideaRegenUsed, 0));
      if (remaining <= 0) err(400, 'Лимит перегенерации тем исчерпан.');

      const community = await findCommunityByOwner(vkUserId);
      const profile = await ensureCommunityProfileContext(vkUserId, user, community);
      const fixedTitles = new Set(
        topics
          .filter((item) => toInt((item as Json).id, 0) !== topicId)
          .map((item) => String((item as Json).title || '')),
      );
      const replacement = await generateTopicsBatch({
        vkUserId,
        count: 1,
        startFrom: toInt(selected.seqNo, 1),
        communityName: String(user.selectedCommunityName || 'community'),
        existingTitles: fixedTitles,
        selectedCommunityUrl: String(user.selectedCommunityUrl || ''),
        communityProfileText: profile.text,
        communityProfileJson: profile.json,
      });
      const next = replacement[0];
      if (!next) err(500, 'Failed to regenerate topic.');

      const upd = await db
        .from('topics')
        .update({ title: next.title, short: next.short, source: next.source || 'auto', updated_at: nowIso() })
        .eq('vk_user_id', Number(vkUserId))
        .eq('id', topicId);
      if (upd.error) err(500, upd.error.message);

      const del = await db.from('topic_post_variants').delete().eq('topic_id', topicId);
      if (del.error) err(500, del.error.message);

      const updUser = await db
        .from('app_users')
        .update({ idea_regen_used: toInt(user.ideaRegenUsed, 0) + 1, updated_at: nowIso() })
        .eq('vk_user_id', Number(vkUserId));
      if (updUser.error) err(500, updUser.error.message);

      return reply(200, { state: await buildState(vkUserId), message: 'Выбранная тема обновлена.' });
    }

    if (route === '/api/topics/regenerate-page' && method === 'POST') {
      const safePage = Math.max(1, toInt(body.page, 1));
      const state = await buildState(vkUserId);
      const user = (state.user as Json) || {};
      const topics = (state.topics as Json[]) || [];
      const start = (safePage - 1) * PAGE_SIZE;
      const chunk = topics.slice(start, start + PAGE_SIZE);
      if (!chunk.length) err(400, 'На этой странице нет тем.');
      const required = chunk.length;
      const remaining = Math.max(0, toInt(user.ideaRegenTotal, 0) - toInt(user.ideaRegenUsed, 0));
      if (remaining < required) err(400, 'Недостаточно лимита перегенерации тем.');
      const community = await findCommunityByOwner(vkUserId);
      const profile = await ensureCommunityProfileContext(vkUserId, user, community);

      const fixedTitles = new Set(
        topics
          .filter((_, idx) => idx < start || idx >= start + PAGE_SIZE)
          .map((item) => String((item as Json).title || '')),
      );
      const replacements = await generateTopicsBatch({
        vkUserId,
        count: required,
        startFrom: start + 1,
        communityName: String(user.selectedCommunityName || 'community'),
        existingTitles: fixedTitles,
        selectedCommunityUrl: String(user.selectedCommunityUrl || ''),
        communityProfileText: profile.text,
        communityProfileJson: profile.json,
      });
      for (let i = 0; i < chunk.length; i += 1) {
        const t = chunk[i] as Json;
        const r = replacements[i];
        const upd = await db
          .from('topics')
          .update({ title: r.title, short: r.short, source: 'auto', updated_at: nowIso() })
          .eq('vk_user_id', Number(vkUserId))
          .eq('id', toInt(t.id, 0));
        if (upd.error) err(500, upd.error.message);
      }
      const del = await db.from('topic_post_variants').delete().in('topic_id', chunk.map((t) => toInt((t as Json).id, 0)));
      if (del.error) err(500, del.error.message);
      const updUser = await db
        .from('app_users')
        .update({ idea_regen_used: toInt(user.ideaRegenUsed, 0) + required, updated_at: nowIso() })
        .eq('vk_user_id', Number(vkUserId));
      if (updUser.error) err(500, updUser.error.message);
      return reply(200, { state: await buildState(vkUserId), message: `Перегенерировано тем: ${required}.` });
    }

    if (route === '/api/topics/custom' && method === 'POST') {
      const title = clampSingleLine(body.title, 220);
      if (!title) err(400, 'Введите название темы.');
      const state = await buildState(vkUserId);
      const user = state.user as Json;
      const topics = state.topics as Json[];
      const remainingPosts = Math.max(0, toInt(user.postsTotal, 0) - toInt(user.postsUsed, 0));
      const remainingThemeSlots = Math.max(0, toInt(user.themesCapacityTotal, 0) - topics.length);
      if (remainingPosts <= 0 || remainingThemeSlots <= 0) err(400, 'Лимит тем исчерпан.');
      const ins = await db.from('topics').insert({
        vk_user_id: Number(vkUserId),
        community_id: toInt(user.selectedCommunityId, 0),
        seq_no: topics.length + 1,
        title,
        short: 'Пользовательская тема.',
        source: 'custom',
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      if (ins.error) err(500, ins.error.message);
      const upd = await db
        .from('app_users')
        .update({ posts_used: toInt(user.postsUsed, 0) + 1, updated_at: nowIso() })
        .eq('vk_user_id', Number(vkUserId));
      if (upd.error) err(500, upd.error.message);
      return reply(200, { state: await buildState(vkUserId), message: 'Тема добавлена в контент-план.' });
    }

    err(404, 'Endpoint not found.');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Internal server error.';
    if (status >= 500) console.error('[smart-task]', message, e);
    return reply(status, { ok: false, message });
  }
});
