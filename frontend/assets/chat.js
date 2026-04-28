
// ── Chat Assistant ─────────────────────────────────────────────────────────────

let _chatOpen    = false;
let _chatHistory = [];    // [{role, content}]
let _chatSending = false;

// Diff modal state
let _diffCurrentYaml  = '';
let _diffProposedYaml = '';
let _diffChanges      = [];

const _CHAT_CHIPS_HTML = `
    <p class="chat-suggestions-label">Get started — try asking:</p>
    <button class="chat-chip" onclick="chipAsk('What field types are available?')">What field types are available?</button>
    <button class="chat-chip" onclick="chipAsk('How do I add conditional logic?')">How do I add conditional logic?</button>
    <button class="chat-chip" onclick="chipAsk('Show me a source: dropdown example')">Show me a source: dropdown example</button>
    <button class="chat-chip" onclick="chipAsk('Help me build a form from scratch')">Help me build a form from scratch</button>
`;

function toggleChat() {
    _chatOpen = !_chatOpen;
    const panel = document.getElementById('chatPanel');
    panel.style.display = _chatOpen ? 'flex' : 'none';
    if (_chatOpen) {
        if (!_chatHistory.length) _loadChatFromStorage();
        setTimeout(() => document.getElementById('chatInput').focus(), 50);
    }
}

function _loadChatFromStorage() {
    try {
        const saved = sessionStorage.getItem('chatHistory');
        if (!saved) return;
        _chatHistory = JSON.parse(saved);
        if (!_chatHistory.length) return;
        const suggestions = document.getElementById('chatSuggestions');
        if (suggestions) suggestions.remove();
        _chatHistory.forEach(msg => _appendChatMessage(msg.role, msg.content, false));
        const container = document.getElementById('chatMessages');
        container.scrollTop = container.scrollHeight;
    } catch (_) { _chatHistory = []; }
}

function _saveChatToStorage() {
    try { sessionStorage.setItem('chatHistory', JSON.stringify(_chatHistory)); } catch (_) {}
}

function newChat() {
    if (_chatHistory.length > 0 && !confirm('Start a new conversation? This will clear the current chat.')) return;
    _chatHistory = [];
    sessionStorage.removeItem('chatHistory');
    const container = document.getElementById('chatMessages');
    container.innerHTML = `<div class="chat-suggestions" id="chatSuggestions">${_CHAT_CHIPS_HTML}</div>`;
}

function chipAsk(text) {
    const input = document.getElementById('chatInput');
    input.value = text;
    autoresizeChatInput();
    sendChat();
}

async function sendChat() {
    if (_chatSending) return;
    const input = document.getElementById('chatInput');
    const text  = input.value.trim();
    if (!text) return;

    input.value = '';
    autoresizeChatInput();

    const suggestions = document.getElementById('chatSuggestions');
    if (suggestions) suggestions.remove();

    _chatHistory.push({ role: 'user', content: text });
    _saveChatToStorage();
    _appendChatMessage('user', text, false);

    const typingEl = _appendTypingIndicator();
    _chatSending   = true;
    document.getElementById('chatSendBtn').disabled = true;

    try {
        const context = {};
        const editorEl = document.getElementById('editorView');
        if (editorEl && editorEl.style.display !== 'none') {
            const yaml = document.getElementById('yamlEditor').value.trim();
            if (yaml) { context.current_yaml = yaml; context.view = 'editor'; }
        }

        const resp = await fetch('/api/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ messages: _chatHistory, context }),
        });

        typingEl.remove();

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            _appendChatMessage('assistant', `⚠️ ${err.error || 'Request failed'}`, false);
            return;
        }

        let fullContent = '';
        const bubble    = _appendChatMessage('assistant', '', true);
        const contentEl = bubble.querySelector('.chat-message-content');

        const reader  = resp.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = '';

        outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') break outer;
                try {
                    const chunk = JSON.parse(payload);
                    if (chunk.error) {
                        contentEl.innerHTML = `<span class="chat-error-text">⚠️ ${chunk.error}</span>`;
                        fullContent = '';
                        break outer;
                    }
                    if (chunk.token) {
                        fullContent += chunk.token;
                        _renderChatContent(contentEl, fullContent, false);
                        bubble.scrollIntoView({ block: 'end' });
                    }
                } catch (_) {}
            }
        }

        if (fullContent) {
            _chatHistory.push({ role: 'assistant', content: fullContent });
            _saveChatToStorage();
            _renderChatContent(contentEl, fullContent, true);
        }

    } catch (err) {
        typingEl.remove();
        _appendChatMessage('assistant', `⚠️ Network error: ${err.message}`, false);
    } finally {
        _chatSending = false;
        document.getElementById('chatSendBtn').disabled = false;
    }
}

function _appendChatMessage(role, content, streaming) {
    const container  = document.getElementById('chatMessages');
    const div        = document.createElement('div');
    div.className    = `chat-message chat-message-${role}`;
    const contentEl  = document.createElement('div');
    contentEl.className = 'chat-message-content';
    if (content) _renderChatContent(contentEl, content, role === 'assistant' && !streaming);
    div.appendChild(contentEl);
    container.appendChild(div);
    div.scrollIntoView({ block: 'end' });
    return div;
}

function _renderChatContent(el, text, addInsertButtons) {
    if (typeof marked !== 'undefined') {
        el.innerHTML = marked.parse(text);
    } else {
        el.innerHTML = text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/```[a-z]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
            .replace(/\n/g, '<br>');
    }

    if (!addInsertButtons) return;

    el.querySelectorAll('pre code').forEach(code => {
        const pre = code.closest('pre');
        if (!pre || pre.querySelector('.insert-yaml-btn')) return;
        const codeText = code.textContent.trim();
        const isYaml   = code.className.includes('yaml') || code.className.includes('yml') ||
                         /^(title:|fields:|github:|ansible:)/.test(codeText);
        if (!isYaml) return;
        const btn       = document.createElement('button');
        btn.className   = 'insert-yaml-btn';
        btn.textContent = '⬆ Insert into editor';
        btn.onclick     = () => _yamlCodeAction(codeText);
        pre.appendChild(btn);
    });
}

// ── YAML insert / diff routing ─────────────────────────────────────────────────

function _yamlCodeAction(proposedYaml) {
    const editorEl = document.getElementById('editorView');
    const editor   = document.getElementById('yamlEditor');
    const hasContent = editorEl && editorEl.style.display !== 'none'
                    && editor && editor.value.trim();
    if (hasContent) {
        _showYamlDiffModal(editor.value.trim(), proposedYaml);
    } else {
        _insertYamlFromChat(proposedYaml);
    }
}

function _insertYamlFromChat(yaml) {
    const editorEl = document.getElementById('editorView');
    if (!editorEl || editorEl.style.display === 'none') {
        alert('Open a form in the editor first, then use "Insert into editor".');
        return;
    }
    const editor      = document.getElementById('yamlEditor');
    const existingRaw = editor.value.trim();

    if (!existingRaw) {
        editor.value = yaml.trim();
        onYamlChange();
        _flashEditor();
        toggleChat();
        return;
    }

    try {
        const existing = jsyaml.load(existingRaw);
        const incoming = jsyaml.load(yaml);

        if (!existing || typeof existing !== 'object') throw new Error('bad existing');

        let newFields = [];
        let newEnv    = null;

        if (Array.isArray(incoming)) {
            newFields = incoming;
        } else if (incoming && typeof incoming === 'object') {
            if (Array.isArray(incoming.fields)) newFields = incoming.fields;
            else if (incoming.name && incoming.type)  newFields = [incoming];
            if (incoming.env && typeof incoming.env === 'object') newEnv = incoming.env;
        }

        if (newFields.length === 0 && !newEnv) {
            if (!confirm('Replace the current YAML with the generated content?')) return;
            editor.value = yaml.trim();
        } else {
            if (!Array.isArray(existing.fields)) existing.fields = [];
            existing.fields = [...existing.fields, ...newFields];
            if (newEnv) existing.env = { ...(existing.env || {}), ...newEnv };
            editor.value = jsyaml.dump(existing, { lineWidth: -1, indent: 2, noRefs: true });
        }

    } catch (_) {
        if (!confirm('Replace the current YAML with the generated content?')) return;
        editor.value = yaml.trim();
    }

    onYamlChange();
    _flashEditor();
    toggleChat();
}

function _flashEditor() {
    const editor = document.getElementById('yamlEditor');
    editor.classList.add('yaml-inserted');
    setTimeout(() => editor.classList.remove('yaml-inserted'), 700);
}

// ── YAML Diff System ───────────────────────────────────────────────────────────

function _computeDiff(currentObj, proposedObj) {
    const changes = [];

    // Top-level (non-field) changes
    const metaKeys    = ['title', 'description', 'env', 'github', 'ansible'];
    const metaChanges = {};
    for (const key of metaKeys) {
        if (JSON.stringify(currentObj[key]) !== JSON.stringify(proposedObj[key])) {
            metaChanges[key] = { from: currentObj[key], to: proposedObj[key] };
        }
    }
    if (Object.keys(metaChanges).length) {
        changes.push({ id: 'meta', type: 'META', changes: metaChanges });
    }

    const curFields  = currentObj.fields  || [];
    const propFields = proposedObj.fields || [];
    const curByName  = new Map(curFields.map(f  => [f.name, f]));
    const propByName = new Map(propFields.map(f => [f.name, f]));

    // Added and modified (walk proposed order)
    for (const field of propFields) {
        const existing = curByName.get(field.name);
        if (!existing) {
            changes.push({ id: `add:${field.name}`, type: 'ADDED', field });
        } else if (JSON.stringify(existing) !== JSON.stringify(field)) {
            const props = {};
            const keys  = new Set([...Object.keys(existing), ...Object.keys(field)]);
            for (const k of keys) {
                if (JSON.stringify(existing[k]) !== JSON.stringify(field[k])) {
                    props[k] = { from: existing[k], to: field[k] };
                }
            }
            changes.push({ id: `mod:${field.name}`, type: 'MODIFIED', field, original: existing, props });
        }
    }

    // Deleted
    for (const field of curFields) {
        if (!propByName.has(field.name)) {
            changes.push({ id: `del:${field.name}`, type: 'DELETED', field });
        }
    }

    return changes;
}

function _showYamlDiffModal(currentYaml, proposedYaml) {
    let currentObj, proposedObj;
    try {
        currentObj  = jsyaml.load(currentYaml)  || {};
        proposedObj = jsyaml.load(proposedYaml) || {};
    } catch (_) {
        if (confirm('Cannot parse YAML to compute diff. Replace entire editor content?')) {
            document.getElementById('yamlEditor').value = proposedYaml.trim();
            onYamlChange(); _flashEditor(); toggleChat();
        }
        return;
    }

    const changes = _computeDiff(currentObj, proposedObj);

    if (!changes.length) {
        alert('No changes detected — the proposed YAML matches the current form.');
        return;
    }

    _diffCurrentYaml  = currentYaml;
    _diffProposedYaml = proposedYaml;
    _diffChanges      = changes;

    _renderDiffModal(changes);
    document.getElementById('yamlDiffModal').style.display = 'block';
}

function _renderDiffModal(changes) {
    const total = changes.length;
    document.getElementById('diffModalBody').innerHTML = `
        <div class="diff-select-all">
            <label>
                <input type="checkbox" id="diffSelectAll" checked onchange="diffToggleAll(this.checked)">
                <span>Select all &nbsp;<span class="diff-count">${total} change${total !== 1 ? 's' : ''}</span></span>
            </label>
        </div>
        <div class="diff-changes-list">
            ${changes.map(_renderDiffRow).join('')}
        </div>
    `;
}

function _renderDiffRow(change) {
    let icon, rowClass, label, details = '';

    if (change.type === 'ADDED') {
        icon     = '+';
        rowClass = 'diff-row-added';
        label    = `Add field <strong>${_esc(change.field.name)}</strong>`;
        if (change.field.label) label += ` &mdash; "${_esc(change.field.label)}"`;
        if (change.field.type)  label += ` <em class="diff-type">(${_esc(change.field.type)})</em>`;

    } else if (change.type === 'DELETED') {
        icon     = '&minus;';
        rowClass = 'diff-row-deleted';
        label    = `Delete field <strong>${_esc(change.field.name)}</strong>`;
        if (change.field.label) label += ` &mdash; "${_esc(change.field.label)}"`;

    } else if (change.type === 'MODIFIED') {
        icon     = '~';
        rowClass = 'diff-row-modified';
        label    = `Modify field <strong>${_esc(change.field.name)}</strong>`;
        if (change.field.label) label += ` &mdash; "${_esc(change.field.label)}"`;
        details  = _renderPropDetails(change.props);

    } else if (change.type === 'META') {
        icon     = '~';
        rowClass = 'diff-row-modified';
        const keys = Object.keys(change.changes).join(', ');
        label    = `Update form settings <em class="diff-type">(${_esc(keys)})</em>`;
        const metaProps = {};
        for (const [k, {from, to}] of Object.entries(change.changes)) {
            metaProps[k] = {
                from: from === undefined ? undefined : _truncate(JSON.stringify(from), 80),
                to:   to   === undefined ? undefined : _truncate(JSON.stringify(to),   80),
            };
        }
        details = _renderPropDetails(metaProps);
    }

    return `
        <div class="diff-row ${rowClass}">
            <label class="diff-row-check">
                <input type="checkbox" class="diff-change-check" data-id="${_esc(change.id)}" checked
                       onchange="diffSyncSelectAll()">
            </label>
            <div class="diff-row-badge">${icon}</div>
            <div class="diff-row-info">
                <div class="diff-row-label">${label}</div>
                ${details}
            </div>
        </div>
    `;
}

function _renderPropDetails(props) {
    if (!props || !Object.keys(props).length) return '';
    const rows = Object.entries(props).map(([k, {from, to}]) => {
        const fromStr = from === undefined ? '<em>unset</em>' : `<code>${_esc(_truncate(String(from), 60))}</code>`;
        const toStr   = to   === undefined ? '<em>unset</em>' : `<code>${_esc(_truncate(String(to),   60))}</code>`;
        return `<div class="diff-prop-row"><span class="diff-prop-key">${_esc(k)}:</span> ${fromStr} &rarr; ${toStr}</div>`;
    }).join('');
    return `<div class="diff-prop-details">${rows}</div>`;
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '…' : str;
}

function diffToggleAll(checked) {
    document.querySelectorAll('.diff-change-check').forEach(cb => cb.checked = checked);
}

function diffSyncSelectAll() {
    const all     = document.querySelectorAll('.diff-change-check');
    const checked = document.querySelectorAll('.diff-change-check:checked');
    const sa      = document.getElementById('diffSelectAll');
    if (!sa) return;
    sa.indeterminate = checked.length > 0 && checked.length < all.length;
    sa.checked       = checked.length === all.length;
}

function closeDiffModal() {
    document.getElementById('yamlDiffModal').style.display = 'none';
    _diffCurrentYaml  = '';
    _diffProposedYaml = '';
    _diffChanges      = [];
}

function applyDiffChanges() {
    const checkedIds = new Set(
        [...document.querySelectorAll('.diff-change-check:checked')].map(cb => cb.dataset.id)
    );

    if (!checkedIds.size) {
        alert('No changes selected. Check at least one change to apply.');
        return;
    }

    const selected = _diffChanges.filter(c => checkedIds.has(c.id));
    const newYaml  = _buildResultYaml(_diffCurrentYaml, selected);

    const editor = document.getElementById('yamlEditor');
    editor.value = newYaml;
    onYamlChange();
    _flashEditor();
    closeDiffModal();
    toggleChat();
}

function _buildResultYaml(currentYaml, selectedChanges) {
    if (window.YAML2) {
        try { return _buildResultYamlCST(currentYaml, selectedChanges); }
        catch (e) { console.warn('YAML2 CST path failed, using fallback:', e); }
    }
    return _buildResultYamlFallback(currentYaml, selectedChanges);
}

function _buildResultYamlCST(currentYaml, selectedChanges) {
    const doc = window.YAML2.parseDocument(currentYaml);

    for (const change of selectedChanges) {
        if (change.type === 'META') {
            for (const [key, {to}] of Object.entries(change.changes)) {
                if (to === undefined || to === null) doc.delete(key);
                else doc.set(key, to);
            }

        } else if (change.type === 'ADDED') {
            let fieldsSeq = doc.get('fields');
            if (!fieldsSeq || !window.YAML2.isSeq(fieldsSeq)) {
                doc.set('fields', []);
                fieldsSeq = doc.get('fields');
            }
            if (window.YAML2.isSeq(fieldsSeq)) {
                fieldsSeq.add(doc.createNode(change.field));
            }

        } else if (change.type === 'DELETED') {
            const fieldsSeq = doc.get('fields');
            if (fieldsSeq && window.YAML2.isSeq(fieldsSeq)) {
                const idx = fieldsSeq.items.findIndex(
                    item => window.YAML2.isMap(item) && item.get('name') === change.field.name
                );
                if (idx !== -1) fieldsSeq.items.splice(idx, 1);
            }

        } else if (change.type === 'MODIFIED') {
            const fieldsSeq = doc.get('fields');
            if (fieldsSeq && window.YAML2.isSeq(fieldsSeq)) {
                const idx = fieldsSeq.items.findIndex(
                    item => window.YAML2.isMap(item) && item.get('name') === change.field.name
                );
                if (idx !== -1) {
                    fieldsSeq.items[idx] = doc.createNode(change.field);
                }
            }
        }
    }

    return doc.toString();
}

function _buildResultYamlFallback(currentYaml, selectedChanges) {
    const result = jsyaml.load(currentYaml) || {};

    for (const change of selectedChanges) {
        if (change.type === 'META') {
            for (const [key, {to}] of Object.entries(change.changes)) {
                if (to === undefined) delete result[key];
                else result[key] = to;
            }
        } else if (change.type === 'ADDED') {
            if (!Array.isArray(result.fields)) result.fields = [];
            result.fields.push(change.field);
        } else if (change.type === 'DELETED') {
            if (Array.isArray(result.fields)) {
                result.fields = result.fields.filter(f => f.name !== change.field.name);
            }
        } else if (change.type === 'MODIFIED') {
            if (Array.isArray(result.fields)) {
                const idx = result.fields.findIndex(f => f.name === change.field.name);
                if (idx !== -1) result.fields[idx] = change.field;
            }
        }
    }

    return jsyaml.dump(result, { lineWidth: -1, indent: 2, noRefs: true });
}

// ── Shared utilities ────────────────────────────────────────────────────────────

function _appendTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const div       = document.createElement('div');
    div.className   = 'chat-message chat-message-assistant';
    div.innerHTML   = '<div class="chat-typing"><span></span><span></span><span></span></div>';
    container.appendChild(div);
    div.scrollIntoView({ block: 'end' });
    return div;
}

function onChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
    }
}

function autoresizeChatInput() {
    const el        = document.getElementById('chatInput');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
