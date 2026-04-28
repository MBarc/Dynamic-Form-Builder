# Dynamic Form Builder

A containerized, YAML-driven form builder for prototyping enterprise forms and dispatching them to GitHub Actions or Ansible Tower — with a built-in local AI assistant.

## Why this exists

Enterprise teams often hit a coordination wall between developers building automation workflows and the specialized teams that own form platforms (ServiceNow, SailPoint, etc.). Dynamic Form Builder lets developers:

- Prototype forms immediately in YAML without waiting on other teams
- Validate the dispatch payload against a real GitHub Actions or Ansible Tower workflow
- Hand off the same YAML as a structured spec to whoever owns the production form

## Features

- **Live YAML editor** — form renders and payload updates in real time as you type
- **GitHub Actions + Ansible Tower** — dispatch via `repository_dispatch` or launch an AWX job template
- **Dynamic options** — populate dropdowns/checkboxes from a live API with server-side pagination
- **`{{env:VAR}}` placeholders** — tokens resolved server-side so they never reach the browser
- **Conditional logic** — `show_if` rules with chained dependencies; hidden values excluded from the payload
- **AI assistant** — local Ollama model proposes YAML changes reviewable in a diff modal before applying
- **Folder organization** — drag-and-drop reorder, rename, multi-select bulk actions
- **Dispatch history** — every dispatch recorded with payload + response, viewable per form
- **Four themes** — ServiceNow, Aurora, Midnight, Atlassian

## Architecture

```
Browser → nginx (static + reverse proxy) → Flask API → MongoDB
                                                     → Ollama (local LLM)
```

| Service         | Purpose                                              | Host port |
|-----------------|------------------------------------------------------|-----------|
| `frontend`      | nginx — SPA + `/api/*` reverse proxy                 | `8090`    |
| `flask-backend` | REST API, dispatch, proxy, SSE chat                  | `3000`    |
| `mongodb`       | Forms, folders, dispatch history                     | `27017`   |
| `mongo-express` | Optional MongoDB GUI                                 | `8091`    |
| `ollama`        | Local LLM runtime (`llama3.2:3b`)                    | `11434`   |

## Quick start

```bash
git clone https://github.com/MBarc/dynamic-form-builder.git
cd dynamic-form-builder
docker-compose up -d
```

Open **http://localhost:8090**. The first boot pulls the `llama3.2:3b` model (~2 GB) for the AI assistant — the app is fully usable while that downloads.

> **Note:** Default MongoDB credentials are `changeme`/`changeme`. These are for local development only.

### Seed example forms

After the stack is up, populate three demo forms that exercise the dynamic `source:` feature:

```bash
python seed_source_templates.py
```

## Configuration

Environment variables on the `flask-backend` service:

| Variable                     | Default                    | Description                        |
|------------------------------|----------------------------|------------------------------------|
| `MONGO_HOST`                 | `localhost`                | MongoDB host                       |
| `MONGO_INITDB_ROOT_USERNAME` | `changeme`                 | MongoDB username                   |
| `MONGO_INITDB_ROOT_PASSWORD` | `changeme`                 | MongoDB password                   |
| `OLLAMA_HOST`                | `http://localhost:11434`   | Ollama runtime URL                 |
| `OLLAMA_MODEL`               | `llama3.2:3b`              | Model used by the chat assistant   |
| Any `{{env:VAR}}` name       | —                          | Resolved into source URLs/headers  |

## Documentation

Full YAML schema reference — field types, `source:` config, pagination, `show_if` conditional logic, and complete examples — is available inside the app under **Docs** in the left sidebar.

## Standalone mode (no Docker)

A single-file alternative stores forms in a local `forms.json` instead of MongoDB. The AI assistant is not available in this mode.

```bash
pip install -r requirements-standalone.txt
python standalone.py   # → http://localhost:8080
```

## Project layout

```
backend/          Flask API
frontend/         nginx-served SPA (app.js, chat.js, styles.css)
database/         MongoDB init script with sample forms
standalone.py     Single-file no-Docker alternative
seed_source_templates.py
docker-compose.yml
```

## License

See [LICENSE](LICENSE).
