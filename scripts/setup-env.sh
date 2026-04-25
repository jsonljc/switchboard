#!/usr/bin/env bash
# =============================================================================
# Switchboard Environment Setup
# Generates secure secrets for .env if not already set.
# Usage: ./scripts/setup-env.sh
# =============================================================================

set -euo pipefail

ENV_FILE="${1:-.env}"

echo "Switchboard environment setup"
echo ""

# Create .env from example if it doesn't exist
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example "$ENV_FILE"
    echo "Created $ENV_FILE from .env.example"
  else
    touch "$ENV_FILE"
    echo "Created empty $ENV_FILE"
  fi
fi

# Helper: set a variable if not already present or empty
set_secret() {
  local var="$1"
  local value="$2"
  local label="$3"

  if grep -q "^${var}=.\+" "$ENV_FILE" 2>/dev/null; then
    echo "  SKIP  ${label} (already set)"
  else
    # Remove empty entry if present, then append
    sed -i.bak "/^${var}=$/d" "$ENV_FILE" 2>/dev/null || true
    rm -f "${ENV_FILE}.bak"
    echo "${var}=${value}" >> "$ENV_FILE"
    echo "  SET   ${label}"
  fi
}

echo ""
echo "Generating secrets..."

# Redis password
REDIS_PW=$(openssl rand -base64 32)
set_secret "REDIS_PASSWORD" "$REDIS_PW" "REDIS_PASSWORD"

# Postgres password
PG_PW=$(openssl rand -base64 32)
set_secret "POSTGRES_PASSWORD" "$PG_PW" "POSTGRES_PASSWORD"

# Credentials encryption key
CRED_KEY=$(openssl rand -hex 32)
set_secret "CREDENTIALS_ENCRYPTION_KEY" "$CRED_KEY" "CREDENTIALS_ENCRYPTION_KEY"

# Session token secret
SESSION_SECRET=$(openssl rand -base64 32)
set_secret "SESSION_TOKEN_SECRET" "$SESSION_SECRET" "SESSION_TOKEN_SECRET"

# NextAuth secret
NEXTAUTH_SECRET=$(openssl rand -base64 32)
set_secret "NEXTAUTH_SECRET" "$NEXTAUTH_SECRET" "NEXTAUTH_SECRET"

# Internal API secret
INTERNAL_SECRET=$(openssl rand -base64 32)
set_secret "INTERNAL_API_SECRET" "$INTERNAL_SECRET" "INTERNAL_API_SECRET"

echo ""
echo "Done. Review $ENV_FILE and fill in remaining values (API keys, tokens, etc.)."
