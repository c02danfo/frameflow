# FrameFlow Deployment Guide - Hostinger VPS

## Rekommenderat arbetssätt (enkelt)

**Mål:** Du utvecklar lokalt, pushar till GitHub, och kör en manuell deploy på VPS i `~/OnlineApps`.

- **Lokalt:** ändra kod → `git commit` → `git push`
- **VPS:** `git pull` → `docker compose up -d --build`

Detta ger versionshistorik och enkel rollback, utan att du behöver automation direkt.

## Prerequisites

✅ **Already completed:**
- Single Sign-On (SSO) implementation
- Shared session store in PostgreSQL
- Both apps use same SESSION_SECRET
- Login works on first attempt (no double-login)
- Cross-app navigation configured

## System Requirements

- Ubuntu 22.04 LTS (or similar)
- Docker & Docker Compose installed
- Domain names configured (DNS A records)
- PostgreSQL database accessible at 192.168.0.192:15432

## Deployment Steps

### 1. Initial Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version
```

### 2. Clone Repository & Configure

```bash
# Clone your repository
cd ~
git clone YOUR_REPO_URL OnlineApps
cd OnlineApps

# Create production environment file
cp .env.production.template .env.production
nano .env.production
```

**Edit `.env.production`:**
```env
SESSION_SECRET=GENERATE_A_STRONG_RANDOM_SECRET
JWT_SECRET=GENERATE_A_STRONG_RANDOM_SECRET
AUTH_DB_PASSWORD=your_secure_auth_db_password
INVENTORY_DB_PASSWORD=your_actual_db_password
FRAMING_DB_PASSWORD=your_actual_db_password
DOMAIN=frameflowapp.com
```

**⚠️ Important:** The `DOMAIN` value should be your base domain (e.g., `frameflowapp.com`) without protocol. The system will automatically create `inventory.frameflowapp.com` and `framing.frameflowapp.com`.

### 3. Configure Domain Names

Edit `caddy/Caddyfile.production`:
```bash
nano caddy/Caddyfile.production
```

Replace `YOUR_DOMAIN` with your actual domain:
- `inventory.YOUR_DOMAIN` → `inventory.frameflowapp.com`
- `framing.YOUR_DOMAIN` → `framing.frameflowapp.com`

**DNS Configuration** (in Hostinger panel):
```
Type  | Name      | Value           | TTL
------|-----------|-----------------|------
A     | inventory | 145.223.83.210  | 3600
A     | framing   | 145.223.83.210  | 3600
A     | @         | 145.223.83.210  | 3600
```

### 4. Database Setup

Ensure PostgreSQL on 192.168.0.192:15432 has:

```sql
-- Inventory database
CREATE DATABASE inventory_artyx;

-- Framing database  
CREATE DATABASE framing_app;

-- Shared user (or separate users)
CREATE USER inventory_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE inventory_artyx TO inventory_user;
GRANT ALL PRIVILEGES ON DATABASE framing_app TO inventory_user;

-- Enable network access in postgresql.conf:
listen_addresses = '*'

-- Add to pg_hba.conf:
host    inventory_artyx    inventory_user    YOUR_VPS_IP/32    md5
host    framing_app        inventory_user    YOUR_VPS_IP/32    md5
```

### 5. Build & Deploy

```bash
# Load environment variables
export $(cat .env.production | xargs)

# Build and start services
docker compose -f docker-compose.production.yml up -d --build

# Check logs
docker compose -f docker-compose.production.yml logs -f

# Verify health
docker compose -f docker-compose.production.yml ps
```

### 6. Verify Deployment

```bash
# Check containers are running
docker ps

# Expected output:
# - frameflow-inventory (port 3015)
# - frameflow-framing (port 3011)
# - frameflow-caddy (ports 80, 443)

# Test endpoints
curl -I http://localhost:3015/auth/login
curl -I http://localhost:3011/auth/login

# Test HTTPS (after DNS propagation)
curl -I https://inventory.yourdomain.com
curl -I https://framing.yourdomain.com
```

### 7. Test SSO Flow

1. Open `https://inventory.yourdomain.com`
2. Login with `admin@inventory.local` / `test123`
3. Click "Ramapp" dropdown → "Order"
4. **Expected:** Should land on framing-app WITHOUT re-login
5. Verify user badge shows your email on both apps

### 8. Firewall Configuration

```bash
# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp  # HTTP/3

# PostgreSQL (if needed externally)
sudo ufw allow from 192.168.0.192 to any port 5432

# Enable firewall
sudo ufw enable
```

## Backup Strategy

### Automated Daily Backups

Create `/root/backup-frameflow.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/backups/frameflow"
DATE=$(date +%Y-%m-%d)
mkdir -p "$BACKUP_DIR"

# Backup inventory database
docker exec frameflow-inventory pg_dump -U inventory_user -d inventory_artyx | gzip > "$BACKUP_DIR/inventory-$DATE.sql.gz"

# Backup framing database (from remote host via psql)
PGPASSWORD=your_password pg_dump -h 192.168.0.192 -p 15432 -U inventory_user -d framing_app | gzip > "$BACKUP_DIR/framing-$DATE.sql.gz"

# Keep last 30 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete

echo "Backup completed: $DATE"
```

**Setup cron:**
```bash
chmod +x /root/backup-frameflow.sh
crontab -e

# Add line:
0 2 * * * /root/backup-frameflow.sh >> /var/log/frameflow-backup.log 2>&1
```

## Maintenance Commands

```bash
# View logs
docker compose -f docker-compose.production.yml logs -f inventory-app
docker compose -f docker-compose.production.yml logs -f framing-app
docker compose -f docker-compose.production.yml logs -f caddy

# Restart service
docker compose -f docker-compose.production.yml restart inventory-app

# Update after code changes
git pull
docker compose -f docker-compose.production.yml up -d --build

# Stop all services
docker compose -f docker-compose.production.yml down

# Remove volumes (⚠️ deletes data)
docker compose -f docker-compose.production.yml down -v

---

## Lokal utveckling (utanför VPS) med `frameflow.test`

SSO/cookies använder subdomäner, så vi kör lokalt med en riktig basdomän (`frameflow.test`) + Caddy med intern TLS.

### 1. Förbered lokala env-vars

I repo-roten:

```bash
cp .env.example .env
```

Öppna `.env` och sätt minst:
- `SESSION_SECRET` (slumpad, lång)
- `JWT_SECRET` (slumpad, lång)
- `AUTH_DB_PASSWORD`, `INVENTORY_DB_PASSWORD`, `FRAMING_DB_PASSWORD`
- `DOMAIN=frameflow.test`

### 2. Lägg till hosts-entries

På din lokala dator (Linux/macOS):

```bash
sudo sh -c 'printf "127.0.0.1 frameflow.test inventory.frameflow.test framing.frameflow.test\n" >> /etc/hosts'
```

### 3. Starta allt lokalt

Kör Compose med lokal override (Caddy använder `caddy/Caddyfile.local`):

```bash
docker compose -f docker-compose.production.yml -f docker-compose.local.override.yml up -d --build
```

### 4. Öppna i webbläsaren

- Dashboard: `https://frameflow.test`
- Inventory: `https://inventory.frameflow.test`
- Framing: `https://framing.frameflow.test`

Första gången kommer din webbläsare varna för cert (Caddy `tls internal`). Godkänn för lokal dev.

### 5. Stoppa lokalt

```bash
docker compose -f docker-compose.production.yml -f docker-compose.local.override.yml down
```

---

## Manuell deploy till VPS i `~/OnlineApps` (privat GitHub repo)

### 1. Skapa deploy key på VPS

```bash
ssh-keygen -t ed25519 -C "frameflow-vps-deploy" -f ~/.ssh/frameflow_deploy -N ""
cat ~/.ssh/frameflow_deploy.pub
```

Lägg in public key i GitHub:
- Repo → **Settings** → **Deploy keys** → **Add deploy key**
- Klistra in nyckeln
- **Read access** räcker (för `git pull`)

### 2. Konfigurera SSH på VPS

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
   IdentityFile ~/.ssh/frameflow_deploy
   IdentitiesOnly yes
EOF

ssh -T git@github.com
```

### 3. Klona repot till rätt mapp

```bash
cd ~
git clone git@github.com:c02danfo/frameflow.git OnlineApps
cd ~/OnlineApps
```

### 4. Skapa `.env.production` på VPS (committas inte)

```bash
cp .env.production.template .env.production
nano .env.production
```

Sätt minst: `SESSION_SECRET`, `JWT_SECRET`, `AUTH_DB_PASSWORD`, `INVENTORY_DB_PASSWORD`, `FRAMING_DB_PASSWORD`, `DOMAIN`.

### 5. Deploy

```bash
cd ~/OnlineApps
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml ps
```

### 6. Uppdatera vid ny kod (rutin)

```bash
cd ~/OnlineApps
git pull
docker compose -f docker-compose.production.yml up -d --build
```
```

## Monitoring

```bash
# Resource usage
docker stats

# Service health
docker compose -f docker-compose.production.yml ps

# Caddy logs (access/errors)
docker exec frameflow-caddy cat /data/logs/inventory-access.log
docker exec frameflow-caddy cat /data/logs/framing-access.log
```

## Troubleshooting

### SSO not working (re-login required)

**Check:**
1. Both apps use same SESSION_SECRET: `docker compose -f docker-compose.production.yml config | grep SESSION_SECRET`
2. Both containers can reach same DB: `docker logs frameflow-inventory | grep PostgreSQL`
3. Cookie domain is correct (both on same parent domain)

### App won't start

```bash
# Check specific container logs
docker logs frameflow-inventory
docker logs frameflow-framing

# Common issues:
# - Database connection timeout → Check DB_HOST/PORT in .env
# - Port conflict → Check if ports 3011/3015 already used
# - Missing env vars → Verify .env.production is loaded
```

### HTTPS certificate issues

```bash
# Check Caddy config syntax
docker exec frameflow-caddy caddy validate --config /etc/caddy/Caddyfile

# Restart Caddy
docker compose -f docker-compose.production.yml restart caddy

# View Caddy logs
docker logs frameflow-caddy
```

## Security Checklist

- [ ] Strong SESSION_SECRET (128+ characters)
- [ ] Database passwords changed from defaults
- [ ] PostgreSQL only accepts connections from VPS IP
- [ ] Firewall configured (ufw enabled)
- [ ] HTTPS enforced (Caddy auto-redirects)
- [ ] Regular backups scheduled
- [ ] `.env.production` NOT committed to git
- [ ] Security headers enabled in Caddyfile

## Performance Tuning

```yaml
# Add to docker-compose.production.yml under each service:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

## Rollback Procedure

```bash
# Stop services
docker compose -f docker-compose.production.yml down

# Restore database backup
gunzip < /backups/frameflow/inventory-2025-12-29.sql.gz | docker exec -i frameflow-inventory psql -U inventory_user -d inventory_artyx

# Checkout previous git commit
git log --oneline
git checkout COMMIT_HASH

# Rebuild and restart
docker compose -f docker-compose.production.yml up -d --build
```

## Next Steps

1. **Test locally with external DB**:
   ```bash
   # Update inventory-artyx/backend/.env and framing-app/backend/.env
   # Then: docker compose -f docker-compose.production.yml up
   ```

2. **Deploy to VPS**:
   - Push code to Git
   - SSH to VPS
   - Follow steps above

3. **Monitor first 48h**:
   - Check logs daily
   - Verify SSO works across both apps
   - Test backup restoration

## Support

- Check logs: `docker compose logs -f`
- Health checks: `docker compose ps`
- Database connectivity: `docker exec -it frameflow-inventory pg_isready -h 192.168.0.192 -p 15432`
