-- Lock down all business tables from anon/authenticated roles.
-- Service access is done via service_role only.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'app_users',
    'communities',
    'topics',
    'topic_post_variants',
    'purchases',
    'support_requests',
    'miniapp_payments',
    'vk_bot_admins',
    'vk_bot_promos',
    'vk_bot_promo_uses',
    'vk_bot_users'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;
