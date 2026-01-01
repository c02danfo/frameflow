#!/bin/bash
# Quick deployment script for FrameFlow production

set -e

echo "🚀 FrameFlow Production Deployment"
echo "===================================="

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "❌ .env.production not found!"
    echo "   Copy .env.production.template and configure it first."
    exit 1
fi

# Load environment
export $(cat .env.production | grep -v '^#' | xargs)

# Verify SESSION_SECRET is set
if [ -z "$SESSION_SECRET" ] || [ "$SESSION_SECRET" = "GENERATE_STRONG_SECRET_HERE_128_CHARS" ]; then
    echo "❌ SESSION_SECRET not configured in .env.production"
    exit 1
fi

echo "✅ Environment loaded"

# Pull latest changes (if in git)
if [ -d .git ]; then
    echo "📥 Pulling latest changes..."
    git pull
fi

# Build and deploy
echo "🔨 Building containers..."
docker compose -f docker-compose.production.yml build

echo "🚢 Starting services..."
docker compose -f docker-compose.production.yml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check status
echo ""
echo "📊 Service Status:"
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
