import logging
import sqlite3
from server.config import DB_PATH

log = logging.getLogger(__name__)


def _get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_text TEXT NOT NULL,
            source_hash TEXT NOT NULL,
            target_language TEXT NOT NULL,
            translated_text TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(source_hash, target_language)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_hash_lang
        ON translations(source_hash, target_language)
    """)
    conn.commit()
    conn.close()
    log.info("Database initialized at %s", DB_PATH)


def get_cached_batch(hashes, language):
    """Look up cached translations for a list of source hashes + language.
    Returns dict { source_hash: translated_text }."""
    if not hashes:
        return {}

    conn = _get_conn()
    placeholders = ",".join("?" for _ in hashes)
    rows = conn.execute(
        f"SELECT source_hash, translated_text FROM translations "
        f"WHERE source_hash IN ({placeholders}) AND target_language = ?",
        [*hashes, language]
    ).fetchall()
    conn.close()
    log.debug("Cache lookup: %d/%d hits for lang=%s", len(rows), len(hashes), language)
    return {row["source_hash"]: row["translated_text"] for row in rows}


def set_cached_batch(entries, language):
    """Store translations. entries = list of (source_text, source_hash, translated_text)."""
    if not entries:
        return

    conn = _get_conn()
    conn.executemany(
        "INSERT OR REPLACE INTO translations "
        "(source_text, source_hash, target_language, translated_text) "
        "VALUES (?, ?, ?, ?)",
        [(text, h, language, translated) for text, h, translated in entries]
    )
    conn.commit()
    conn.close()
    log.debug("Stored %d translations for lang=%s", len(entries), language)


def get_stats():
    conn = _get_conn()
    total = conn.execute("SELECT COUNT(*) as c FROM translations").fetchone()["c"]
    lang_rows = conn.execute(
        "SELECT target_language, COUNT(*) as c FROM translations GROUP BY target_language"
    ).fetchall()
    conn.close()
    return {
        "total": total,
        "by_language": {row["target_language"]: row["c"] for row in lang_rows}
    }


def get_languages():
    conn = _get_conn()
    rows = conn.execute(
        "SELECT DISTINCT target_language FROM translations ORDER BY target_language"
    ).fetchall()
    conn.close()
    return [row["target_language"] for row in rows]
