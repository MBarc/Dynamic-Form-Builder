<p align="center">
  <img src="pics/FormBuilderLogo.png" alt="Dynamic Form Builder logo" width="500"/>
</p>

<h1 align="center">📝 Dynamic Form Builder 📝</h1>

<p align="center">
  <em>A containerized, YAML-driven form builder that prototypes enterprise forms and dispatches them to GitHub Actions or Ansible Tower — with a built-in local AI assistant.</em>
</p>

---

## Table of Contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Using the interface](#using-the-interface)
- [AI assistant](#ai-assistant)
- [YAML schema reference](#yaml-schema-reference)
- [Standalone mode (no Docker)](#standalone-mode-no-docker)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [License](#license)

---

## Why this exists

Enterprise organizations often hit a coordination wall between development teams building automation workflows and the specialized teams that own form platforms (ServiceNow, SailPoint, etc.). The result:

- Development bottlenecks waiting for form-creation resources
- Misaligned requirements between technical implementations and the user-facing form
- Extended time-to-market for automation initiatives

Dynamic Form Builder is a **self-service prototyping environment**. Developers describe a form in YAML, watch it render live, validate the dispatch payload against a real GitHub Actions or Ansible Tower workflow, and hand off the same YAML as a structured spec to whoever owns the production form.

---

## Features

- **Live YAML editor** — type YAML, see the form render and the dispatch payload update in real time
- **Two integrations** — dispatch to GitHub Actions (`repository_dispatch`) or launch an Ansible Tower / AWX job template
- **Dynamic options** — populate `dropdown` / `checkbox` choices from a live API via the server-side proxy, with cursor- and `next_url`-style pagination
- **`{{env:VAR}}` placeholders** — form-level or server-level environment variables resolved server-side so tokens never reach the browser
- **Conditional logic** — `show_if` rules with `equals`, `not_equals`, `contains`, `not_empty` operators, including chained dependencies
- **Searchable dropdowns** — type-ahead filtering on long option lists
- **Folder organization** — drag-and-drop reorder, rename, drag forms between folders, multi-select delete
- **Dispatch history** — every dispatch is recorded with payload + response and viewable per form
- **AI assistant** — chat with a local Ollama model that proposes YAML changes you can review in a checkbox-driven diff modal before applying
- **Theme switcher** — four built-in themes (ServiceNow, Aurora, Midnight, Atlassian), preference persisted
- **Standalone mode** — single-file Flask server with JSON storage if you don't want Docker or MongoDB

---

## Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Browser    │ ─► │    nginx     │ ─► │ Flask API    │
│  (vanilla    │    │  (static +   │    │   (Python)   │
│   JS SPA)    │    │   reverse    │    └──┬────┬──────┘
└──────────────┘    │    proxy)    │       │    │
                    └──────────────┘       │    │
                                           ▼    ▼
                                   ┌─────────┐ ┌─────────┐
                                   │ MongoDB │ │ Ollama  │
                                   │ forms,  │ │ (local  │
                                   │ folders,│ │  LLM)   │
                                   │ history │ └─────────┘
                                   └─────────┘
```

| Component        | Purpose                                                              | Container        | Host port |
|------------------|----------------------------------------------------------------------|------------------|-----------|
| `frontend`       | nginx serving the SPA and reverse-proxying `/api/*`                  | `nginx:alpine`   | `8090`    |
| `flask-backend`  | REST API + GitHub/Ansible dispatch + `/api/proxy` + `/api/chat` SSE  | custom Python    | `3000`    |
| `mongodb`        | Forms, folders (with order), dispatch history                        | `mongo:7.0`      | `27017`   |
| `mongo-express`  | Optional MongoDB GUI                                                 | `mongo-express`  | `8091`    |
| `ollama`         | Local LLM runtime for the AI assistant                               | `ollama/ollama`  | `11434`   |
| `ollama-init`    | One-shot init container that pulls `llama3.2:3b` on first boot       | `ollama/ollama`  | —         |

---

## Quick start

```bash
git clone https://github.com/MBarc/dynamic-form-builder.git
cd dynamic-form-builder

docker-compose up -d
```

Then open:

- **App** — <http://localhost:8090>
- **MongoDB Express** (optional GUI) — <http://localhost:8091>

The first boot pulls the `llama3.2:3b` model (~2 GB) for the AI assistant. The app is usable immediately; the chat icon will start working once the pull finishes.

> ℹ️ The default MongoDB credentials are `changeme`/`changeme` and are intended for local development only. Override them via environment variables before deploying anywhere shared.

---

## Using the interface

![Form Builder interface](pics/FormBuilderExample.png)

### Landing view

- **Folder sidebar** — drag to reorder, right-click to rename or delete, `+ New Folder` to create
- **Form grid** — click to select, click again to open, Shift-click to multi-select, right-click for rename/duplicate/delete
- **Search** — filter forms by title or name across the current folder
- **Docs** — full YAML schema reference rendered inline

### Editor view

- **Left panel** — live form preview, integration switcher (None / GitHub Actions / Ansible Tower), form-level environment variables panel
- **Right panel** — YAML editor, dispatch payload preview, "Send to GitHub Actions" / "Launch on Ansible Tower" button, dispatch history viewer
- **Save** — `💾 Save to MongoDB` persists the YAML; the button reflects unsaved-state
- **Theme** — palette icon (top right) switches between the four built-in themes; preference is saved to `localStorage`

### Tokens

Personal access tokens (GitHub PAT, Ansible Tower token) are entered inline in the YAML under `github.token` / `ansible.token`. They are saved with the form, so use this for prototyping only — for production-grade secrets, prefer server-side env vars referenced via `{{env:VAR}}` (see below).

---

## AI assistant

A local Ollama model (default: `llama3.2:3b`) is wired into the chat icon at the bottom-right of the page.

- **Streamed responses** over server-sent events
- **Context-aware** — the current form's YAML is injected into the system prompt when the editor is open
- **Insert into editor** — every YAML code block in the response gets an "Insert" button
- **Diff review modal** — when there's existing YAML, the assistant's suggestion is rendered as a list of granular changes (added / modified / deleted fields, plus form-level metadata changes). Uncheck anything you don't want, then click **Apply Selected** — comments and formatting in your existing YAML are preserved via a CST-based round-trip when possible.

To use a different model, set `OLLAMA_MODEL` on the `flask-backend` service in `docker-compose.yml` (and pull it into the `ollama` container).

---

## YAML schema reference

### Top-level structure

```yaml
title: "My Form Title"           # Form heading
description: "Optional summary"  # Subtitle (optional)

env:                             # Optional — form-level variables (see below)
  DT_API_KEY: "dt0c01.xxxx"
  DT_ENV_ID:  "abc123"

github:                          # Optional — GitHub Actions dispatch
  token:      ""                 # PAT (saved with form — use for prototyping)
  repository: "org/repo"
  workflow:   "workflow-file.yml"
  event_type: "my_event_type"

ansible:                         # Optional — Ansible Tower / AWX
  token:           ""
  tower_url:       "https://tower.example.com"
  job_template_id: 42

fields:
  - name: "fieldName"            # Unique payload key
    label: "Field Label"
    type: "text"
    # ... field properties below
```

> Only one of `github:` or `ansible:` may be active at a time. The integration switcher in the editor swaps between them safely.

### Field types

| Type             | Description                                                                  |
|------------------|------------------------------------------------------------------------------|
| `text`           | Single-line text input                                                       |
| `email`          | Email input (browser-validated)                                              |
| `number`         | Numeric input (supports `min` / `max`)                                       |
| `datetime-local` | Date and time picker                                                         |
| `textarea`       | Multi-line text input                                                        |
| `dropdown`       | Single-select — requires `options` or `source`                               |
| `checkbox`       | Multi-select — requires `options` or `source`; payload value is an array     |

### Common field properties

| Property      | Type          | Required | Description                                                  |
|---------------|---------------|----------|--------------------------------------------------------------|
| `name`        | string        | yes      | Unique payload key                                           |
| `label`       | string        | yes      | Label shown above the field                                  |
| `type`        | string        | yes      | One of the field types above                                 |
| `required`    | boolean       | no       | Marks the field mandatory (`true` / `false`, never yes/no)   |
| `placeholder` | string        | no       | Hint text inside the input                                   |
| `default`     | string/number | no       | Pre-filled value on load                                     |
| `note`        | string        | no       | 💡 helper text rendered below the field                      |
| `min` / `max` | number        | no       | Numeric bounds (`number` type only)                          |
| `options`     | list          | dropdown / checkbox | Static list of `{ value, label }` choices         |
| `source`      | object        | dropdown / checkbox | Live API source (replaces `options`)              |
| `show_if`     | object        | no       | Conditional visibility — see below                           |

### Static options

```yaml
options:
  - value: "payload_value"
    label: "Displayed label"
```

### Dynamic options (`source`)

A `dropdown` or `checkbox` can be populated from a live API GET request. The request is made server-side via `/api/proxy`, so tokens never reach the browser.

```yaml
- name: "managementZone"
  label: "Management Zone"
  type: "dropdown"
  required: true
  source:
    url: "https://{{env:DT_ENV_ID}}.live.dynatrace.com/api/v2/managementZones"
    headers:
      Authorization: "Api-Token {{env:DT_API_TOKEN}}"
    path:  "managementZones"   # dot-notation path to the array in the response
    value: "id"                # field of each item used as the payload value
    label: "name"              # field of each item displayed in the UI
```

| Property     | Required | Description                                                                                       |
|--------------|----------|---------------------------------------------------------------------------------------------------|
| `url`        | yes      | Full URL of the GET endpoint. Supports `{{env:VAR}}`.                                             |
| `headers`    | no       | HTTP header map. Supports `{{env:VAR}}`.                                                          |
| `path`       | no       | Dot-notation path to the array in the response (omit if root is already an array).                |
| `value`      | no       | Field of each item used as the option value. Omit to use the whole item.                          |
| `label`      | no       | Field of each item used as the displayed label. Omit to use the whole item.                       |
| `pagination` | no       | Pagination config — see below.                                                                    |

#### Pagination (`source.pagination`)

The proxy fetches all pages server-side and returns one merged array (hard cap: 20 pages).

| Property        | Type       | Description                                                                            |
|-----------------|------------|----------------------------------------------------------------------------------------|
| `type`          | required   | `cursor` (cursor passed as a query param) or `next_url` (full next URL in body)        |
| `next_path`     | `cursor`   | Dot-path to the cursor value in the response                                           |
| `next_param`    | `cursor`   | Query parameter name to send the cursor on the next request                            |
| `next_url_path` | `next_url` | Dot-path to the full next-page URL in the response                                     |

`cursor` example (Dynatrace-style):

```yaml
pagination:
  type:       "cursor"
  next_path:  "nextPageKey"
  next_param: "nextPageKey"
```

`next_url` example (GitHub-style):

```yaml
pagination:
  type:          "next_url"
  next_url_path: "next"
```

### Form-level environment variables (`env`)

```yaml
env:
  DT_API_KEY: "dt0c01.xxxx"
  DT_ENV_ID:  "abc123.live.dynatrace.com"
```

- Saved with the form, available to any `{{env:VAR}}` placeholder in `source.url` / `source.headers`
- **Resolution order:** form-level `env` overrides server environment variables of the same name
- Stored in plaintext alongside the rest of the form — for highly sensitive secrets, prefer setting a server env var on the `flask-backend` container instead

### Conditional logic (`show_if`)

A field with `show_if` is hidden until its condition is met. Hidden fields are **excluded from the payload** and their values are cleared on hide, so stale data never leaks.

```yaml
show_if:
  field:    "sourceFieldName"
  operator: "equals"          # optional; defaults to "equals"
  value:    "targetValue"     # not required for not_empty
```

| Operator                  | Best for             | Behaviour                                                |
|---------------------------|----------------------|----------------------------------------------------------|
| `equals` *(default)*      | dropdown, text       | Source value matches `value` exactly                     |
| `not_equals`              | dropdown, text       | Source value does not match `value`                      |
| `contains`                | checkbox, text       | Checkbox includes `value`, or text contains the substring|
| `not_empty`               | any                  | Source field has any non-empty value                     |

A conditional field can itself be the source of another `show_if` — chains are evaluated until stable, so multi-level branching works.

### Complete example

```yaml
title: "Access Request"
description: "Request access to a system or environment"

github:
  token: ""
  repository: "my-org/automation-repo"
  workflow:   "access-request.yml"
  event_type: "access_request_automation"

fields:
  - name: "requestorName"
    label: "Your Name"
    type: "text"
    required: true

  - name: "environment"
    label: "Target Environment"
    type: "dropdown"
    required: true
    options:
      - { value: "development", label: "Development" }
      - { value: "staging",     label: "Staging" }
      - { value: "production",  label: "Production" }

  - name: "productionApprover"
    label: "Production Approver"
    type: "text"
    required: true
    note: "All production requests require manager approval"
    show_if:
      field: "environment"
      value: "production"

  - name: "accessLevel"
    label: "Access Level"
    type: "dropdown"
    required: true
    options:
      - { value: "read",  label: "Read-only" }
      - { value: "write", label: "Read / Write" }
      - { value: "admin", label: "Admin" }

  - name: "justification"
    label: "Admin Justification"
    type: "textarea"
    required: true
    show_if:
      field: "accessLevel"
      value: "admin"
```

---

## Standalone mode (no Docker)

If you don't want Docker or MongoDB, a single-file alternative server is included. It serves the frontend, exposes the same `/api/*` endpoints, and stores all form data in a local `forms.json` file.

```bash
pip install -r requirements-standalone.txt
python standalone.py
# → http://localhost:8080
```

Writes to `forms.json` are atomic (temp-file + rename), so a crash mid-save won't corrupt your data. The AI assistant is not available in standalone mode.

| Variable     | Default       | Description                       |
|--------------|---------------|-----------------------------------|
| `PORT`       | `8080`        | Port the server listens on        |
| `FORMS_FILE` | `forms.json`  | Path to the JSON storage file     |

---

## Configuration

Environment variables read by the Flask backend (set them on the `flask-backend` service in `docker-compose.yml`):

| Variable                       | Default                  | Description                                          |
|--------------------------------|--------------------------|------------------------------------------------------|
| `MONGO_HOST`                   | `localhost`              | MongoDB host                                         |
| `MONGO_PORT`                   | `27017`                  | MongoDB port                                         |
| `MONGO_INITDB_ROOT_USERNAME`   | `changeme`               | MongoDB username                                     |
| `MONGO_INITDB_ROOT_PASSWORD`   | `changeme`               | MongoDB password                                     |
| `MONGO_INITDB_DATABASE`        | `forms`                  | MongoDB database                                     |
| `OLLAMA_HOST`                  | `http://localhost:11434` | Ollama runtime URL                                   |
| `OLLAMA_MODEL`                 | `llama3.2:3b`            | Model used by `/api/chat`                            |
| Any name referenced via `{{env:VAR}}` | —                 | Resolved into `source.url` / `source.headers`        |

### Seeding example forms

After the stack is up, you can populate three demo forms that exercise the `source:` feature:

```bash
python seed_source_templates.py
```

They are placed into a `Source Examples` folder.

---

## Project layout

```
dynamic-form-builder/
├── backend/
│   ├── app.py              # Flask API: forms, folders, history, dispatch, proxy, chat
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── assets/
│   │   ├── app.js          # Editor, dispatch, conditional logic, landing/folder UI
│   │   ├── chat.js         # AI assistant + diff review modal
│   │   └── styles.css      # Theme system (ServiceNow / Aurora / Midnight / Atlassian)
│   ├── index.html
│   └── nginx.conf          # Static + reverse proxy + SSE pass-through
├── database/
│   └── init-mongo.js       # First-boot sample forms + indexes + app user
├── pics/                   # README images
├── docker-compose.yml      # mongo + flask + nginx + mongo-express + ollama
├── standalone.py           # Single-file no-Docker alternative
├── seed_source_templates.py
└── README.md
```

---

## License

See [LICENSE](LICENSE).
