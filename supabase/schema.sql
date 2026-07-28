-- Supabase schema for SNW Whatsapp Notification

-- Workspace principal
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Perfil do usuário e permissão dentro do workspace
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('superadmin', 'workspace_admin', 'client_user');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'client_user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, workspace_id)
);

-- Cliente ou subconta dentro do workspace
DO $$ BEGIN
  CREATE TYPE integration_platform AS ENUM ('uazapi', 'evolution', 'waha');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_channel AS ENUM ('email', 'whatsapp');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  integration_platform integration_platform NOT NULL,
  integration_config jsonb DEFAULT '{}'::jsonb,
  notify_email text,
  notify_whatsapp text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Números WhatsApp gerenciados por cliente
DO $$ BEGIN
  CREATE TYPE number_status AS ENUM ('connected', 'disconnected', 'pending', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS whatsapp_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  phone text NOT NULL,
  provider integration_platform NOT NULL,
  status number_status NOT NULL DEFAULT 'pending',
  last_seen_at timestamptz,
  notify_to text,
  notify_channel notification_channel NOT NULL DEFAULT 'whatsapp',
  pair_code text,
  qr_code_url text,
  qr_expires_at timestamptz,
  last_checked_at timestamptz,
  last_alert_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, phone)
);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS monitoring_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_monitor_new_numbers boolean NOT NULL DEFAULT true;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS notify_whatsapp text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS notify_email text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS notify_on_reconnect boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider integration_platform NOT NULL,
  name text NOT NULL,
  base_url text,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'not_configured',
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, provider, name)
);

-- Compatibilidade para bancos criados antes do monitor automático
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES integrations(id) ON DELETE CASCADE;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS provider_token text;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS monitoring_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS last_alert_at timestamptz;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS whatsapp_numbers_integration_external_idx;
CREATE UNIQUE INDEX whatsapp_numbers_integration_external_idx
  ON whatsapp_numbers(integration_id, external_id);
CREATE INDEX IF NOT EXISTS integrations_workspace_idx ON integrations(workspace_id);

CREATE TABLE IF NOT EXISTS platform_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  primary_sender_id uuid REFERENCES whatsapp_numbers(id) ON DELETE SET NULL,
  fallback_sender_id uuid REFERENCES whatsapp_numbers(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_notification_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  primary_sender_id uuid REFERENCES whatsapp_numbers(id) ON DELETE SET NULL,
  fallback_sender_id uuid REFERENCES whatsapp_numbers(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Solicitações interativas enviadas ao número que perdeu a conexão.
-- A resposta "1" gera QR Code e a resposta "2" gera código de pareamento.
CREATE TABLE IF NOT EXISTS reconnect_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  whatsapp_number_id uuid NOT NULL REFERENCES whatsapp_numbers(id) ON DELETE CASCADE,
  sender_number_id uuid NOT NULL REFERENCES whatsapp_numbers(id) ON DELETE CASCADE,
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
  ON reconnect_requests(sender_number_id, recipient_phone, created_at DESC)
  WHERE status = 'pending';

-- Eventos que registram desconexão, reconexão e geração de QR Code
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_number_id uuid REFERENCES whatsapp_numbers(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auditoria de ações humanas no painel (nunca armazenar credenciais no payload)
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_workspace_created_idx
  ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_number_created_idx
  ON events(whatsapp_number_id, created_at DESC);

-- Usuários aprovados ou pendentes
DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('pending', 'active', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  full_name text,
  role user_role NOT NULL DEFAULT 'client_user',
  status user_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger para atualizar timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_workspaces_updated_at ON workspaces;
CREATE TRIGGER update_workspaces_updated_at
BEFORE UPDATE ON workspaces
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_clients_updated_at ON clients;
CREATE TRIGGER update_clients_updated_at
BEFORE UPDATE ON clients
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_integrations_updated_at ON integrations;
CREATE TRIGGER update_integrations_updated_at
BEFORE UPDATE ON integrations
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_whatsapp_numbers_updated_at ON whatsapp_numbers;
CREATE TRIGGER update_whatsapp_numbers_updated_at
BEFORE UPDATE ON whatsapp_numbers
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
