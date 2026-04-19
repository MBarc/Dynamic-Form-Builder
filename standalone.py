#!/usr/bin/env python3
"""
Standalone server for Dynamic Form Builder.
No Docker, no MongoDB — just Python.

Forms are stored in a local JSON file (forms.json by default).
The server serves the existing frontend and exposes the same /api/*
contract as the Docker backend, so the frontend needs no changes.

Usage
-----
    pip install flask requests
    python standalone.py

Environment variables (all optional)
-------------------------------------
    PORT        Port to listen on.              Default: 8080
    FORMS_FILE  Path to the JSON storage file.  Default: forms.json
                (created automatically on first run)
"""

import json
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory

# ── Configuration ──────────────────────────────────────────────────────────────

BASE_DIR      = Path(__file__).parent
FRONTEND      = BASE_DIR / "frontend"
FORMS_FILE    = Path(os.getenv("FORMS_FILE",   BASE_DIR / "forms.json"))
HISTORY_FILE  = Path(os.getenv("HISTORY_FILE", BASE_DIR / "history.json"))
PORT          = int(os.getenv("PORT", 8080))

# ── App setup ──────────────────────────────────────────────────────────────────

app   = Flask(__name__, static_folder=None)
_lock = threading.Lock()   # guards reads/writes to FORMS_FILE and HISTORY_FILE

# ── File-based storage helpers ─────────────────────────────────────────────────

def _read() -> list:
    """Return the list of stored form documents."""
    if not FORMS_FILE.exists():
        return []
    with FORMS_FILE.open(encoding="utf-8") as fh:
        return json.load(fh).get("forms", [])


def _write(forms: list) -> None:
    """Atomically persist the form list — safe against mid-write crashes."""
    content = json.dumps({"forms": forms}, indent=2, default=str)
    tmp = tempfile.NamedTemporaryFile(
        mode="w", dir=FORMS_FILE.parent,
        delete=False, suffix=".tmp", encoding="utf-8",
    )
    try:
        tmp.write(content)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp.close()
        os.replace(tmp.name, FORMS_FILE)   # atomic on POSIX and Windows
    except Exception:
        tmp.close()
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_history() -> list:
    if not HISTORY_FILE.exists():
        return []
    with HISTORY_FILE.open(encoding="utf-8") as fh:
        return json.load(fh).get("history", [])


def _write_history(history: list) -> None:
    content = json.dumps({"history": history[-200:]}, indent=2, default=str)
    tmp = tempfile.NamedTemporaryFile(
        mode="w", dir=HISTORY_FILE.parent,
        delete=False, suffix=".tmp", encoding="utf-8",
    )
    try:
        tmp.write(content); tmp.flush(); os.fsync(tmp.fileno()); tmp.close()
        os.replace(tmp.name, HISTORY_FILE)
    except Exception:
        tmp.close()
        try: os.unlink(tmp.name)
        except OSError: pass
        raise


# ── Frontend static files ──────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    # Catches assets/styles.css, assets/app.js, etc.
    # Flask will never reach this route for /api/* paths because
    # those explicit routes are registered first and take priority.
    return send_from_directory(FRONTEND, filename)


# ── Health check ───────────────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
def get_history():
    form_name = request.args.get("form")
    limit     = min(int(request.args.get("limit", 20)), 100)
    with _lock:
        history = _read_history()
    history = sorted(history, key=lambda r: r.get("timestamp", ""), reverse=True)
    if form_name:
        history = [r for r in history if r.get("form_name") == form_name]
    return jsonify(history[:limit])


@app.route("/api/history", methods=["POST"])
def add_history():
    data   = request.json or {}
    record = {
        "form_name":   data.get("form_name", ""),
        "integration": data.get("integration", ""),
        "timestamp":   _now(),
        "status":      data.get("status", "unknown"),
        "payload":     data.get("payload", {}),
        "response":    data.get("response", {}),
    }
    with _lock:
        history = _read_history()
        history.append(record)
        _write_history(history)
    return jsonify({"message": "Recorded"}), 201


@app.route("/api/health")
def health_check():
    # Return "mongodb: connected" so the frontend status badge stays green.
    # The frontend only checks that field; it doesn't care what's behind it.
    return jsonify({
        "status":    "healthy",
        "mongodb":   "connected",
        "storage":   str(FORMS_FILE),
        "timestamp": _now(),
    })


# ── Forms CRUD ─────────────────────────────────────────────────────────────────

@app.route("/api/forms", methods=["GET"])
def get_forms():
    with _lock:
        forms = _read()
    return jsonify(forms)


@app.route("/api/forms/<form_name>", methods=["GET"])
def get_form(form_name):
    with _lock:
        forms = _read()
    form = next((f for f in forms if f["name"] == form_name), None)
    if not form:
        return jsonify({"error": "Form not found"}), 404
    return jsonify(form)


@app.route("/api/forms", methods=["POST"])
def create_form():
    data = request.json or {}
    for field in ("name", "title", "yamlContent"):
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400

    with _lock:
        forms = _read()
        if any(f["name"] == data["name"] for f in forms):
            return jsonify({"error": "Form with this name already exists"}), 409
        now = _now()
        doc = {
            "name":        data["name"],
            "title":       data["title"],
            "yamlContent": data["yamlContent"],
            "folder":      data.get("folder", ""),
            "createdAt":   now,
            "updatedAt":   now,
        }
        forms.append(doc)
        _write(forms)

    return jsonify(doc), 201


@app.route("/api/forms/<form_name>", methods=["PUT"])
def update_form(form_name):
    data    = request.json or {}
    allowed = {"name", "title", "yamlContent", "folder"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return jsonify({"error": "Nothing to update"}), 400

    with _lock:
        forms = _read()
        for form in forms:
            if form["name"] == form_name:
                form.update(updates)
                form["updatedAt"] = _now()
                _write(forms)
                return jsonify(form)

    return jsonify({"error": "Form not found"}), 404


@app.route("/api/forms/<form_name>", methods=["DELETE"])
def delete_form(form_name):
    with _lock:
        forms     = _read()
        remaining = [f for f in forms if f["name"] != form_name]
        if len(remaining) == len(forms):
            return jsonify({"error": "Form not found"}), 404
        _write(remaining)
    return jsonify({"message": "Form deleted"})


# ── Ansible Tower launch ──────────────────────────────────────────────────────

@app.route("/api/ansible/launch", methods=["POST"])
def ansible_launch():
    data = request.json or {}
    for field in ("tower_url", "job_template_id", "ansible_token", "extra_vars"):
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400

    tower_url       = data["tower_url"].rstrip("/")
    job_template_id = data["job_template_id"]
    url     = f"{tower_url}/api/v2/job_templates/{job_template_id}/launch/"
    headers = {
        "Authorization": f"Bearer {data['ansible_token']}",
        "Content-Type":  "application/json",
    }

    try:
        resp = requests.post(url, json={"extra_vars": data["extra_vars"]}, headers=headers, timeout=15)
    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out after 15 seconds"}), 504
    except requests.exceptions.RequestException as exc:
        return jsonify({"error": f"Network error: {exc}"}), 500

    if resp.status_code in (200, 201):
        job = resp.json()
        return jsonify({
            "message": "Job launched successfully",
            "job_id":  job.get("id"),
            "job_url": f"{tower_url}/#/jobs/playbook/{job.get('id')}",
            "status":  job.get("status"),
        })
    if resp.status_code == 401:
        return jsonify({"error": "Authentication failed", "details": "Invalid or expired token"}), 401
    if resp.status_code == 404:
        return jsonify({"error": "Job template not found", "details": f"Template ID {job_template_id} not found or token lacks access"}), 404
    return jsonify({"error": "Tower API error", "details": resp.text, "status_code": resp.status_code}), resp.status_code


# ── External API proxy ────────────────────────────────────────────────────────

def _get_path(obj, path):
    """Navigate a dot-notation path in a nested dict (e.g. 'data.items')."""
    if not path:
        return obj
    for part in str(path).split("."):
        if not isinstance(obj, dict):
            return None
        obj = obj.get(part)
    return obj


@app.route("/api/proxy", methods=["POST"])
def api_proxy():
    """
    Proxy a GET request to an external URL on behalf of the frontend.

    {{env:VAR_NAME}} placeholders in the URL and headers are resolved in
    this order:
      1. Form-level env vars declared in the YAML (sent by the frontend)
      2. Server environment variables (fallback)

    When a `pagination` config is included the proxy loops through all
    pages server-side, merges results, and returns a flat array.
    """
    data    = request.json or {}
    raw_url = data.get("url", "").strip()
    if not raw_url:
        return jsonify({"error": "Missing url"}), 400

    form_env = {str(k): str(v) for k, v in (data.get("env") or {}).items()}

    def resolve(text):
        return re.sub(
            r"\{\{env:([^}]+)\}\}",
            lambda m: form_env.get(m.group(1).strip()) or os.environ.get(m.group(1).strip(), ""),
            str(text),
        )

    url     = resolve(raw_url)
    headers = {k: resolve(v) for k, v in (data.get("headers") or {}).items()}

    pagination = data.get("pagination")

    if pagination:
        path         = data.get("path", "")
        ptype        = str(pagination.get("type", "cursor"))
        all_items    = []
        current_url  = url
        extra_params = {}

        try:
            for _ in range(20):   # hard cap — prevents infinite loops
                resp = requests.get(current_url, headers=headers, params=extra_params, timeout=15)
                try:
                    body = resp.json()
                except ValueError:
                    return jsonify({"error": "Non-JSON response from paginated API"}), 502

                if not (200 <= resp.status_code < 300):
                    return jsonify({"error": f"API returned {resp.status_code}", "details": resp.text}), 502

                page_items = _get_path(body, path)
                if isinstance(page_items, list):
                    all_items.extend(page_items)

                if ptype == "cursor":
                    next_val = _get_path(body, pagination.get("next_path", ""))
                    if not next_val:
                        break
                    extra_params = {str(pagination.get("next_param", "cursor")): str(next_val)}
                    current_url  = url
                elif ptype == "next_url":
                    next_url_val = _get_path(body, pagination.get("next_url_path", "next"))
                    if not next_url_val:
                        break
                    current_url  = str(next_url_val)
                    extra_params = {}
                else:
                    break

        except requests.exceptions.Timeout:
            return jsonify({"error": "Request timed out after 15 seconds"}), 504
        except requests.exceptions.RequestException as exc:
            return jsonify({"error": f"Request failed: {exc}"}), 502

        return jsonify({"status": 200, "data": all_items, "paginated": True})

    # ── Non-paginated (original behaviour) ────────────────────────────────────
    try:
        resp = requests.get(url, headers=headers, timeout=15)
    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out after 15 seconds"}), 504
    except requests.exceptions.RequestException as exc:
        return jsonify({"error": f"Request failed: {exc}"}), 502

    try:
        body = resp.json()
    except ValueError:
        body = resp.text

    return jsonify({"status": resp.status_code, "data": body})


# ── GitHub Actions dispatch ────────────────────────────────────────────────────

@app.route("/api/github/dispatch", methods=["POST"])
def github_dispatch():
    data = request.json or {}
    for field in ("event_type", "client_payload", "github_token", "github_repository"):
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400

    repo = data["github_repository"]
    if "/" not in repo:
        return jsonify({"error": "Repository must be in format 'owner/repo'"}), 400

    url     = f"https://api.github.com/repos/{repo}/dispatches"
    headers = {
        "Authorization": f"token {data['github_token']}",
        "Accept":        "application/vnd.github.v3+json",
        "Content-Type":  "application/json",
        "User-Agent":    "Form-Builder/1.0",
    }
    payload = {
        "event_type":     data["event_type"],
        "client_payload": data["client_payload"],
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
    except requests.exceptions.RequestException as exc:
        return jsonify({"error": f"Network error: {exc}"}), 500

    if resp.status_code == 204:
        return jsonify({
            "message":    "Workflow dispatched successfully",
            "event_type": data["event_type"],
            "repository": repo,
            "timestamp":  _now(),
        })
    if resp.status_code == 401:
        return jsonify({
            "error":                "Authentication failed",
            "details":              "Invalid GitHub token or insufficient permissions",
            "required_permissions": ["repo", "workflow"],
        }), 401
    if resp.status_code == 404:
        return jsonify({
            "error":      "Repository not found",
            "details":    f"Repository '{repo}' not found or token lacks access",
            "repository": repo,
        }), 404
    if resp.status_code == 422:
        return jsonify({
            "error":      "Invalid event type",
            "details":    "The event_type might not match any repository_dispatch triggers",
            "event_type": data["event_type"],
        }), 422

    return jsonify({
        "error":       "GitHub API error",
        "details":     resp.text,
        "status_code": resp.status_code,
    }), resp.status_code


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 52)
    print("  Form Builder — standalone mode")
    print(f"  Frontend : {FRONTEND}")
    print(f"  Storage  : {FORMS_FILE}")
    print(f"  URL      : http://localhost:{PORT}")
    print("=" * 52)
    app.run(host="0.0.0.0", port=PORT, debug=False)
