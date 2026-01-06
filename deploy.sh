#!/bin/bash
set -e

echo "🚀 FrameFlow Production Deployment"
echo "===================================="

cd /OnlineApps

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "❌ .env.production not found!"
    echo "   Copy .env.production.template and configure it first."
    exit 1
fi

# Load env
export $(grep -v '^#' .env.production | xargs)

# Safety check
if [ -z "$SESSION_SECRET" ] || [[ "$SESSION_SECRET" == *"GENERATE"* ]]; then
  echo "❌ SESSION_SECRET not configured"
  exit 1
fi

echo "✅ Environment OK"

# Pull latest code
if [ -d .git ]; then
  echo "📥 Pulling latest changes..."
  git pull origin main
fi

# Hard restart
echo "🛑 Stopping containers..."
docker compose -f docker-compose.production.yml down

echo "🔨 Building containers..."
docker compose -f docker-compose.production.yml build

echo "🚢 Starting containers..."
docker compose -f docker-compose.production.yml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10


# Status
echo ""
echo "📊 Service status:"
docker compose -f docker-compose.production.yml ps

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🔗 Access your apps at:"
echo "   Inventory: https://inventory.YOUR_DOMAIN"
echo "   Framing:   https://framing.YOUR_DOMAIN"
echo ""
echo "📝 View logs with:"
echo "   docker compose -f docker-compose.production.yml logs -f"
