// init-mongo.js - Place this file in the same directory as docker-compose.yml

// Switch to the forms database
db = db.getSiblingDB('forms');

// Create the forms collection with sample data
db.forms.insertMany([
  {
    name: "maintenance-window",
    title: "Creating a Maintenance Window",
    yamlContent: `title: "Creating a Maintenance Window"
description: "Configure a maintenance window in Dynatrace"
github:
  repository: "your-org/dynatrace-automation"
  workflow: "maintenance-window.yml"
  event_type: "maintenance_window_request"

fields:
  - name: "maintenanceWindowName"
    label: "What should we name this Maintenance Window?"
    type: "text"
    required: true
    placeholder: "e.g., Monthly Server Patching"

  - name: "managementZone"
    label: "What Management Zone will this be affecting?"
    type: "dropdown"
    required: true
    note: "This question should auto populate its answer choices from /api/v2/maintenance. The answer choices provided are just examples."
    options:
      - value: "production-web"
        label: "Production Web Services"
      - value: "production-db"
        label: "Production Database"
      - value: "staging-all"
        label: "Staging Environment"
      - value: "development"
        label: "Development Environment"

  - name: "entityTypes"
    label: "What entity types are being affected? (Optional)"
    type: "checkbox"
    required: false
    options:
      - value: "services"
        label: "Services"
      - value: "web-applications"
        label: "Web Applications (RUM)"
      - value: "hosts"
        label: "Hosts"`,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "dynatrace-access",
    title: "Dynatrace Access Request",
    yamlContent: `title: "Dynatrace Environment Access Request"
description: "Request access to Dynatrace monitoring environments"
github:
  repository: "your-org/dynatrace-automation"
  workflow: "dynatrace-access-management.yml"
  event_type: "dynatrace_access_request"

fields:
  - name: "requesterName"
    label: "Requester Name"
    type: "text"
    required: true

  - name: "requesterEmail"
    label: "Email Address"
    type: "email"
    required: true

  - name: "environment"
    label: "Dynatrace Environment"
    type: "dropdown"
    required: true
    options:
      - value: "prod"
        label: "Production"
      - value: "stage"
        label: "Staging"
      - value: "dev"
        label: "Development"

  - name: "accessLevel"
    label: "Required Access Level"
    type: "dropdown"
    required: true
    options:
      - value: "viewer"
        label: "Viewer (Read-only)"
      - value: "user"
        label: "User (Standard access)"
      - value: "admin"
        label: "Administrator"

  - name: "justification"
    label: "Business Justification"
    type: "textarea"
    required: true
    placeholder: "Please explain why you need this access..."`,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "user-provisioning",
    title: "User Account Provisioning",
    yamlContent: `title: "User Account Provisioning Request"
description: "Create or modify user accounts across systems"
github:
  repository: "your-org/identity-management"
  workflow: "user-provisioning.yml"
  event_type: "user_provisioning_request"

fields:
  - name: "employeeId"
    label: "Employee ID"
    type: "text"
    required: true
    placeholder: "e.g., EMP12345"

  - name: "fullName"
    label: "Full Name"
    type: "text"
    required: true
    placeholder: "First Last"

  - name: "email"
    label: "Email Address"
    type: "email"
    required: true
    placeholder: "user@company.com"

  - name: "department"
    label: "Department"
    type: "dropdown"
    required: true
    options:
      - value: "engineering"
        label: "Engineering"
      - value: "marketing"
        label: "Marketing"
      - value: "sales"
        label: "Sales"
      - value: "hr"
        label: "Human Resources"
      - value: "finance"
        label: "Finance"

  - name: "systems"
    label: "Required System Access"
    type: "checkbox"
    required: true
    options:
      - value: "active-directory"
        label: "Active Directory"
      - value: "jira"
        label: "JIRA"
      - value: "confluence"
        label: "Confluence"
      - value: "github"
        label: "GitHub Enterprise"
      - value: "aws"
        label: "AWS Console"`,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "server-deployment",
    title: "Server Deployment Request",
    yamlContent: `title: "Server Deployment Request"
description: "Deploy new server infrastructure"
github:
  repository: "your-org/infrastructure"
  workflow: "server-deployment.yml"
  event_type: "server_deployment_request"

fields:
  - name: "serverName"
    label: "Server Name"
    type: "text"
    required: true
    placeholder: "e.g., web-server-01"

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

  - name: "serverType"
    label: "Server Type"
    type: "dropdown"
    required: true
    options:
      - value: "web-server"
        label: "Web Server"
      - value: "database-server"
        label: "Database Server"
      - value: "application-server"
        label: "Application Server"
      - value: "load-balancer"
        label: "Load Balancer"

  - name: "specifications"
    label: "Hardware Specifications"
    type: "checkbox"
    required: true
    options:
      - value: "2cpu-4gb"
        label: "2 CPU, 4GB RAM"
      - value: "4cpu-8gb"
        label: "4 CPU, 8GB RAM"
      - value: "8cpu-16gb"
        label: "8 CPU, 16GB RAM"
      - value: "16cpu-32gb"
        label: "16 CPU, 32GB RAM"

  - name: "justification"
    label: "Business Justification"
    type: "textarea"
    required: true
    placeholder: "Explain the business need for this server..."`,
    createdAt: new Date(),
    updatedAt: new Date()
  }
]);

// Create unique index on the name field
db.forms.createIndex({ "name": 1 }, { unique: true });

// Create a user for the application
db.createUser({
  user: "changeme",
  pwd: "changeme",
  roles: [
    {
      role: "readWrite",
      db: "forms"
    }
  ]
});

print("Database initialized with sample forms and application user created.");