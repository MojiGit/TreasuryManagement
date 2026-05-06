# ── database.py ───────────────────────────────────────────
# Supabase client factory
#
# Required .env keys:
#   SUPABASE_URL          — e.g. https://xxxx.supabase.co
#   SUPABASE_SERVICE_KEY  — service_role secret key (never expose to frontend)
#
# Run this SQL once in the Supabase SQL editor to create the schema:
#
#   CREATE TABLE users (
#       id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
#       email         TEXT UNIQUE NOT NULL,
#       password_hash TEXT NOT NULL,
#       created_at    TIMESTAMPTZ DEFAULT NOW()
#   );
#
#   CREATE TABLE wallet_configs (
#       id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
#       user_id    UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,
#       config     JSONB NOT NULL,
#       updated_at TIMESTAMPTZ DEFAULT NOW()
#   );
# ─────────────────────────────────────────────────────────

import os
from functools import lru_cache
from supabase import create_client, Client


@lru_cache(maxsize=1)
def get_db() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Database not configured. "
            "Set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file."
        )
    return create_client(url, key)
