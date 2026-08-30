from __future__ import annotations

import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://vellum:vellum@db:5432/vellum"
    anthropic_api_key: str = ""
    upload_dir: str = "uploads"
    max_upload_size: int = 25 * 1024 * 1024  # 25MB

    # Answering a due-diligence question well means chaining retrieval calls and quoting
    # source text exactly, so this defaults to a model that follows tool and formatting
    # instructions reliably. Override with LLM_MODEL to trade capability for cost.
    llm_model: str = "claude-opus-5"

    model_config = {"env_file": ".env"}


settings = Settings()

# Ensure the Anthropic API key is available as an environment variable
# so that pydantic-ai's Anthropic integration can pick it up.
if settings.anthropic_api_key:
    os.environ.setdefault("ANTHROPIC_API_KEY", settings.anthropic_api_key)
