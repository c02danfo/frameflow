#!/bin/bash
echo "🛑 Stopping all FrameFlow services..."

pkill -f "auth-service/backend.*nodemon" && echo "  ✓ Stopped auth-service" || echo "  - auth-service not running"
pkill -f "dashboard-app/backend.*nodemon" && echo "  ✓ Stopped dashboard-app" || echo "  - dashboard-app not running"
pkill -f "framing-app/backend.*nodemon" && echo "  ✓ Stopped framing-app" || echo "  - framing-app not running"
pkill -f "inventory-artyx/backend.*nodemon" && echo "  ✓ Stopped inventory-artyx" || echo "  - inventory-artyx not running"

pkill -f "auth-service/backend/src/index.js" 2>/dev/null
pkill -f "dashboard-app/backend/src/index.js" 2>/dev/null
pkill -f "framing-app/backend/src/index.js" 2>/dev/null
pkill -f "inventory-artyx/backend/src/index.js" 2>/dev/null

echo ""
echo "✅ All services stopped"
