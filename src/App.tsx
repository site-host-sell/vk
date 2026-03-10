import { useEffect, useMemo, useState } from 'react';
import bridge from '@vkontakte/vk-bridge';
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
import { api, type AppState, type PlanCode, type PlanDefinition, type Topic, type UserState } from './api';

type TabId = 'home' | 'plan' | 'cabinet' | 'tariffs' | 'support';
type ConnectMode = 'idle' | 'connect' | 'replace';

const PAGE_SIZE = 10;

const TAB_OPTIONS = [
  { label: 'Главная', value: 'home' },
  { label: 'Контент-план', value: 'plan' },
  { label: 'Кабинет', value: 'cabinet' },
  { label: 'Тарифы', value: 'tariffs' },
  { label: 'Поддержка', value: 'support' },
];

const PLAN_FALLBACK: PlanDefinition[] = [
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

function fallbackVkUserId() {
  const key = 'vk_miniapp_test_uid';
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
    // Outside VK app context.
  }
  return fallbackVkUserId();
}

function getPlanTitle(planCode: PlanCode, plans: PlanDefinition[]) {
  if (planCode === 'free') {
    return 'FREE';
  }
  return plans.find((plan) => plan.code === planCode)?.title || planCode;
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [plans, setPlans] = useState<PlanDefinition[]>(PLAN_FALLBACK);
  const [user, setUser] = useState<UserState | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [vkUserId, setVkUserId] = useState('');
  const [page, setPage] = useState(1);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [supportText, setSupportText] = useState('');
  const [snackbarText, setSnackbarText] = useState('');
  const [connectMode, setConnectMode] = useState<ConnectMode>('idle');
  const [communityInput, setCommunityInput] = useState('');
  const [pendingPurchase, setPendingPurchase] = useState<PlanDefinition | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const totalPages = Math.max(1, Math.ceil(Math.max(1, topics.length) / PAGE_SIZE));
  const currentPage = Math.min(totalPages, Math.max(1, page));
  const pagedTopics = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return topics.slice(start, start + PAGE_SIZE);
  }, [topics, currentPage]);

  const hasCommunity = Boolean(user?.selectedCommunityUrl);
  const remainingPosts = Math.max(0, (user?.postsTotal || 0) - (user?.postsUsed || 0));
  const remainingThemeSlots = Math.max(0, (user?.themesCapacityTotal || 0) - topics.length);

  const showMessage = (text: string) => setSnackbarText(text);

  function applyState(state: AppState) {
    setUser(state.user);
    setTopics(state.topics);
    setPage((prev) => {
      const pages = Math.max(1, Math.ceil(Math.max(1, state.topics.length) / PAGE_SIZE));
      return Math.min(Math.max(1, prev), pages);
    });
  }

  async function runAction(task: () => Promise<{ state?: AppState; message?: string }>) {
    setBusy(true);
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
      showMessage(String(error?.message || error || 'Ошибка запроса.'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function loadInitial() {
    setInitialLoading(true);
    const resolvedUserId = await resolveVkUserId();
    setVkUserId(resolvedUserId);

    try {
      const plansResult = await api.getPlans();
      if (plansResult?.plans?.length) {
        setPlans(plansResult.plans);
      }
    } catch {
      // Keep fallback plans.
    }

    try {
      const stateResult = await api.getState(resolvedUserId);
      applyState(stateResult.state);
    } catch (error: any) {
      showMessage(`Не удалось загрузить состояние: ${String(error?.message || error)}`);
    } finally {
      setInitialLoading(false);
    }
  }

  useEffect(() => {
    void loadInitial();
  }, []);

  const openConnectForm = (mode: ConnectMode) => {
    setConnectMode(mode);
    setCommunityInput(mode === 'replace' ? '' : user?.selectedCommunityUrl || '');
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
    const result = await runAction(() => api.connectCommunity(vkUserId, communityUrl));
    if (result?.state) {
      closeConnectForm();
      setActiveTab('plan');
    }
  };

  const disconnectCommunity = async () => {
    const result = await runAction(() => api.disconnectCommunity(vkUserId));
    if (result?.state) {
      closeConnectForm();
      setPage(1);
    }
  };

  const purchasePlan = async (plan: PlanDefinition) => {
    const result = await runAction(() => api.purchasePlan(vkUserId, plan.code));
    if (result?.state) {
      setPendingPurchase(null);
      setActiveTab('plan');
    }
  };

  const generateMoreTopics = async () => {
    const result = await runAction(() => api.generateMore(vkUserId));
    if (result?.state) {
      const pages = Math.max(1, Math.ceil(Math.max(1, result.state.topics.length) / PAGE_SIZE));
      setPage(pages);
    }
  };

  const regenerateCurrentPage = async () => {
    await runAction(() => api.regeneratePage(vkUserId, currentPage));
  };

  const appendCustomTopic = async () => {
    const text = customTopicInput.trim();
    if (!text) {
      showMessage('Введите тему для своего поста.');
      return;
    }
    const result = await runAction(() => api.addCustomTopic(vkUserId, text));
    if (result?.state) {
      setCustomTopicInput('');
      const pages = Math.max(1, Math.ceil(Math.max(1, result.state.topics.length) / PAGE_SIZE));
      setPage(pages);
    }
  };

  const submitSupport = async () => {
    const text = supportText.trim();
    if (!text) {
      showMessage('Введите текст обращения.');
      return;
    }
    const result = await runAction(() => api.sendSupport(vkUserId, text));
    if (result) {
      setSupportText('');
    }
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
            disabled={busy}
          />
        </FormItem>
        <Div className="two-buttons">
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
      <Group header={<Header size="s">Обзор</Header>}>
        <CardGrid size="l">
          <Card mode="outline">
            <Div>
              <Title level="3" weight="2">
                VK Bot Processor MVP
              </Title>
              <Text>
                Мини-приложение работает через backend API и БД. Здесь можно полноценно тестировать
                пользовательский сценарий без n8n.
              </Text>
              <Text>Текущий VK User ID: {vkUserId || '...'}</Text>
            </Div>
          </Card>
        </CardGrid>
      </Group>

      <Group header={<Header size="s">Быстрые действия</Header>}>
        <Div className="home-actions">
          {!hasCommunity ? (
            <Button
              stretched
              size="l"
              before={<Icon28ListOutline />}
              onClick={() => openConnectForm('connect')}
              disabled={busy}
            >
              🔗 Подключить сообщество
            </Button>
          ) : (
            <Button
              stretched
              size="l"
              before={<Icon28ListOutline />}
              onClick={() => setActiveTab('plan')}
              disabled={busy}
            >
              🗓 Контент-план
            </Button>
          )}

          <Button
            stretched
            mode="secondary"
            size="l"
            before={<Icon28CoinsOutline />}
            onClick={() => setActiveTab('tariffs')}
            disabled={busy}
          >
            💳 Выбрать тариф
          </Button>

          <Button
            stretched
            mode="secondary"
            size="l"
            before={<Icon28UserCircleOutline />}
            onClick={() => setActiveTab('cabinet')}
            disabled={busy}
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
            subtitle={`Тем: ${topics.length}. Лимит тем: ${remainingPosts}. Можно догенерировать: ${remainingThemeSlots}.`}
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

          <Div className="plan-controls">
            <Button onClick={generateMoreTopics} disabled={busy}>
              ➕ Еще темы
            </Button>
            <Button mode="secondary" onClick={regenerateCurrentPage} disabled={busy}>
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
              disabled={busy}
            />
          </FormItem>
          <Div>
            <Button stretched onClick={appendCustomTopic} disabled={busy}>
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
        <SimpleCell subtitle="Текущий тариф">{getPlanTitle(user?.planCode || 'free', plans)}</SimpleCell>
        <SimpleCell subtitle="Посты (использовано / всего)">
          {`${user?.postsUsed || 0} / ${user?.postsTotal || 0}`}
        </SimpleCell>
        <SimpleCell subtitle="Темы в плане (занято / емкость)">
          {`${topics.length} / ${user?.themesCapacityTotal || 0}`}
        </SimpleCell>
        <SimpleCell subtitle="Перегенерация тем (использовано / всего)">
          {`${user?.ideaRegenUsed || 0} / ${user?.ideaRegenTotal || 0}`}
        </SimpleCell>
        <SimpleCell subtitle="Перегенерация текстов (использовано / всего)">
          {`${user?.textRegenUsed || 0} / ${user?.textRegenTotal || 0}`}
        </SimpleCell>
      </Group>

      <Group header={<Header size="s">Сообщество</Header>}>
        {hasCommunity ? (
          <>
            <SimpleCell subtitle="Подключено">{user?.selectedCommunityUrl || ''}</SimpleCell>
            <Div className="two-buttons">
              <Button stretched mode="secondary" onClick={disconnectCommunity} disabled={busy}>
                Отключить сообщество
              </Button>
              <Button stretched onClick={() => openConnectForm('replace')} disabled={busy}>
                Привязать новое
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
      </Group>

      <Group header={<Header size="s">Доступные планы</Header>}>
        <Div className="tariff-grid">
          {plans.map((plan) => (
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
                  disabled={busy}
                >
                  Купить
                </Button>
              </Div>
            </Card>
          ))}
        </Div>
      </Group>

      {pendingPurchase ? (
        <Group header={<Header size="s">Подтверждение оплаты (backend режим)</Header>}>
          <Banner
            title={`Тариф: ${pendingPurchase.title}`}
            subtitle={`К оплате: ${pendingPurchase.price} ₽`}
            actions={
              <div className="banner-actions">
                <Button size="s" onClick={() => purchasePlan(pendingPurchase)} disabled={busy}>
                  Оплатить
                </Button>
                <Button
                  size="s"
                  mode="secondary"
                  onClick={() => setPendingPurchase(null)}
                  disabled={busy}
                >
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
          disabled={busy}
        />
      </FormItem>
      <Div>
        <Button stretched before={<Icon28MessageOutline />} onClick={submitSupport} disabled={busy}>
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
            <PanelHeader>VK Mini App (backend + DB)</PanelHeader>
            <Group>
              <Div>
                <SegmentedControl
                  options={TAB_OPTIONS}
                  value={activeTab}
                  onChange={(value) => setActiveTab(value as TabId)}
                />
              </Div>
            </Group>

            {initialLoading ? (
              <Group>
                <Placeholder>Загружаю состояние из базы данных...</Placeholder>
              </Group>
            ) : (
              <>
                {activeTab === 'home' && renderHome()}
                {activeTab === 'plan' && renderPlan()}
                {activeTab === 'cabinet' && renderCabinet()}
                {activeTab === 'tariffs' && renderTariffs()}
                {activeTab === 'support' && renderSupport()}
              </>
            )}
          </Panel>
        </SplitCol>
      </SplitLayout>

      {snackbarText ? <Snackbar onClose={() => setSnackbarText('')}>{snackbarText}</Snackbar> : null}
    </AppRoot>
  );
}
