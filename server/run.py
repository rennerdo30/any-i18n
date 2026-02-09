import logging
import signal
import sys
import uvicorn
from server.config import SERVER_PORT

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

if __name__ == "__main__":
    reload = "--no-reload" not in sys.argv
    uvicorn.run("server.main:app", host="0.0.0.0", port=SERVER_PORT, reload=reload)
