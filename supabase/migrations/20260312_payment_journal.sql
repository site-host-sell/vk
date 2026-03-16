-- Security migration: verified payment journal used by /api/purchase guard.
-- Run this before deploying smart-task with payment verification check.

CREATE TABLE IF NOT EXISTS public.miniapp_payments (
  id BIGSERIAL PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  vk_user_id BIGINT,
  plan_code TEXT,
  amount_rub INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  confirmation_url TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.miniapp_payments ADD COLUMN IF NOT EXISTS payment_id TEXT;
ALTER TABLE public.miniapp_payments ADD COLUMN IF NOT EXISTS vk_user_id BIGINT;
ALTER TABLE public.miniapp_payments ADD COLUMN IF NOT EXISTS plan_code TEXT;
ALTER TABLE public.miniapp_payments ADD COLUMN IF NOT EXISTS amount_rub INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.miniapp_payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.miniapp_payments ADD COLUMN IF NOT EXISTS confirmation_url TEXT;
ALTER TABLE public.miniapp_payments ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.miniapp_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.miniapp_payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE public.miniapp_payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_miniapp_payments_payment_id_uq
  ON public.miniapp_payments(payment_id);

CREATE INDEX IF NOT EXISTS idx_miniapp_payments_status
  ON public.miniapp_payments(status);

CREATE INDEX IF NOT EXISTS idx_miniapp_payments_vk_user_id
  ON public.miniapp_payments(vk_user_id);
