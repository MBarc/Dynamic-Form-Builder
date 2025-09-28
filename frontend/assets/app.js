// MongoDB API Configuration
const API_BASE = '/api'; // Use relative path for containerized setup

let currentConfig = null;
let currentFormKey = null;
let isLoading = false;
let hasUnsavedChanges = false;

// YAML Parser using js-yaml library
function parseYAML(yamlString) {
    try {
        const result = jsyaml.load(yamlString);
        return result;
    } catch (error) {
        console.error('YAML Parse Error:', error);
        return null;
    }
}

// Default template for new forms
const defaultFormTemplate = (title) => `title: "${title}"
description: "Getting started template with examples of all field types"
github:
  repository: "your-org/your-repo"
  workflow: "${title.toLowerCase().replace(/\s+/g, '-')}-workflow.yml"
  event_type: "${title.toLowerCase().replace(/\s+/g, '_')}_automation"

fields:
  - name: "textExample"
    label: "Text Input Example"
    type: "text"
    required: true
    placeholder: "Enter some text here"
    note: "This is an example note explaining field behavior or requirements"

  - name: "emailExample"
    label: "Email Input Example"
    type: "email"
    required: true
    placeholder: "user@example.com"

  - name: "numberExample"
    label: "Number Input Example"
    type: "number"
    required: false
    min: 1
    max: 100
    default: 10

  - name: "dateExample"
    label: "Date/Time Input Example"
    type: "datetime-local"
    required: false

  - name: "dropdownExample"
    label: "Dropdown Selection Example"
    type: "dropdown"
    required: true
    note: "This question should auto populate its answer choices from /api/v2/maintenance. The answer choices provided are just examples."
    options:
      - value: "option1"
        label: "First Option"
      - value: "option2"
        label: "Second Option"
      - value: "option3"
        label: "Third Option"

  - name: "checkboxExample"
    label: "Multiple Choice Example"
    type: "checkbox"
    required: false
    options:
      - value: "choice1"
        label: "First Choice"
      - value: "choice2"
        label: "Second Choice"
      - value: "choice3"
        label: "Third Choice"

  - name: "textareaExample"
    label: "Long Text Example"
    type: "textarea"
    required: false
    placeholder: "Enter detailed information here..."
    note: "This field supports markdown formatting in the final implementation"`;

// Real API functions that connect to Flask backend
async function apiCall(endpoint, options = {}) {
    try {
        console.log(`API Call: ${options.method || 'GET'} ${endpoint}`);
        const response = await fetch(endpoint, options);
        return response;
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

// API functions
async function loadAllForms() {
    try {
        setLoading(true);
        const response = await apiCall(`${API_BASE}/forms`, {
            method: 'GET'
        });
        
        if (response.ok) {
            const forms = await response.json();
            populateFormSelector(forms);
            return forms;
        } else {
            const error = await response.json();
            showError('Failed to load forms from database: ' + (error.error || 'Unknown error'));
            updateDbStatus(false);
        }
    } catch (error) {
        showError('Database connection error: ' + error.message);
        updateDbStatus(false);
    } finally {
        setLoading(false);
    }
}

async function loadForm(formName) {
    try {
        const response = await apiCall(`${API_BASE}/forms/${formName}`, {
            method: 'GET'
        });
        
        if (response.ok) {
            const form = await response.json();
            return form;
        } else {
            const error = await response.json();
            showError(`Failed to load form: ${formName} - ${error.error || 'Unknown error'}`);
        }
    } catch (error) {
        showError('Error loading form: ' + error.message);
    }
}

async function saveForm(formName, title, yamlContent) {
    try {
        const response = await apiCall(`${API_BASE}/forms/${formName}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: formName,
                title: title,
                yamlContent: yamlContent
            })
        });
        
        if (response.ok) {
            showSuccess('Form configuration saved to database');
            return true;
        } else {
            const error = await response.json();
            showError('Failed to save form configuration: ' + (error.error || 'Unknown error'));
            return false;
        }
    } catch (error) {
        showError('Error saving form: ' + error.message);
        return false;
    }
}

async function createForm(formName, title, yamlContent) {
    try {
        const response = await apiCall(`${API_BASE}/forms`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: formName,
                title: title,
                yamlContent: yamlContent
            })
        });
        
        if (response.ok) {
            showSuccess('New form created in database');
            await loadAllForms();
            return true;
        } else {
            const error = await response.json();
            showError('Failed to create form: ' + (error.error || 'Unknown error'));
            return false;
        }
    } catch (error) {
        showError('Error creating form: ' + error.message);
        return false;
    }
}

async function deleteForm(formName) {
    try {
        const response = await apiCall(`${API_BASE}/forms/${formName}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showSuccess('Form deleted from database');
            await loadAllForms();
            return true;
        } else {
            const error = await response.json();
            showError('Failed to delete form: ' + (error.error || 'Unknown error'));
            return false;
        }
    } catch (error) {
        showError('Error deleting form: ' + error.message);
        return false;
    }
}

// UI Helper Functions
function setLoading(loading) {
    isLoading = loading;
    const indicator = document.getElementById('loadingIndicator');
    indicator.style.display = loading ? 'block' : 'none';
}

function updateDbStatus(connected) {
    const status = document.getElementById('dbStatus');
    if (connected) {
        status.className = 'db-status';
        status.innerHTML = '<div class="db-status-dot"></div><span>Connected to MongoDB (localhost:27017)</span>';
    } else {
        status.className = 'db-status disconnected';
        status.innerHTML = '<div class="db-status-dot"></div><span>Disconnected from MongoDB</span>';
    }
}

function populateFormSelector(forms) {
    const selector = document.getElementById('formSelector');
    selector.innerHTML = '<option value="">Select a form...</option>';
    
    forms.forEach(form => {
        const option = document.createElement('option');
        option.value = form.name;
        option.textContent = form.title || form.name;
        selector.appendChild(option);
    });
}

function parseAndRenderForm() {
    const yamlContent = document.getElementById('yamlEditor').value;
    
    const errorContainer = document.getElementById('errorContainer');
    if (errorContainer) {
        errorContainer.remove();
    }

    try {
        currentConfig = parseYAML(yamlContent);
        if (currentConfig && currentConfig.fields) {
            renderDynamicForm(currentConfig);
            updatePayload();
        } else if (yamlContent.trim()) {
            showFormError('Invalid YAML configuration. Please check the format.');
        }
    } catch (error) {
        showFormError('Error parsing YAML: ' + error.message);
    }
}

function showFormError(message) {
    const container = document.getElementById('dynamicFormContainer');
    const errorDiv = document.createElement('div');
    errorDiv.id = 'errorContainer';
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    container.innerHTML = '';
    container.appendChild(errorDiv);
}

function renderDynamicForm(config) {
    const container = document.getElementById('dynamicFormContainer');
    
    let html = `
        <div class="dynamic-form">
            <h2>${config.title || 'Dynamic Form'}</h2>
            ${config.description ? `<p style="margin-bottom: 20px; color: #666;">${config.description}</p>` : ''}
            <form id="dynamicForm">
    `;

    config.fields.forEach(field => {
        html += `<div class="form-group ${field.required ? 'required' : ''}">`;
        html += `<label class="form-label" for="${field.name}">${field.label}</label>`;

        switch (field.type) {
            case 'text':
            case 'email':
            case 'number':
            case 'datetime-local':
                html += `<input type="${field.type}" id="${field.name}" name="${field.name}" 
                        class="form-input" ${field.required ? 'required' : ''}
                        ${field.placeholder ? `placeholder="${field.placeholder}"` : ''}
                        ${field.min ? `min="${field.min}"` : ''}
                        ${field.max ? `max="${field.max}"` : ''}
                        ${field.default ? `value="${field.default}"` : ''}>`;
                break;

            case 'textarea':
                html += `<textarea id="${field.name}" name="${field.name}" class="form-textarea" 
                        ${field.required ? 'required' : ''}
                        ${field.placeholder ? `placeholder="${field.placeholder}"` : ''} 
                        rows="4">${field.default || ''}</textarea>`;
                break;

            case 'dropdown':
                html += `<select id="${field.name}" name="${field.name}" class="form-select" ${field.required ? 'required' : ''}>`;
                if (!field.required) {
                    html += '<option value="">Select an option</option>';
                }
                field.options.forEach(option => {
                    const selected = field.default === option.value ? 'selected' : '';
                    html += `<option value="${option.value}" ${selected}>${option.label}</option>`;
                });
                html += '</select>';
                break;

            case 'checkbox':
                html += '<div class="checkbox-container">';
                field.options.forEach(option => {
                    html += `
                        <div class="checkbox-item">
                            <input type="checkbox" id="${field.name}_${option.value}" 
                                   name="${field.name}" value="${option.value}">
                            <label for="${field.name}_${option.value}">${option.label}</label>
                        </div>`;
                });
                html += '</div>';
                break;
        }

        // Add note if it exists
        if (field.note) {
            html += `<div class="form-note">${field.note}</div>`;
        }

        html += '</div>';
    });

    html += `
            <button type="submit" class="submit-btn">Submit ${config.title}</button>
        </form>
    </div>`;

    container.innerHTML = html;

    // Add event listeners
    const form = document.getElementById('dynamicForm');
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('input', updatePayload);
        input.addEventListener('change', updatePayload);
    });

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        alert('Form submitted! In production, this would trigger the GitHub Actions workflow.');
    });
}

function getFormData() {
    if (!currentConfig) return {};
    
    const form = document.getElementById('dynamicForm');
    if (!form) return {};
    
    const formData = new FormData(form);
    const data = {};
    
    // Handle regular form fields
    for (let [key, value] of formData.entries()) {
        if (data[key]) {
            if (Array.isArray(data[key])) {
                data[key].push(value);
            } else {
                data[key] = [data[key], value];
            }
        } else {
            data[key] = value;
        }
    }
    
    // Handle checkboxes specifically
    currentConfig.fields.forEach(field => {
        if (field.type === 'checkbox') {
            const checkboxes = form.querySelectorAll(`input[name="${field.name}"]:checked`);
            data[field.name] = Array.from(checkboxes).map(cb => cb.value);
        }
    });
    
    return data;
}

function updatePayload() {
    if (!currentConfig) return;
    
    const formData = getFormData();
    
    // Get GitHub configuration from YAML with fallbacks
    const github = currentConfig.github || {};
    const workflow = github.workflow || 'workflow.yml';
    const repository = github.repository || 'unknown/unknown';
    const eventType = github.event_type || `${workflow.replace('.yml', '').replace(/[-\s]/g, '_')}_automation`;
    
    const payload = {
        event_type: eventType,
        client_payload: {
            automation_type: workflow.replace('.yml', ''),
            timestamp: new Date().toISOString(),
            request_id: `req_${Date.now()}`,
            workflow: workflow,
            target_repository: repository,
            form_data: formData,
            form_config: {
                title: currentConfig.title || 'Untitled Form',
                description: currentConfig.description || ''
            }
        }
    };
    
    const payloadJson = JSON.stringify(payload, null, 2);
    const highlighted = syntaxHighlight(payloadJson);
    
    document.getElementById('payloadDisplay').innerHTML = highlighted;
}

function syntaxHighlight(json) {
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        let cls = 'json-number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'json-key';
            } else {
                cls = 'json-string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'json-boolean';
        } else if (/null/.test(match)) {
            cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
    });
}

async function sendPayload() {
    if (!currentConfig) {
        alert('Please select and configure a form first');
        return;
    }

    // Get GitHub token from the input field
    const githubToken = document.getElementById('githubToken').value.trim();
    if (!githubToken) {
        alert('Please enter your GitHub Personal Access Token first');
        document.getElementById('githubToken').focus();
        return;
    }

    // Validate GitHub configuration exists
    if (!currentConfig.github || !currentConfig.github.repository) {
        alert('GitHub configuration missing in YAML. Please add a "github" section with repository and workflow details.');
        return;
    }

    const btn = document.getElementById('sendPayloadBtn');
    const btnText = document.getElementById('btnText');
    const spinner = document.getElementById('spinner');
    
    // Show loading state
    btn.disabled = true;
    btnText.textContent = 'Sending...';
    spinner.style.display = 'block';
    
    try {
        const formData = getFormData();
        const github = currentConfig.github;
        const workflow = github.workflow || 'workflow.yml';
        const repository = github.repository || 'unknown/unknown';
        const eventType = github.event_type || `${workflow.replace('.yml', '').replace(/[-\s]/g, '_')}_automation`;
        
        const payload = {
            event_type: eventType,
            client_payload: {
                automation_type: workflow.replace('.yml', ''),
                timestamp: new Date().toISOString(),
                request_id: `req_${Date.now()}`,
                workflow: workflow,
                target_repository: repository,
                form_data: formData,
                form_config: {
                    title: currentConfig.title || 'Untitled Form',
                    description: currentConfig.description || ''
                }
            }
        };

        // Send payload with GitHub token to Flask backend
        const response = await apiCall(`${API_BASE}/github/dispatch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...payload,
                github_token: githubToken,
                github_repository: repository
            })
        });

        const result = await response.json();
        
        if (response.ok) {
            showResponseModal(true, 'Workflow Dispatched Successfully!', {
                message: result.message,
                repository: repository,
                workflow: workflow,
                event_type: eventType,
                timestamp: result.timestamp
            });
        } else {
            showResponseModal(false, 'Failed to Dispatch Workflow', result);
        }
        
    } catch (error) {
        showResponseModal(false, 'Network Error', { error: error.message });
    } finally {
        // Reset button state
        btn.disabled = false;
        btnText.textContent = 'Send to GitHub Actions';
        spinner.style.display = 'none';
    }
}

function showResponseModal(success, title, data) {
    const modal = document.getElementById('responseModal');
    const modalContent = document.getElementById('responseModalContent');
    const responseContent = document.getElementById('responseContent');
    
    if (success) {
        modalContent.className = 'modal-content success';
        createConfetti();
    } else {
        modalContent.className = 'modal-content error';
    }
    
    responseContent.innerHTML = `
        <h3>${title}</h3>
        <pre style="text-align: left; background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">${JSON.stringify(data, null, 2)}</pre>
    `;
    
    modal.style.display = 'block';
}

function createConfetti() {
    for (let i = 0; i < 50; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * window.innerWidth + 'px';
            confetti.style.top = '-10px';
            confetti.style.animationDuration = Math.random() * 3 + 2 + 's';
            confetti.style.animationDelay = Math.random() * 2 + 's';
            document.body.appendChild(confetti);
            
            setTimeout(() => {
                confetti.remove();
            }, 7000);
        }, i * 100);
    }
}

// Track if initialization has already happened
let isInitialized = false;

// Initialize the application
document.addEventListener('DOMContentLoaded', async function() {
    if (isInitialized) {
        console.warn('Application already initialized, skipping...');
        return;
    }
    
    console.log('Initializing Form Builder...');
    isInitialized = true;
    
    // Check API health first - only once on startup
    await checkApiHealth();
    await loadAllForms();
    console.log('Initialization complete');
});

// Check API and database health - one time only
async function checkApiHealth() {
    try {
        const response = await apiCall(`${API_BASE}/health`, {
            method: 'GET'
        });
        
        if (response.ok) {
            const health = await response.json();
            updateDbStatus(health.mongodb === 'connected');
        } else {
            updateDbStatus(false);
        }
    } catch (error) {
        console.error('Health check failed:', error);
        updateDbStatus(false);
    }
}

// Handle browser refresh warning - only when there are unsaved changes
window.addEventListener('beforeunload', function (e) {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return 'You have unsaved changes. Are you sure you want to leave?';
    }
});

// Close modals when clicking outside
window.addEventListener('click', function(event) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
});

// Handle Enter key in new form modal
document.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && document.getElementById('newFormModal').style.display === 'block') {
        createNewForm();
    }
});

async function loadSelectedForm() {
    if (hasUnsavedChanges) {
        if (!confirm('You have unsaved changes. Are you sure you want to switch forms?')) {
            // Reset selector to current form
            document.getElementById('formSelector').value = currentFormKey || '';
            return;
        }
    }

    const selectedForm = document.getElementById('formSelector').value;
    if (!selectedForm) {
        clearEditor();
        return;
    }

    currentFormKey = selectedForm;
    const form = await loadForm(selectedForm);
    
    if (form && form.yamlContent) {
        document.getElementById('yamlEditor').value = form.yamlContent;
        parseAndRenderForm();
        hasUnsavedChanges = false;
        updateSaveButton();
    }
}

function clearEditor() {
    document.getElementById('yamlEditor').value = '';
    document.getElementById('dynamicFormContainer').innerHTML = '';
    document.getElementById('payloadDisplay').innerHTML = '// Select a form to view payload structure';
    currentConfig = null;
    currentFormKey = null;
    hasUnsavedChanges = false;
    updateSaveButton();
}

function onYamlChange() {
    hasUnsavedChanges = true;
    updateSaveButton();
    parseAndRenderForm();
}

function updateSaveButton() {
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = !hasUnsavedChanges || !currentFormKey;
    saveBtn.textContent = hasUnsavedChanges ? '💾 Save Changes' : '✅ Saved';
}

async function saveFormConfiguration() {
    if (!currentFormKey || !hasUnsavedChanges) return;

    const yamlContent = document.getElementById('yamlEditor').value;
    const config = parseYAML(yamlContent);
    
    if (!config) {
        showError('Cannot save: Invalid YAML format');
        return;
    }

    const success = await saveForm(currentFormKey, config.title || currentFormKey, yamlContent);
    if (success) {
        hasUnsavedChanges = false;
        updateSaveButton();
    }
}

async function showNewFormModal() {
    document.getElementById('newFormModal').style.display = 'block';
    document.getElementById('newFormName').value = '';
    document.getElementById('newFormName').focus();
}

async function createNewForm() {
    const formName = document.getElementById('newFormName').value.trim();
    
    if (!formName) {
        alert('Please enter a form name');
        return;
    }

    // Validate form name format
    if (!/^[a-z0-9-]+$/.test(formName)) {
        alert('Form name must contain only lowercase letters, numbers, and hyphens');
        return;
    }

    const title = formName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const yamlContent = defaultFormTemplate(title);
    
    const success = await createForm(formName, title, yamlContent);
    if (success) {
        closeModal('newFormModal');
        // Select the new form
        document.getElementById('formSelector').value = formName;
        await loadSelectedForm();
    }
}

async function showDeleteConfirmModal() {
    if (!currentFormKey) {
        alert('Please select a form to delete');
        return;
    }

    const currentForm = document.getElementById('formSelector').selectedOptions[0];
    const formTitle = currentForm ? currentForm.textContent : currentFormKey;
    
    document.getElementById('deleteFormName').textContent = formTitle;
    document.getElementById('deleteConfirmModal').style.display = 'block';
}

async function deleteCurrentForm() {
    if (!currentFormKey) return;

    const success = await deleteForm(currentFormKey);
    if (success) {
        closeModal('deleteConfirmModal');
        clearEditor();
        // Reset selector
        document.getElementById('formSelector').value = '';
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showError(message) {
    console.error(message);
    
    // Create a more visible error notification
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    errorDiv.style.position = 'fixed';
    errorDiv.style.top = '20px';
    errorDiv.style.right = '20px';
    errorDiv.style.zIndex = '9999';
    errorDiv.style.maxWidth = '400px';
    errorDiv.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    
    document.body.appendChild(errorDiv);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 5000);
}

function showSuccess(message) {
    console.log(message);
    
    // Create a more visible success notification
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    successDiv.style.position = 'fixed';
    successDiv.style.top = '20px';
    successDiv.style.right = '20px';
    successDiv.style.zIndex = '9999';
    successDiv.style.maxWidth = '400px';
    successDiv.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    
    document.body.appendChild(successDiv);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (successDiv.parentNode) {
            successDiv.parentNode.removeChild(successDiv);
        }
    }, 3000);
}