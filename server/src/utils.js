export const PAGE_SIZE = 10;
export const MAX_COMMUNITY_URL_LENGTH = 220;
export const MAX_TOPIC_TITLE_LENGTH = 220;
export const MAX_TOPIC_SHORT_LENGTH = 500;
export const MAX_SUPPORT_TEXT_LENGTH = 2500;
export const MAX_POST_TEXT_LENGTH = 9000;

export function parseVkUserId(value) {
  const vkUserId = String(value ?? '').trim();
  if (!/^\d{3,20}$/.test(vkUserId)) {
    const error = new Error('Invalid vkUserId.');
    error.status = 400;
    throw error;
  }
  return vkUserId;
}

export function normalizeVkUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed || trimmed.length > MAX_COMMUNITY_URL_LENGTH) {
    return '';
  }

  const hasProtocol = /^https?:\/\//i.test(trimmed);
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    const host = String(parsed.hostname || '').toLowerCase();
    if (host !== 'vk.com' && !host.endsWith('.vk.com')) {
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

export function extractCommunityName(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, '').split('/')[0] || 'community';
  } catch {
    return 'community';
  }
}

function topicTemplate(index, communityName) {
  const prefixes = [
    'Разбор',
    'Пошагово',
    'Кейс',
    'FAQ',
    'Гайд',
    'Чек-лист',
    'Ошибка',
    'Миф',
    'Сценарий',
    'Идея',
    'Формула',
    'Инструкция',
  ];
  const angles = [
    'как выбрать решение без переплаты',
    'что важно перед первым обращением',
    'как не потерять клиента на старте',
    'как правильно сравнивать варианты',
    'что чаще всего спрашивают в сообщениях',
    'какие шаги дают быстрый результат',
    'как усилить доверие к сообществу',
    'как оформить предложение понятнее',
    'как работать с возражениями',
    'как подготовиться к покупке',
    'как сократить путь до заявки',
    'как удерживать внимание подписчиков',
  ];
  const outcomes = [
    'чтобы подписчик понял пользу за 30 секунд',
    'чтобы пост приводил к сообщениям в ЛС',
    'чтобы аудитория чаще сохраняла публикации',
    'чтобы снизить количество типичных вопросов',
    'чтобы повысить отклик и вовлечение',
    'чтобы упростить выбор для клиента',
    'чтобы усилить доверие к экспертности',
    'чтобы увеличить долю целевых заявок',
  ];

  const prefix = prefixes[index % prefixes.length];
  const angle = angles[(index * 3 + 1) % angles.length];
  const outcome = outcomes[(index * 5 + 2) % outcomes.length];

  return {
    title: `${prefix}: ${angle} в ${communityName}`,
    short: `Пост о том, ${outcome}. Дайте читателю простые шаги и понятный следующий шаг.`,
  };
}

export function createAutoTopics(count, startFrom, communityName, existingTitles = new Set()) {
  const rows = [];
  const normalizedSeen = new Set(
    Array.from(existingTitles).map((value) => String(value || '').trim().toLowerCase()),
  );
  let cursor = Math.max(0, startFrom - 1);

  while (rows.length < count) {
    const sequence = startFrom + rows.length;
    const tpl = topicTemplate(cursor, communityName);
    cursor += 1;
    let title = clampSingleLine(tpl.title, MAX_TOPIC_TITLE_LENGTH);
    const normalizedTitle = title.trim().toLowerCase();
    if (normalizedSeen.has(normalizedTitle)) {
      title = `${title} #${sequence}`;
    }
    normalizedSeen.add(title.trim().toLowerCase());
    rows.push({
      seqNo: sequence,
      title,
      short: clampSingleLine(tpl.short, MAX_TOPIC_SHORT_LENGTH),
      source: 'auto',
    });
  }

  return rows;
}

export function normalizeTopicTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ');
}

export function topicSimilarity(a, b) {
  const aTokens = new Set(normalizeTopicTitle(a).split(' ').filter(Boolean));
  const bTokens = new Set(normalizeTopicTitle(b).split(' ').filter(Boolean));
  if (!aTokens.size || !bTokens.size) {
    return 0;
  }

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }
  const union = aTokens.size + bTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function isTopicDuplicate(candidate, existingTitles) {
  const normalizedCandidate = normalizeTopicTitle(candidate);
  if (!normalizedCandidate) {
    return true;
  }

  for (const current of existingTitles) {
    const normalizedCurrent = normalizeTopicTitle(current);
    if (!normalizedCurrent) {
      continue;
    }
    if (normalizedCandidate === normalizedCurrent) {
      return true;
    }
    if (
      normalizedCandidate.includes(normalizedCurrent) ||
      normalizedCurrent.includes(normalizedCandidate)
    ) {
      return true;
    }
    if (topicSimilarity(normalizedCandidate, normalizedCurrent) >= 0.82) {
      return true;
    }
  }

  return false;
}

export function filterUniqueTopics(candidates, existingTitles, limit) {
  const accepted = [];
  const pool = [...existingTitles];

  for (const item of candidates) {
    const title = clampSingleLine(item?.title || '', MAX_TOPIC_TITLE_LENGTH);
    const short = clampSingleLine(item?.short || '', MAX_TOPIC_SHORT_LENGTH);
    if (!title) {
      continue;
    }
    if (isTopicDuplicate(title, pool)) {
      continue;
    }
    accepted.push({ title, short: short || 'Краткое описание темы.' });
    pool.push(title);
    if (accepted.length >= limit) {
      break;
    }
  }
  return accepted;
}

export function normalizeGeneratedTopics(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => {
      if (typeof item === 'string') {
        const title = clampSingleLine(item, MAX_TOPIC_TITLE_LENGTH);
        return title ? { title, short: 'Краткое описание темы.' } : null;
      }
      if (item && typeof item === 'object') {
        const title = clampSingleLine(item.title || item.topic || item.name || '', MAX_TOPIC_TITLE_LENGTH);
        const short = clampSingleLine(
          item.short || item.description || item.desc || '',
          MAX_TOPIC_SHORT_LENGTH,
        );
        if (!title) {
          return null;
        }
        return { title, short: short || 'Краткое описание темы.' };
      }
      return null;
    })
    .filter(Boolean);
}

export function normalizeGeneratedPosts(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => {
      if (typeof item === 'string') {
        return clampPostBody(item, MAX_POST_TEXT_LENGTH);
      }
      if (item && typeof item === 'object') {
        return clampPostBody(item.text || item.post || item.content || '', MAX_POST_TEXT_LENGTH);
      }
      return '';
    })
    .filter((text) => text.length > 0);
}

export function clampSingleLine(value, maxLength = 220) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, maxLength));
}

export function clampPostBody(value, maxLength = 9000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, Math.max(1, maxLength));
}

export function getToPageEdge(topicsCount) {
  const rem = topicsCount % PAGE_SIZE;
  return rem === 0 ? PAGE_SIZE : PAGE_SIZE - rem;
}

export function toInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.trunc(num);
}
