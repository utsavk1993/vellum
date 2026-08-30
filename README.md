# Vellum

A document question-and-answer tool for commercial real estate lawyers.

Upload the documents in a matter, ask questions across them, and get answers you can
check against the source.

## Setup

### Prerequisites

- Docker and Docker Compose
- `just` (`brew install just` or `cargo install just`)

### Getting started

```bash
just setup                       # copies .env.example to .env, builds images
# add your key to .env:  ANTHROPIC_API_KEY=sk-ant-...
just dev                         # Postgres + backend (:8000) + frontend (:5173)
```

Migrations run automatically when the backend starts.

### Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Required. |
| `API_PORT` | `8000` | |

## Project structure

- `backend/` — FastAPI, SQLAlchemy, PydanticAI
- `frontend/` — React, Vite, Tailwind
- `alembic/` — database migrations

## Commands

| Command | Purpose |
| --- | --- |
| `just dev` | Start the full stack |
| `just stop` / `just reset` | Stop, or stop and clear the database |
| `just check` / `just fmt` | Lint and typecheck, or format |
| `just logs-backend` | Tail backend logs |
| `just db-shell` | Open a psql shell |
