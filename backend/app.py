# app.py
from flask import Flask, jsonify, request, Response
import json
from flask_cors import CORS
from pymongo import MongoClient
from bson.objectid import ObjectId
from datetime import datetime
import os
import re
import requests

app = Flask(__name__)
CORS(app)  # Enable CORS so your HTML frontend can call the API

# MongoDB connection
MONGO_USER = os.getenv("MONGO_INITDB_ROOT_USERNAME", "changeme")
MONGO_PASS = os.getenv("MONGO_INITDB_ROOT_PASSWORD", "changeme")
MONGO_DB = os.getenv("MONGO_INITDB_DATABASE", "forms")
MONGO_HOST = os.getenv("MONGO_HOST", "localhost")  # Use localhost for local testing
MONGO_PORT = int(os.getenv("MONGO_PORT", 27017))

# GitHub configuration (optional - for real GitHub integration)
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GITHUB_REPO_OWNER = os.getenv("GITHUB_REPO_OWNER", "your-org")
GITHUB_REPO_NAME = os.getenv("GITHUB_REPO_NAME", "your-repo")

mongo_uri = f"mongodb://{MONGO_USER}:{MONGO_PASS}@{MONGO_HOST}:{MONGO_PORT}/{MONGO_DB}?authSource=admin"
print(f"Connecting to MongoDB: {mongo_uri}")

try:
    client = MongoClient(mongo_uri)
    db = client[MONGO_DB]
    forms_collection   = db.forms
    history_collection = db.history
    folders_collection = db.folders
    # Test connection
    client.admin.command('ping')
    print("Successfully connected to MongoDB!")
except Exception as e:
    print(f"Failed to connect to MongoDB: {e}")

# Helper to convert ObjectId to string
def serialize_form(form):
    if form and '_id' in form:
        form['_id'] = str(form['_id'])
    return form

# Routes
@app.route('/api/forms', methods=['GET'])
def get_forms():
    try:
        forms = list(forms_collection.find())
        return jsonify([serialize_form(f) for f in forms])
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/api/forms/<form_name>', methods=['GET'])
def get_form(form_name):
    try:
        # Look up by name field, not ObjectId
        form = forms_collection.find_one({'name': form_name})
        if not form:
            return jsonify({"error": "Form not found"}), 404
        return jsonify(serialize_form(form))
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/api/forms', methods=['POST'])
def create_form():
    try:
        data = request.json
        required_fields = ['name', 'title', 'yamlContent']
        
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400
        
        # Check if form name already exists
        existing = forms_collection.find_one({'name': data['name']})
        if existing:
            return jsonify({"error": "Form with this name already exists"}), 409
        
        form_doc = {
            "name": data['name'],
            "title": data['title'],
            "yamlContent": data['yamlContent'],
            "folder": data.get('folder', ''),
            "createdAt": datetime.utcnow(),
            "updatedAt": datetime.utcnow()
        }
        
        result = forms_collection.insert_one(form_doc)
        form = forms_collection.find_one({'_id': result.inserted_id})
        return jsonify(serialize_form(form)), 201
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/api/forms/<form_name>', methods=['PUT'])
def update_form(form_name):
    try:
        data = request.json
        update_fields = {}
        
        # Map the fields correctly
        if 'yamlContent' in data:
            update_fields['yamlContent'] = data['yamlContent']
        if 'title' in data:
            update_fields['title'] = data['title']
        if 'name' in data:
            update_fields['name'] = data['name']
        if 'folder' in data:
            update_fields['folder'] = data['folder']
            
        if not update_fields:
            return jsonify({"error": "Nothing to update"}), 400
            
        update_fields['updatedAt'] = datetime.utcnow()
        
        result = forms_collection.update_one(
            {'name': form_name}, 
            {'$set': update_fields}
        )
        
        if result.matched_count == 0:
            return jsonify({"error": "Form not found"}), 404
            
        form = forms_collection.find_one({'name': form_name})
        return jsonify(serialize_form(form))
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/api/forms/<form_name>', methods=['DELETE'])
def delete_form(form_name):
    try:
        result = forms_collection.delete_one({'name': form_name})
        if result.deleted_count == 0:
            return jsonify({"error": "Form not found"}), 404
        return jsonify({"message": "Form deleted"}), 200
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/api/folders', methods=['GET'])
def get_folders():
    try:
        docs = list(folders_collection.find({}, {'_id': 0, 'name': 1, 'order': 1}))
        docs.sort(key=lambda d: (d.get('order') is None, d.get('order', 0)))
        return jsonify([d['name'] for d in docs])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/folders', methods=['POST'])
def create_folder():
    try:
        name = (request.json or {}).get('name', '').strip()
        if not name:
            return jsonify({"error": "Folder name required"}), 400
        next_order = folders_collection.count_documents({})
        folders_collection.update_one(
            {'name': name},
            {'$set': {'name': name}, '$setOnInsert': {'order': next_order}},
            upsert=True
        )
        return jsonify({"name": name}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/folder-order', methods=['PUT'])
def reorder_folders():
    try:
        order = (request.json or {}).get('order', [])
        for i, name in enumerate(order):
            folders_collection.update_one({'name': name}, {'$set': {'order': i}}, upsert=True)
        return jsonify({"message": "Order updated"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/folders/<folder_name>', methods=['PUT'])
def rename_folder(folder_name):
    try:
        new_name = (request.json or {}).get('name', '').strip()
        if not new_name:
            return jsonify({"error": "New folder name required"}), 400
        folders_collection.delete_one({'name': folder_name})
        folders_collection.update_one({'name': new_name}, {'$set': {'name': new_name}}, upsert=True)
        forms_collection.update_many({'folder': folder_name}, {'$set': {'folder': new_name}})
        return jsonify({"name": new_name}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/folders/<folder_name>', methods=['DELETE'])
def delete_folder(folder_name):
    try:
        folders_collection.delete_one({'name': folder_name})
        forms_collection.update_many({'folder': folder_name}, {'$set': {'folder': ''}})
        return jsonify({"message": "Folder deleted"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/github/dispatch', methods=['POST'])
def github_dispatch():
    """
    Handle GitHub Actions workflow dispatch
    """
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['event_type', 'client_payload', 'github_token', 'github_repository']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400
        
        github_token = data['github_token']
        github_repo = data['github_repository']
        
        # Validate repository format (owner/repo)
        if '/' not in github_repo:
            return jsonify({"error": "Repository must be in format 'owner/repo'"}), 400
        
        # Real GitHub API integration
        github_url = f"https://api.github.com/repos/{github_repo}/dispatches"
        headers = {
            'Authorization': f'token {github_token}',
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'Form-Builder/1.0'
        }
        
        github_payload = {
            'event_type': data['event_type'],
            'client_payload': data['client_payload']
        }
        
        print(f"Sending GitHub dispatch to: {github_url}")
        print(f"Event type: {data['event_type']}")
        print(f"Repository: {github_repo}")
        
        response = requests.post(github_url, json=github_payload, headers=headers)
        
        if response.status_code == 204:
            return jsonify({
                "message": "Workflow dispatched successfully",
                "event_type": data['event_type'],
                "repository": github_repo,
                "timestamp": datetime.utcnow().isoformat()
            })
        elif response.status_code == 401:
            return jsonify({
                "error": "Authentication failed",
                "details": "Invalid GitHub token or insufficient permissions",
                "required_permissions": ["repo", "workflow"]
            }), 401
        elif response.status_code == 404:
            return jsonify({
                "error": "Repository not found",
                "details": f"Repository '{github_repo}' not found or token lacks access",
                "repository": github_repo
            }), 404
        elif response.status_code == 422:
            return jsonify({
                "error": "Invalid event type",
                "details": "The event_type might not match any repository_dispatch triggers in your workflows",
                "event_type": data['event_type']
            }), 422
        else:
            return jsonify({
                "error": "GitHub API error",
                "details": response.text,
                "status_code": response.status_code
            }), response.status_code
            
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Network error: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": f"GitHub dispatch error: {str(e)}"}), 500

@app.route('/api/history', methods=['GET'])
def get_history():
    try:
        form_name = request.args.get('form')
        limit     = min(int(request.args.get('limit', 20)), 100)
        query     = {'form_name': form_name} if form_name else {}
        records   = list(history_collection.find(query, {'_id': 0}).sort('timestamp', -1).limit(limit))
        return jsonify(records)
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/api/history', methods=['POST'])
def add_history():
    try:
        data   = request.json or {}
        record = {
            'form_name':   data.get('form_name', ''),
            'integration': data.get('integration', ''),
            'timestamp':   datetime.utcnow().isoformat(),
            'status':      data.get('status', 'unknown'),
            'payload':     data.get('payload', {}),
            'response':    data.get('response', {}),
        }
        history_collection.insert_one(record)
        return jsonify({'message': 'Recorded'}), 201
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500


@app.route('/api/ansible/launch', methods=['POST'])
def ansible_launch():
    data = request.json or {}
    for field in ('tower_url', 'job_template_id', 'ansible_token', 'extra_vars'):
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400

    tower_url       = data['tower_url'].rstrip('/')
    job_template_id = data['job_template_id']
    url     = f"{tower_url}/api/v2/job_templates/{job_template_id}/launch/"
    headers = {
        'Authorization': f"Bearer {data['ansible_token']}",
        'Content-Type':  'application/json',
    }

    try:
        resp = requests.post(url, json={'extra_vars': data['extra_vars']}, headers=headers, timeout=15)
    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out after 15 seconds"}), 504
    except requests.exceptions.RequestException as exc:
        return jsonify({"error": f"Network error: {exc}"}), 500

    if resp.status_code in (200, 201):
        job = resp.json()
        return jsonify({
            "message":  "Job launched successfully",
            "job_id":   job.get("id"),
            "job_url":  f"{tower_url}/#/jobs/playbook/{job.get('id')}",
            "status":   job.get("status"),
        })
    if resp.status_code == 401:
        return jsonify({"error": "Authentication failed", "details": "Invalid or expired token"}), 401
    if resp.status_code == 404:
        return jsonify({"error": "Job template not found", "details": f"Template ID {job_template_id} not found or token lacks access"}), 404
    return jsonify({"error": "Tower API error", "details": resp.text, "status_code": resp.status_code}), resp.status_code


# Helper to navigate a dot-notation path in a nested dict (e.g. "data.items")
def _get_path(obj, path):
    if not path:
        return obj
    for part in str(path).split('.'):
        if not isinstance(obj, dict):
            return None
        obj = obj.get(part)
    return obj


@app.route('/api/proxy', methods=['POST'])
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
    data = request.json or {}
    raw_url = data.get('url', '').strip()
    if not raw_url:
        return jsonify({'error': 'Missing url'}), 400

    form_env = {str(k): str(v) for k, v in (data.get('env') or {}).items()}

    def resolve(text):
        return re.sub(
            r'\{\{env:([^}]+)\}\}',
            lambda m: form_env.get(m.group(1).strip()) or os.environ.get(m.group(1).strip(), ''),
            str(text),
        )

    url     = resolve(raw_url)
    headers = {k: resolve(v) for k, v in (data.get('headers') or {}).items()}

    pagination = data.get('pagination')

    if pagination:
        path        = data.get('path', '')
        ptype       = str(pagination.get('type', 'cursor'))
        all_items   = []
        current_url = url
        extra_params = {}

        try:
            for _ in range(20):   # hard cap — prevents infinite loops
                resp = requests.get(current_url, headers=headers, params=extra_params, timeout=15)
                try:
                    body = resp.json()
                except ValueError:
                    return jsonify({'error': 'Non-JSON response from paginated API'}), 502

                if not (200 <= resp.status_code < 300):
                    return jsonify({'error': f'API returned {resp.status_code}', 'details': resp.text}), 502

                page_items = _get_path(body, path)
                if isinstance(page_items, list):
                    all_items.extend(page_items)

                if ptype == 'cursor':
                    next_val = _get_path(body, pagination.get('next_path', ''))
                    if not next_val:
                        break
                    extra_params = {str(pagination.get('next_param', 'cursor')): str(next_val)}
                    current_url  = url   # back to base URL; extra_params carries the cursor
                elif ptype == 'next_url':
                    next_url_val = _get_path(body, pagination.get('next_url_path', 'next'))
                    if not next_url_val:
                        break
                    current_url  = str(next_url_val)
                    extra_params = {}
                else:
                    break

        except requests.exceptions.Timeout:
            return jsonify({'error': 'Request timed out after 15 seconds'}), 504
        except requests.exceptions.RequestException as exc:
            return jsonify({'error': f'Request failed: {exc}'}), 502

        return jsonify({'status': 200, 'data': all_items, 'paginated': True})

    # ── Non-paginated (original behaviour) ────────────────────────────────────
    try:
        resp = requests.get(url, headers=headers, timeout=15)
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request timed out after 15 seconds'}), 504
    except requests.exceptions.RequestException as exc:
        return jsonify({'error': f'Request failed: {exc}'}), 502

    try:
        body = resp.json()
    except ValueError:
        body = resp.text

    return jsonify({'status': resp.status_code, 'data': body})


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Test MongoDB connection
        client.admin.command('ping')
        return jsonify({
            "status": "healthy",
            "mongodb": "connected",
            "timestamp": datetime.utcnow().isoformat()
        })
    except Exception as e:
        return jsonify({
            "status": "unhealthy",
            "mongodb": "disconnected",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }), 500

CHAT_SYSTEM_PROMPT = """\
You are a helpful assistant for a YAML-driven dynamic form builder.
Help users create and configure forms. Always wrap YAML output in ```yaml code fences.

## Schema

title: "Form Title"
description: "Optional subtitle"

env:                          # form-level variables
  MY_TOKEN: "value"           # referenced as {{env:MY_TOKEN}} in source urls/headers

github:                       # optional — GitHub Actions dispatch
  token: ""
  repository: "org/repo"
  workflow: "workflow.yml"
  event_type: "my_event"

ansible:                      # optional — Ansible Tower
  token: ""
  tower_url: "https://tower.example.com"
  job_template_id: 42

fields:
  - name: "fieldId"           # required, unique key used in payload
    label: "Display Label"    # required
    type: "text"              # see types below
    required: true            # true or false (not yes/no)
    placeholder: "hint text"
    default: "value"
    note: "helper text shown below field"
    min: 0                    # number type only
    max: 100                  # number type only
    options:                  # dropdown / checkbox — static list
      - value: "payload_val"
        label: "Display label"
    source:                   # dropdown / checkbox — live API (replaces options)
      url: "https://api.example.com/items"   # supports {{env:VAR}}
      headers:
        Authorization: "Bearer {{env:MY_TOKEN}}"
      path: "data.items"      # dot-path to array in response; omit if root is array
      value: "id"             # field to use as option value
      label: "name"           # field to use as display label
      pagination:             # optional
        type: "cursor"        # or "next_url"
        next_path: "nextPageKey"
        next_param: "nextPageKey"
        # for next_url type use: next_url_path: "info.next"
    show_if:                  # optional conditional visibility
      field: "otherFieldName"
      operator: "equals"      # equals | not_equals | contains | not_empty
      value: "target_value"

## Field Types
text, email, number, datetime-local, textarea, dropdown, checkbox

## Rules
- Use true/false for booleans, never yes/no
- dropdown and checkbox require either options: or source:
- Fields hidden by show_if are excluded from the payload
- When generating a complete form output one self-contained YAML block
- Keep answers concise
- When asked to edit, modify, rename, delete, or add anything to an existing form, ALWAYS output the COMPLETE revised YAML (all fields, all top-level sections) in a single ```yaml block — never output just the changed portion
"""


@app.route('/api/chat', methods=['POST'])
def chat():
    data     = request.json or {}
    messages = data.get('messages', [])
    context  = data.get('context', {})

    if not messages:
        return jsonify({'error': 'No messages provided'}), 400

    ollama_host = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
    model       = os.getenv('OLLAMA_MODEL', 'llama3.2:3b')

    # Optionally inject current form YAML into the system prompt
    system = CHAT_SYSTEM_PROMPT
    if context.get('current_yaml'):
        system += (
            "\n\nThe user is currently editing this form YAML:\n"
            f"```yaml\n{context['current_yaml']}\n```\n"
            "Reference it when answering questions about their specific form."
        )

    # Truncate to last 20 messages to keep tokens bounded
    if len(messages) > 20:
        messages = messages[-20:]

    payload = {
        'model':    model,
        'messages': [{'role': 'system', 'content': system}] + messages,
        'stream':   True,
    }

    def generate():
        try:
            resp = requests.post(
                f"{ollama_host}/api/chat",
                json=payload,
                stream=True,
                timeout=180,
            )
            if resp.status_code != 200:
                yield f"data: {json.dumps({'error': f'Ollama returned HTTP {resp.status_code}. Is the model loaded?'})}\n\n"
                return

            for raw_line in resp.iter_lines():
                if not raw_line:
                    continue
                try:
                    chunk = json.loads(raw_line)
                    token = chunk.get('message', {}).get('content', '')
                    if token:
                        yield f"data: {json.dumps({'token': token})}\n\n"
                    if chunk.get('done'):
                        yield 'data: [DONE]\n\n'
                        return
                except (ValueError, KeyError):
                    continue

        except requests.exceptions.ConnectionError:
            yield f"data: {json.dumps({'error': 'Cannot connect to Ollama. Run: docker compose up ollama'})}\n\n"
        except requests.exceptions.Timeout:
            yield f"data: {json.dumps({'error': 'Generation timed out — model may still be loading on first use, try again in 30s.'})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control':     'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=True)