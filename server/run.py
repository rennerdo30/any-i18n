import logging
import os
import signal
import sys
import uvicorn
from server.config import SERVER_PORT

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

# os._exit bypasses all exception handlers — uvicorn's reload mode swallows sys.exit/SystemExit
signal.signal(signal.SIGINT, lambda *_: os._exit(0))
signal.signal(signal.SIGTERM, lambda *_: os._exit(0))

if __name__ == "__main__":
    reload = "--no-reload" not in sys.argv
    uvicorn.run("server.main:app", host="0.0.0.0", port=SERVER_PORT, reload=reload)
