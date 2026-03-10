import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { pool, withTransaction } from './db.js';
import { PLAN_CATALOG, PLAN_MAP } from './plans.js';
import {
  PAGE_SIZE,
  createAutoTopics,
  extractCommunityName,
  getToPageEdge,
  normalizeVkUrl,
  parseVkUserId,
  toInt,
} from './utils.js';

dotenv.config();

const app = express();
app.use(express.json({ limit: '512kb' }));

const corsOrigins = String(
  process.env.CORS_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173,https://site-host-sell.github.io',
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
  }),
);

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

async function ensureUser(client, vkUserId) {
  await client.query(
    `INSERT INTO app_users (vk_user_id) VALUES ($1)
     ON CONFLICT (vk_user_id) DO NOTHING`,
    [vkUserId],
  );
  const userRes = await client.query('SELECT * FROM app_users WHERE vk_user_id = $1', [vkUserId]);
  return mapUserRow(userRes.rows[0]);
}

async function findCommunityByOwner(client, vkUserId) {
  const res = await client.query(
    `SELECT id, community_url, community_screen, owner_vk_user_id
     FROM communities
     WHERE owner_vk_user_id = $1`,
    [vkUserId],
  );
  return res.rows[0] || null;
}

async function findCommunityByUrl(client, communityUrl) {
  const res = await client.query(
    `SELECT id, community_url, community_screen, owner_vk_user_id
     FROM communities
     WHERE community_url = $1`,
    [communityUrl],
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
  return res.rows.map((row) => ({
    id: String(row.id),
    seqNo: toInt(row.seq_no, 0),
    title: String(row.title || ''),
    short: String(row.short || ''),
    source: String(row.source || 'auto'),
  }));
}

async function insertTopics(client, vkUserId, communityId, topics) {
  for (const topic of topics) {
    await client.query(
      `INSERT INTO topics (vk_user_id, community_id, seq_no, title, short, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (vk_user_id, seq_no)
       DO UPDATE SET title = EXCLUDED.title, short = EXCLUDED.short, source = EXCLUDED.source, updated_at = now()`,
      [
        vkUserId,
        communityId,
        topic.seqNo,
        String(topic.title || ''),
        String(topic.short || ''),
        String(topic.source || 'auto'),
      ],
    );
  }
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
  const topics = await listTopics(client, vkUserId);
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

function makeHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePage(pageInput) {
  return Math.max(1, toInt(pageInput, 1));
}

const connectCommunitySchema = z.object({
  vkUserId: z.union([z.string(), z.number()]),
  communityUrl: z.string().min(1),
});

const userSchema = z.object({
  vkUserId: z.union([z.string(), z.number()]),
});

const purchaseSchema = z.object({
  vkUserId: z.union([z.string(), z.number()]),
  planCode: z.string().min(1),
});

const regenerateSchema = z.object({
  vkUserId: z.union([z.string(), z.number()]),
  page: z.union([z.number(), z.string()]).optional(),
});

const customTopicSchema = z.object({
  vkUserId: z.union([z.string(), z.number()]),
  title: z.string().min(3).max(300),
});

const supportSchema = z.object({
  vkUserId: z.union([z.string(), z.number()]),
  text: z.string().min(3).max(4000),
});

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

app.get('/api/plans', (_req, res) => {
  res.json({ plans: PLAN_CATALOG });
});

app.get('/api/state', async (req, res) => {
  const vkUserId = parseVkUserId(req.query.vkUserId);
  const state = await withTransaction((client) => buildStateByClient(client, vkUserId));
  res.json({ state });
});

app.post('/api/community/connect', async (req, res) => {
  const parsed = connectCommunitySchema.parse(req.body);
  const vkUserId = parseVkUserId(parsed.vkUserId);
  const normalizedUrl = normalizeVkUrl(parsed.communityUrl);
  if (!normalizedUrl) {
    throw makeHttpError(400, 'Укажите корректную ссылку на VK-сообщество.');
  }

  const result = await withTransaction(async (client) => {
    await ensureUser(client, vkUserId);

    const byUrl = await findCommunityByUrl(client, normalizedUrl);
    if (byUrl && String(byUrl.owner_vk_user_id) !== vkUserId) {
      throw makeHttpError(
        409,
        'Это сообщество уже подключено к другому аккаунту. Одно сообщество можно привязать только к одному пользователю.',
      );
    }

    const current = await findCommunityByOwner(client, vkUserId);
    if (current && String(current.community_url) !== normalizedUrl) {
      await client.query('DELETE FROM communities WHERE id = $1', [toInt(current.id, 0)]);
      await client.query('DELETE FROM topics WHERE vk_user_id = $1', [vkUserId]);
      await client.query(
        `UPDATE app_users SET selected_community_id = NULL, updated_at = now() WHERE vk_user_id = $1`,
        [vkUserId],
      );
    }

    const communityScreen = extractCommunityName(normalizedUrl);
    const upsertCommunity = await client.query(
      `INSERT INTO communities (community_url, community_screen, owner_vk_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_vk_user_id)
       DO UPDATE SET community_url = EXCLUDED.community_url, community_screen = EXCLUDED.community_screen, updated_at = now()
       RETURNING id`,
      [normalizedUrl, communityScreen, vkUserId],
    );

    const communityId = toInt(upsertCommunity.rows[0].id, 0);
    await client.query(
      `UPDATE app_users SET selected_community_id = $2, updated_at = now() WHERE vk_user_id = $1`,
      [vkUserId, communityId],
    );

    const currentTopics = await listTopics(client, vkUserId);
    let generatedCount = 0;
    if (currentTopics.length === 0) {
      const user = await ensureUser(client, vkUserId);
      const remainingPosts = Math.max(0, user.postsTotal - user.postsUsed);
      const remainingThemeSlots = Math.max(0, user.themesCapacityTotal - currentTopics.length);
      generatedCount = Math.min(3, remainingPosts, remainingThemeSlots);
      if (generatedCount > 0) {
        const generated = createAutoTopics(generatedCount, 1, communityScreen);
        await insertTopics(client, vkUserId, communityId, generated);
        await client.query(
          `UPDATE app_users SET posts_used = posts_used + $2, updated_at = now() WHERE vk_user_id = $1`,
          [vkUserId, generatedCount],
        );
      }
    }

    const state = await buildStateByClient(client, vkUserId);
    return { state, generatedCount };
  });

  res.json({
    state: result.state,
    message:
      result.generatedCount > 0
        ? `Сообщество подключено. Сгенерировано стартовых тем: ${result.generatedCount}.`
        : 'Сообщество подключено. Лимит тем исчерпан, выберите тариф для продолжения.',
  });
});

app.post('/api/community/disconnect', async (req, res) => {
  const parsed = userSchema.parse(req.body);
  const vkUserId = parseVkUserId(parsed.vkUserId);

  const state = await withTransaction(async (client) => {
    await ensureUser(client, vkUserId);
    const community = await findCommunityByOwner(client, vkUserId);
    if (community) {
      await client.query('DELETE FROM communities WHERE id = $1', [toInt(community.id, 0)]);
    }
    await client.query('DELETE FROM topics WHERE vk_user_id = $1', [vkUserId]);
    await client.query(
      `UPDATE app_users SET selected_community_id = NULL, updated_at = now() WHERE vk_user_id = $1`,
      [vkUserId],
    );
    return buildStateByClient(client, vkUserId);
  });

  res.json({
    state,
    message: 'Сообщество отключено. Теперь можно привязать новое.',
  });
});

app.post('/api/plans/purchase', async (req, res) => {
  const parsed = purchaseSchema.parse(req.body);
  const vkUserId = parseVkUserId(parsed.vkUserId);
  const planCode = String(parsed.planCode || '').trim();
  const plan = PLAN_MAP.get(planCode);
  if (!plan) {
    throw makeHttpError(400, 'Неизвестный тариф.');
  }

  const state = await withTransaction(async (client) => {
    await ensureUser(client, vkUserId);
    await client.query(
      `UPDATE app_users
       SET plan_code = $2,
           posts_total = posts_total + $3,
           themes_capacity_total = themes_capacity_total + $4,
           idea_regen_total = idea_regen_total + $5,
           text_regen_total = text_regen_total + $6,
           updated_at = now()
       WHERE vk_user_id = $1`,
      [vkUserId, planCode, plan.posts, plan.themes, plan.ideaRegen, plan.textRegen],
    );
    await client.query(
      `INSERT INTO purchases (vk_user_id, plan_code, amount_rub) VALUES ($1, $2, $3)`,
      [vkUserId, planCode, plan.price],
    );
    return buildStateByClient(client, vkUserId);
  });

  res.json({
    state,
    message: `Тариф «${plan.title}» активирован. Лимиты начислены.`,
  });
});

app.post('/api/topics/generate-more', async (req, res) => {
  const parsed = userSchema.parse(req.body);
  const vkUserId = parseVkUserId(parsed.vkUserId);

  const result = await withTransaction(async (client) => {
    const stateBefore = await buildStateByClient(client, vkUserId);
    if (!stateBefore.user.selectedCommunityId) {
      throw makeHttpError(409, 'Сначала подключите сообщество.');
    }

    const remainingPosts = Math.max(0, stateBefore.user.postsTotal - stateBefore.user.postsUsed);
    const remainingThemeSlots = Math.max(
      0,
      stateBefore.user.themesCapacityTotal - stateBefore.topics.length,
    );
    const count = Math.min(
      remainingPosts,
      remainingThemeSlots,
      getToPageEdge(stateBefore.topics.length),
    );

    if (count <= 0) {
      throw makeHttpError(409, 'Лимит тем исчерпан. Выберите тариф для продолжения.');
    }

    const startFrom = stateBefore.topics.length + 1;
    const generated = createAutoTopics(
      count,
      startFrom,
      stateBefore.user.selectedCommunityName || 'сообщества',
    );
    await insertTopics(client, vkUserId, stateBefore.user.selectedCommunityId, generated);
    await client.query(
      `UPDATE app_users SET posts_used = posts_used + $2, updated_at = now() WHERE vk_user_id = $1`,
      [vkUserId, count],
    );

    const state = await buildStateByClient(client, vkUserId);
    return { state, generatedCount: count };
  });

  res.json({
    state: result.state,
    message: `Добавлено тем: ${result.generatedCount}.`,
  });
});

app.post('/api/topics/regenerate-page', async (req, res) => {
  const parsed = regenerateSchema.parse(req.body);
  const vkUserId = parseVkUserId(parsed.vkUserId);
  const page = normalizePage(parsed.page);

  const result = await withTransaction(async (client) => {
    const stateBefore = await buildStateByClient(client, vkUserId);
    if (!stateBefore.user.selectedCommunityId) {
      throw makeHttpError(409, 'Сначала подключите сообщество.');
    }

    const from = (page - 1) * PAGE_SIZE;
    const chunk = stateBefore.topics.slice(from, from + PAGE_SIZE);
    if (!chunk.length) {
      throw makeHttpError(409, 'На текущей странице нет тем для перегенерации.');
    }

    const required = chunk.length;
    const remainingIdeaRegens = Math.max(
      0,
      stateBefore.user.ideaRegenTotal - stateBefore.user.ideaRegenUsed,
    );
    if (remainingIdeaRegens < required) {
      throw makeHttpError(
        409,
        `Недостаточно перегенераций тем. Нужно: ${required}, доступно: ${remainingIdeaRegens}.`,
      );
    }

    for (const topic of chunk) {
      const newTitle = String(topic.title).includes('(обновлено)')
        ? String(topic.title)
        : `${topic.title} (обновлено)`;
      await client.query(
        `UPDATE topics
         SET title = $3,
             short = $4,
             updated_at = now()
         WHERE vk_user_id = $1 AND seq_no = $2`,
        [
          vkUserId,
          topic.seqNo,
          newTitle,
          'Перегенерировано с учетом контекста сообщества и уже существующих тем.',
        ],
      );
    }

    await client.query(
      `UPDATE app_users
       SET idea_regen_used = idea_regen_used + $2,
           updated_at = now()
       WHERE vk_user_id = $1`,
      [vkUserId, required],
    );

    const state = await buildStateByClient(client, vkUserId);
    return { state, regeneratedCount: required };
  });

  res.json({
    state: result.state,
    message: `Перегенерировано тем: ${result.regeneratedCount}.`,
  });
});

app.post('/api/topics/custom', async (req, res) => {
  const parsed = customTopicSchema.parse(req.body);
  const vkUserId = parseVkUserId(parsed.vkUserId);
  const title = String(parsed.title || '').trim();

  const state = await withTransaction(async (client) => {
    const stateBefore = await buildStateByClient(client, vkUserId);
    if (!stateBefore.user.selectedCommunityId) {
      throw makeHttpError(409, 'Сначала подключите сообщество.');
    }

    const remainingPosts = Math.max(0, stateBefore.user.postsTotal - stateBefore.user.postsUsed);
    const remainingThemeSlots = Math.max(
      0,
      stateBefore.user.themesCapacityTotal - stateBefore.topics.length,
    );
    if (remainingPosts <= 0 || remainingThemeSlots <= 0) {
      throw makeHttpError(409, 'Лимит тем исчерпан. Выберите тариф для продолжения.');
    }

    await insertTopics(client, vkUserId, stateBefore.user.selectedCommunityId, [
      {
        seqNo: stateBefore.topics.length + 1,
        title,
        short: 'Пользовательская тема, добавлена через кнопку «Свой пост».',
        source: 'custom',
      },
    ]);

    await client.query(
      `UPDATE app_users SET posts_used = posts_used + 1, updated_at = now() WHERE vk_user_id = $1`,
      [vkUserId],
    );

    return buildStateByClient(client, vkUserId);
  });

  res.json({
    state,
    message: 'Тема добавлена в контент-план.',
  });
});

app.post('/api/support', async (req, res) => {
  const parsed = supportSchema.parse(req.body);
  const vkUserId = parseVkUserId(parsed.vkUserId);
  const text = String(parsed.text || '').trim();

  await withTransaction(async (client) => {
    await ensureUser(client, vkUserId);
    await client.query(`INSERT INTO support_requests (vk_user_id, text) VALUES ($1, $2)`, [
      vkUserId,
      text,
    ]);
  });

  res.json({ ok: true, message: 'Обращение сохранено.' });
});

app.use((error, _req, res, _next) => {
  const status = toInt(error.status, 500);
  if (error.name === 'ZodError') {
    res.status(400).json({ error: 'Некорректный формат запроса.', details: error.issues });
    return;
  }
  if (status >= 500) {
    console.error('API error:', error);
  }
  res.status(status).json({ error: error.message || 'Внутренняя ошибка сервера.' });
});

const port = toInt(process.env.PORT, 8787);
app.listen(port, () => {
  console.log(`VK mini-app backend is running on port ${port}`);
});
