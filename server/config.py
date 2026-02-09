import os

# LLM backend: "claude-cli" | "gemini-cli" | "codex-cli" | "openai-api" | "anthropic-api"
LLM_BACKEND = os.environ.get("LLM_BACKEND", "claude-cli")

# API keys (only needed for API backends)
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Model names
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")

# Database
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "translations.db"))

# Translation batching — max keys per LLM call
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "50"))

# Max parallel LLM calls (claude CLI Pro allows 5 concurrent)
MAX_PARALLEL = int(os.environ.get("MAX_PARALLEL", "5"))

# Server
SERVER_PORT = int(os.environ.get("SERVER_PORT", "39418"))
