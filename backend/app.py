# app.py
from flask import Flask, jsonify, request
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

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=True)