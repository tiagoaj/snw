-- Estrutura de e-mails do SNW (Resend).
-- Pode ser executada mais de uma vez no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  campaign_id uuid,
  provider text NOT NULL DEFAULT 'resend' CHECK (provider = 'resend'),
  provider_email_id text,
  category text NOT NULL CHECK (category IN ('status', 'billing', 'platform', 'marketing', 'cart_recovery')),
  template_key text NOT NULL,
  recipient_email text NOT NULL,
  recipient_name text,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'delayed', 'bounced', 'complained', 'failed', 'suppressed')),
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS email_messages_provider_id_idx
  ON email_messages(provider_email_id)
  WHERE provider_email_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_messages_recipient_idx
  ON email_messages(lower(recipient_email), created_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_workspace_idx
  ON email_messages(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_campaign_idx
  ON email_messages(campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  audience text NOT NULL
    CHECK (audience IN ('all_clients', 'active_subscribers', 'trialing', 'checkout_pending', 'past_due')),
  subject text NOT NULL,
  preheader text,
  content_text text NOT NULL,
  button_label text,
  button_url text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'sending', 'completed', 'failed', 'canceled')),
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE email_messages
    ADD CONSTRAINT email_messages_campaign_fk
    FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  provider_email_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, email)
);

CREATE INDEX IF NOT EXISTS email_campaigns_status_idx
  ON email_campaigns(status, scheduled_at, created_at);
CREATE INDEX IF NOT EXISTS email_campaign_recipients_pending_idx
  ON email_campaign_recipients(campaign_id, status, created_at);

CREATE TABLE IF NOT EXISTS email_marketing_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL DEFAULT 'user_request',
  source text NOT NULL DEFAULT 'unsubscribe_link',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email)
);
CREATE UNIQUE INDEX IF NOT EXISTS email_marketing_opt_outs_lower_email_idx
  ON email_marketing_opt_outs(lower(email));

CREATE TABLE IF NOT EXISTS email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('bounced', 'complained', 'manual')),
  provider_event_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email)
);
CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_lower_email_idx
  ON email_suppressions(lower(email));

CREATE TABLE IF NOT EXISTS email_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  svix_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  provider_email_id text,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_webhook_events_created_idx
  ON email_webhook_events(created_at DESC);

DROP TRIGGER IF EXISTS update_email_messages_updated_at ON email_messages;
CREATE TRIGGER update_email_messages_updated_at
BEFORE UPDATE ON email_messages
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_email_campaigns_updated_at ON email_campaigns;
CREATE TRIGGER update_email_campaigns_updated_at
BEFORE UPDATE ON email_campaigns
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_email_campaign_recipients_updated_at ON email_campaign_recipients;
CREATE TRIGGER update_email_campaign_recipients_updated_at
BEFORE UPDATE ON email_campaign_recipients
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_email_suppressions_updated_at ON email_suppressions;
CREATE TRIGGER update_email_suppressions_updated_at
BEFORE UPDATE ON email_suppressions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_marketing_opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS email_templates (
  template_key text PRIMARY KEY
    CHECK (template_key IN (
      'status_disconnected',
      'status_reconnected',
      'billing_notice',
      'welcome',
      'trial_ending',
      'cart_recovery',
      'campaign'
    )),
  subject_template text NOT NULL,
  preheader_template text NOT NULL DEFAULT '',
  eyebrow_template text NOT NULL DEFAULT '',
  title_template text NOT NULL,
  content_template text NOT NULL,
  button_label_template text NOT NULL DEFAULT '',
  button_url_template text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_email_templates_updated_at ON email_templates;
CREATE TRIGGER update_email_templates_updated_at
BEFORE UPDATE ON email_templates
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_templates TO service_role;
