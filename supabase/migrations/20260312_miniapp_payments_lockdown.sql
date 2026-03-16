-- Lock down payment journal access for public roles.
-- Keep access for service_role only.

ALTER TABLE IF EXISTS public.miniapp_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.miniapp_payments FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.miniapp_payments FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.miniapp_payments TO service_role';
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'S'
        AND n.nspname = 'public'
        AND c.relname = 'miniapp_payments_id_seq'
    ) THEN
      EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.miniapp_payments_id_seq TO service_role';
    END IF;
  END IF;
END $$;
