-- Execute este arquivo uma vez no SQL Editor do Supabase.
-- Ele é idempotente: pode ser executado novamente sem recriar dados existentes.

CREATE TABLE IF NOT EXISTS public.workspace_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'asaas' CHECK (provider = 'asaas'),
  plan_id text NOT NULL CHECK (plan_id IN ('start', 'growth', 'scale')),
  integration_limit integer NOT NULL CHECK (integration_limit BETWEEN 1 AND 3),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'checkout_pending', 'active', 'past_due', 'canceled', 'expired')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  asaas_checkout_id text UNIQUE,
  asaas_checkout_url text,
  checkout_expires_at timestamptz,
  asaas_customer_id text,
  asaas_subscription_id text UNIQUE,
  asaas_last_payment_id text,
  last_payment_status text,
  next_due_date date,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_subscriptions_customer_idx
  ON public.workspace_subscriptions(asaas_customer_id);

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'asaas' CHECK (provider = 'asaas'),
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, event_id)
);

CREATE INDEX IF NOT EXISTS billing_webhook_events_created_idx
  ON public.billing_webhook_events(created_at DESC);

CREATE OR REPLACE FUNCTION public.billing_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_workspace_subscriptions_updated_at
  ON public.workspace_subscriptions;
CREATE TRIGGER update_workspace_subscriptions_updated_at
BEFORE UPDATE ON public.workspace_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.billing_set_updated_at();

ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
