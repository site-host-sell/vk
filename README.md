# VK Mini App (Supabase only)

## Architecture
- `src/` - VK Mini App frontend (Vite + VKUI).
- `server/` - optional old backend scaffold. Current app can work without it.
- Data path in current setup:
  - Mini App -> Supabase Data API -> Postgres tables.

## Required env for frontend build
Create `.env` in repo root:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxx
```

You can also use:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`

## Run locally
```bash
npm install
npm run dev
```

## Deploy frontend to GitHub Pages
```bash
npm run deploy
```

## DB schema
Core tables used by the mini app:
- `app_users`
- `communities`
- `topics`
- `purchases`
- `support_requests`

Schema migration file:
- `server/migrations/001_init.sql`

## Important security note
Current "Supabase only" mode uses `publishable key` from the client and broad table access.
For strict production security, move write operations to Supabase Edge Functions and verify user identity server-side.
