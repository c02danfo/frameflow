#!/bin/bash
echo "🚀 Starting all FrameFlow services..."

cd /Users/home/Projects/frameflow/frameflow/auth-service/backend && npm run dev > /tmp/frameflow-auth.log 2>&1 &
echo "  ✓ auth-service (port 3005)"

cd /Users/home/Projects/frameflow/frameflow/dashboard-app/backend && npm run dev > /tmp/frameflow-dashboard.log 2>&1 &
echo "  ✓ dashboard-app (port 3010)"

cd /Users/home/Projects/frameflow/frameflow/framing-app/backend && npm run dev > /tmp/frameflow-framing.log 2>&1 &
echo "  ✓ framing-app (port 3011)"

cd /Users/home/Projects/frameflow/frameflow/inventory-artyx/backend && npm run dev > /tmp/frameflow-inventory.log 2>&1 &
echo "  ✓ inventory-artyx (port 3015)"

sleep 3
echo ""
echo "✅ All services started!"
echo ""
echo "Services:"
echo "  - Auth:      http://localhost:3005"
echo "  - Dashboard: http://localhost:3010"
echo "  - Framing:   http://localhost:3011"
echo "  - Inventory: http://localhost:3015"
echo ""
echo "Logs:"
echo "  tail -f /tmp/frameflow-auth.log"
echo "  tail -f /tmp/frameflow-dashboard.log"
echo "  tail -f /tmp/frameflow-framing.log"
echo "  tail -f /tmp/frameflow-inventory.log"
echo ""
echo "To stop all services: ./stop-all.sh"
