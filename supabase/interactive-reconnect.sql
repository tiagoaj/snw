-- Execute uma vez no SQL Editor do Supabase.
CREATE TABLE IF NOT EXISTS public.reconnect_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  whatsapp_number_id uuid NOT NULL REFERENCES public.whatsapp_numbers(id) ON DELETE CASCADE,
  sender_number_id uuid NOT NULL REFERENCES public.whatsapp_numbers(id) ON DELETE CASCADE,
  recipient_phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'cancelled', 'expired', 'failed', 'reconnected')),
  selected_method text CHECK (selected_method IS NULL OR selected_method IN ('qr', 'pairing')),
  error_message text,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconnect_requests_pending_idx
  ON public.reconnect_requests(sender_number_id, recipient_phone, created_at DESC)
  WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconnect_requests TO service_role;
NOTIFY pgrst, 'reload schema';
