# Deployment Guide

Deploy Switchboard on a VPS with Docker Compose, Postgres, Redis, and nginx with TLS.

## Prerequisites

- VPS with 2+ GB RAM (DigitalOcean, Hetzner, etc.)
- Domain name with DNS A record pointing to the VPS IP
- Docker and Docker Compose installed on the VPS

## 1. Clone and Setup

```bash
git clone https://github.com/your-org/switchboard.git
cd switchboard
bash deploy/setup.sh
```

This generates `.env.prod` with random secrets. You'll need to fill in:

- Channel tokens (see [Channel Setup](./channel-setup.md))
- `SKIN_ID` and `PROFILE_ID` if using lead bot mode
- `ANTHROPIC_API_KEY` for LLM-powered responses

## 2. Configure Nginx

Replace `DOMAIN` in `nginx/nginx.conf` with your actual domain:

```bash
sed -i "s/DOMAIN/your-domain.com/g" nginx/nginx.conf
```

## 3. Build and Start

```bash
# Start the stack (HTTP-only initially for certbot)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Wait for all services to be healthy:

```bash
docker compose -f docker-compose.prod.yml ps
```

## 4. TLS Certificate

```bash
# Get certificate from Let's Encrypt
docker compose -f docker-compose.prod.yml run certbot certonly \
  --webroot -w /var/www/certbot \
  -d your-domain.com \
  --email your-email@example.com \
  --agree-tos

# Restart nginx to pick up the certificate
docker compose -f docker-compose.prod.yml restart nginx
```

## 5. Bootstrap Admin User

Create the first admin user and get an API key:

```bash
source .env.prod

curl -X POST https://your-domain.com/api/setup/bootstrap \
  -H "Authorization: Bearer $INTERNAL_SETUP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@yourbusiness.com",
    "name": "Admin",
    "password": "a-strong-password-here"
  }'
```

**Save the API key from the response** — it's only shown once.

## 6. Verify

```bash
# Health check
curl https://your-domain.com/health

# Should return: { "status": "ok", "checks": { "database": "ok", "redis": "ok" }, ... }
```

## 7. Register Webhooks

See [Channel Setup](./channel-setup.md) for registering Telegram and WhatsApp webhooks.

## Operations

### View Logs

```bash
docker compose -f docker-compose.prod.yml logs -f chat    # Chat server
docker compose -f docker-compose.prod.yml logs -f api     # API server
```

### Restart a Service

```bash
docker compose -f docker-compose.prod.yml restart chat
```

### Update Deployment

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

### Database Backup

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U switchboard switchboard > backup-$(date +%Y%m%d).sql
```

### Renew TLS Certificate

Certbot container auto-renews every 12 hours. To force renewal:

```bash
docker compose -f docker-compose.prod.yml run certbot renew
docker compose -f docker-compose.prod.yml restart nginx
```
