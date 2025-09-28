# app.py
from flask import Flask, jsonify, request
from flask_cors import CORS
from pymongo import MongoClient
from bson.objectid import ObjectId
from datetime import datetime
import os
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
    forms_collection = db.forms
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