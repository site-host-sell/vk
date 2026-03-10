export const PAGE_SIZE = 10;

export function parseVkUserId(value) {
  const vkUserId = String(value ?? '').trim();
  if (!/^\d{3,20}$/.test(vkUserId)) {
    const error = new Error('Некорректный vkUserId.');
    error.status = 400;
    throw error;
  }
  return vkUserId;
}

export function normalizeVkUrl(raw) {
  const trimmed = String(raw ?? '').trim();
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

export function extractCommunityName(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, '').split('/')[0] || 'community';
  } catch {
    return 'community';
  }
}

function topicTemplate(index, communityName) {
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

export function createAutoTopics(count, startFrom, communityName) {
  return Array.from({ length: count }, (_, idx) => {
    const sequence = startFrom + idx;
    const tpl = topicTemplate(sequence - 1, communityName);
    return {
      seqNo: sequence,
      title: tpl.title,
      short: tpl.short,
      source: 'auto',
    };
  });
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
