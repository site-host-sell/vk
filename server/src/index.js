import crypto from 'crypto';
import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { pool, withTransaction } from './db.js';
import { PLAN_CATALOG, PLAN_MAP } from './plans.js';
import {
  PAGE_SIZE,
  MAX_POST_TEXT_LENGTH,
  MAX_SUPPORT_TEXT_LENGTH,
  clampPostBody,
  clampSingleLine,
  createAutoTopics,
  extractCommunityName,
  filterUniqueTopics,
  getToPageEdge,
  normalizeGeneratedPosts,
  normalizeGeneratedTopics,
  normalizeVkUrl,
  parseVkUserId,
  toInt,
} from './utils.js';

dotenv.config();

const app = express();
app.use(express.json({ limit: '512kb' }));

const corsOrigins = String(
  process.env.CORS_ORIGINS ||
    [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'https://site-host-sell.github.io',
      'https://vk.com',
      'https://m.vk.com',
    ].join(','),
)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: false,
  }),
);

const PORT = Math.max(1, toInt(process.env.PORT, 8787));
const VK_MINI_APP_SECRET = String(process.env.VK_MINI_APP_SECRET || '').trim();
const ROOT_ADMIN_VK_IDS = new Set(
  String(process.env.ROOT_ADMIN_VK_IDS || process.env.ROOT_ADMIN_VK_ID || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);
const ALLOW_INSECURE_DEV_AUTH = String(process.env.ALLOW_INSECURE_DEV_AUTH || '').trim() === '1';
const TOPICS_WEBHOOK_URL = String(process.env.TOPICS_WEBHOOK_URL || '').trim();
const TOPIC_POSTS_WEBHOOK_URL = String(process.env.TOPIC_POSTS_WEBHOOK_URL || '').trim();
const SUPPORT_WEBHOOK_URL = String(process.env.SUPPORT_WEBHOOK_URL || '').trim();
const BUY_VK_WEBHOOK_URL = String(process.env.BUY_VK_WEBHOOK_URL || '').trim();
const WEBHOOK_TIMEOUT_MS = Math.max(3000, toInt(process.env.WEBHOOK_TIMEOUT_MS, 15000));
const PURCHASE_APPLY_SECRET = String(process.env.PURCHASE_APPLY_SECRET || '').trim();
const N8N_WEBHOOK_SECRET = String(process.env.N8N_WEBHOOK_SECRET || '').trim();

const userSchema = z.object({
  vkUserId: z.union([z.string(), z.number()]).optional(),
  launchParams: z.string().optional(),
});

const connectCommunitySchema = userSchema.extend({
  communityUrl: z.string().min(1).max(300),
});

const purchaseSchema = userSchema.extend({
  planCode: z.string().min(1).max(32),
  paymentId: z.string().min(1).max(180).optional(),
  orderId: z.string().min(1).max(180).optional(),
  transactionId: z.string().min(1).max(180).optional(),
});

const regenerateSchema = userSchema.extend({
  page: z.union([z.number(), z.string()]).optional(),
});

const customTopicSchema = userSchema.extend({
  title: z.string().min(3).max(300),
});

const topicPostsSchema = userSchema.extend({
  topicId: z.union([z.string(), z.number()]),
});

const supportSchema = userSchema.extend({
  text: z.string().min(1).max(4000),
});

const adminTargetSchema = userSchema.extend({
  targetUserRef: z.string().min(1).max(180),
});

const adminPlanSchema = adminTargetSchema.extend({
  planCode: z.string().min(1).max(32),
});

const adminLimitsSchema = adminTargetSchema.extend({
  limits: z
    .object({
      posts: z.number().optional(),
      themes: z.number().optional(),
      idea: z.number().optional(),
      text: z.number().optional(),
    })
    .strict(),
});

const adminGroupSchema = userSchema.extend({
  groupRef: z.string().min(1).max(180),
});

const adminRoleSchema = userSchema.extend({
  targetUserRef: z.string().min(1).max(180),
  role: z.string().min(1).max(32).optional(),
});

const adminPromoAddSchema = userSchema.extend({
  input: z
    .object({
      code: z.string().min(1).max(100),
      percent: z.number().optional(),
      maxUses: z.number().nullable().optional(),
      allowedPlan: z.string().optional(),
      days: z.number().nullable().optional(),
      note: z.string().optional(),
      active: z.boolean().optional(),
    })
    .strict(),
});
const adminPromoSetSchema = adminPromoAddSchema;
const adminPromoCodeSchema = userSchema.extend({
  code: z.string().min(1).max(100),
});
const adminPromoToggleSchema = adminPromoCodeSchema.extend({
  active: z.boolean(),
});

function parseBody(schema, req) {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues?.[0]?.message || 'Invalid request body.';
    throw makeHttpError(400, message);
  }
  return parsed.data;
}

function makeHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePage(pageInput) {
  return Math.max(1, toInt(pageInput, 1));
}

function isHttpsUrl(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isLoopbackAddress(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return false;
  }
  const normalized = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  return normalized === '127.0.0.1' || normalized === '::1';
}

function getLaunchParamsFromRequest(req, parsedBody = null) {
  const headerRaw = String(req.get('x-vk-launch-params') || '').trim();
  if (headerRaw) {
    return headerRaw;
  }

  const bodyRaw =
    parsedBody && typeof parsedBody.launchParams === 'string'
      ? String(parsedBody.launchParams).trim()
      : '';
  if (bodyRaw) {
    return bodyRaw;
  }

  const queryRaw = typeof req.query.launchParams === 'string' ? String(req.query.launchParams).trim() : '';
  return queryRaw;
}

function verifyVkLaunchParams(launchParamsRaw) {
  if (!VK_MINI_APP_SECRET) {
    throw makeHttpError(
      503,
      'Server is not configured: VK_MINI_APP_SECRET is missing. Enable Mini App signature verification.',
    );
  }

  const prepared = String(launchParamsRaw || '').trim().replace(/^\?/, '');
  if (!prepared) {
    throw makeHttpError(401, 'Mini App launch params are missing.');
  }

  const params = new URLSearchParams(prepared);
  const sign = String(params.get('sign') || '').trim();
  if (!sign) {
    throw makeHttpError(401, 'Mini App launch params do not contain sign.');
  }

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'sign' && key.startsWith('vk_')) {
      pairs.push([key, value]);
    }
  }
  if (!pairs.length) {
    throw makeHttpError(401, 'Invalid launch params: vk_* params are missing.');
  }

  pairs.sort(([a], [b]) => a.localeCompare(b));
  const checkString = pairs.map(([key, value]) => `${key}=${value}`).join('&');
  const expected = toBase64Url(
    crypto.createHmac('sha256', VK_MINI_APP_SECRET).update(checkString).digest(),
  );
  if (expected !== sign) {
    throw makeHttpError(401, 'Mini App launch signature verification failed.');
  }

  return parseVkUserId(params.get('vk_user_id'));
}

function resolveRequestVkUserId(req, parsedBody = null) {
  const launchParams = getLaunchParamsFromRequest(req, parsedBody);
  if (launchParams) {
    return verifyVkLaunchParams(launchParams);
  }

  if (!ALLOW_INSECURE_DEV_AUTH) {
    throw makeHttpError(401, 'Mini App authorization is required (launch params).');
  }
  const host = String(req.hostname || '').toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  const remoteAddress = String(req.socket?.remoteAddress || '');
  const isLoopbackClient = isLoopbackAddress(remoteAddress);
  if (!isLocalHost || !isLoopbackClient) {
    throw makeHttpError(401, 'Mini App authorization is required (launch params).');
  }

  const fallback = parsedBody?.vkUserId ?? req.query?.vkUserId ?? req.body?.vkUserId;
  return parseVkUserId(fallback);
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function getPurchaseSecretFromRequest(req) {
  return String(req.get('x-purchase-secret') || '').trim();
}

function requirePurchaseSecret(req) {
  if (!PURCHASE_APPLY_SECRET) {
    throw makeHttpError(503, 'Server is not configured: PURCHASE_APPLY_SECRET is missing.');
  }
  const provided = getPurchaseSecretFromRequest(req);
  if (!provided || !secureEqual(provided, PURCHASE_APPLY_SECRET)) {
    throw makeHttpError(403, 'Purchase apply is forbidden.');
  }
}

async function ensureVerifiedPayment(client, vkUserId, planCode, paymentId) {
  try {
    const check = await client.query(
      `SELECT status, vk_user_id, plan_code
         FROM miniapp_payments
        WHERE payment_id = $1
        LIMIT 1`,
      [paymentId],
    );
    if (!check.rowCount) {
      throw makeHttpError(409, 'Payment is not verified.');
    }

    const row = check.rows[0] || {};
    const status = String(row.status || '').trim().toLowerCase();
    if (status !== 'succeeded') {
      throw makeHttpError(409, 'Payment is not completed.');
    }

    const ownerVkUserId = String(row.vk_user_id || '').trim();
    if (!ownerVkUserId || ownerVkUserId !== String(vkUserId)) {
      throw makeHttpError(409, 'Payment owner mismatch.');
    }

    const rowPlanCode = String(row.plan_code || '').trim().toLowerCase();
    if (!rowPlanCode || rowPlanCode !== String(planCode || '').trim().toLowerCase()) {
      throw makeHttpError(409, 'Payment plan mismatch.');
    }
  } catch (error) {
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('miniapp_payments') && msg.includes('does not exist')) {
      throw makeHttpError(503, 'DB migration required: miniapp_payments is missing.');
    }
    throw error;
  }
}

async function postWebhookJson(url, body) {
  if (!isHttpsUrl(url)) {
    return { ok: false, status: 0, payload: null, raw: '' };
  }

  const bodyText = JSON.stringify(body);
  const webhookHeaders = buildWebhookHeaders(bodyText);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...webhookHeaders,
      },
      body: bodyText,
      signal: abort.signal,
    });
    const raw = await response.text();
    let payload = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed;
        }
      } catch {
        payload = null;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      payload,
      raw,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw makeHttpError(504, 'External service did not respond in time.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildWebhookHeaders(bodyText) {
  if (!N8N_WEBHOOK_SECRET) {
    return {};
  }

  const ts = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac('sha256', N8N_WEBHOOK_SECRET)
    .update(`${ts}.${bodyText}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return {
    'x-webhook-timestamp': ts,
    'x-webhook-signature': signature,
    'x-webhook-secret': N8N_WEBHOOK_SECRET,
  };
}

function mapUserRow(row) {
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
    selectedCommunityId: row.selected_community_id ? toInt(row.selected_community_id, 0) : null,
  };
}

function mapTopicRow(row) {
  return {
    id: String(row.id),
    seqNo: toInt(row.seq_no, 0),
    title: String(row.title || ''),
    short: String(row.short || ''),
    source: String(row.source || 'auto'),
  };
}

function mapState(user, community, topics) {
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

async function ensureUser(client, vkUserId) {
  await client.query(
    `INSERT INTO app_users (vk_user_id) VALUES ($1)
     ON CONFLICT (vk_user_id) DO NOTHING`,
    [vkUserId],
  );
  const userRes = await client.query('SELECT * FROM app_users WHERE vk_user_id = $1', [vkUserId]);
  if (!userRes.rows[0]) {
    throw makeHttpError(500, 'Failed to load user state.');
  }
  return mapUserRow(userRes.rows[0]);
}

async function findCommunityByOwner(client, vkUserId) {
  const res = await client.query(
    `SELECT id, community_url, community_screen, owner_vk_user_id, description
     FROM communities
     WHERE owner_vk_user_id = $1
     LIMIT 1`,
    [vkUserId],
  );
  return res.rows[0] || null;
}

async function findCommunityByUrl(client, communityUrl) {
  const res = await client.query(
    `SELECT id, community_url, community_screen, owner_vk_user_id, description
     FROM communities
     WHERE community_url = $1
     LIMIT 1`,
    [communityUrl],
  );
  return res.rows[0] || null;
}

async function findCommunityByScreen(client, screenName) {
  const res = await client.query(
    `SELECT id, community_url, community_screen, owner_vk_user_id, description
     FROM communities
     WHERE community_screen = $1
     LIMIT 1`,
    [screenName],
  );
  return res.rows[0] || null;
}

async function listTopics(client, vkUserId) {
  const res = await client.query(
    `SELECT id, seq_no, title, short, source
     FROM topics
     WHERE vk_user_id = $1
     ORDER BY seq_no ASC`,
    [vkUserId],
  );
  return res.rows.map(mapTopicRow);
}

async function findTopicById(client, vkUserId, topicId) {
  const topicIdInt = toInt(topicId, 0);
  if (topicIdInt <= 0) {
    return null;
  }
  const res = await client.query(
    `SELECT id, seq_no, title, short, source
     FROM topics
     WHERE vk_user_id = $1 AND id = $2
     LIMIT 1`,
    [vkUserId, topicIdInt],
  );
  return res.rows[0] ? mapTopicRow(res.rows[0]) : null;
}

async function insertTopics(client, vkUserId, communityId, topics) {
  for (const topic of topics) {
    await client.query(
      `INSERT INTO topics (vk_user_id, community_id, seq_no, title, short, source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), now())
       ON CONFLICT (vk_user_id, seq_no)
       DO UPDATE SET
         title = EXCLUDED.title,
         short = EXCLUDED.short,
         source = EXCLUDED.source,
         updated_at = now()`,
      [
        vkUserId,
        communityId,
        topic.seqNo,
        clampSingleLine(topic.title, 220),
        clampSingleLine(topic.short, 500),
        String(topic.source || 'auto'),
      ],
    );
  }
}

async function loadTopicPostVariants(client, topicId) {
  const res = await client.query(
    `SELECT variant_no, text
     FROM topic_post_variants
     WHERE topic_id = $1
     ORDER BY variant_no ASC`,
    [toInt(topicId, 0)],
  );
  return res.rows
    .map((row) => ({
      variant: Math.max(1, toInt(row.variant_no, 1)),
      text: clampPostBody(row.text, MAX_POST_TEXT_LENGTH),
    }))
    .filter((item) => item.text.length > 0)
    .slice(0, 3);
}

async function saveTopicPostVariants(client, topicId, posts, source = 'ai') {
  const safeTopicId = toInt(topicId, 0);
  for (let idx = 0; idx < Math.min(posts.length, 3); idx += 1) {
    const item = posts[idx];
    await client.query(
      `INSERT INTO topic_post_variants (topic_id, variant_no, text, source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (topic_id, variant_no)
       DO UPDATE SET text = EXCLUDED.text, source = EXCLUDED.source, updated_at = now()`,
      [safeTopicId, idx + 1, clampPostBody(item.text, MAX_POST_TEXT_LENGTH), source],
    );
  }
}

async function deleteTopicPostVariants(client, topicIds) {
  const ids = topicIds.map((item) => toInt(item, 0)).filter((item) => item > 0);
  if (!ids.length) {
    return;
  }
  await client.query(`DELETE FROM topic_post_variants WHERE topic_id = ANY($1::bigint[])`, [ids]);
}

async function buildStateByClient(client, vkUserId) {
  const user = await ensureUser(client, vkUserId);
  const community = await findCommunityByOwner(client, vkUserId);
  if (community && user.selectedCommunityId !== toInt(community.id, 0)) {
    await client.query(
      `UPDATE app_users SET selected_community_id = $2, updated_at = now() WHERE vk_user_id = $1`,
      [vkUserId, toInt(community.id, 0)],
    );
  }
  const freshUser = await ensureUser(client, vkUserId);
  const topics = await listTopics(client, vkUserId);
  return mapState(freshUser, community, topics);
}

function buildPostVariant(topic, variant, businessContext) {
  const title = clampSingleLine(topic.title, 220);
  const short = clampSingleLine(topic.short, 500);
  return clampPostBody(
    `${title}

${short}

Variant ${variant}. Practical post for ${businessContext}.

1) Start from client pain.
2) Give concrete actionable steps.
3) Finish with a clear CTA for DM.`,
    MAX_POST_TEXT_LENGTH,
  );
}

async function generateTopicsViaWebhook({ vkUserId, communityName, communityUrl, count, existingTitles }) {
  if (!isHttpsUrl(TOPICS_WEBHOOK_URL) || count <= 0) {
    return [];
  }

  try {
    const response = await postWebhookJson(TOPICS_WEBHOOK_URL, {
      source: 'vk-miniapp',
      vkUserId: String(vkUserId),
      community: {
        name: clampSingleLine(communityName, 220),
        url: String(communityUrl || '').slice(0, 220),
      },
      count,
      existingTopics: existingTitles.slice(0, 300).map((item) => clampSingleLine(item, 220)),
    });

    if (!response.ok || !response.payload) {
      return [];
    }

    const payload = response.payload;
    const candidates = [
      normalizeGeneratedTopics(payload.topics),
      normalizeGeneratedTopics(payload.items),
      normalizeGeneratedTopics(payload.data?.topics),
      normalizeGeneratedTopics(payload.data?.items),
    ];
    const generated = candidates.find((list) => list.length > 0) || [];
    return filterUniqueTopics(generated, existingTitles, count);
  } catch {
    return [];
  }
}

async function generatePostsViaWebhook({ vkUserId, topic, state }) {
  if (!isHttpsUrl(TOPIC_POSTS_WEBHOOK_URL)) {
    return [];
  }

  try {
    const response = await postWebhookJson(TOPIC_POSTS_WEBHOOK_URL, {
      source: 'vk-miniapp',
      vkUserId: String(vkUserId),
      topic: {
        id: topic.id,
        seqNo: topic.seqNo,
        title: clampSingleLine(topic.title, 220),
        short: clampSingleLine(topic.short, 500),
        source: String(topic.source || 'auto'),
      },
      community: {
        name: clampSingleLine(state.user.selectedCommunityName, 220),
        url: String(state.user.selectedCommunityUrl || '').slice(0, 220),
      },
      needVariants: 3,
    });

    if (!response.ok || !response.payload) {
      return [];
    }

    const payload = response.payload;
    const candidates = [
      normalizeGeneratedPosts(payload.posts),
      normalizeGeneratedPosts(payload.items),
      normalizeGeneratedPosts(payload.data?.posts),
      normalizeGeneratedPosts(payload.data?.items),
    ];
    const generated = (candidates.find((list) => list.length > 0) || []).slice(0, 3);
    return generated.map((text, idx) => ({
      variant: idx + 1,
      text: clampPostBody(text, MAX_POST_TEXT_LENGTH),
    }));
  } catch {
    return [];
  }
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      mode: ALLOW_INSECURE_DEV_AUTH ? 'dev' : 'strict',
      vkSignatureVerification: Boolean(VK_MINI_APP_SECRET),
      now: nowIso(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: String(error?.message || 'Database health check failed.'),
    });
  }
});

app.get('/api/plans', (_req, res) => {
  res.json({ plans: PLAN_CATALOG });
});

app.post('/api/state', async (req, res, next) => {
  try {
    const parsedBody = parseBody(userSchema, req);
    const vkUserId = resolveRequestVkUserId(req, parsedBody);
    const state = await withTransaction(async (client) => buildStateByClient(client, vkUserId));
    res.json({ state });
  } catch (error) {
    next(error);
  }
});

app.post('/api/community/connect', async (req, res, next) => {
  try {
    const parsedBody = parseBody(connectCommunitySchema, req);
    const vkUserId = resolveRequestVkUserId(req, parsedBody);

    const normalizedUrl = normalizeVkUrl(clampSingleLine(parsedBody.communityUrl, 220));
    if (!normalizedUrl) {
      throw makeHttpError(400, 'Provide a valid VK community URL.');
    }

    const result = await withTransaction(async (client) => {
      await ensureUser(client, vkUserId);

      const byUrl = await findCommunityByUrl(client, normalizedUrl);
      if (byUrl && String(byUrl.owner_vk_user_id) !== String(vkUserId)) {
        throw makeHttpError(
          409,
          'This community is already linked to another account. One community can only belong to one user.',
        );
      }

      const currentCommunity = await findCommunityByOwner(client, vkUserId);
      if (currentCommunity && currentCommunity.community_url !== normalizedUrl) {
        await client.query('DELETE FROM communities WHERE id = $1', [toInt(currentCommunity.id, 0)]);
        await client.query(
          `UPDATE app_users SET selected_community_id = NULL, updated_at = now() WHERE vk_user_id = $1`,
          [vkUserId],
        );
      }

      const communityScreen = extractCommunityName(normalizedUrl);
      const upsertRes = await client.query(
        `INSERT INTO communities (community_url, community_screen, owner_vk_user_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (owner_vk_user_id)
         DO UPDATE SET community_url = EXCLUDED.community_url, community_screen = EXCLUDED.community_screen, updated_at = now()
         RETURNING id`,
        [normalizedUrl, communityScreen, vkUserId],
      );
      const communityId = toInt(upsertRes.rows[0]?.id, 0);
      if (communityId <= 0) {
        throw makeHttpError(500, 'Failed to save community.');
      }

      await client.query(
        `UPDATE app_users SET selected_community_id = $2, updated_at = now() WHERE vk_user_id = $1`,
        [vkUserId, communityId],
      );

      let state = await buildStateByClient(client, vkUserId);
      let generatedCount = 0;
      if (state.topics.length === 0) {
        const remainingPosts = Math.max(0, state.user.postsTotal - state.user.postsUsed);
        const remainingThemeSlots = Math.max(0, state.user.themesCapacityTotal - state.topics.length);
        generatedCount = Math.min(3, remainingPosts, remainingThemeSlots);
        if (generatedCount > 0) {
          const existingTitles = [];
          const generatedFromWebhook = await generateTopicsViaWebhook({
            vkUserId,
            communityName: state.user.selectedCommunityName || communityScreen,
            communityUrl: normalizedUrl,
            count: generatedCount,
            existingTitles,
          });
          const generated =
            generatedFromWebhook.length > 0
              ? generatedFromWebhook.map((topic, idx) => ({
                  seqNo: idx + 1,
                  title: topic.title,
                  short: topic.short,
                  source: 'ai',
                }))
              : createAutoTopics(generatedCount, 1, state.user.selectedCommunityName || communityScreen, new Set());

          await insertTopics(client, vkUserId, communityId, generated);
          await client.query(
            `UPDATE app_users
             SET posts_used = posts_used + $2, updated_at = now()
             WHERE vk_user_id = $1`,
            [vkUserId, generatedCount],
          );
          state = await buildStateByClient(client, vkUserId);
        }
      }

      return {
        state,
        message:
          generatedCount > 0
            ? `Community linked. Starter topics generated: ${generatedCount}.`
            : 'Community linked. Topic limit reached, choose a tariff to continue.',
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/community/disconnect', async (req, res, next) => {
  try {
    const parsedBody = parseBody(userSchema, req);
    const vkUserId = resolveRequestVkUserId(req, parsedBody);

    const result = await withTransaction(async (client) => {
      await ensureUser(client, vkUserId);
      const community = await findCommunityByOwner(client, vkUserId);
      if (community) {
        await client.query('DELETE FROM communities WHERE id = $1', [toInt(community.id, 0)]);
      }
      await client.query(
        `UPDATE app_users SET selected_community_id = NULL, updated_at = now() WHERE vk_user_id = $1`,
        [vkUserId],
      );
      const state = await buildStateByClient(client, vkUserId);
      return { state, message: 'Community disconnected. You can link another one.' };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/purchase', async (req, res, next) => {
  try {
    requirePurchaseSecret(req);
    const parsedBody = parseBody(purchaseSchema, req);
    const vkUserId = parseVkUserId(parsedBody.vkUserId ?? req.query?.vkUserId);
    const planCode = String(parsedBody.planCode || '').trim();
    const paymentId = String(
      parsedBody.paymentId || parsedBody.orderId || parsedBody.transactionId || '',
    ).trim();
    if (!paymentId) {
      throw makeHttpError(400, 'paymentId is required.');
    }
    if (paymentId.length > 180 || /\s/.test(paymentId)) {
      throw makeHttpError(400, 'paymentId has invalid format.');
    }
    const plan = PLAN_MAP.get(planCode);
    if (!plan) {
      throw makeHttpError(400, 'Unknown tariff.');
    }

    const result = await withTransaction(async (client) => {
      await ensureVerifiedPayment(client, vkUserId, plan.code, paymentId);

      const appliedQ = await client.query(
        `SELECT applied, reason, owner_vk_user_id
         FROM apply_purchase_once($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          vkUserId,
          plan.code,
          toInt(plan.posts, 0),
          toInt(plan.themes, 0),
          toInt(plan.ideaRegen, 0),
          toInt(plan.textRegen, 0),
          toInt(plan.price, 0),
          paymentId,
        ],
      );
      if (!appliedQ.rowCount) {
        throw makeHttpError(500, 'Unexpected apply_purchase_once() result.');
      }

      const applied = Boolean(appliedQ.rows[0]?.applied);
      const reason = String(appliedQ.rows[0]?.reason || '');
      if (!applied) {
        if (reason === 'already_applied_other_user') {
          throw makeHttpError(409, 'This payment is already applied to another user.');
        }
        const state = await buildStateByClient(client, vkUserId);
        return {
          state,
          message: 'Payment is already applied. Limits were not duplicated.',
        };
      }

      const state = await buildStateByClient(client, vkUserId);
      return {
        state,
        message: `Tariff "${plan.title}" activated. Limits were added to your account.`,
      };
    });

    res.json(result);
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('apply_purchase_once')) {
      return next(makeHttpError(503, 'DB migration required: apply_purchase_once() is missing.'));
    }
    next(error);
  }
});

app.post('/api/purchase/vk-chat', async (req, res, next) => {
  try {
    const parsedBody = parseBody(userSchema, req);
    const vkUserId = resolveRequestVkUserId(req, parsedBody);
    const planCode = String(req.body?.planCode || '').trim();
    const plan = PLAN_MAP.get(planCode);
    if (!plan) {
      throw makeHttpError(400, 'Unknown tariff.');
    }
    if (!isHttpsUrl(BUY_VK_WEBHOOK_URL)) {
      throw makeHttpError(503, 'BUY_VK_WEBHOOK_URL is missing.');
    }

    const response = await postWebhookJson(BUY_VK_WEBHOOK_URL, {
      vkUserId,
      planCode: plan.code,
      amount: toInt(plan.price, 0),
      title: plan.title,
      source: 'vk-miniapp',
      createdAt: nowIso(),
    });
    if (!response.ok) {
      throw makeHttpError(502, `VK webhook failed with status ${response.status}.`);
    }

    const payload = response.payload || {};
    if (payload.ok === false) {
      throw makeHttpError(502, String(payload.message || 'VK webhook rejected the request.'));
    }

    res.json({
      ok: true,
      message: String(payload.message || 'Payment link was sent to your VK dialog from the group account.'),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/topics/more', async (req, res, next) => {
  try {
    const parsedBody = parseBody(userSchema, req);
    const vkUserId = resolveRequestVkUserId(req, parsedBody);

    const result = await withTransaction(async (client) => {
      const state = await buildStateByClient(client, vkUserId);
      if (!state.user.selectedCommunityId) {
        throw makeHttpError(400, 'Link a community first.');
      }

      const remainingPosts = Math.max(0, state.user.postsTotal - state.user.postsUsed);
      const remainingThemeSlots = Math.max(0, state.user.themesCapacityTotal - state.topics.length);
      const count = Math.min(remainingPosts, remainingThemeSlots, getToPageEdge(state.topics.length));
      if (count <= 0) {
        throw makeHttpError(400, 'Topic limit reached. Choose a tariff to continue.');
      }

      const communityName = state.user.selectedCommunityName || 'community';
      const existingTitles = state.topics.map((topic) => topic.title);
      const generatedFromWebhook = await generateTopicsViaWebhook({
        vkUserId,
        communityName,
        communityUrl: state.user.selectedCommunityUrl,
        count,
        existingTitles,
      });
      const missing = Math.max(0, count - generatedFromWebhook.length);
      const generatedFallback =
        missing > 0
          ? createAutoTopics(
              missing,
              state.topics.length + generatedFromWebhook.length + 1,
              communityName,
              new Set([...existingTitles, ...generatedFromWebhook.map((item) => item.title)]),
            )
          : [];
      const generated = [
        ...generatedFromWebhook.map((topic, idx) => ({
          seqNo: state.topics.length + idx + 1,
          title: topic.title,
          short: topic.short,
          source: 'ai',
        })),
        ...generatedFallback,
      ];

      await insertTopics(client, vkUserId, state.user.selectedCommunityId, generated);
      await client.query(
        `UPDATE app_users
         SET posts_used = posts_used + $2, updated_at = now()
         WHERE vk_user_id = $1`,
        [vkUserId, count],
      );

      const nextState = await buildStateByClient(client, vkUserId);
      return { state: nextState, message: `Added topics: ${count}.` };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/topics/regenerate-page', async (req, res, next) => {
  try {
    const parsedBody = parseBody(regenerateSchema, req);
    const vkUserId = resolveRequestVkUserId(req, parsedBody);
    const safePage = normalizePage(parsedBody.page);

    const result = await withTransaction(async (client) => {
      const state = await buildStateByClient(client, vkUserId);
      if (!state.user.selectedCommunityId) {
        throw makeHttpError(400, 'Link a community first.');
      }

      const start = (safePage - 1) * PAGE_SIZE;
      const chunk = state.topics.slice(start, start + PAGE_SIZE);
      if (!chunk.length) {
        throw makeHttpError(400, 'No topics on this page to regenerate.');
      }

      const required = chunk.length;
      const remainingIdeaRegens = Math.max(0, state.user.ideaRegenTotal - state.user.ideaRegenUsed);
      if (remainingIdeaRegens < required) {
        throw makeHttpError(
          400,
          `Not enough topic regens. Required: ${required}, available: ${remainingIdeaRegens}.`,
        );
      }

      const titlesOutsideChunk = state.topics
        .filter((topic) => !chunk.some((item) => item.id === topic.id))
        .map((topic) => topic.title);
      const generatedFromWebhook = await generateTopicsViaWebhook({
        vkUserId,
        communityName: state.user.selectedCommunityName || 'community',
        communityUrl: state.user.selectedCommunityUrl,
        count: required,
        existingTitles: titlesOutsideChunk,
      });
      const missing = Math.max(0, required - generatedFromWebhook.length);
      const generatedFallback =
        missing > 0
          ? createAutoTopics(
              missing,
              1,
              state.user.selectedCommunityName || 'community',
              new Set([...titlesOutsideChunk, ...generatedFromWebhook.map((item) => item.title)]),
            )
          : [];
      const generated = [
        ...generatedFromWebhook.map((topic) => ({
          title: topic.title,
          short: topic.short,
          source: 'ai',
        })),
        ...generatedFallback.map((topic) => ({
          title: topic.title,
          short: topic.short,
          source: topic.source || 'auto',
        })),
      ].slice(0, required);

      for (let idx = 0; idx < chunk.length; idx += 1) {
        const original = chunk[idx];
        const replacement = generated[idx];
        await client.query(
          `UPDATE topics
           SET title = $3, short = $4, source = $5, updated_at = now()
           WHERE vk_user_id = $1 AND id = $2`,
          [
            vkUserId,
            toInt(original.id, 0),
            clampSingleLine(replacement.title, 220),
            clampSingleLine(replacement.short, 500),
            String(replacement.source || 'ai'),
          ],
        );
      }

      await deleteTopicPostVariants(client, chunk.map((item) => item.id));
      await client.query(
        `UPDATE app_users
         SET idea_regen_used = idea_regen_used + $2, updated_at = now()
         WHERE vk_user_id = $1`,
        [vkUserId, required],
      );

      const nextState = await buildStateByClient(client, vkUserId);
      return { state: nextState, message: `Regenerated topics: ${required}.` };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/topics/custom', async (req, res, next) => {
  try {
    const parsedBody = parseBody(customTopicSchema, req);
    const vkUserId = resolveRequestVkUserId(req, parsedBody);
    const cleanTitle = clampSingleLine(parsedBody.title, 220);
    if (!cleanTitle) {
      throw makeHttpError(400, 'Enter a custom topic title.');
    }

    const result = await withTransaction(async (client) => {
      const state = await buildStateByClient(client, vkUserId);
      if (!state.user.selectedCommunityId) {
        throw makeHttpError(400, 'Link a community first.');
      }

      const remainingPosts = Math.max(0, state.user.postsTotal - state.user.postsUsed);
      const remainingThemeSlots = Math.max(0, state.user.themesCapacityTotal - state.topics.length);
      if (remainingPosts <= 0 || remainingThemeSlots <= 0) {
        throw makeHttpError(400, 'Topic limit reached. Choose a tariff to continue.');
      }

      await client.query(
        `INSERT INTO topics (vk_user_id, community_id, seq_no, title, short, source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'custom', now(), now())`,
        [
          vkUserId,
          state.user.selectedCommunityId,
          state.topics.length + 1,
          cleanTitle,
          'Custom topic added by user.',
        ],
      );
      await client.query(
        `UPDATE app_users
         SET posts_used = posts_used + 1, updated_at = now()
         WHERE vk_user_id = $1`,
        [vkUserId],
      );

      const nextState = await buildStateByClient(client, vkUserId);
      return { state: nextState, message: 'Custom topic was added to content plan.' };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/topics/posts', async (req, res, next) => {
  try {
    const parsedBody = parseBody(topicPostsSchema, req);
    const vkUserId = resolveRequestVkUserId(req, parsedBody);

    const result = await withTransaction(async (client) => {
      const state = await buildStateByClient(client, vkUserId);
      const topic = await findTopicById(client, vkUserId, parsedBody.topicId);
      if (!topic) {
        throw makeHttpError(404, 'Topic not found.');
      }

      const topicId = toInt(topic.id, 0);
      const persistedPosts = await loadTopicPostVariants(client, topicId);
      if (persistedPosts.length >= 3) {
        return {
          topic,
          posts: persistedPosts.slice(0, 3),
          message: `Showing saved post variants for topic "${topic.title}".`,
        };
      }

      const aiPosts = await generatePostsViaWebhook({ vkUserId, topic, state });
      const fallbackPosts = [1, 2, 3].map((variant) => ({
        variant,
        text: buildPostVariant(topic, variant, state.user.selectedCommunityName || 'your community'),
      }));
      const posts = aiPosts.length >= 3 ? aiPosts : fallbackPosts;
      const source = aiPosts.length >= 3 ? 'ai' : 'fallback';
      await saveTopicPostVariants(client, topicId, posts, source);

      return {
        topic,
        posts,
        message: `Generated 3 post variants for topic "${topic.title}".`,
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/topics/posts/regenerate', async (req, res, next) => {
  try {
    const parsedBody = parseBody(topicPostsSchema, req);
    const vkUserId = resolveRequestVkUserId(req, parsedBody);

    const result = await withTransaction(async (client) => {
      const state = await buildStateByClient(client, vkUserId);
      const topic = await findTopicById(client, vkUserId, parsedBody.topicId);
      if (!topic) {
        throw makeHttpError(404, 'Topic not found.');
      }

      const remainingTextRegens = Math.max(0, state.user.textRegenTotal - state.user.textRegenUsed);
      if (remainingTextRegens <= 0) {
        throw makeHttpError(400, 'Text regen limit reached. Choose a tariff to continue.');
      }

      const topicId = toInt(topic.id, 0);
      const aiPosts = await generatePostsViaWebhook({ vkUserId, topic, state });
      const fallbackPosts = [1, 2, 3].map((variant) => ({
        variant,
        text: buildPostVariant(topic, variant, state.user.selectedCommunityName || 'your community'),
      }));
      const posts = aiPosts.length >= 3 ? aiPosts : fallbackPosts;
      const source = aiPosts.length >= 3 ? 'ai' : 'fallback';
      await saveTopicPostVariants(client, topicId, posts, source);
      await client.query(
        `UPDATE app_users
         SET text_regen_used = text_regen_used + 1, updated_at = now()
         WHERE vk_user_id = $1`,
        [vkUserId],
      );

      const nextState = await buildStateByClient(client, vkUserId);
      return {
        topic,
        posts,
        state: nextState,
        message: `Posts for topic "${topic.title}" were regenerated and saved.`,
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/support', async (req, res, next) => {
  try {
    const parsedBody = parseBody(supportSchema, req);
    const vkUserId = resolveRequestVkUserId(req, parsedBody);
    const cleanText = clampPostBody(parsedBody.text, MAX_SUPPORT_TEXT_LENGTH);
    if (!cleanText) {
      throw makeHttpError(400, 'Support message is empty.');
    }

    await withTransaction(async (client) => {
      await ensureUser(client, vkUserId);
      await client.query(
        `INSERT INTO support_requests (vk_user_id, text, created_at)
         VALUES ($1, $2, now())`,
        [vkUserId, cleanText],
      );
    });

    if (!isHttpsUrl(SUPPORT_WEBHOOK_URL)) {
      res.json({
        ok: false,
        message:
          'Support request saved, but Telegram forwarding webhook is not configured on backend.',
      });
      return;
    }

    const response = await postWebhookJson(SUPPORT_WEBHOOK_URL, {
      vkUserId: String(vkUserId),
      text: cleanText,
      source: 'vk-miniapp',
      createdAt: nowIso(),
    });
    const payload = response.payload;
    if (!response.ok) {
      const reason =
        (payload && typeof payload.message === 'string' && payload.message) || `HTTP ${response.status}`;
      throw makeHttpError(502, `Support request saved, but forwarding failed: ${reason}`);
    }

    const forwarded = Boolean(payload && payload.forwarded === true);
    if (!forwarded) {
      const reason =
        (payload && typeof payload.message === 'string' && payload.message) ||
        'Webhook did not confirm forwarding.';
      throw makeHttpError(502, `Support request saved, but forwarding failed: ${reason}`);
    }

    res.json({
      ok: true,
      message: 'Request registered. Support manager will contact you shortly.',
    });
  } catch (error) {
    next(error);
  }
});

function parseVkUserRef(raw) {
  const input = String(raw || '').trim();
  if (!input) {
    throw makeHttpError(400, 'User reference is required.');
  }
  if (input.length > 180) {
    throw makeHttpError(400, 'User reference is too long.');
  }

  if (/^\d+$/.test(input)) {
    return parseVkUserId(input);
  }

  const idAlias = input.match(/^id(\d+)$/i);
  if (idAlias) {
    return parseVkUserId(idAlias[1]);
  }

  const normalizedUrl = normalizeVkUrl(input);
  if (normalizedUrl) {
    const screenName = extractCommunityName(normalizedUrl);
    const match = screenName.match(/^id(\d+)$/i);
    if (match) {
      return parseVkUserId(match[1]);
    }
    if (/^\d+$/.test(screenName)) {
      return parseVkUserId(screenName);
    }
  }

  throw makeHttpError(400, 'Failed to parse VK user id from reference.');
}

function parseGroupRef(raw) {
  const input = String(raw || '').trim();
  if (!input) {
    throw makeHttpError(400, 'Community reference is required.');
  }
  if (input.length > 180) {
    throw makeHttpError(400, 'Community reference is too long.');
  }

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
  if (!clean) {
    throw makeHttpError(400, 'Invalid community reference.');
  }
  if (!/^[A-Za-z0-9_.-]{2,120}$/.test(clean)) {
    throw makeHttpError(400, 'Invalid community screen name format.');
  }

  return {
    normalizedUrl: `https://vk.com/${clean}`,
    screenName: clean,
  };
}

function normalizePromoCode(raw) {
  const code = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (!code || code.length < 3) {
    throw makeHttpError(400, 'Promo code must contain at least 3 characters.');
  }
  return code.slice(0, 64);
}

function normalizePromoPlan(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (!value || value === 'all' || value === '*') {
    return 'all';
  }
  if (value === 'free' || PLAN_MAP.has(value)) {
    return value;
  }
  throw makeHttpError(400, 'Invalid promo allowed plan.');
}

function normalizeDiscountPercent(value) {
  const percent = Math.max(1, Math.min(95, toInt(value, 0)));
  if (!Number.isFinite(percent) || percent < 1) {
    throw makeHttpError(400, 'Promo discount must be between 1 and 95.');
  }
  return percent;
}

function promoExpiresAtFromDays(days) {
  if (days == null) {
    return null;
  }
  const safeDays = Math.max(1, toInt(days, 1));
  const date = new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

function limitsByPlan(planCode) {
  if (planCode === 'free') {
    return { posts: 3, themes: 3, idea: 0, text: 0 };
  }
  const plan = PLAN_MAP.get(planCode);
  if (!plan) {
    throw makeHttpError(400, `Unknown plan: ${planCode}`);
  }
  return {
    posts: toInt(plan.posts, 0),
    themes: toInt(plan.themes, 0),
    idea: toInt(plan.ideaRegen, 0),
    text: toInt(plan.textRegen, 0),
  };
}

function mapAdminRow(row) {
  const activeRaw = row.is_active;
  const isActive =
    activeRaw === true || activeRaw === 1 || activeRaw === '1' || String(activeRaw || '').toLowerCase() === 'true';
  return {
    vkUserId: String(row.vk_user_id),
    role: String(row.role || 'admin').toLowerCase(),
    isActive,
    addedBy: String(row.added_by || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function mapPromoRow(row) {
  const activeRaw = row.is_active;
  const isActive =
    activeRaw === true || activeRaw === 1 || activeRaw === '1' || String(activeRaw || '').toLowerCase() === 'true';
  return {
    code: String(row.code || ''),
    discountPercent: toInt(row.discount_percent, 0),
    isActive,
    maxUses: row.max_uses == null ? null : toInt(row.max_uses, 0),
    usedCount: toInt(row.used_count, 0),
    allowedPlan: String(row.allowed_plan || 'all'),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    note: String(row.note || ''),
    createdBy: String(row.created_by || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

async function ensureAdminByClient(client, vkUserId) {
  let row = null;
  try {
    const res = await client.query(
      `SELECT vk_user_id, role, is_active, added_by, updated_at
       FROM vk_bot_admins
       WHERE vk_user_id = $1
       LIMIT 1`,
      [String(vkUserId)],
    );
    row = res.rows[0] || null;
  } catch (error) {
    if (error?.code === '42P01') {
      throw makeHttpError(503, 'Admin tables are missing. Run backend migration first.');
    }
    throw error;
  }

  if (!row && ROOT_ADMIN_VK_IDS.has(String(vkUserId))) {
    await client.query(
      `INSERT INTO vk_bot_admins (vk_user_id, role, is_active, added_by, created_at, updated_at)
       VALUES ($1, 'owner', 1, $1, now(), now())
       ON CONFLICT (vk_user_id)
       DO UPDATE SET role = 'owner', is_active = 1, updated_at = now()`,
      [String(vkUserId)],
    );
    row = {
      vk_user_id: String(vkUserId),
      role: 'owner',
      is_active: 1,
      added_by: String(vkUserId),
      updated_at: nowIso(),
    };
  }

  const mapped = row ? mapAdminRow(row) : null;
  if (!mapped || !mapped.isActive) {
    throw makeHttpError(403, 'Admin access denied.');
  }

  return {
    vkUserId: String(vkUserId),
    role: String(mapped.role || 'admin').toLowerCase(),
    isAdmin: true,
    canManageAdmins: String(mapped.role || '').toLowerCase() === 'owner',
  };
}

app.post('/api/admin/me', async (req, res, next) => {
  try {
    const parsedBody = parseBody(userSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      return { me, message: `Role: ${me.role}.` };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/admins/list', async (req, res, next) => {
  try {
    const parsedBody = parseBody(userSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      const rows = await client.query(
        `SELECT vk_user_id, role, is_active, added_by, updated_at
         FROM vk_bot_admins
         ORDER BY vk_user_id ASC`,
      );
      return {
        me,
        admins: rows.rows.map(mapAdminRow),
        message: `Admins: ${rows.rows.length}.`,
      };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/admins/add', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminRoleSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const targetVkId = parseVkUserRef(parsedBody.targetUserRef);
    const role = String(parsedBody.role || 'admin').trim().toLowerCase();
    if (!['admin', 'owner'].includes(role)) {
      throw makeHttpError(400, 'Role must be admin or owner.');
    }

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      if (!me.canManageAdmins) {
        throw makeHttpError(403, 'Only owner can manage admin list.');
      }

      await client.query(
        `INSERT INTO vk_bot_admins (vk_user_id, role, is_active, added_by, created_at, updated_at)
         VALUES ($1, $2, 1, $3, now(), now())
         ON CONFLICT (vk_user_id)
         DO UPDATE SET role = EXCLUDED.role, is_active = 1, added_by = EXCLUDED.added_by, updated_at = now()`,
        [String(targetVkId), role, String(actorVkId)],
      );
      return { me, message: `Admin ${targetVkId} granted role ${role}.` };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/admins/remove', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminTargetSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const targetVkId = parseVkUserRef(parsedBody.targetUserRef);

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      if (!me.canManageAdmins) {
        throw makeHttpError(403, 'Only owner can manage admin list.');
      }

      const targetRes = await client.query(
        `SELECT role FROM vk_bot_admins WHERE vk_user_id = $1 LIMIT 1`,
        [String(targetVkId)],
      );
      const targetRole = String(targetRes.rows[0]?.role || '').toLowerCase();
      if (targetRole === 'owner') {
        throw makeHttpError(400, 'Owner role cannot be removed.');
      }

      await client.query(
        `UPDATE vk_bot_admins
         SET is_active = 0, updated_at = now()
         WHERE vk_user_id = $1`,
        [String(targetVkId)],
      );

      return { me, message: `Admin ${targetVkId} was deactivated.` };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/get', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminTargetSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const targetVkId = parseVkUserRef(parsedBody.targetUserRef);

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);

      const userRes = await client.query(
        `SELECT vk_user_id, plan_code, posts_total, posts_used, themes_capacity_total,
                idea_regen_total, idea_regen_used, text_regen_total, text_regen_used
         FROM app_users
         WHERE vk_user_id = $1
         LIMIT 1`,
        [targetVkId],
      );

      if (!userRes.rows[0]) {
        return {
          me,
          userSnapshot: {
            vkUserId: String(targetVkId),
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
        };
      }

      const user = userRes.rows[0];
      const community = await findCommunityByOwner(client, targetVkId);
      const [topicsCountRes, purchasesCountRes, supportCountRes] = await Promise.all([
        client.query(`SELECT COUNT(*)::int AS c FROM topics WHERE vk_user_id = $1`, [targetVkId]),
        client.query(`SELECT COUNT(*)::int AS c FROM purchases WHERE vk_user_id = $1`, [targetVkId]),
        client.query(`SELECT COUNT(*)::int AS c FROM support_requests WHERE vk_user_id = $1`, [targetVkId]),
      ]);

      const userSnapshot = {
        vkUserId: String(targetVkId),
        exists: true,
        planCode: String(user.plan_code || 'free'),
        postsTotal: toInt(user.posts_total, 0),
        postsUsed: toInt(user.posts_used, 0),
        themesCapacityTotal: toInt(user.themes_capacity_total, 0),
        ideaRegenTotal: toInt(user.idea_regen_total, 0),
        ideaRegenUsed: toInt(user.idea_regen_used, 0),
        textRegenTotal: toInt(user.text_regen_total, 0),
        textRegenUsed: toInt(user.text_regen_used, 0),
        selectedCommunityUrl: community?.community_url || '',
        selectedCommunityName: community?.community_screen || '',
        topicsCount: toInt(topicsCountRes.rows[0]?.c, 0),
        purchasesCount: toInt(purchasesCountRes.rows[0]?.c, 0),
        supportCount: toInt(supportCountRes.rows[0]?.c, 0),
      };

      return {
        me,
        userSnapshot,
        message: `User snapshot loaded for ${targetVkId}.`,
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/set-plan', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminPlanSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const targetVkId = parseVkUserRef(parsedBody.targetUserRef);
    const planCode = String(parsedBody.planCode || '').trim();
    const limits = limitsByPlan(planCode);

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      await ensureUser(client, targetVkId);

      await client.query(
        `UPDATE app_users
         SET plan_code = $2,
             posts_total = $3,
             posts_used = 0,
             themes_capacity_total = $4,
             idea_regen_total = $5,
             idea_regen_used = 0,
             text_regen_total = $6,
             text_regen_used = 0,
             updated_at = now()
         WHERE vk_user_id = $1`,
        [targetVkId, planCode, limits.posts, limits.themes, limits.idea, limits.text],
      );

      if (planCode !== 'free') {
        await client.query(
          `INSERT INTO purchases (vk_user_id, plan_code, amount_rub, created_at)
           VALUES ($1, $2, 0, now())`,
          [targetVkId, planCode],
        );
      }

      return { me, message: `Plan ${planCode} set for user ${targetVkId}.` };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/reset-usage', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminTargetSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const targetVkId = parseVkUserRef(parsedBody.targetUserRef);

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      await ensureUser(client, targetVkId);
      await client.query(
        `UPDATE app_users
         SET posts_used = 0, idea_regen_used = 0, text_regen_used = 0, updated_at = now()
         WHERE vk_user_id = $1`,
        [targetVkId],
      );
      return { me, message: `Usage counters reset for user ${targetVkId}.` };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/limits-set', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminLimitsSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const targetVkId = parseVkUserRef(parsedBody.targetUserRef);
    const limits = parsedBody.limits || {};

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      const userRes = await client.query(
        `SELECT posts_used, idea_regen_used, text_regen_used FROM app_users WHERE vk_user_id = $1 LIMIT 1`,
        [targetVkId],
      );
      if (!userRes.rows[0]) {
        throw makeHttpError(404, `User ${targetVkId} not found.`);
      }
      const user = userRes.rows[0];

      const update = { updated_at: nowIso() };
      if (typeof limits.posts === 'number') {
        const nextPosts = Math.max(0, toInt(limits.posts, 0));
        update.posts_total = nextPosts;
        update.posts_used = Math.min(toInt(user.posts_used, 0), nextPosts);
      }
      if (typeof limits.themes === 'number') {
        update.themes_capacity_total = Math.max(0, toInt(limits.themes, 0));
      }
      if (typeof limits.idea === 'number') {
        const nextIdea = Math.max(0, toInt(limits.idea, 0));
        update.idea_regen_total = nextIdea;
        update.idea_regen_used = Math.min(toInt(user.idea_regen_used, 0), nextIdea);
      }
      if (typeof limits.text === 'number') {
        const nextText = Math.max(0, toInt(limits.text, 0));
        update.text_regen_total = nextText;
        update.text_regen_used = Math.min(toInt(user.text_regen_used, 0), nextText);
      }

      if (Object.keys(update).length <= 1) {
        throw makeHttpError(400, 'Provide at least one limit to set.');
      }

      const columns = Object.keys(update);
      const values = columns.map((key) => update[key]);
      const setSql = columns.map((key, idx) => `${key} = $${idx + 2}`).join(', ');
      await client.query(`UPDATE app_users SET ${setSql} WHERE vk_user_id = $1`, [targetVkId, ...values]);

      return { me, message: `Limits were set for user ${targetVkId}.` };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/limits-add', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminLimitsSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const targetVkId = parseVkUserRef(parsedBody.targetUserRef);
    const limits = parsedBody.limits || {};

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      const userRes = await client.query(
        `SELECT posts_total, themes_capacity_total, idea_regen_total, text_regen_total
         FROM app_users
         WHERE vk_user_id = $1
         LIMIT 1`,
        [targetVkId],
      );
      if (!userRes.rows[0]) {
        throw makeHttpError(404, `User ${targetVkId} not found.`);
      }
      const user = userRes.rows[0];

      const hasChanges =
        typeof limits.posts === 'number' ||
        typeof limits.themes === 'number' ||
        typeof limits.idea === 'number' ||
        typeof limits.text === 'number';
      if (!hasChanges) {
        throw makeHttpError(400, 'Provide at least one limit to add.');
      }

      const nextPostsTotal = Math.max(0, toInt(user.posts_total, 0) + toInt(limits.posts, 0));
      const nextThemesTotal = Math.max(0, toInt(user.themes_capacity_total, 0) + toInt(limits.themes, 0));
      const nextIdeaTotal = Math.max(0, toInt(user.idea_regen_total, 0) + toInt(limits.idea, 0));
      const nextTextTotal = Math.max(0, toInt(user.text_regen_total, 0) + toInt(limits.text, 0));

      await client.query(
        `UPDATE app_users
         SET posts_total = $2,
             posts_used = LEAST(posts_used, $2),
             themes_capacity_total = $3,
             idea_regen_total = $4,
             idea_regen_used = LEAST(idea_regen_used, $4),
             text_regen_total = $5,
             text_regen_used = LEAST(text_regen_used, $5),
             updated_at = now()
         WHERE vk_user_id = $1`,
        [targetVkId, nextPostsTotal, nextThemesTotal, nextIdeaTotal, nextTextTotal],
      );

      return { me, message: `Limits were added for user ${targetVkId}.` };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/unlink', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminTargetSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const targetVkId = parseVkUserRef(parsedBody.targetUserRef);

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      await ensureUser(client, targetVkId);
      const community = await findCommunityByOwner(client, targetVkId);
      if (community) {
        await client.query('DELETE FROM communities WHERE id = $1', [toInt(community.id, 0)]);
      }
      await client.query(
        `UPDATE app_users SET selected_community_id = NULL, updated_at = now() WHERE vk_user_id = $1`,
        [targetVkId],
      );
      return { me, message: `Community unlinked for user ${targetVkId}.` };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/groups/unlink', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminGroupSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const parsedGroup = parseGroupRef(parsedBody.groupRef);

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      let community = await findCommunityByUrl(client, parsedGroup.normalizedUrl);
      if (!community) {
        community = await findCommunityByScreen(client, parsedGroup.screenName);
      }
      if (!community) {
        throw makeHttpError(404, 'Community not found.');
      }

      const ownerId = String(community.owner_vk_user_id || '');
      await client.query('DELETE FROM communities WHERE id = $1', [toInt(community.id, 0)]);
      await client.query(
        `UPDATE app_users SET selected_community_id = NULL, updated_at = now() WHERE vk_user_id = $1`,
        [ownerId],
      );

      return { me, message: `Community ${community.community_url} unlinked (owner: ${ownerId}).` };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/reset', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminTargetSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const targetVkId = parseVkUserRef(parsedBody.targetUserRef);

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      await ensureUser(client, targetVkId);
      const community = await findCommunityByOwner(client, targetVkId);
      if (community) {
        await client.query('DELETE FROM communities WHERE id = $1', [toInt(community.id, 0)]);
      }

      await client.query(`DELETE FROM topics WHERE vk_user_id = $1`, [targetVkId]);
      await client.query(`DELETE FROM purchases WHERE vk_user_id = $1`, [targetVkId]);
      await client.query(`DELETE FROM support_requests WHERE vk_user_id = $1`, [targetVkId]);
      await client.query(`DELETE FROM vk_bot_promo_uses WHERE vk_user_id = $1`, [String(targetVkId)]);

      await client.query(
        `UPDATE app_users
         SET plan_code = 'free',
             posts_total = 3,
             posts_used = 0,
             themes_capacity_total = 3,
             idea_regen_total = 0,
             idea_regen_used = 0,
             text_regen_total = 0,
             text_regen_used = 0,
             selected_community_id = NULL,
             updated_at = now()
         WHERE vk_user_id = $1`,
        [targetVkId],
      );

      return { me, message: `User ${targetVkId} reset to FREE.` };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/forget', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminTargetSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const targetVkId = parseVkUserRef(parsedBody.targetUserRef);

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      await client.query(`DELETE FROM app_users WHERE vk_user_id = $1`, [targetVkId]);
      await client.query(`DELETE FROM vk_bot_users WHERE vk_user_id = $1`, [String(targetVkId)]);
      await client.query(`DELETE FROM vk_bot_promo_uses WHERE vk_user_id = $1`, [String(targetVkId)]);
      return { me, message: `User ${targetVkId} was fully deleted.` };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/promos/list', async (req, res, next) => {
  try {
    const parsedBody = parseBody(userSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      const rows = await client.query(
        `SELECT code, discount_percent, is_active, max_uses, used_count, allowed_plan, expires_at, note, created_by, updated_at
         FROM vk_bot_promos
         ORDER BY code ASC`,
      );
      return {
        me,
        promos: rows.rows.map(mapPromoRow),
        message: `Promo codes: ${rows.rows.length}.`,
      };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/promos/add', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminPromoAddSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const input = parsedBody.input || {};
    const code = normalizePromoCode(input.code);
    const percent = normalizeDiscountPercent(toInt(input.percent, 0));
    const maxUses = input.maxUses == null ? null : Math.max(1, toInt(input.maxUses, 1));
    const allowedPlan = normalizePromoPlan(input.allowedPlan);
    const expiresAt = promoExpiresAtFromDays(input.days);
    const note = String(input.note || '').trim();

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      await client.query(
        `INSERT INTO vk_bot_promos
         (code, discount_percent, is_active, max_uses, used_count, allowed_plan, expires_at, note, created_by, created_at, updated_at)
         VALUES ($1, $2, 1, $3, 0, $4, $5, $6, $7, now(), now())`,
        [code, percent, maxUses, allowedPlan, expiresAt, note, String(actorVkId)],
      );
      return { me, message: `Promo code ${code} created.` };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/promos/set', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminPromoSetSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const input = parsedBody.input || {};
    const code = normalizePromoCode(input.code);

    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      const update = { updated_at: nowIso() };
      if (typeof input.percent === 'number') {
        update.discount_percent = normalizeDiscountPercent(input.percent);
      }
      if (input.maxUses !== undefined) {
        update.max_uses = input.maxUses == null ? null : Math.max(1, toInt(input.maxUses, 1));
      }
      if (input.allowedPlan !== undefined) {
        update.allowed_plan = normalizePromoPlan(input.allowedPlan);
      }
      if (input.days !== undefined) {
        update.expires_at = promoExpiresAtFromDays(input.days);
      }
      if (input.note !== undefined) {
        update.note = String(input.note || '').trim();
      }
      if (typeof input.active === 'boolean') {
        update.is_active = input.active ? 1 : 0;
      }
      if (Object.keys(update).length <= 1) {
        throw makeHttpError(400, 'No fields provided for promo update.');
      }

      const columns = Object.keys(update);
      const values = columns.map((key) => update[key]);
      const setSql = columns.map((key, idx) => `${key} = $${idx + 2}`).join(', ');
      const updateRes = await client.query(
        `UPDATE vk_bot_promos SET ${setSql} WHERE code = $1 RETURNING code`,
        [code, ...values],
      );
      if (!updateRes.rows[0]) {
        throw makeHttpError(404, 'Promo code not found.');
      }
      return { me, message: `Promo code ${code} updated.` };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/promos/delete', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminPromoCodeSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const code = normalizePromoCode(parsedBody.code);
    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      await client.query(`DELETE FROM vk_bot_promos WHERE code = $1`, [code]);
      return { me, message: `Promo code ${code} deleted.` };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/promos/toggle', async (req, res, next) => {
  try {
    const parsedBody = parseBody(adminPromoToggleSchema, req);
    const actorVkId = resolveRequestVkUserId(req, parsedBody);
    const code = normalizePromoCode(parsedBody.code);
    const active = Boolean(parsedBody.active);
    const result = await withTransaction(async (client) => {
      const me = await ensureAdminByClient(client, actorVkId);
      const updateRes = await client.query(
        `UPDATE vk_bot_promos
         SET is_active = $2, updated_at = now()
         WHERE code = $1
         RETURNING code`,
        [code, active ? 1 : 0],
      );
      if (!updateRes.rows[0]) {
        throw makeHttpError(404, 'Promo code not found.');
      }
      return { me, message: `Promo code ${code} ${active ? 'enabled' : 'disabled'}.` };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = Number(error?.status || 500);
  const message = String(error?.message || 'Internal server error.');
  if (status >= 500) {
    console.error('[backend-error]', message);
  }
  res.status(status).json({
    ok: false,
    message,
  });
});

const server = app.listen(PORT, () => {
  console.log(`VK Mini App backend listening on :${PORT}`);
});

async function shutdown(signal) {
  try {
    console.log(`Received ${signal}, shutting down...`);
    server.close(async () => {
      try {
        await pool.end();
      } finally {
        process.exit(0);
      }
    });
  } catch {
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
