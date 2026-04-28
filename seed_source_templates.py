"""
Seed three template forms that demonstrate the `source:` (GET auto-populate) feature.

Run from the project root while the stack is up:
    python seed_source_templates.py

Targets the Flask backend directly on http://localhost:3000.
"""

import json
import sys
import urllib.request
import urllib.error

API = "http://localhost:3000/api"
FOLDER = "Source Examples"


# ── helpers ───────────────────────────────────────────────────────────────────

def post(path, body):
    data = json.dumps(body).encode()
    req  = urllib.request.Request(
        f"{API}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def ensure_folder(name):
    status, body = post("/folders", {"name": name})
    if status in (200, 201):
        print(f"  folder '{name}' ready")
    else:
        print(f"  folder '{name}': {body}")


def seed_form(name, title, yaml_content):
    status, body = post("/forms", {
        "name":        name,
        "title":       title,
        "yamlContent": yaml_content,
        "folder":      FOLDER,
    })
    if status == 201:
        print(f"  created  '{name}'")
    elif status == 409:
        print(f"  skipped  '{name}' (already exists)")
    else:
        print(f"  ERROR    '{name}': {status} – {body}")


# ── templates ─────────────────────────────────────────────────────────────────

GITHUB_BRANCH_DEPLOYMENT = r"""title: "GitHub Branch Deployment"
description: "Trigger a deployment by selecting a live branch from your GitHub repository. Branch list is fetched dynamically via the GitHub API."

env:
  GITHUB_TOKEN: ""
  GITHUB_OWNER: "your-org"
  GITHUB_REPO: "your-repo"

github:
  token: ""
  repository: "your-org/your-repo"
  workflow: "deploy.yml"
  event_type: "deploy_branch"

fields:
  - name: "branch"
    label: "Branch to Deploy"
    type: "dropdown"
    required: true
    source:
      url: "https://api.github.com/repos/{{env:GITHUB_OWNER}}/{{env:GITHUB_REPO}}/branches?per_page=100"
      headers:
        Authorization: "token {{env:GITHUB_TOKEN}}"
        Accept: "application/vnd.github.v3+json"
      value: "name"
      label: "name"
    note: "Fetched live from GitHub. Fill in GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO in the env block above."

  - name: "environment"
    label: "Target Environment"
    type: "dropdown"
    required: true
    options:
      - value: "development"
        label: "Development"
      - value: "staging"
        label: "Staging"
      - value: "production"
        label: "Production"

  - name: "confirm_production"
    label: "Type CONFIRM to proceed"
    type: "text"
    required: true
    placeholder: "CONFIRM"
    show_if:
      field: "environment"
      operator: "equals"
      value: "production"
    note: "Safety gate — only appears when Production is selected."

  - name: "deploy_notes"
    label: "Deployment Notes"
    type: "textarea"
    required: false
    placeholder: "What is being deployed and why? Any rollback plan?"
"""


SUPPORT_TICKET = r"""title: "Create Support Ticket"
description: "Submit a support request. The assignee and notification lists are fetched live from the user directory API."

fields:
  - name: "ticket_title"
    label: "Ticket Title"
    type: "text"
    required: true
    placeholder: "One-line summary of the issue"

  - name: "priority"
    label: "Priority"
    type: "dropdown"
    required: true
    options:
      - value: "low"
        label: "Low"
      - value: "medium"
        label: "Medium"
      - value: "high"
        label: "High"
      - value: "critical"
        label: "Critical — page on-call"

  - name: "assignee"
    label: "Assign To"
    type: "dropdown"
    required: true
    source:
      url: "https://jsonplaceholder.typicode.com/users"
      value: "id"
      label: "name"
    note: "User list fetched live from the directory API (demo: JSONPlaceholder)."

  - name: "notify_users"
    label: "Also Notify"
    type: "checkbox"
    required: false
    source:
      url: "https://jsonplaceholder.typicode.com/users"
      value: "username"
      label: "name"
    note: "Select additional team members to CC on this ticket."

  - name: "description"
    label: "Description"
    type: "textarea"
    required: true
    placeholder: "Steps to reproduce, impact, environment details..."
"""


PAGINATED_CHARACTER_SEARCH = r"""title: "Paginated Source Demo"
description: "Demonstrates the pagination feature of the source: directive. All pages are fetched server-side and merged into a single list before the dropdown renders. Uses the public Rick & Morty API (826 characters across 42 pages) as a stand-in for any paginated internal API."

fields:
  - name: "character"
    label: "Select Character"
    type: "dropdown"
    required: true
    source:
      url: "https://rickandmortyapi.com/api/character"
      path: "results"
      value: "id"
      label: "name"
      pagination:
        type: "next_url"
        next_url_path: "info.next"
    note: "826 characters fetched across 42 pages. Equivalent to fetching all Kubernetes namespaces, Jira projects, or any paginated REST collection."

  - name: "species_filter"
    label: "Species Filter (static)"
    type: "checkbox"
    required: false
    options:
      - value: "Human"
        label: "Human"
      - value: "Alien"
        label: "Alien"
      - value: "Robot"
        label: "Robot"
      - value: "Humanoid"
        label: "Humanoid"
    note: "Static options shown alongside a paginated dropdown — mix and match as needed."

  - name: "notes"
    label: "Notes"
    type: "textarea"
    required: false
    placeholder: "Any additional context about this selection..."
"""


# ── main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Seeding source-feature template forms into folder '{FOLDER}'…\n")

    print("Creating folder…")
    ensure_folder(FOLDER)

    print("\nCreating forms…")
    seed_form("github-branch-deployment",  "GitHub Branch Deployment",  GITHUB_BRANCH_DEPLOYMENT)
    seed_form("support-ticket",            "Create Support Ticket",      SUPPORT_TICKET)
    seed_form("paginated-source-demo",     "Paginated Source Demo",      PAGINATED_CHARACTER_SEARCH)

    print("\nDone. Refresh http://localhost:8090 to see the new forms.")
