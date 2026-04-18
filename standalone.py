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
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory

# ── Configuration ──────────────────────────────────────────────────────────────

BASE_DIR    = Path(__file__).parent
FRONTEND    = BASE_DIR / "frontend"
FORMS_FILE  = Path(os.getenv("FORMS_FILE", BASE_DIR / "forms.json"))
PORT        = int(os.getenv("PORT", 8080))

# ── App setup ──────────────────────────────────────────────────────────────────

app   = Flask(__name__, static_folder=None)
_lock = threading.Lock()   # guards all reads and writes to FORMS_FILE

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
            "createdAt":   now,
            "updatedAt":   now,
        }
        forms.append(doc)
        _write(forms)

    return jsonify(doc), 201


@app.route("/api/forms/<form_name>", methods=["PUT"])
def update_form(form_name):
    data    = request.json or {}
    allowed = {"name", "title", "yamlContent"}
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
