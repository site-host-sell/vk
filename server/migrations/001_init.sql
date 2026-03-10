CREATE TABLE IF NOT EXISTS app_users (
  vk_user_id BIGINT PRIMARY KEY,
  plan_code TEXT NOT NULL DEFAULT 'free',
  posts_total INTEGER NOT NULL DEFAULT 3,
  posts_used INTEGER NOT NULL DEFAULT 0,
  themes_capacity_total INTEGER NOT NULL DEFAULT 3,
  idea_regen_total INTEGER NOT NULL DEFAULT 0,
  idea_regen_used INTEGER NOT NULL DEFAULT 0,
  text_regen_total INTEGER NOT NULL DEFAULT 0,
  text_regen_used INTEGER NOT NULL DEFAULT 0,
  selected_community_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS communities (
  id BIGSERIAL PRIMARY KEY,
  community_url TEXT NOT NULL UNIQUE,
  community_screen TEXT NOT NULL,
  owner_vk_user_id BIGINT NOT NULL UNIQUE REFERENCES app_users(vk_user_id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_selected_community_id_fkey;
ALTER TABLE app_users
  ADD CONSTRAINT app_users_selected_community_id_fkey
  FOREIGN KEY (selected_community_id) REFERENCES communities(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS topics (
  id BIGSERIAL PRIMARY KEY,
  vk_user_id BIGINT NOT NULL REFERENCES app_users(vk_user_id) ON DELETE CASCADE,
  community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  seq_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  short TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vk_user_id, seq_no)
);

CREATE TABLE IF NOT EXISTS purchases (
  id BIGSERIAL PRIMARY KEY,
  vk_user_id BIGINT NOT NULL REFERENCES app_users(vk_user_id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  amount_rub INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_requests (
  id BIGSERIAL PRIMARY KEY,
  vk_user_id BIGINT NOT NULL REFERENCES app_users(vk_user_id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topics_user_seq ON topics(vk_user_id, seq_no);
CREATE INDEX IF NOT EXISTS idx_purchases_user_created ON purchases(vk_user_id, created_at DESC);
