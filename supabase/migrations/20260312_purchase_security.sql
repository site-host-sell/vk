-- Security migration: idempotent payment apply protection
-- Run this in Supabase SQL Editor before deploying updated smart-task function.

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS external_payment_id TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_external_payment_id_uq
  ON purchases(external_payment_id)
  WHERE external_payment_id IS NOT NULL;

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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_purchase_once(BIGINT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_purchase_once(BIGINT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_purchase_once(BIGINT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) TO service_role';
  END IF;
END$$;
