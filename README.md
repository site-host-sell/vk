# VK Mini App + Backend (без n8n)

## Что внутри
- `src/` — мини-приложение (VKUI + Vite), работает через backend API.
- `server/` — backend API (`Express + Postgres`) с бизнес-логикой:
  - пользователь/кабинет,
  - привязка сообщества,
  - контент-план и темы,
  - покупка тарифов,
  - support-запросы.

## 1) Локальный запуск

### Frontend
```bash
npm install
npm run dev
```

### Backend
```bash
cd server
npm install
cp .env.example .env
# заполните DATABASE_URL
npm run migrate
npm run dev
```

Frontend ожидает backend по `VITE_API_BASE_URL`.
Создайте `.env` в корне проекта:
```env
VITE_API_BASE_URL=http://127.0.0.1:8787
```

## 2) Прод-развертывание

### Frontend (GitHub Pages)
```bash
npm run deploy
```

### Backend (Railway/Render)
Запустите `server/` как отдельный сервис:
- стартовая команда: `npm run start`
- рабочая папка: `server`
- переменные окружения:
  - `DATABASE_URL=...`
  - `CORS_ORIGINS=https://site-host-sell.github.io`
  - `PORT` (опционально)

После деплоя backend укажите его URL в переменной `VITE_API_BASE_URL` и перезадеплойте frontend.

## 3) SQL миграция
Файл схемы:
- `server/migrations/001_init.sql`

Применение:
```bash
npm run backend:migrate
```
