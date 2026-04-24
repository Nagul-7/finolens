#!/bin/bash
# FinoLens — Start All Services
# Kills any existing instances and restarts everything cleanly

set -e
FINOLENS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
TEAL='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${TEAL}"
echo "  ███████╗██╗███╗   ██╗ ██████╗ ██╗     ███████╗███╗   ██╗███████╗"
echo "  ██╔════╝██║████╗  ██║██╔═══██╗██║     ██╔════╝████╗  ██║██╔════╝"
echo "  █████╗  ██║██╔██╗ ██║██║   ██║██║     █████╗  ██╔██╗ ██║███████╗"
echo "  ██╔══╝  ██║██║╚██╗██║██║   ██║██║     ██╔══╝  ██║╚██╗██║╚════██║"
echo "  ██║     ██║██║ ╚████║╚██████╔╝███████╗███████╗██║ ╚████║███████║"
echo "  ╚═╝     ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═══╝╚══════╝"
echo -e "${NC}"
echo -e "${TEAL}  Personal Stock Market Intelligence Platform${NC}"
echo ""

# Kill existing processes on ports 3000, 5000, 8000
echo -e "${YELLOW}→ Stopping any existing FinoLens services...${NC}"
for PORT in 3000 5000 8000; do
  PID=$(lsof -ti:$PORT 2>/dev/null)
  if [ ! -z "$PID" ]; then
    kill -9 $PID 2>/dev/null
    echo -e "  Killed process on port $PORT (PID: $PID)"
  fi
done
sleep 1

# Check PostgreSQL
echo -e "${YELLOW}→ Checking PostgreSQL...${NC}"
if ! pg_isready -q 2>/dev/null; then
  echo -e "  ${RED}PostgreSQL not running. Starting...${NC}"
  sudo systemctl start postgresql
  sleep 2
fi
echo -e "  ${GREEN}✔ PostgreSQL ready${NC}"

# Check Redis
echo -e "${YELLOW}→ Checking Redis...${NC}"
if ! redis-cli ping > /dev/null 2>&1; then
  echo -e "  ${RED}Redis not running. Starting...${NC}"
  sudo systemctl start redis-server
  sleep 1
fi
echo -e "  ${GREEN}✔ Redis ready${NC}"

# Start ML Service
echo -e "${YELLOW}→ Starting ML Service (port 8000)...${NC}"
cd "$FINOLENS_DIR/ml-service"
nohup uvicorn main:app --host 0.0.0.0 --port 8000 > "$FINOLENS_DIR/logs/ml-service.log" 2>&1 &
ML_PID=$!
echo $ML_PID > "$FINOLENS_DIR/logs/ml-service.pid"
sleep 3

# Verify ML service
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
  echo -e "  ${GREEN}✔ ML Service running (PID: $ML_PID)${NC}"
else
  echo -e "  ${RED}✖ ML Service failed to start. Check logs/ml-service.log${NC}"
  exit 1
fi

# Start Backend
echo -e "${YELLOW}→ Starting Backend (port 5000)...${NC}"
cd "$FINOLENS_DIR/backend"
nohup node src/server.js > "$FINOLENS_DIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$FINOLENS_DIR/logs/backend.pid"
sleep 3

# Verify backend
if curl -s http://localhost:5000/api/health > /dev/null 2>&1; then
  echo -e "  ${GREEN}✔ Backend running (PID: $BACKEND_PID)${NC}"
else
  echo -e "  ${RED}✖ Backend failed to start. Check logs/backend.log${NC}"
  exit 1
fi

# Start Frontend
echo -e "${YELLOW}→ Starting Frontend (port 3000)...${NC}"
cd "$FINOLENS_DIR/frontend"
nohup npm run dev > "$FINOLENS_DIR/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$FINOLENS_DIR/logs/frontend.pid"
sleep 4

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     FinoLens is running!               ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Frontend  →  http://localhost:3000    ║${NC}"
echo -e "${GREEN}║  Backend   →  http://localhost:5000    ║${NC}"
echo -e "${GREEN}║  ML API    →  http://localhost:8000    ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Logs →  ~/Desktop/finolens/logs/      ║${NC}"
echo -e "${GREEN}║  Stop →  ./stop.sh                     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

# Create stop script
cat > "$FINOLENS_DIR/stop.sh" << 'STOP'
#!/bin/bash
echo "Stopping FinoLens..."
for PORT in 3000 5000 8000; do
  PID=$(lsof -ti:$PORT 2>/dev/null)
  if [ ! -z "$PID" ]; then
    kill -9 $PID 2>/dev/null
    echo "  Stopped port $PORT"
  fi
done
echo "All services stopped."
STOP
chmod +x "$FINOLENS_DIR/stop.sh"
