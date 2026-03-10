import { useMemo, useState } from 'react';
import {
  AppRoot,
  Badge,
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
  SegmentedControl,
  SimpleCell,
  Snackbar,
  SplitCol,
  SplitLayout,
  Text,
  Textarea,
  Title,
} from '@vkontakte/vkui';
import {
  Icon28CoinsOutline,
  Icon28ListOutline,
  Icon28MessageOutline,
  Icon28UserCircleOutline,
} from '@vkontakte/icons';

type TabId = 'home' | 'plan' | 'cabinet' | 'tariffs' | 'support';
type PlanCode = 'free' | 'one_time' | 'plan10' | 'plan15' | 'plan30' | 'unlim';
type ConnectMode = 'idle' | 'connect' | 'replace';

type Topic = {
  id: string;
  title: string;
  short: string;
  source: 'auto' | 'custom';
};

type UserState = {
  planCode: PlanCode;
  postsTotal: number;
  postsUsed: number;
  themesCapacityTotal: number;
  ideaRegenTotal: number;
  ideaRegenUsed: number;
  textRegenTotal: number;
  textRegenUsed: number;
  selectedCommunityUrl: string;
  selectedCommunityName: string;
};

type PlanDefinition = {
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

const PAGE_SIZE = 10;

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

const TAB_OPTIONS = [
  { label: 'Главная', value: 'home' },
  { label: 'Контент-план', value: 'plan' },
  { label: 'Кабинет', value: 'cabinet' },
  { label: 'Тарифы', value: 'tariffs' },
  { label: 'Поддержка', value: 'support' },
];

const START_USER: UserState = {
  planCode: 'free',
  postsTotal: 3,
  postsUsed: 0,
  themesCapacityTotal: 3,
  ideaRegenTotal: 0,
  ideaRegenUsed: 0,
  textRegenTotal: 0,
  textRegenUsed: 0,
  selectedCommunityUrl: '',
  selectedCommunityName: '',
};

function normalizeVkUrl(raw: string): string {
  const trimmed = raw.trim();
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
    const slug = parsed.pathname.replace(/^\/+/, '').split('/')[0] || 'community';
    return slug;
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

function createAutoTopics(count: number, startFrom: number, communityName: string): Topic[] {
  return Array.from({ length: count }, (_, idx) => {
    const sequence = startFrom + idx;
    const tpl = topicTemplate(sequence - 1, communityName);
    return {
      id: String(sequence),
      title: tpl.title,
      short: tpl.short,
      source: 'auto',
    };
  });
}

function getPlanTitle(code: PlanCode): string {
  if (code === 'free') {
    return 'FREE';
  }
  return PLAN_CATALOG.find((item) => item.code === code)?.title || code;
}

function getRemainingPosts(user: UserState): number {
  return Math.max(0, user.postsTotal - user.postsUsed);
}

function getRemainingThemeSlots(user: UserState, topicsCount: number): number {
  return Math.max(0, user.themesCapacityTotal - topicsCount);
}

function getRemainingIdeaRegens(user: UserState): number {
  return Math.max(0, user.ideaRegenTotal - user.ideaRegenUsed);
}

function getToPageEdge(topicsCount: number): number {
  const rem = topicsCount % PAGE_SIZE;
  return rem === 0 ? PAGE_SIZE : PAGE_SIZE - rem;
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [user, setUser] = useState<UserState>(START_USER);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [page, setPage] = useState(1);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [supportText, setSupportText] = useState('');
  const [snackbarText, setSnackbarText] = useState('');
  const [connectMode, setConnectMode] = useState<ConnectMode>('idle');
  const [communityInput, setCommunityInput] = useState('');
  const [pendingPurchase, setPendingPurchase] = useState<PlanDefinition | null>(null);

  const totalPages = Math.max(1, Math.ceil(Math.max(1, topics.length) / PAGE_SIZE));
  const currentPage = Math.min(totalPages, Math.max(1, page));
  const remainingPosts = getRemainingPosts(user);
  const remainingThemeSlots = getRemainingThemeSlots(user, topics.length);
  const remainingIdeaRegens = getRemainingIdeaRegens(user);
  const hasCommunity = Boolean(user.selectedCommunityUrl);

  const pagedTopics = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return topics.slice(start, start + PAGE_SIZE);
  }, [topics, currentPage]);

  const showMessage = (text: string) => setSnackbarText(text);

  const openConnectForm = (mode: ConnectMode) => {
    setConnectMode(mode);
    setCommunityInput(mode === 'replace' ? '' : user.selectedCommunityUrl);
  };

  const closeConnectForm = () => {
    setConnectMode('idle');
    setCommunityInput('');
  };

  const connectCommunity = () => {
    const normalized = normalizeVkUrl(communityInput);
    if (!normalized) {
      showMessage('Введите корректную ссылку VK: https://vk.com/...');
      return;
    }

    const communityName = extractCommunityName(normalized);
    const initialToGenerate = Math.min(3, remainingPosts, user.themesCapacityTotal);
    const generated = createAutoTopics(initialToGenerate, 1, communityName);

    setUser((prev) => ({
      ...prev,
      selectedCommunityUrl: normalized,
      selectedCommunityName: communityName,
      postsUsed: prev.postsUsed + initialToGenerate,
    }));
    setTopics(generated);
    setPage(1);
    setActiveTab('plan');
    closeConnectForm();

    if (initialToGenerate > 0) {
      showMessage(`Сообщество подключено. Сгенерировано стартовых тем: ${initialToGenerate}.`);
    } else {
      showMessage('Сообщество подключено. Лимит тем исчерпан, выберите тариф для продолжения.');
    }
  };

  const disconnectCommunity = () => {
    if (!hasCommunity) {
      showMessage('Сообщество уже не подключено.');
      return;
    }

    setUser((prev) => ({
      ...prev,
      selectedCommunityUrl: '',
      selectedCommunityName: '',
    }));
    setTopics([]);
    setPage(1);
    closeConnectForm();
    showMessage('Сообщество отключено. Можно привязать новое.');
  };

  const purchasePlan = (plan: PlanDefinition) => {
    setUser((prev) => ({
      ...prev,
      planCode: plan.code,
      postsTotal: prev.postsTotal + plan.posts,
      themesCapacityTotal: prev.themesCapacityTotal + plan.themes,
      ideaRegenTotal: prev.ideaRegenTotal + plan.ideaRegen,
      textRegenTotal: prev.textRegenTotal + plan.textRegen,
    }));
    setPendingPurchase(null);
    setActiveTab('plan');
    showMessage(`Тариф «${plan.title}» активирован. Лимиты начислены.`);
  };

  const generateMoreTopics = () => {
    if (!hasCommunity) {
      showMessage('Сначала подключите сообщество.');
      setActiveTab('home');
      return;
    }

    if (remainingPosts <= 0 || remainingThemeSlots <= 0) {
      showMessage('Лимит тем закончился. Выберите тариф, чтобы продолжить.');
      setActiveTab('tariffs');
      return;
    }

    const toEdge = getToPageEdge(topics.length);
    const count = Math.min(toEdge, remainingPosts, remainingThemeSlots);
    if (count <= 0) {
      showMessage('Новых тем добавить нельзя. Нужен тариф.');
      setActiveTab('tariffs');
      return;
    }

    const startFrom = topics.length + 1;
    const generated = createAutoTopics(count, startFrom, user.selectedCommunityName || 'сообщества');
    const nextTopics = [...topics, ...generated];

    setTopics(nextTopics);
    setUser((prev) => ({
      ...prev,
      postsUsed: prev.postsUsed + count,
    }));
    setPage(Math.ceil(nextTopics.length / PAGE_SIZE));
    showMessage(`Добавлено тем: ${count}.`);
  };

  const regenerateCurrentPage = () => {
    if (!hasCommunity) {
      showMessage('Сначала подключите сообщество.');
      return;
    }

    if (pagedTopics.length === 0) {
      showMessage('На текущей странице нет тем для перегенерации.');
      return;
    }

    const required = pagedTopics.length;
    if (remainingIdeaRegens < required) {
      showMessage(`Недостаточно перегенераций тем. Нужно: ${required}, доступно: ${remainingIdeaRegens}.`);
      return;
    }

    const ids = new Set(pagedTopics.map((item) => item.id));
    const next = topics.map((topic) => {
      if (!ids.has(topic.id)) {
        return topic;
      }
      return {
        ...topic,
        title: `${topic.title} (обновлено)`,
        short: 'Перегенерировано с учетом контекста сообщества и уже существующих тем.',
      };
    });

    setTopics(next);
    setUser((prev) => ({
      ...prev,
      ideaRegenUsed: prev.ideaRegenUsed + required,
    }));
    showMessage(`Перегенерировано тем: ${required}.`);
  };

  const appendCustomTopic = () => {
    const value = customTopicInput.trim();
    if (!hasCommunity) {
      showMessage('Сначала подключите сообщество.');
      setActiveTab('home');
      return;
    }
    if (!value) {
      showMessage('Введите тему для своего поста.');
      return;
    }
    if (remainingPosts <= 0 || remainingThemeSlots <= 0) {
      showMessage('Лимит тем закончился. Выберите тариф.');
      setActiveTab('tariffs');
      return;
    }

    const topic: Topic = {
      id: String(topics.length + 1),
      title: value,
      short: 'Пользовательская тема, добавлена через кнопку «Свой пост».',
      source: 'custom',
    };
    const nextTopics = [...topics, topic];

    setTopics(nextTopics);
    setUser((prev) => ({
      ...prev,
      postsUsed: prev.postsUsed + 1,
    }));
    setCustomTopicInput('');
    setPage(Math.ceil(nextTopics.length / PAGE_SIZE));
    showMessage('Тема добавлена в контент-план.');
  };

  const renderConnectForm = () => {
    if (connectMode === 'idle') {
      return null;
    }

    const title = connectMode === 'replace' ? 'Привязать новое сообщество' : 'Подключить сообщество';

    return (
      <Group header={<Header size="s">{title}</Header>}>
        <FormItem top="Ссылка на VK-сообщество">
          <Input
            value={communityInput}
            onChange={(event) => setCommunityInput(event.target.value)}
            placeholder="https://vk.com/club123456"
          />
        </FormItem>
        <Div className="two-buttons">
          <Button stretched onClick={connectCommunity}>
            Сохранить
          </Button>
          <Button stretched mode="secondary" onClick={closeConnectForm}>
            Отмена
          </Button>
        </Div>
      </Group>
    );
  };

  const renderHome = () => (
    <>
      <Group header={<Header size="s">Обзор</Header>}>
        <CardGrid size="l">
          <Card mode="outline">
            <Div>
              <Title level="3" weight="2">
                VK Bot Processor MVP
              </Title>
              <Text>
                Локальная версия с прод-подобной логикой. Можно пройти полный пользовательский сценарий:
                подключить сообщество, сгенерировать темы, докупить тариф, продолжить генерацию.
              </Text>
            </Div>
          </Card>
        </CardGrid>
      </Group>

      <Group header={<Header size="s">Быстрые действия</Header>}>
        <Div className="home-actions">
          {!hasCommunity ? (
            <Button stretched size="l" before={<Icon28ListOutline />} onClick={() => openConnectForm('connect')}>
              🔗 Подключить сообщество
            </Button>
          ) : (
            <Button stretched size="l" before={<Icon28ListOutline />} onClick={() => setActiveTab('plan')}>
              🗓 Контент-план
            </Button>
          )}

          <Button
            stretched
            mode="secondary"
            size="l"
            before={<Icon28CoinsOutline />}
            onClick={() => setActiveTab('tariffs')}
          >
            💳 Выбрать тариф
          </Button>

          <Button
            stretched
            mode="secondary"
            size="l"
            before={<Icon28UserCircleOutline />}
            onClick={() => setActiveTab('cabinet')}
          >
            👤 Кабинет
          </Button>
        </Div>
      </Group>

      {renderConnectForm()}
    </>
  );

  const renderPlan = () => {
    if (!hasCommunity) {
      return (
        <>
          <Group header={<Header size="s">Контент-план</Header>}>
            <Placeholder>Сначала подключите сообщество, чтобы начать генерацию тем.</Placeholder>
            <Div>
              <Button stretched onClick={() => openConnectForm('connect')}>
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
            subtitle={`Тем: ${topics.length}. Лимит тем: ${remainingPosts}. Можно догенерировать: ${remainingThemeSlots}.`}
            actions={
              <div className="banner-actions">
                <Button
                  size="s"
                  mode="secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Назад
                </Button>
                <Button
                  size="s"
                  mode="secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                >
                  Вперед
                </Button>
              </div>
            }
          />

          <Div className="plan-controls">
            <Button onClick={generateMoreTopics}>➕ Еще темы</Button>
            <Button mode="secondary" onClick={regenerateCurrentPage}>
              🔄 Перегенерировать темы
            </Button>
          </Div>
        </Group>

        <Group header={<Header size="s">Темы</Header>}>
          {pagedTopics.length === 0 ? (
            <Placeholder>Тем пока нет. Нажмите «➕ Еще темы».</Placeholder>
          ) : (
            pagedTopics.map((topic, index) => (
              <SimpleCell
                key={topic.id}
                multiline
                subtitle={topic.short}
                after={<Badge mode="prominent">#{(currentPage - 1) * PAGE_SIZE + index + 1}</Badge>}
              >
                {topic.title}
              </SimpleCell>
            ))
          )}
        </Group>

        <Group header={<Header size="s">Свой пост</Header>}>
          <FormItem top="Введите тему вручную">
            <Input
              value={customTopicInput}
              onChange={(event) => setCustomTopicInput(event.target.value)}
              placeholder="Например: Как выбрать подрядчика без переплат"
            />
          </FormItem>
          <Div>
            <Button stretched onClick={appendCustomTopic}>
              Добавить в контент-план
            </Button>
          </Div>
        </Group>
      </>
    );
  };

  const renderCabinet = () => (
    <>
      <Group header={<Header size="s">Кабинет</Header>}>
        <SimpleCell subtitle="Текущий тариф">{getPlanTitle(user.planCode)}</SimpleCell>
        <SimpleCell subtitle="Посты (использовано / всего)">{`${user.postsUsed} / ${user.postsTotal}`}</SimpleCell>
        <SimpleCell subtitle="Темы в плане (занято / емкость)">{`${topics.length} / ${user.themesCapacityTotal}`}</SimpleCell>
        <SimpleCell subtitle="Перегенерация тем (использовано / всего)">{`${user.ideaRegenUsed} / ${user.ideaRegenTotal}`}</SimpleCell>
        <SimpleCell subtitle="Перегенерация текстов (использовано / всего)">{`${user.textRegenUsed} / ${user.textRegenTotal}`}</SimpleCell>
      </Group>

      <Group header={<Header size="s">Сообщество</Header>}>
        {hasCommunity ? (
          <>
            <SimpleCell subtitle="Подключено">{user.selectedCommunityUrl}</SimpleCell>
            <Div className="two-buttons">
              <Button stretched mode="secondary" onClick={disconnectCommunity}>
                Отключить сообщество
              </Button>
              <Button stretched onClick={() => openConnectForm('replace')}>
                Привязать новое
              </Button>
            </Div>
          </>
        ) : (
          <>
            <Placeholder>Сейчас сообщество не подключено.</Placeholder>
            <Div>
              <Button stretched onClick={() => openConnectForm('connect')}>
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
      </Group>

      <Group header={<Header size="s">Доступные планы</Header>}>
        <Div className="tariff-grid">
          {PLAN_CATALOG.map((plan) => (
            <Card key={plan.code} mode="outline" className={plan.highlight ? 'plan-highlight' : ''}>
              <Div className="plan-card">
                <Title level="3" weight="2">
                  {plan.title}
                </Title>
                <Text className="plan-short">{plan.short}</Text>
                <Text>• Тем в контент-плане: {plan.themes}</Text>
                <Text>• Перегенераций тем: {plan.ideaRegen}</Text>
                <Text>• Перегенераций текста: {plan.textRegen}</Text>
                <Text>• Цена: {plan.price} ₽</Text>
                <Button
                  stretched
                  size="m"
                  mode={plan.highlight ? 'primary' : 'secondary'}
                  onClick={() => setPendingPurchase(plan)}
                >
                  Купить
                </Button>
              </Div>
            </Card>
          ))}
        </Div>
      </Group>

      {pendingPurchase ? (
        <Group header={<Header size="s">Подтверждение оплаты (локальный тест)</Header>}>
          <Banner
            title={`Тариф: ${pendingPurchase.title}`}
            subtitle={`К оплате: ${pendingPurchase.price} ₽`}
            actions={
              <div className="banner-actions">
                <Button size="s" onClick={() => purchasePlan(pendingPurchase)}>
                  Оплатить
                </Button>
                <Button size="s" mode="secondary" onClick={() => setPendingPurchase(null)}>
                  Отменить
                </Button>
              </div>
            }
          />
        </Group>
      ) : null}
    </>
  );

  const renderSupport = () => (
    <Group header={<Header size="s">Поддержка</Header>}>
      <FormItem top="Опишите вопрос">
        <Textarea
          value={supportText}
          onChange={(event) => setSupportText(event.target.value)}
          placeholder="Например: после оплаты не начислились лимиты"
        />
      </FormItem>
      <Div>
        <Button
          stretched
          before={<Icon28MessageOutline />}
          onClick={() => {
            if (!supportText.trim()) {
              showMessage('Введите текст обращения.');
              return;
            }
            setSupportText('');
            showMessage('Обращение отправлено в локальный журнал.');
          }}
        >
          Отправить обращение
        </Button>
      </Div>
    </Group>
  );

  return (
    <AppRoot mode="full">
      <SplitLayout>
        <SplitCol autoSpaced>
          <Panel id="main">
            <PanelHeader>VK Mini App (локальная прод-логика)</PanelHeader>
            <Group>
              <Div>
                <SegmentedControl
                  options={TAB_OPTIONS}
                  value={activeTab}
                  onChange={(value) => setActiveTab(value as TabId)}
                />
              </Div>
            </Group>

            {activeTab === 'home' && renderHome()}
            {activeTab === 'plan' && renderPlan()}
            {activeTab === 'cabinet' && renderCabinet()}
            {activeTab === 'tariffs' && renderTariffs()}
            {activeTab === 'support' && renderSupport()}
          </Panel>
        </SplitCol>
      </SplitLayout>

      {snackbarText ? <Snackbar onClose={() => setSnackbarText('')}>{snackbarText}</Snackbar> : null}
    </AppRoot>
  );
}
