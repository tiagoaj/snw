-- Modelos editáveis dos e-mails transacionais do SNW.
-- Pode ser executado mais de uma vez no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.email_templates (
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
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_email_templates_updated_at ON public.email_templates;
CREATE TRIGGER update_email_templates_updated_at
BEFORE UPDATE ON public.email_templates
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO service_role;
