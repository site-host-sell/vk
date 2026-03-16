# VK Mini App (Secure Backend Mode)

## Architecture
- `src/` - VK Mini App frontend (Vite + VKUI).
- `server/` - backend API (Express + Postgres), all DB access is server-side.
- Data path in secure mode:
  - Mini App -> Backend API -> Postgres tables.

## Why this is safer
- Browser no longer talks directly to Supabase tables.
- `vk_user_id` in requests is verified server-side via VK Mini App signed launch params (`sign`).
- In production (`ALLOW_INSECURE_DEV_AUTH=0`), requests without valid signed launch params are rejected.

## Frontend env (`.env`)
```env
VITE_BACKEND_API_URL=https://your-backend-domain
VITE_VK_DIALOG_URL=https://vk.com/im?sel=-<your-group-id>
```

## Backend env (`server/.env`)
```env
PORT=8787
DATABASE_URL=postgresql://postgres:password@host:5432/postgres
PG_SSL=true
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://site-host-sell.github.io,https://vk.com,https://m.vk.com

VK_MINI_APP_SECRET=your_vk_app_secret
ALLOW_INSECURE_DEV_AUTH=0
ROOT_ADMIN_VK_IDS=227082684

TOPICS_WEBHOOK_URL=https://your-n8n-domain/webhook/topics-generate
TOPIC_POSTS_WEBHOOK_URL=https://your-n8n-domain/webhook/topic-posts-generate
SUPPORT_WEBHOOK_URL=https://your-n8n-domain/webhook/support-forward
BUY_VK_WEBHOOK_URL=https://your-n8n-domain/webhook/miniapp-buy-vk-chat
N8N_WEBHOOK_SECRET=your_random_long_secret_for_n8n
WEBHOOK_TIMEOUT_MS=15000
PURCHASE_APPLY_SECRET=your_random_long_secret
```

`/api/purchase` is protected and must be called only by trusted backend/webhook
with header `x-purchase-secret: PURCHASE_APPLY_SECRET` and unique `paymentId`.
Bearer `Authorization` is not accepted for purchase apply.
Payment apply is atomic via `apply_purchase_once(...)` DB function
(see `supabase/migrations/20260312_purchase_security.sql`).
Additionally, `/api/purchase` validates that `paymentId` exists in `miniapp_payments`
with `status='succeeded'` and matching `vk_user_id`/`plan_code`
(see `supabase/migrations/20260312_payment_journal.sql`).

For Supabase Edge Function mode, configure:
- `PURCHASE_APPLY_SECRET`
- `CORS_ORIGINS` (comma-separated allowlist, no wildcard in production)
- `VK_MINI_APP_SECRET`
- `BUY_VK_WEBHOOK_URL` (if purchase link is sent via n8n)
- `N8N_WEBHOOK_SECRET` (if using n8n webhooks)

Security rule:
- Never expose Supabase `service_role` key (or any key with write access) in frontend env (`VITE_*`).
- n8n webhooks must validate `x-webhook-secret` and/or HMAC pair:
  - `x-webhook-timestamp`
  - `x-webhook-signature` (HMAC SHA-256 over `${timestamp}.${rawBody}` with `N8N_WEBHOOK_SECRET`).

## Local run
```bash
npm install
npm run backend:migrate
npm run backend:dev
npm run dev
npm run security:scan
npm run security:history
```

## Build / deploy frontend
```bash
npm run build
npm run deploy
```

## DB schema
Core tables:
- `app_users`
- `communities`
- `topics`
- `topic_post_variants`
- `purchases`
- `support_requests`

Admin/promo tables:
- `vk_bot_admins`
- `vk_bot_promos`
- `vk_bot_promo_uses`
- `vk_bot_users`
