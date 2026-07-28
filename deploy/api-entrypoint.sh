#!/bin/sh
set -eu

load_secret() {
  variable_name="$1"
  secret_path="$2"

  if [ -f "$secret_path" ]; then
    secret_value="$(cat "$secret_path")"
    export "$variable_name=$secret_value"
  fi
}

load_secret SUPABASE_SERVICE_ROLE_KEY /run/secrets/snw_supabase_service_role_key
load_secret WEBHOOK_SECRET /run/secrets/snw_webhook_secret
load_secret INTEGRATION_ENCRYPTION_KEY /run/secrets/snw_integration_encryption_key

exec node dist/server.js
