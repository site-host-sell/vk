-- Cache parsed VK community context + AI profile used for topic/post generation.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS public.community_ai_profiles (
  id BIGSERIAL PRIMARY KEY,
  community_id BIGINT NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  owner_vk_user_id BIGINT NOT NULL,
  community_url TEXT NOT NULL DEFAULT '',
  community_screen TEXT NOT NULL DEFAULT '',
  profile_text TEXT NOT NULL DEFAULT '',
  profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  parser_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'webhook',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_ai_profiles_community_uq
  ON public.community_ai_profiles(community_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_profiles_owner
  ON public.community_ai_profiles(owner_vk_user_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_profiles_updated
  ON public.community_ai_profiles(updated_at DESC);

ALTER TABLE IF EXISTS public.community_ai_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  BEGIN
    EXECUTE 'REVOKE ALL ON TABLE public.community_ai_profiles FROM anon';
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    EXECUTE 'REVOKE ALL ON TABLE public.community_ai_profiles FROM authenticated';
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_ai_profiles TO service_role';
  EXCEPTION WHEN undefined_object THEN NULL;
  END;

  BEGIN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.community_ai_profiles_id_seq TO service_role';
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;
