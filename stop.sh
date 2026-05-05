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
