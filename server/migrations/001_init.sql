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
  external_payment_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_requests (
  id BIGSERIAL PRIMARY KEY,
  vk_user_id BIGINT NOT NULL REFERENCES app_users(vk_user_id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topic_post_variants (
  id BIGSERIAL PRIMARY KEY,
  topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  variant_no INTEGER NOT NULL CHECK (variant_no >= 1 AND variant_no <= 3),
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ai',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (topic_id, variant_no)
);

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS external_payment_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_topics_user_seq ON topics(vk_user_id, seq_no);
CREATE INDEX IF NOT EXISTS idx_purchases_user_created ON purchases(vk_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_external_payment_id_uq
  ON purchases(external_payment_id)
  WHERE external_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_topic_post_variants_topic ON topic_post_variants(topic_id, variant_no);

CREATE OR REPLACE FUNCTION public.apply_purchase_once(
  p_vk_user_id BIGINT,
  p_plan_code TEXT,
  p_posts_delta INTEGER,
  p_themes_delta INTEGER,
  p_idea_delta INTEGER,
  p_text_delta INTEGER,
  p_amount_rub INTEGER,
  p_external_payment_id TEXT
)
RETURNS TABLE(applied BOOLEAN, reason TEXT, owner_vk_user_id BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted_id BIGINT;
  v_existing_owner BIGINT;
  v_payment_id TEXT := btrim(COALESCE(p_external_payment_id, ''));
BEGIN
  IF p_vk_user_id IS NULL OR p_vk_user_id <= 0 THEN
    RAISE EXCEPTION 'vk_user_id is required';
  END IF;
  IF v_payment_id = '' THEN
    RAISE EXCEPTION 'external_payment_id is required';
  END IF;

  INSERT INTO app_users (vk_user_id)
  VALUES (p_vk_user_id)
  ON CONFLICT (vk_user_id) DO NOTHING;

  INSERT INTO purchases (vk_user_id, plan_code, amount_rub, external_payment_id, created_at)
  VALUES (
    p_vk_user_id,
    COALESCE(NULLIF(btrim(COALESCE(p_plan_code, '')), ''), 'free'),
    GREATEST(COALESCE(p_amount_rub, 0), 0),
    v_payment_id,
    now()
  )
  ON CONFLICT (external_payment_id)
  WHERE external_payment_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    SELECT vk_user_id
      INTO v_existing_owner
      FROM purchases
     WHERE external_payment_id = v_payment_id
     LIMIT 1;

    IF v_existing_owner IS NULL THEN
      RETURN QUERY SELECT FALSE, 'duplicate_unknown_owner', NULL::BIGINT;
      RETURN;
    END IF;
    IF v_existing_owner <> p_vk_user_id THEN
      RETURN QUERY SELECT FALSE, 'already_applied_other_user', v_existing_owner;
      RETURN;
    END IF;
    RETURN QUERY SELECT FALSE, 'already_applied_same_user', v_existing_owner;
    RETURN;
  END IF;

  UPDATE app_users
     SET plan_code = COALESCE(NULLIF(btrim(COALESCE(p_plan_code, '')), ''), plan_code),
         posts_total = posts_total + GREATEST(COALESCE(p_posts_delta, 0), 0),
         themes_capacity_total = themes_capacity_total + GREATEST(COALESCE(p_themes_delta, 0), 0),
         idea_regen_total = idea_regen_total + GREATEST(COALESCE(p_idea_delta, 0), 0),
         text_regen_total = text_regen_total + GREATEST(COALESCE(p_text_delta, 0), 0),
         updated_at = now()
   WHERE vk_user_id = p_vk_user_id;

  RETURN QUERY SELECT TRUE, 'applied', p_vk_user_id;
END;
$$;

CREATE TABLE IF NOT EXISTS vk_bot_admins (
  vk_user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  added_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vk_bot_promos (
  code TEXT PRIMARY KEY,
  discount_percent INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  max_uses INTEGER NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  allowed_plan TEXT NOT NULL DEFAULT 'all',
  expires_at TIMESTAMPTZ NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vk_bot_promo_uses (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  vk_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vk_bot_users (
  vk_user_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vk_bot_promos_active ON vk_bot_promos(is_active, code);
CREATE INDEX IF NOT EXISTS idx_vk_bot_promo_uses_user ON vk_bot_promo_uses(vk_user_id, created_at DESC);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_post_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vk_bot_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE vk_bot_promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vk_bot_promo_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE vk_bot_users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE app_users, communities, topics, topic_post_variants, purchases, support_requests, vk_bot_admins, vk_bot_promos, vk_bot_promo_uses, vk_bot_users FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_purchase_once(BIGINT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE app_users, communities, topics, topic_post_variants, purchases, support_requests, vk_bot_admins, vk_bot_promos, vk_bot_promo_uses, vk_bot_users FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_purchase_once(BIGINT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_purchase_once(BIGINT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) TO service_role';
  END IF;
END$$;
