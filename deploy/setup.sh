#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Switchboard Production Setup Script
# Generates secrets, creates .env.prod, and starts the stack.
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env.prod"

echo "=== Switchboard Production Setup ==="
echo ""

# Check for required tools
for cmd in docker openssl; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: $cmd is required but not installed."
    exit 1
  fi
done

# Generate .env.prod if it doesn't exist
if [ -f "$ENV_FILE" ]; then
  echo "Found existing $ENV_FILE — skipping generation."
  echo "Delete it and re-run to regenerate."
else
  echo "Generating secrets and creating $ENV_FILE..."

  POSTGRES_PASSWORD=$(openssl rand -hex 16)
  CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -hex 32)
  INTERNAL_SETUP_SECRET=$(openssl rand -hex 32)
  INTERNAL_API_SECRET=$(openssl rand -hex 32)
  NEXTAUTH_SECRET=$(openssl rand -hex 32)
  API_KEY_ENCRYPTION_SECRET=$(openssl rand -hex 32)

  read -rp "Domain name (e.g. switchboard.example.com): " DOMAIN
  read -rp "Admin email for Let's Encrypt: " CERTBOT_EMAIL

  cat > "$ENV_FILE" <<EOF
# ==========================================================================
# Switchboard Production Environment — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# ==========================================================================

# Domain
DOMAIN=${DOMAIN}
CORS_ORIGIN=https://${DOMAIN}
NEXTAUTH_URL=https://${DOMAIN}

# Database
POSTGRES_USER=switchboard
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=switchboard

# Secrets (auto-generated, do not change after first deploy)
CREDENTIALS_ENCRYPTION_KEY=${CREDENTIALS_ENCRYPTION_KEY}
INTERNAL_SETUP_SECRET=${INTERNAL_SETUP_SECRET}
INTERNAL_API_SECRET=${INTERNAL_API_SECRET}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
API_KEY_ENCRYPTION_SECRET=${API_KEY_ENCRYPTION_SECRET}

# Channel tokens (fill in before starting)
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=

# LLM (required for lead bot mode)
ANTHROPIC_API_KEY=

# Lead bot mode (set both to enable conversational flows)
SKIN_ID=
PROFILE_ID=
LEAD_BOT_MODE=false

# Meta Ads (optional)
META_ADS_ACCESS_TOKEN=
META_ADS_ACCOUNT_ID=
META_PIXEL_ID=

# Stripe (optional)
STRIPE_SECRET_KEY=

# Let's Encrypt
CERTBOT_EMAIL=${CERTBOT_EMAIL}
EOF

  echo "Created $ENV_FILE"
  echo ""
  echo "IMPORTANT: Edit $ENV_FILE to add your channel tokens before starting."
fi

echo ""
echo "=== Next Steps ==="
echo ""
echo "1. Edit $ENV_FILE and add your channel tokens"
echo ""
echo "2. Update nginx/nginx.conf: replace DOMAIN with your actual domain"
echo "   sed -i 's/DOMAIN/${DOMAIN:-your-domain}/g' $PROJECT_DIR/nginx/nginx.conf"
echo ""
echo "3. Build and start (HTTP-only first for certbot):"
echo "   cd $PROJECT_DIR"
echo "   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build"
echo ""
echo "4. Get TLS certificate:"
echo "   docker compose -f docker-compose.prod.yml run certbot certonly \\"
echo "     --webroot -w /var/www/certbot -d \$DOMAIN --email \$CERTBOT_EMAIL --agree-tos"
echo ""
echo "5. Restart nginx to pick up the certificate:"
echo "   docker compose -f docker-compose.prod.yml restart nginx"
echo ""
echo "6. Bootstrap admin user:"
echo "   curl -X POST https://\$DOMAIN/api/setup/bootstrap \\"
echo "     -H 'Authorization: Bearer \$INTERNAL_SETUP_SECRET' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"email\": \"admin@example.com\", \"name\": \"Admin\", \"password\": \"your-secure-password\"}'"
echo ""
