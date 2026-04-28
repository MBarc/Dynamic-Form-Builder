// MongoDB API Configuration
const API_BASE = '/api'; // Use relative path for containerized setup

let currentConfig = null;
let currentFormKey = null;
let isLoading = false;
let hasUnsavedChanges = false;

// Conditional logic state
let conditionalFields = {}; // fieldName → show_if config
let dependencyMap = {};     // sourceField → [dependent field names]

// Env panel sync flag — prevents infinite loop when env panel updates YAML
let _skipEnvPanelUpdate = false;

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
    note: "This field supports markdown formatting in the final implementation"

  # ── Conditional logic examples ──────────────────────────────────────────────

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

  - name: "productionApprover"
    label: "Production Approver"
    type: "text"
    required: true
    placeholder: "Enter approver's name"
    show_if:
      field: "environment"
      operator: "equals"
      value: "production"
    note: "Appears only when Production is selected — dropdown-driven conditional"

  - name: "notifyTeams"
    label: "Notify Teams"
    type: "checkbox"
    required: false
    options:
      - value: "operations"
        label: "Operations"
      - value: "security"
        label: "Security"
      - value: "leadership"
        label: "Leadership"

  - name: "securityJustification"
    label: "Security Justification"
    type: "textarea"
    required: true
    placeholder: "Describe the security impact and mitigations..."
    show_if:
      field: "notifyTeams"
      operator: "contains"
      value: "security"
    note: "Appears when the Security team checkbox is ticked — checkbox-driven conditional"`;

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

async function createForm(formName, title, yamlContent, folder) {
    try {
        const body = { name: formName, title, yamlContent };
        if (folder) body.folder = folder;
        const response = await apiCall(`${API_BASE}/forms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (response.ok) {
            showSuccess('New form created in database');
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

// ── Environment Variables Panel ────────────────────────────────────────────────

function renderEnvPanel(env) {
    if (_skipEnvPanelUpdate) return;
    const section = document.getElementById('envVarsSection');
    const list    = document.getElementById('envVarsList');
    if (!section || !list) return;

    if (env === null) {
        section.style.display = 'none';
        list.innerHTML = '';
        return;
    }
    section.style.display = '';
    list.innerHTML = '';

    const entries = Object.entries(env);
    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'env-empty';
        empty.textContent = 'No variables yet. Click "+ Add Variable" to add one.';
        list.appendChild(empty);
        return;
    }
    entries.forEach(([key, value]) => {
        list.appendChild(buildEnvRow(key, String(value)));
    });
}

function buildEnvRow(key, value) {
    const row = document.createElement('div');
    row.className = 'env-var-row';
    row.innerHTML = `
        <input class="env-key form-input" type="text" placeholder="VAR_NAME" value="${escHtml(key)}" oninput="onEnvPanelChange()">
        <input class="env-val form-input" type="text" placeholder="value" value="${escHtml(value)}" oninput="onEnvPanelChange()">
        <button class="env-remove" onclick="this.closest('.env-var-row').remove(); onEnvPanelChange();" title="Remove">×</button>`;
    return row;
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function addEnvVar() {
    const section = document.getElementById('envVarsSection');
    section.style.display = '';
    const list = document.getElementById('envVarsList');
    const empty = list.querySelector('.env-empty');
    if (empty) empty.remove();
    list.appendChild(buildEnvRow('', ''));
    list.lastElementChild.querySelector('.env-key').focus();
}

function collectEnvFromPanel() {
    const env = {};
    document.querySelectorAll('.env-var-row').forEach(row => {
        const k = row.querySelector('.env-key').value.trim();
        const v = row.querySelector('.env-val').value;
        if (k) env[k] = v;
    });
    return env;
}

function onEnvPanelChange() {
    const env = collectEnvFromPanel();
    _skipEnvPanelUpdate = true;
    try {
        syncEnvToYaml(env);
    } finally {
        _skipEnvPanelUpdate = false;
    }
    if (currentConfig) currentConfig.env = env;
    hasUnsavedChanges = true;
    updateSaveButton();
    updatePayload();
}

function syncEnvToYaml(env) {
    const editor = document.getElementById('yamlEditor');
    if (!editor) return;
    let yaml = editor.value;

    const keys = Object.keys(env);
    const envBlock = keys.length > 0
        ? 'env:\n' + keys.map(k => `  ${k}: "${String(env[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join('\n') + '\n'
        : '';

    // Replace existing env: block (top-level key followed by indented lines)
    const envRegex = /^env:\n(?:[ \t]+[^\n]*\n)*/m;
    if (envRegex.test(yaml)) {
        yaml = yaml.replace(envRegex, envBlock);
    } else if (envBlock) {
        // Insert after description: or title: at the top
        yaml = yaml.replace(
            /^((?:title:[^\n]*\n)?(?:description:[^\n]*\n)?)/m,
            (m) => m + envBlock
        );
    }
    editor.value = yaml;
}

// ──────────────────────────────────────────────────────────────────────────────

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
        renderEnvPanel(currentConfig ? (currentConfig.env || {}) : null);
        syncIntegrationSwitcher();
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
            ${config.description ? `<p style="margin-bottom: 20px; color: var(--text-muted);">${config.description}</p>` : ''}
            <form id="dynamicForm">
    `;

    config.fields.forEach(field => {
        const isConditional = !!field.show_if;
        // Conditional fields start hidden; evaluateAllConditions() will show them if needed
        html += `<div class="form-group ${field.required ? 'required' : ''}" id="field-group-${field.name}"${isConditional ? ' style="display:none;"' : ''}>`;
        html += `<label class="form-label" for="${field.name}">${field.label}</label>`;

        switch (field.type) {
            case 'text':
            case 'email':
            case 'number':
            case 'datetime-local':
                html += `<input type="${field.type}" id="${field.name}" name="${field.name}"
                        class="form-input" ${field.required ? 'required' : ''}
                        ${field.placeholder ? `placeholder="${field.placeholder}"` : ''}
                        ${field.min !== undefined ? `min="${field.min}"` : ''}
                        ${field.max !== undefined ? `max="${field.max}"` : ''}
                        ${field.default !== undefined ? `value="${field.default}"` : ''}>`;
                break;

            case 'textarea':
                html += `<textarea id="${field.name}" name="${field.name}" class="form-textarea"
                        ${field.required ? 'required' : ''}
                        ${field.placeholder ? `placeholder="${field.placeholder}"` : ''}
                        rows="4">${field.default || ''}</textarea>`;
                break;

            case 'dropdown':
                if (field.source) {
                    // Searchable select — options fetched asynchronously
                    html += `<div class="sds-wrapper">
                        <input type="text" id="sds-input-${field.name}" class="form-input sds-input source-loading"
                               placeholder="Loading options…" disabled autocomplete="off">
                        <div class="sds-dropdown" id="sds-list-${field.name}"></div>
                        <input type="hidden" id="${field.name}" name="${field.name}">
                    </div>`;
                } else {
                    html += `<select id="${field.name}" name="${field.name}" class="form-select" ${field.required ? 'required' : ''}>`;
                    html += '<option value="">Select an option</option>';
                    (field.options || []).forEach(option => {
                        const selected = field.default === option.value ? 'selected' : '';
                        html += `<option value="${option.value}" ${selected}>${option.label}</option>`;
                    });
                    html += '</select>';
                }
                break;

            case 'checkbox':
                if (field.source) {
                    html += `<div id="${field.name}_options" class="checkbox-container source-loading">
                        <span class="source-loading-text">Loading options…</span>
                    </div>`;
                } else {
                    html += '<div class="checkbox-container">';
                    (field.options || []).forEach(option => {
                        html += `
                            <label class="checkbox-item">
                                <input type="checkbox" id="${field.name}_${option.value}"
                                       name="${field.name}" value="${option.value}">
                                ${option.label}
                            </label>`;
                    });
                    html += '</div>';
                }
                break;
        }

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

    // Build the dependency map for conditional logic
    buildConditionalLogic(config.fields);

    // Wire up listeners — every change re-evaluates conditions then refreshes the payload
    const form = document.getElementById('dynamicForm');
    form.querySelectorAll('input, select, textarea').forEach(input => {
        input.addEventListener('input', handleFormChange);
        input.addEventListener('change', handleFormChange);
    });

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        alert('Form submitted! In production, this would trigger the GitHub Actions workflow.');
    });

    // Apply initial conditional visibility
    evaluateAllConditions();

    // Kick off async fetches for any source-backed fields
    config.fields.filter(f => f.source).forEach(fetchSourceOptions);
}

// Returns only the values of currently VISIBLE fields — used for the payload and GitHub dispatch.
function getFormData() {
    if (!currentConfig) return {};
    const form = document.getElementById('dynamicForm');
    if (!form) return {};

    const data = {};
    currentConfig.fields.forEach(field => {
        const groupEl = document.getElementById(`field-group-${field.name}`);
        if (groupEl && groupEl.style.display === 'none') return; // skip hidden

        if (field.type === 'checkbox') {
            const checked = form.querySelectorAll(`input[name="${field.name}"]:checked`);
            data[field.name] = Array.from(checked).map(cb => cb.value);
        } else {
            const input = form.querySelector(`[name="${field.name}"]`);
            if (input) data[field.name] = input.value;
        }
    });
    return data;
}

// Returns values for ALL fields (including hidden) — used only by condition evaluation
// so that a field can correctly react to a source field's current value.
function getAllFormValues() {
    if (!currentConfig) return {};
    const form = document.getElementById('dynamicForm');
    if (!form) return {};

    const data = {};
    currentConfig.fields.forEach(field => {
        if (field.type === 'checkbox') {
            const checked = form.querySelectorAll(`input[name="${field.name}"]:checked`);
            data[field.name] = Array.from(checked).map(cb => cb.value);
        } else {
            const input = form.querySelector(`[name="${field.name}"]`);
            if (input) data[field.name] = input.value;
        }
    });
    return data;
}

// Called by every field change event — evaluate conditions first, then refresh payload.
function handleFormChange() {
    evaluateAllConditions();
    updatePayload();
}

// Populate the module-level dependency map from the field list.
function buildConditionalLogic(fields) {
    conditionalFields = {};
    dependencyMap = {};
    fields.forEach(field => {
        if (!field.show_if) return;
        conditionalFields[field.name] = field.show_if;
        const src = field.show_if.field;
        if (!dependencyMap[src]) dependencyMap[src] = [];
        if (!dependencyMap[src].includes(field.name)) dependencyMap[src].push(field.name);
    });
}

// Show or hide every conditional field based on current form state.
// Handles multi-level chains (a conditional field whose source is itself conditional)
// by iterating until the visibility map stabilises.
function evaluateAllConditions() {
    if (!currentConfig || !currentConfig.fields) return;

    const formValues = getAllFormValues();

    // Seed: non-conditional fields are always visible; conditional fields start hidden.
    const visibility = {};
    currentConfig.fields.forEach(field => { visibility[field.name] = !field.show_if; });

    // Iterate until stable to handle chained dependencies (e.g. C depends on B depends on A).
    let changed = true;
    let passes = 0;
    while (changed && passes < 10) {
        changed = false;
        passes++;
        currentConfig.fields.forEach(field => {
            if (!field.show_if) return;
            const cond = field.show_if;
            // A field is only reachable when its source field is itself visible.
            const sourceVisible = visibility[cond.field] !== false;
            const condMet = sourceVisible && evaluateCondition(cond, formValues);
            if (!!visibility[field.name] !== condMet) {
                visibility[field.name] = condMet;
                changed = true;
            }
        });
    }

    // Apply to the DOM.
    currentConfig.fields.forEach(field => {
        if (!field.show_if) return;
        const groupEl = document.getElementById(`field-group-${field.name}`);
        if (!groupEl) return;

        const shouldShow = !!visibility[field.name];
        const isHidden   = groupEl.style.display === 'none';

        if (!shouldShow && !isHidden) {
            groupEl.style.display = 'none';
            resetFieldValue(field, groupEl);
        } else if (shouldShow && isHidden) {
            groupEl.style.display = '';
            groupEl.classList.add('field-appearing');
            setTimeout(() => groupEl.classList.remove('field-appearing'), 250);
        }
    });
}

// Evaluate a single show_if condition against the current form values.
// Supported operators: equals (default), not_equals, contains, not_empty.
function evaluateCondition(condition, formValues) {
    const operator    = condition.operator || 'equals';
    const sourceValue = formValues[condition.field];
    const target      = String(condition.value !== undefined ? condition.value : '');

    switch (operator) {
        case 'equals':
            if (Array.isArray(sourceValue)) return sourceValue.length === 1 && sourceValue[0] === target;
            return String(sourceValue || '') === target;

        case 'not_equals':
            if (Array.isArray(sourceValue)) return !(sourceValue.length === 1 && sourceValue[0] === target);
            return String(sourceValue || '') !== target;

        case 'contains':
            if (Array.isArray(sourceValue)) return sourceValue.includes(target);
            return String(sourceValue || '').includes(target);

        case 'not_empty':
            if (Array.isArray(sourceValue)) return sourceValue.length > 0;
            return sourceValue !== '' && sourceValue !== null && sourceValue !== undefined;

        default:
            return false;
    }
}

// Clear a field's value when it becomes hidden so stale data never reaches the payload.
function resetFieldValue(field, groupEl) {
    if (!groupEl) groupEl = document.getElementById(`field-group-${field.name}`);
    if (!groupEl) return;

    switch (field.type) {
        case 'checkbox':
            groupEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
            break;
        case 'dropdown': {
            const sdsInput = groupEl.querySelector('.sds-input');
            if (sdsInput) {
                sdsInput.value = '';
                const hidden = groupEl.querySelector('input[type="hidden"]');
                if (hidden) { hidden.value = ''; }
                const list = groupEl.querySelector('.sds-dropdown');
                if (list) list.classList.remove('open');
            } else {
                const sel = groupEl.querySelector('select');
                if (sel) sel.selectedIndex = 0;
            }
            break;
        }
        default:
            groupEl.querySelectorAll('input, textarea').forEach(el => {
                el.value = field.default !== undefined ? String(field.default) : '';
            });
    }
}

// Fetch options for a source-backed dropdown or checkbox field via the server proxy.
// The proxy resolves {{env:VAR}} placeholders so tokens never reach the browser.
// When field.source.pagination is set the proxy fetches all pages server-side.
async function fetchSourceOptions(field) {
    const isPaginated = !!(field.source.pagination);

    // Update loading text so users know a multi-page fetch is in progress
    if (isPaginated) {
        if (field.type === 'dropdown') {
            const ti = document.getElementById(`sds-input-${field.name}`);
            if (ti) ti.placeholder = 'Fetching all pages…';
        } else if (field.type === 'checkbox') {
            const span = document.querySelector(`#${field.name}_options .source-loading-text`);
            if (span) span.textContent = 'Fetching all pages…';
        }
    }

    try {
        const body = {
            url:     field.source.url,
            headers: field.source.headers || {},
            env:     currentConfig.env || {},
        };
        if (isPaginated) {
            body.pagination = field.source.pagination;
            body.path       = field.source.path || '';
        }

        const resp = await fetch('/api/proxy', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });

        const result = await resp.json();

        if (!resp.ok) {
            setSourceError(field, result.error || 'Failed to load options');
            return;
        }

        // Paginated responses already have items extracted server-side;
        // non-paginated responses still need client-side path navigation.
        let items = result.data;
        if (!result.paginated && field.source.path) {
            for (const key of field.source.path.split('.')) {
                items = items?.[key];
                if (items === undefined) break;
            }
        }

        if (!Array.isArray(items)) {
            setSourceError(field, `No array found at path "${field.source.path || '(root)'}"`);
            return;
        }

        if (field.type === 'dropdown') {
            populateSearchableDropdown(field, items);

        } else if (field.type === 'checkbox') {
            const container = document.getElementById(`${field.name}_options`);
            if (!container) return;
            container.innerHTML = '';
            container.classList.remove('source-loading');
            items.forEach(item => {
                const value = field.source.value ? String(item[field.source.value] ?? '') : String(item);
                const label = field.source.label ? String(item[field.source.label] ?? '') : String(item);
                const lbl   = document.createElement('label');
                lbl.className   = 'checkbox-item';
                lbl.innerHTML   = `<input type="checkbox" name="${field.name}" value="${value}"> ${label}`;
                lbl.querySelector('input').addEventListener('change', handleFormChange);
                container.appendChild(lbl);
            });
        }

        evaluateAllConditions();
        updatePayload();

    } catch (err) {
        setSourceError(field, `Network error: ${err.message}`);
    }
}

function populateSearchableDropdown(field, items) {
    const textInput = document.getElementById(`sds-input-${field.name}`);
    const listEl    = document.getElementById(`sds-list-${field.name}`);
    const hidden    = document.getElementById(field.name);
    if (!textInput || !listEl || !hidden) return;

    const allItems = items.map(item => ({
        value: field.source.value ? String(item[field.source.value] ?? '') : String(item),
        label: field.source.label ? String(item[field.source.label] ?? '') : String(item),
    }));

    function renderList(filter) {
        const q = (filter || '').toLowerCase();
        listEl.innerHTML = '';
        const filtered = q ? allItems.filter(i => i.label.toLowerCase().includes(q)) : allItems;
        if (!filtered.length) {
            listEl.innerHTML = '<div class="sds-no-results">No results found</div>';
            return;
        }
        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className    = 'sds-option';
            div.textContent  = item.label;
            div.dataset.value = item.value;
            div.addEventListener('mousedown', e => {
                e.preventDefault();
                hidden.value      = item.value;
                textInput.value   = item.label;
                listEl.classList.remove('open');
                hidden.dispatchEvent(new Event('change', { bubbles: true }));
            });
            listEl.appendChild(div);
        });
    }

    renderList('');
    textInput.disabled     = false;
    textInput.placeholder  = 'Search options…';
    textInput.classList.remove('source-loading');

    textInput.addEventListener('focus', () => { renderList(textInput.value); listEl.classList.add('open'); });
    textInput.addEventListener('input', () => { renderList(textInput.value); listEl.classList.add('open'); });
    textInput.addEventListener('blur',  () => { setTimeout(() => listEl.classList.remove('open'), 150); });
    hidden.addEventListener('change', handleFormChange);
}

function setSourceError(field, message) {
    if (field.type === 'dropdown') {
        const textInput = document.getElementById(`sds-input-${field.name}`);
        if (textInput) {
            textInput.placeholder = `⚠ ${message}`;
            textInput.classList.remove('source-loading');
            textInput.classList.add('source-error');
        }
        return;
    } else if (field.type === 'checkbox') {
        const container = document.getElementById(`${field.name}_options`);
        if (!container) return;
        container.innerHTML = `<span class="source-error-text">⚠ ${message}</span>`;
        container.classList.remove('source-loading');
        container.classList.add('source-error');
    }
}

function updatePayload() {
    if (!currentConfig) return;

    const formData   = getFormData();
    const hasGitHub  = !!(currentConfig.github  && currentConfig.github.repository);
    const hasAnsible = !!(currentConfig.ansible && currentConfig.ansible.tower_url && currentConfig.ansible.job_template_id);
    const hasBoth    = hasGitHub && hasAnsible;

    const githubSection  = document.getElementById('githubPayloadSection');
    const ansibleSection = document.getElementById('ansiblePayloadSection');

    // ── Conflict: both configured ───────────────────────────────────────────────
    if (hasBoth) {
        githubSection.style.display  = 'none';
        ansibleSection.style.display = 'none';
        showFormError('Only one integration may be configured at a time. Use the Integration Type switcher or remove one of "github:" or "ansible:" from your YAML.');
        return;
    }

    githubSection.style.display  = hasGitHub  ? '' : 'none';
    ansibleSection.style.display = hasAnsible ? '' : 'none';

    if (hasGitHub) {
        const github   = currentConfig.github;
        const workflow = github.workflow || 'workflow.yml';
        const repo     = github.repository;
        const evtType  = github.event_type || `${workflow.replace('.yml', '').replace(/[-\s]/g, '_')}_automation`;
        const payload  = {
            event_type: evtType,
            client_payload: {
                automation_type:   workflow.replace('.yml', ''),
                timestamp:         new Date().toISOString(),
                request_id:        `req_${Date.now()}`,
                workflow,
                target_repository: repo,
                form_data:         formData,
                form_config:       { title: currentConfig.title || 'Untitled Form', description: currentConfig.description || '' }
            }
        };
        document.getElementById('payloadDisplay').innerHTML = syntaxHighlight(JSON.stringify(payload, null, 2));
    }

    // ── Ansible only ────────────────────────────────────────────────────────────
    if (hasAnsible) {
        const payload = {
            job_template_id: currentConfig.ansible.job_template_id,
            extra_vars:      formData
        };
        document.getElementById('ansiblePayloadDisplay').innerHTML = syntaxHighlight(JSON.stringify(payload, null, 2));
    }

    // ── Neither configured ──────────────────────────────────────────────────────
    if (!hasGitHub && !hasAnsible) {
        githubSection.style.display = '';
        document.getElementById('payloadDisplay').innerHTML =
            '// Add a "github:" or "ansible:" section to your YAML to configure dispatch';
    }
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

    const githubToken = (currentConfig.github && currentConfig.github.token) || '';
    if (!githubToken) {
        alert('Please add a token to the YAML:\n\ngithub:\n  token: "your-token-here"');
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
        await logDispatch('github', payload, result, response.ok ? 'success' : 'failed');

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

async function sendAnsiblePayload() {
    if (!currentConfig) {
        alert('Please select and configure a form first');
        return;
    }

    const token = (currentConfig.ansible && currentConfig.ansible.token) || '';
    if (!token) {
        alert('Please add a token to the YAML:\n\nansible:\n  token: "your-token-here"');
        return;
    }

    const ansible = currentConfig.ansible || {};
    if (!ansible.tower_url || !ansible.job_template_id) {
        alert('Ansible configuration missing. Please add tower_url and job_template_id to the "ansible:" section of your YAML.');
        return;
    }

    const btn      = document.getElementById('sendAnsibleBtn');
    const btnText  = document.getElementById('ansibleBtnText');
    const spinner  = document.getElementById('ansibleSpinner');

    btn.disabled          = true;
    btnText.textContent   = 'Launching...';
    spinner.style.display = 'block';

    try {
        const response = await apiCall(`${API_BASE}/ansible/launch`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                tower_url:       ansible.tower_url,
                job_template_id: ansible.job_template_id,
                ansible_token:   token,
                extra_vars:      getFormData()
            })
        });

        const result = await response.json();
        const dispatchPayload = { job_template_id: ansible.job_template_id, tower_url: ansible.tower_url, extra_vars: getFormData() };
        await logDispatch('ansible', dispatchPayload, result, response.ok ? 'success' : 'failed');
        if (response.ok) {
            showResponseModal(true, 'Job Launched Successfully!', result);
        } else {
            showResponseModal(false, 'Failed to Launch Job', result);
        }
    } catch (error) {
        showResponseModal(false, 'Network Error', { error: error.message });
    } finally {
        btn.disabled          = false;
        btnText.textContent   = '🤖 Launch on Ansible Tower';
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
        <pre style="text-align: left; background: var(--checkbox-bg); color: var(--text); padding: 15px; border-radius: 8px; margin: 15px 0;">${JSON.stringify(data, null, 2)}</pre>
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

// ── Form Duplication ───────────────────────────────────────────────────────────

let _duplicatingYaml = null;

// ── Dispatch History ───────────────────────────────────────────────────────────

async function logDispatch(integration, payload, response, status) {
    try {
        await apiCall(`${API_BASE}/history`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                form_name:   currentFormKey,
                integration,
                status,
                payload,
                response,
            }),
        });
    } catch (_) { /* history failures are non-fatal */ }
}

async function showHistoryModal() {
    if (!currentFormKey) return;

    document.getElementById('historyModalSubtitle').textContent =
        `Recent dispatches for "${currentFormKey}"`;
    document.getElementById('historyModalBody').innerHTML =
        '<p style="color:var(--text-muted);font-size:13px;">Loading…</p>';
    document.getElementById('historyModal').style.display = 'block';

    try {
        const resp = await apiCall(`${API_BASE}/history?form=${encodeURIComponent(currentFormKey)}&limit=20`);
        const records = await resp.json();
        renderHistoryList(records);
    } catch (e) {
        document.getElementById('historyModalBody').innerHTML =
            `<p style="color:var(--error-color);">Failed to load history: ${e.message}</p>`;
    }
}

function renderHistoryList(records) {
    const body = document.getElementById('historyModalBody');
    if (!records.length) {
        body.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No dispatches recorded yet for this form.</p>';
        return;
    }

    body.innerHTML = records.map((r, i) => {
        const ts      = new Date(r.timestamp);
        const timeStr = isNaN(ts) ? r.timestamp : ts.toLocaleString();
        const badge   = r.integration === 'ansible'
            ? '<span class="history-badge badge-ansible">Ansible</span>'
            : '<span class="history-badge badge-github">GitHub</span>';
        const status  = r.status === 'success'
            ? '<span class="history-badge badge-success">Success</span>'
            : '<span class="history-badge badge-failed">Failed</span>';
        return `
            <div class="history-row">
                <div class="history-row-header" onclick="toggleHistoryDetail(${i})">
                    <span class="history-time">${timeStr}</span>
                    ${badge}${status}
                    <span class="history-chevron" id="chevron-${i}">▶</span>
                </div>
                <pre class="history-detail" id="history-detail-${i}" style="display:none;">${JSON.stringify({payload: r.payload, response: r.response}, null, 2)}</pre>
            </div>`;
    }).join('');
}

function toggleHistoryDetail(i) {
    const detail  = document.getElementById(`history-detail-${i}`);
    const chevron = document.getElementById(`chevron-${i}`);
    const open    = detail.style.display === 'none';
    detail.style.display  = open ? 'block' : 'none';
    chevron.textContent   = open ? '▼' : '▶';
}

// ── Router & Landing View ──────────────────────────────────────────────────────

let currentFolder  = null;  // null = "All Forms", string = folder name
let _allForms      = [];    // cached list for landing grid
let _allFolders    = [];    // cached list of persisted folder names (ordered)
let _draggedFolder = null;  // folder being dragged
let _dropPosition  = null;  // 'before' or 'after' relative to drop target
let _searchQuery   = '';    // current form search string
let _currentView   = 'forms'; // 'forms' or 'docs'
let _selectedFormNames = new Set();  // multi-select on landing grid

function handleRoute() {
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('edit:')) {
        showEditorView(decodeURIComponent(hash.slice(5)));
    } else if (hash === 'docs') {
        showDocsView();
    } else if (hash.startsWith('folder:')) {
        showLandingView(decodeURIComponent(hash.slice(7)));
    } else {
        showLandingView(null);
    }
}

function navigateTo(hash) {
    window.location.hash = hash;
}

function navigateHome() {
    navigateTo(currentFolder ? `folder:${encodeURIComponent(currentFolder)}` : '');
}

function navigateToForm(formName) {
    navigateTo(`edit:${encodeURIComponent(formName)}`);
}

async function showLandingView(folder) {
    _currentView  = 'forms';
    if (currentFolder !== folder) _selectedFormNames.clear();
    currentFolder = folder;
    _searchQuery  = '';
    const searchEl = document.getElementById('formSearch');
    if (searchEl) searchEl.value = '';
    document.getElementById('landingView').style.display  = '';
    document.getElementById('editorView').style.display   = 'none';
    document.getElementById('formGrid').style.display     = '';
    document.getElementById('docsView').style.display     = 'none';
    const search = document.querySelector('.landing-search');
    if (search) search.style.display = '';
    clearEditor();
    const forms = await fetchFormsForLanding();
    renderFolderTree(forms);
    renderFormGrid(forms, folder);
}

async function showDocsView() {
    _currentView  = 'docs';
    currentFolder = null;
    document.getElementById('landingView').style.display  = '';
    document.getElementById('editorView').style.display   = 'none';
    document.getElementById('formGrid').style.display     = 'none';
    document.getElementById('docsView').style.display     = '';
    document.getElementById('landingViewTitle').textContent = 'Documentation';
    const search = document.querySelector('.landing-search');
    if (search) search.style.display = 'none';
    clearEditor();
    populateDocsView();
    const forms = await fetchFormsForLanding();
    renderFolderTree(forms);
}

function populateDocsView() {
    const docs = document.getElementById('docsView');
    if (!docs || docs.dataset.populated) return;
    const modal = document.querySelector('#helpModal .modal-content');
    if (!modal) return;
    Array.from(modal.children).forEach(child => {
        if (child.classList.contains('close')) return;
        if (child.classList.contains('modal-buttons')) return;
        // Skip the redundant title — the page header already says "Documentation"
        if (child.tagName === 'H3') return;
        docs.appendChild(child.cloneNode(true));
    });
    docs.dataset.populated = 'true';
}

async function showEditorView(formName) {
    document.getElementById('landingView').style.display  = 'none';
    document.getElementById('editorView').style.display   = '';

    await fetchFormsForLanding();

    if (formName) {
        const form = await loadForm(formName);
        if (form) {
            currentFormKey = formName;
            document.getElementById('yamlEditor').value         = form.yamlContent || '';
            document.getElementById('editorBreadcrumb').textContent = form.title || formName;
            parseAndRenderForm();
            hasUnsavedChanges = false;
            updateSaveButton();
        } else {
            navigateTo('');
        }
    }
}

async function fetchFormsForLanding() {
    try {
        const [formsResp, foldersResp] = await Promise.all([
            apiCall(`${API_BASE}/forms`),
            apiCall(`${API_BASE}/folders`),
        ]);
        if (formsResp.ok)   _allForms   = await formsResp.json();
        if (foldersResp.ok) _allFolders = await foldersResp.json();
    } catch (_) {}
    return _allForms;
}

function renderFolderTree(forms) {
    const tree = document.getElementById('folderTree');
    if (!tree) return;

    // Maintain persisted order; append any form-derived folders not yet tracked
    const formFolders = forms.map(f => f.folder).filter(Boolean);
    const extra = [...new Set(formFolders.filter(f => !_allFolders.includes(f)))].sort();
    const ordered = [..._allFolders, ...extra];

    const unfiledCount = forms.filter(f => !f.folder).length;

    const formsActive = _currentView === 'forms';
    tree.innerHTML = `
        <div class="folder-item ${formsActive && currentFolder === null ? 'active' : ''}"
             onclick="navigateTo('')">
            <span class="fi-icon">🏠</span> All Forms
            <span class="fi-count">${forms.length}</span>
        </div>
        ${unfiledCount > 0 ? `
        <div class="folder-item ${formsActive && currentFolder === '__unfiled__' ? 'active' : ''}"
             onclick="navigateTo('folder:__unfiled__')">
            <span class="fi-icon">📄</span> Unfiled
            <span class="fi-count">${unfiledCount}</span>
        </div>` : ''}
        <div class="folder-item ${_currentView === 'docs' ? 'active' : ''}"
             onclick="navigateTo('docs')">
            <span class="fi-icon">📖</span> Docs
        </div>
        ${ordered.length > 0 ? '<div class="folder-divider"></div>' : ''}
        ${ordered.map(f => `
        <div class="folder-item folder-draggable ${currentFolder === f ? 'active' : ''}"
             draggable="true"
             data-folder="${escHtml(f)}"
             onclick="navigateTo('folder:${encodeURIComponent(f)}')"
             oncontextmenu="showFolderContextMenu(event, '${escHtml(f)}')"
             ondragstart="onFolderDragStart(event, '${escHtml(f)}')"
             ondragover="onFolderDragOver(event)"
             ondrop="onFolderDrop(event, '${escHtml(f)}')"
             ondragleave="onFolderDragLeave(event)"
             ondragend="onFolderDragEnd(event)">
            <span class="fi-drag-handle">⠿</span>
            <span class="fi-icon">📁</span> ${escHtml(f)}
            <span class="fi-count">${forms.filter(x => x.folder === f).length}</span>
        </div>`).join('')}
    `;
}

function renderFormGrid(forms, folder) {
    const grid  = document.getElementById('formGrid');
    const title = document.getElementById('landingViewTitle');
    if (!grid) return;

    let filtered;
    if (!folder) {
        filtered = forms;
        title.textContent = 'All Forms';
    } else if (folder === '__unfiled__') {
        filtered = forms.filter(f => !f.folder);
        title.textContent = 'Unfiled';
    } else {
        filtered = forms.filter(f => f.folder === folder);
        title.textContent = folder;
    }

    const q = _searchQuery.trim().toLowerCase();
    if (q) filtered = filtered.filter(f => (f.title || f.name).toLowerCase().includes(q));

    if (!filtered.length) {
        const isFirstTime = !forms.length && !folder && !q;
        grid.innerHTML = `<div class="form-grid-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style="opacity:.25;margin-bottom:12px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
            ${isFirstTime ? `
                <div>Welcome! Get started by creating your first form.</div>
                <div style="font-size:13px;margin-top:10px;">
                    <a href="#docs" style="color:var(--primary);text-decoration:none;font-weight:600;">📖 See the docs</a>
                    <span style="margin:0 10px;color:var(--text-muted);">·</span>
                    <span style="color:var(--text-muted);">Click <strong style="color:var(--text);">+ New Form</strong> above</span>
                </div>
            ` : `
                <div>${q ? 'No matching forms.' : 'No forms here yet.'}</div>
                ${q ? '' : '<div style="font-size:13px;margin-top:6px;">Click <strong>+ New Form</strong> to create one.</div>'}
            `}
        </div>`;
        return;
    }

    const visibleNames = new Set(filtered.map(f => f.name));
    for (const name of [..._selectedFormNames]) {
        if (!visibleNames.has(name)) _selectedFormNames.delete(name);
    }

    grid.innerHTML = filtered.map(form => {
        const isSelected = _selectedFormNames.has(form.name);
        return `
        <div class="form-card${isSelected ? ' selected' : ''}" data-name="${escHtml(form.name)}"
             onclick="selectFormCard(event, this, '${escHtml(form.name)}')"
             oncontextmenu="showCardContextMenu(event, '${escHtml(form.name)}')"
             title="Click to select · Click again to open · Shift+Click to multi-select">
            <div class="form-card-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 14h8v2H8zm0-4h8v2H8zm0-4h4v2H8z"/></svg>
            </div>
            <div class="form-card-title">${escHtml(form.title || form.name)}</div>
            ${form.folder ? `<div class="form-card-folder">📁 ${escHtml(form.folder)}</div>` : ''}
            <div class="form-card-date">${formatRelativeTime(form.updatedAt || form.createdAt)}</div>
        </div>`;
    }).join('');
}

function selectFormCard(event, el, formName) {
    closeCardContextMenu();

    // Shift-click: toggle this card in/out of the multi-selection
    if (event && event.shiftKey) {
        if (event.preventDefault) event.preventDefault();
        if (_selectedFormNames.has(formName)) {
            _selectedFormNames.delete(formName);
            el.classList.remove('selected');
        } else {
            _selectedFormNames.add(formName);
            el.classList.add('selected');
        }
        if (window.getSelection) window.getSelection().removeAllRanges();
        return;
    }

    // Plain click on the only-selected card: open the form
    if (_selectedFormNames.size === 1 && _selectedFormNames.has(formName)) {
        navigateToForm(formName);
        return;
    }

    // Plain click: collapse selection to just this card
    document.querySelectorAll('.form-card.selected').forEach(c => c.classList.remove('selected'));
    _selectedFormNames.clear();
    _selectedFormNames.add(formName);
    el.classList.add('selected');
}

function showFolderContextMenu(e, folderName) {
    e.preventDefault();
    closeAllContextMenus();

    const menu = document.createElement('div');
    menu.className = 'card-context-menu';
    menu.id = 'folderContextMenu';
    menu.innerHTML = `
        <button onclick="renameFolderPrompt('${folderName}'); closeFolderContextMenu();">✏️ Rename</button>
        <hr>
        <button class="danger" onclick="deleteFolderFromSidebar('${folderName}'); closeFolderContextMenu();">🗑️ Delete</button>
    `;

    document.body.appendChild(menu);
    const { innerWidth: vw, innerHeight: vh } = window;
    const { offsetWidth: mw, offsetHeight: mh } = menu;
    menu.style.left = Math.min(e.clientX, vw - mw - 8) + 'px';
    menu.style.top  = Math.min(e.clientY, vh - mh - 8) + 'px';
}

function closeFolderContextMenu() {
    const m = document.getElementById('folderContextMenu');
    if (m) m.remove();
}

async function renameFolderPrompt(folderName) {
    const newName = prompt(`Rename folder "${folderName}" to:`, folderName);
    if (!newName || newName.trim() === '' || newName.trim() === folderName) return;
    const trimmed = newName.trim();
    try {
        const resp = await apiCall(`${API_BASE}/folders/${encodeURIComponent(folderName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmed }),
        });
        if (!resp.ok) { showError('Failed to rename folder'); return; }
        _allFolders = _allFolders.map(f => f === folderName ? trimmed : f);
        // Update cached forms
        _allForms.forEach(f => { if (f.folder === folderName) f.folder = trimmed; });
        const navigatingFolder = currentFolder === folderName ? trimmed : currentFolder;
        currentFolder = navigatingFolder;
        renderFolderTree(_allForms);
        renderFormGrid(_allForms, currentFolder);
        if (currentFolder !== null) {
            window.history.replaceState(null, '', `#folder:${encodeURIComponent(currentFolder)}`);
        }
    } catch (_) { showError('Failed to rename folder'); }
}

async function deleteFolderFromSidebar(folderName) {
    const count = _allForms.filter(f => f.folder === folderName).length;
    const msg = count > 0
        ? `Delete folder "${folderName}"? The ${count} form${count > 1 ? 's' : ''} inside will become unfiled.`
        : `Delete folder "${folderName}"?`;
    if (!confirm(msg)) return;
    try {
        const resp = await apiCall(`${API_BASE}/folders/${encodeURIComponent(folderName)}`, { method: 'DELETE' });
        if (!resp.ok) { showError('Failed to delete folder'); return; }
        _allFolders = _allFolders.filter(f => f !== folderName);
        _allForms.forEach(f => { if (f.folder === folderName) f.folder = ''; });
        if (currentFolder === folderName) {
            navigateTo('');
        } else {
            renderFolderTree(_allForms);
            renderFormGrid(_allForms, currentFolder);
        }
    } catch (_) { showError('Failed to delete folder'); }
}

function showCardContextMenu(e, formName) {
    e.preventDefault();
    closeAllContextMenus();

    const card = e.currentTarget;

    // Bulk menu when right-clicking inside an existing multi-selection
    const inMultiSelect = _selectedFormNames.size > 1 && _selectedFormNames.has(formName);

    const menu = document.createElement('div');
    menu.className = 'card-context-menu';
    menu.id = 'cardContextMenu';

    if (inMultiSelect) {
        const count = _selectedFormNames.size;
        menu.innerHTML = `
            <button class="danger" onclick="deleteSelectedForms(); closeCardContextMenu();">🗑️ Delete ${count} forms</button>
        `;
    } else {
        // Collapse selection onto the right-clicked card
        document.querySelectorAll('.form-card.selected').forEach(c => c.classList.remove('selected'));
        _selectedFormNames.clear();
        _selectedFormNames.add(formName);
        card.classList.add('selected');

        menu.innerHTML = `
            <button onclick="navigateToForm('${formName}'); closeCardContextMenu();">✏️ Edit</button>
            <button onclick="renameFormFromLanding('${formName}'); closeCardContextMenu();">🏷️ Rename</button>
            <button onclick="duplicateFormFromLanding('${formName}'); closeCardContextMenu();">📋 Duplicate</button>
            <hr>
            <button class="danger" onclick="deleteFormFromLanding('${formName}'); closeCardContextMenu();">🗑️ Delete</button>
        `;
    }

    // Position near the cursor, keeping it on-screen
    document.body.appendChild(menu);
    const { innerWidth: vw, innerHeight: vh } = window;
    const { offsetWidth: mw, offsetHeight: mh } = menu;
    menu.style.left = Math.min(e.clientX, vw - mw - 8) + 'px';
    menu.style.top  = Math.min(e.clientY, vh - mh - 8) + 'px';
}

async function deleteSelectedForms() {
    const names = [..._selectedFormNames];
    if (!names.length) return;

    const label = names.length === 1 ? `"${names[0]}"` : `${names.length} forms`;
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;

    const results = await Promise.all(names.map(async name => {
        try {
            const resp = await apiCall(`${API_BASE}/forms/${name}`, { method: 'DELETE' });
            return resp.ok;
        } catch (_) { return false; }
    }));

    const succeeded = results.filter(Boolean).length;
    const failed    = results.length - succeeded;

    _selectedFormNames.clear();
    const forms = await fetchFormsForLanding();
    renderFolderTree(forms);
    renderFormGrid(forms, currentFolder);

    if (failed === 0) {
        showSuccess(`Deleted ${succeeded} form${succeeded !== 1 ? 's' : ''}`);
    } else {
        showError(`Deleted ${succeeded}, failed to delete ${failed}`);
    }
}

function closeCardContextMenu() {
    const m = document.getElementById('cardContextMenu');
    if (m) m.remove();
}

function closeAllContextMenus() {
    closeCardContextMenu();
    closeFolderContextMenu();
    closeGridContextMenu();
    closeSidebarContextMenu();
}

function showGridContextMenu(e) {
    if (e.target.closest('.form-card') || e.target.closest('.folder-item') ||
        e.target.closest('#cardContextMenu') || e.target.closest('#folderContextMenu') ||
        e.target.closest('.landing-main-header')) return;
    e.preventDefault();
    closeAllContextMenus();

    const menu = document.createElement('div');
    menu.className = 'card-context-menu';
    menu.id = 'gridContextMenu';
    menu.innerHTML = `<button onclick="showNewFormModal(); closeGridContextMenu();">＋ New Form</button>`;

    document.body.appendChild(menu);
    const { innerWidth: vw, innerHeight: vh } = window;
    const { offsetWidth: mw, offsetHeight: mh } = menu;
    menu.style.left = Math.min(e.clientX, vw - mw - 8) + 'px';
    menu.style.top  = Math.min(e.clientY, vh - mh - 8) + 'px';
}

function closeGridContextMenu() {
    const m = document.getElementById('gridContextMenu');
    if (m) m.remove();
}

function showSidebarContextMenu(e) {
    if (e.target.closest('.folder-item') || e.target.closest('#folderContextMenu') ||
        e.target.closest('.btn-new-folder')) return;
    e.preventDefault();
    closeAllContextMenus();

    const menu = document.createElement('div');
    menu.className = 'card-context-menu';
    menu.id = 'sidebarContextMenu';
    menu.innerHTML = `<button onclick="promptNewFolder(); closeSidebarContextMenu();">＋ New Folder</button>`;

    document.body.appendChild(menu);
    const { innerWidth: vw, innerHeight: vh } = window;
    const { offsetWidth: mw, offsetHeight: mh } = menu;
    menu.style.left = Math.min(e.clientX, vw - mw - 8) + 'px';
    menu.style.top  = Math.min(e.clientY, vh - mh - 8) + 'px';
}

function closeSidebarContextMenu() {
    const m = document.getElementById('sidebarContextMenu');
    if (m) m.remove();
}

async function renameFormFromLanding(formName) {
    const cached       = _allForms.find(f => f.name === formName);
    const currentTitle = (cached && cached.title) || formName;
    const input        = prompt(`Rename form "${currentTitle}" to:`, currentTitle);
    if (input === null) return;
    const newTitle = input.trim();
    if (!newTitle || newTitle === currentTitle) return;

    try {
        const existing = await loadForm(formName);
        if (!existing) { showError('Form not found'); return; }

        const escaped     = newTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const yamlContent = existing.yamlContent || '';
        const newYaml     = /^title:/m.test(yamlContent)
            ? yamlContent.replace(/^title:.*$/m, `title: "${escaped}"`)
            : `title: "${escaped}"\n${yamlContent}`;

        const resp = await apiCall(`${API_BASE}/forms/${encodeURIComponent(formName)}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ title: newTitle, yamlContent: newYaml }),
        });
        if (!resp.ok) { showError('Failed to rename form'); return; }

        if (cached) cached.title = newTitle;
        renderFormGrid(_allForms, currentFolder);
        showSuccess('Form renamed');
    } catch (_) { showError('Failed to rename form'); }
}

async function duplicateFormFromLanding(formName) {
    const form = await loadForm(formName);
    if (!form) return;
    _duplicatingYaml = form.yamlContent || '';
    currentFormKey   = formName;
    const titleSlug = (form.title || formName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    document.getElementById('newFormName').value = `${titleSlug}-copy`;
    document.getElementById('newFormModal').style.display = 'block';
    document.getElementById('newFormName').select();
}

async function deleteFormFromLanding(formName) {
    const form = _allForms.find(f => f.name === formName);
    const label = (form && form.title) || formName;
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    const success = await deleteForm(formName);
    if (success) {
        const forms = await fetchFormsForLanding();
        renderFolderTree(forms);
        renderFormGrid(forms, currentFolder);
    }
}

function syncIntegrationSwitcher() {
    const container = document.getElementById('integrationSwitcher');
    if (!container) return;
    if (!currentFormKey) { container.style.display = 'none'; return; }
    container.style.display = '';
    const type = currentConfig
        ? (currentConfig.github ? 'github' : currentConfig.ansible ? 'ansible' : 'none')
        : 'none';
    container.querySelectorAll('.integration-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });
}

function setIntegration(type) {
    const editor = document.getElementById('yamlEditor');
    if (!editor.value.trim()) return;

    const current = parseYAML(editor.value) || {};
    const currentType = current.github ? 'github' : current.ansible ? 'ansible' : 'none';
    if (type === currentType) return;

    if (currentType !== 'none') {
        const fromLabel = currentType === 'github' ? 'GitHub Actions' : 'Ansible Tower';
        const msg = type === 'none'
            ? `This will remove your ${fromLabel} configuration. Continue?`
            : `This will replace your ${fromLabel} configuration. Continue?`;
        if (!confirm(msg)) return;
    }

    let yaml = editor.value;

    // Remove existing integration blocks
    yaml = yaml.replace(/^github:\n(?:[ \t]+[^\n]*\n)*/m, '');
    yaml = yaml.replace(/^ansible:\n(?:[ \t]+[^\n]*\n)*/m, '');

    if (type === 'github') {
        const block = 'github:\n  token: ""\n  repository: "org/repo"\n  workflow: "workflow.yml"\n  event_type: "my_event_type"\n';
        yaml = insertIntegrationBlock(yaml, block);
    } else if (type === 'ansible') {
        const block = 'ansible:\n  token: ""\n  tower_url: "https://tower.example.com"\n  job_template_id: 42\n';
        yaml = insertIntegrationBlock(yaml, block);
    }

    editor.value = yaml.replace(/\n{3,}/g, '\n\n');
    onYamlChange();
}

function insertIntegrationBlock(yaml, block) {
    // Insert after env: block if present, otherwise after description:, otherwise after title:
    const afterEnv  = /^(env:\n(?:[ \t]+[^\n]*\n)*)/m;
    const afterDesc = /^(description:[^\n]*\n)/m;
    const afterTitle = /^(title:[^\n]*\n)/m;
    if (afterEnv.test(yaml))   return yaml.replace(afterEnv,   m => m + block);
    if (afterDesc.test(yaml))  return yaml.replace(afterDesc,  m => m + block);
    if (afterTitle.test(yaml)) return yaml.replace(afterTitle, m => m + block);
    return block + yaml;
}

function onFormSearch() {
    _searchQuery = document.getElementById('formSearch').value;
    renderFormGrid(_allForms, currentFolder);
}

function onFolderDragStart(e, folderName) {
    _draggedFolder = folderName;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', folderName);
    setTimeout(() => {
        const el = document.querySelector(`.folder-draggable[data-folder="${folderName}"]`);
        if (el) el.classList.add('dragging');
    }, 0);
}

function onFolderDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.folder-draggable').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    const rect = e.currentTarget.getBoundingClientRect();
    const isBefore = e.clientY < rect.top + rect.height / 2;
    e.currentTarget.classList.add(isBefore ? 'drop-before' : 'drop-after');
    _dropPosition = isBefore ? 'before' : 'after';
}

function onFolderDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
        e.currentTarget.classList.remove('drop-before', 'drop-after');
    }
}

function onFolderDragEnd(e) {
    document.querySelectorAll('.folder-draggable').forEach(el => {
        el.classList.remove('dragging', 'drop-before', 'drop-after');
    });
    _draggedFolder = null;
    _dropPosition  = null;
}

async function onFolderDrop(e, targetFolder) {
    e.preventDefault();
    document.querySelectorAll('.folder-draggable').forEach(el => {
        el.classList.remove('dragging', 'drop-before', 'drop-after');
    });

    if (!_draggedFolder || _draggedFolder === targetFolder) return;

    const oldIdx    = _allFolders.indexOf(_draggedFolder);
    const targetIdx = _allFolders.indexOf(targetFolder);
    if (oldIdx === -1 || targetIdx === -1) return;

    const newOrder = [..._allFolders];
    newOrder.splice(oldIdx, 1);
    const newTargetIdx = newOrder.indexOf(targetFolder);
    newOrder.splice(_dropPosition === 'before' ? newTargetIdx : newTargetIdx + 1, 0, _draggedFolder);

    _allFolders    = newOrder;
    _draggedFolder = null;
    _dropPosition  = null;

    renderFolderTree(_allForms);

    try {
        await apiCall(`${API_BASE}/folder-order`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ order: _allFolders }),
        });
    } catch (_) { showError('Failed to save folder order'); }
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const d    = new Date(dateStr);
    if (isNaN(d)) return '';
    const diff = (Date.now() - d) / 1000;
    if (diff < 60)     return 'just now';
    if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
}

// ── Folder management ──────────────────────────────────────────────────────────

function promptNewFolder() {
    document.getElementById('newFolderName').value = '';
    document.getElementById('newFolderModal').style.display = 'block';
    document.getElementById('newFolderName').focus();
}

async function confirmNewFolder() {
    const name = document.getElementById('newFolderName').value.trim();
    if (!name) { alert('Please enter a folder name'); return; }
    closeModal('newFolderModal');
    try {
        await apiCall(`${API_BASE}/folders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!_allFolders.includes(name)) _allFolders.push(name);
    } catch (_) {}
    navigateTo(`folder:${encodeURIComponent(name)}`);
}

// ── Track if initialization has already happened
let isInitialized = false;

// Initialize the application
document.addEventListener('DOMContentLoaded', async function() {
    if (isInitialized) {
        console.warn('Application already initialized, skipping...');
        return;
    }
    isInitialized = true;
    await checkApiHealth();
    handleRoute();
});

window.addEventListener('hashchange', handleRoute);

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
    if (!event.target.closest('#cardContextMenu'))  closeCardContextMenu();
    if (!event.target.closest('#folderContextMenu')) closeFolderContextMenu();
    if (!event.target.closest('#gridContextMenu'))     closeGridContextMenu();
    if (!event.target.closest('#sidebarContextMenu')) closeSidebarContextMenu();
});

// Handle Enter key in modals
document.addEventListener('keypress', function(e) {
    if (e.key !== 'Enter') return;
    if (document.getElementById('newFormModal').style.display === 'block') createNewForm();
    if (document.getElementById('newFolderModal').style.display === 'block') confirmNewFolder();
});

function clearEditor() {
    document.getElementById('yamlEditor').value = '';
    document.getElementById('dynamicFormContainer').innerHTML = '';
    document.getElementById('payloadDisplay').innerHTML = '// Select a form to view payload structure';
    document.getElementById('githubPayloadSection').style.display  = '';
    document.getElementById('ansiblePayloadSection').style.display = 'none';
    currentConfig = null;
    currentFormKey = null;
    hasUnsavedChanges = false;
    updateSaveButton();
    renderEnvPanel(null);
    syncIntegrationSwitcher();
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

    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) historyBtn.disabled = !currentFormKey;
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

    let title, yamlContent;
    if (_duplicatingYaml) {
        const parsed   = parseYAML(_duplicatingYaml);
        const srcTitle = (parsed && parsed.title) || currentFormKey;
        title      = srcTitle + ' (Copy)';
        yamlContent = _duplicatingYaml.replace(/^title:.*$/m, `title: "${title}"`);
        _duplicatingYaml = null;
    } else {
        title      = formName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        yamlContent = defaultFormTemplate(title);
    }

    const success = await createForm(formName, title, yamlContent, currentFolder);
    if (success) {
        closeModal('newFormModal');
        navigateToForm(formName);
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
    errorDiv.style.top = '76px';
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
    successDiv.style.top = '76px';
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