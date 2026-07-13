/* ============================================
   SAJAN AI Agent — Frontend Application
   Built on Claude Fable 5 Principles
   ============================================ */

// --- State ---
const state = {
  conversations: [],
  currentConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  ws: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  sidebarOpen: window.innerWidth > 768,
  theme: localStorage.getItem('sajan-theme') || 'dark',
  renderTimeout: null,
  currentStreamEl: null,
  stagedFiles: [],
  isRecording: false,
  lastMicClickTime: 0,
  intelligenceMode: 'medium',
  userId: null
};

// --- DOM References ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(state.theme);
  setupMarked();
  
  const savedUsername = localStorage.getItem('sajan_username');
  if (savedUsername) {
    state.userId = savedUsername;
    $('#login-overlay').classList.remove('active');
    $('#app').style.display = 'grid';
    initApp();
  } else {
    // Show login overlay
    const overlay = $('#login-overlay');
    const appContainer = $('#app');
    overlay.classList.add('active');
    appContainer.style.display = 'none';
    
    $('#login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const user = $('#username-input').value.trim();
      if (user) {
        localStorage.setItem('sajan_username', user);
        state.userId = user;
        overlay.classList.remove('active');
        appContainer.style.display = 'grid';
        $('#display-username').textContent = user;
        $('#user-profile').style.display = 'flex';
        initApp();
      }
    });
  }
});

async function initApp() {
  try {
    setupEventListeners();
  } catch (e) {
    alert("Error in setupEventListeners: " + e.message);
  }
  
  try {
    connectWebSocket();
  } catch (e) {
    console.error("WS connect error:", e);
  }
  
  try {
    loadConversations();
  } catch (e) {
    console.error("Load convs error:", e);
  }
  
  try {
    const res = await apiFetch('/api/config');
    if (res.ok) {
      const json = await res.json();
      state.provider = json.data.provider;
      updateModelBadge(state.provider, json.data.model);
    } else {
      const p = localStorage.getItem('sajan-provider') || 'google';
      const m = localStorage.getItem('sajan-model') || '';
      updateModelBadge(p, m);
    }
  } catch (e) {
    const p = localStorage.getItem('sajan-provider') || 'google';
    const m = localStorage.getItem('sajan-model') || '';
    updateModelBadge(p, m);
  }
  
  try {
    if (state.userId) {
      const displayUser = $('#display-username');
      const userProfile = $('#user-profile');
      if (displayUser) displayUser.textContent = state.userId;
      if (userProfile) userProfile.style.display = 'flex';
    }
  } catch (e) {
    alert("Profile display error: " + e.message);
  }
  
  $('#logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('sajan_username');
    window.location.reload();
  });
}

// --- API Wrapper ---
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.userId) {
    headers.set('X-User-Id', state.userId);
  }
  return fetch(url, { ...options, headers });
}

// ============================================
// MARKED.JS CONFIGURATION
// ============================================
function setupMarked() {
  const renderer = new marked.Renderer();
  renderer.code = function (codeArg, langArg) {
    // marked v12+ passes an object
    const code = typeof codeArg === 'object' ? codeArg.text : codeArg;
    const lang = typeof codeArg === 'object' ? codeArg.lang : langArg;
    let highlighted;
    if (lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code, { language: lang }).value;
    } else {
      highlighted = hljs.highlightAuto(code).value;
    }
    const langLabel = lang ? `<span class="code-lang-label">${lang}</span>` : '';
    return `<div class="code-block-wrapper">${langLabel}<button class="code-copy-btn" onclick="copyCode(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button><pre><code class="hljs">${highlighted}</code></pre></div>`;
  };
  marked.setOptions({
    renderer,
    breaks: true,
    gfm: true
  });
}

// ============================================
// WEBSOCKET
// ============================================
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${location.host}`);

  state.ws.onopen = () => {
    state.reconnectAttempts = 0;
    updateConnectionStatus('connected');
  };

  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWSMessage(data);
    } catch (e) {
      console.error('WS parse error:', e);
    }
  };

  state.ws.onclose = () => {
    updateConnectionStatus('disconnected');
    attemptReconnect();
  };

  state.ws.onerror = () => {
    updateConnectionStatus('disconnected');
  };
}

function attemptReconnect() {
  if (state.reconnectAttempts >= state.maxReconnectAttempts) {
    showToast('Unable to connect to server. Please refresh the page.', 'error');
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
  state.reconnectAttempts++;
  setTimeout(connectWebSocket, delay);
}

function updateConnectionStatus(status) {
  const dot = $('.status-dot');
  const text = $('.status-text');
  dot.className = 'status-dot ' + status;
  text.textContent = status === 'connected' ? 'Connected' : status === 'disconnected' ? 'Reconnecting...' : 'Connecting...';
}

function handleWSMessage(data) {
  switch (data.type) {
    case 'message_ack':
      const userMsgs = $$('.message-user');
      for (let i = userMsgs.length - 1; i >= 0; i--) {
        if (!userMsgs[i].dataset.id) {
          userMsgs[i].dataset.id = data.messageId;
          break;
        }
      }
      break;

    // --- Trace Events ---
    case 'route':
    case 'safety':
    case 'search':
    case 'memory':
    case 'plan':
    case 'retrieval':
    case 'thinking':
    case 'verify':
      appendTrace(data);
      break;

    // --- Streaming ---
    case 'stream_start':
      startStreaming();
      break;
    case 'stream_chunk':
      if (!state.isStreaming) startStreaming();
      if (data.content) appendStreamChunk(data.content);
      break;
    case 'stream_end':
      finishStreaming(data.fullResponse || state.streamingContent, data.userMessageId, data.assistantMessageId);
      break;

    // --- Legacy single-message format ---
    case 'stream':
      if (!state.isStreaming) startStreaming();
      if (data.content) appendStreamChunk(data.content);
      if (data.done) finishStreaming(data.fullContent || state.streamingContent);
      break;
    case 'message':
      appendMessage('assistant', data.content);
      setInputEnabled(true);
      hideThinking();
      break;

    // --- Safety ---
    case 'safety_refusal':
      hideThinking();
      appendMessage('assistant', data.message);
      setInputEnabled(true);
      if (data.action === 'end_conversation') {
        showToast('Conversation ended due to policy violation.', 'warning');
      }
      break;

    case 'title_update':
      if (data.title && data.conversationId) {
        updateConversationTitle(data.conversationId, data.title);
      }
      break;

    // --- Status messages (e.g., "Searching the web...") ---
    case 'status':
      // Show as a subtle thinking-area message
      const thinkingText = $('.thinking-text');
      if (thinkingText && data.message) {
        thinkingText.textContent = data.message;
      }
      break;

    // --- Config updated ---
    case 'config_updated':
      if (data.provider && data.model) {
        updateModelBadge(data.provider, data.model);
        showToast(`Switched to ${data.provider} / ${data.model}`, 'success');
      }
      break;

    // --- Errors ---
    case 'error':
      showToast(data.message || 'An error occurred', 'error');
      setInputEnabled(true);
      hideThinking();
      if (state.isStreaming) {
        finishStreaming(state.streamingContent || 'An error occurred.');
      }
      break;

    default:
      console.log('Unknown WS message type:', data.type);
  }
}

// ============================================
// CHAT FUNCTIONS
// ============================================
function sendAbortMessage() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'abort' }));
  }
}

async function handleSend() {
  if (state.isStreaming) {
    sendAbortMessage();
    return;
  }
  const input = $('#message-input');
  const text = input.value.trim();
  if ((!text && !state.stagedFiles.length)) return;
  if (!state.currentConversationId) await createConversation();

  const attachments = state.stagedFiles.map(f => f.id).filter(Boolean);

  // Clear trace list for new message
  state.currentTraceList = null;
  const reasoningList = $('#reasoning-trace-list');
  const reasoningEmpty = $('#reasoning-empty');
  if (reasoningList) {
    reasoningList.innerHTML = '';
    reasoningList.style.display = 'none';
  }
  if (reasoningEmpty) {
    reasoningEmpty.style.display = 'block';
  }

  // Clear staged files and preview area
  state.stagedFiles = [];
  renderFilePreviews();

  hideWelcomeScreen();
  appendMessage('user', text || (attachments.length > 0 ? '[Attachments]' : ''));
  input.value = '';
  input.style.height = 'auto';
  updateCharCount();
  updateSendButton();
  setInputEnabled(false);
  showThinking();

  // Stop recording if active when sending
  if (state.isRecording && recognition) {
    recognition.stop();
  }

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      type: 'chat',
      conversationId: state.currentConversationId,
      message: text,
      attachments: attachments,
      mode: state.intelligenceMode,
      userId: state.userId
    }));
  } else {
    showToast('Not connected to server. Trying to reconnect...', 'warning');
    setInputEnabled(true);
    hideThinking();
    connectWebSocket();
  }
}

function appendMessage(role, content, animate = true, id = null) {
  const container = $('#messages-container');
  const div = document.createElement('div');
  div.className = `message message-${role}${animate ? '' : ' no-animate'}`;
  if (id) {
    div.dataset.id = id;
  }

  if (role === 'assistant') {
    div.innerHTML = renderMarkdown(content);
  } else {
    // Parse [Image: name (base64)] blocks and render inline images
    let contentForRendering = content;
    const imageRegex = /\[Image:\s*([^(\n]+?)\s*\(([^)]+)\)\]/g;
    contentForRendering = contentForRendering.replace(imageRegex, (match, name, dataUrl) => {
      return `<img class="chat-message-image" src="${dataUrl}" alt="${name}">`;
    });
    div.innerHTML = renderMarkdown(contentForRendering);

    // Edit and Delete controls
    const controls = document.createElement('div');
    controls.className = 'message-controls';
    controls.innerHTML = `
      <button class="message-control-btn edit-btn" title="Edit message">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="message-control-btn delete-btn" title="Delete message">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    `;
    div.appendChild(controls);
  }
  container.appendChild(div);
  scrollToBottom();

  // Update conversation title from first user message
  if (role === 'user' && state.messages.length === 0) {
    const imageRegex = /\[Image:\s*([^(\n]+?)\s*\(([^)]+)\)\]/g;
    const cleanTitleText = content.replace(imageRegex, '').replace(/---[\s\S]*?---/g, '').trim();
    const title = cleanTitleText.substring(0, 50) + (cleanTitleText.length > 50 ? '...' : '');
    updateConversationTitle(state.currentConversationId, title || 'Image/File Attachment');
  }
  state.messages.push({ role, content, id });
}

function startStreaming() {
  state.isStreaming = true;
  state.streamingContent = '';
  setInputEnabled(false);
  const container = $('#messages-container');
  const div = document.createElement('div');
  div.className = 'message message-assistant';
  div.id = 'streaming-message';
  div.innerHTML = '<span class="streaming-cursor">▊</span>';
  container.appendChild(div);
  state.currentStreamEl = div;
  hideThinking();
  scrollToBottom();
}

function appendStreamChunk(chunk) {
  state.streamingContent += chunk;
  if (state.renderTimeout) clearTimeout(state.renderTimeout);
  state.renderTimeout = setTimeout(() => {
    if (state.currentStreamEl) {
      state.currentStreamEl.innerHTML = renderMarkdown(state.streamingContent) + '<span class="streaming-cursor">▊</span>';
      scrollToBottom();
    }
  }, 50);
}

function finishStreaming(fullContent, userMessageId = null, assistantMessageId = null) {
  if (state.renderTimeout) clearTimeout(state.renderTimeout);
  if (state.currentStreamEl) {
    state.currentStreamEl.innerHTML = renderMarkdown(fullContent || state.streamingContent);
    state.currentStreamEl.id = '';
    if (assistantMessageId) {
      state.currentStreamEl.dataset.id = assistantMessageId;
    }
  }

  if (userMessageId) {
    const userMsgs = $$('.message-user');
    for (let i = userMsgs.length - 1; i >= 0; i--) {
      if (!userMsgs[i].dataset.id) {
        userMsgs[i].dataset.id = userMessageId;
        break;
      }
    }
  }

  state.messages.push({ role: 'assistant', content: fullContent || state.streamingContent, id: assistantMessageId });
  if (userMessageId && state.messages.length >= 2) {
    const lastUserMsg = state.messages[state.messages.length - 2];
    if (lastUserMsg && lastUserMsg.role === 'user') {
      lastUserMsg.id = userMessageId;
    }
  }

  state.isStreaming = false;
  state.streamingContent = '';
  state.currentStreamEl = null;
  setInputEnabled(true);
  hideThinking();
  scrollToBottom();
}

function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(text);
  } catch (e) {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

function appendTrace(data, isLive = true) {
  // Find the associated user message.
  // We match by messageId if provided. If not, we find the last user message.
  let userMsgEl = null;
  if (data.messageId) {
    userMsgEl = document.querySelector(`.message-user[data-id="${data.messageId}"]`);
  }
  
  if (!userMsgEl) {
    if (!isLive) return; // Prevent older orphaned traces from appending to newer queries on refresh
    const userMsgs = $$('.message-user');
    if (userMsgs.length > 0) {
      userMsgEl = userMsgs[userMsgs.length - 1];
    }
  }

  if (!userMsgEl) return;

  // Ensure trace container exists inside this message
  let traceContainer = userMsgEl.querySelector('.inline-trace-container');
  if (!traceContainer) {
    traceContainer = document.createElement('div');
    traceContainer.className = 'inline-trace-container';
    userMsgEl.appendChild(traceContainer);
  }

  const traceEl = document.createElement('div');
  traceEl.className = `inline-trace-item trace-${(data.type || '').toLowerCase()}`;
  
  const typeStr = escapeHtml(data.type.toUpperCase());
  const labelStr = escapeHtml(data.label);
  const detailStr = escapeHtml(data.detail);
  const timeStr = new Date(data.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});

  traceEl.innerHTML = `
    <span class="trace-time">${timeStr}</span>
    <span class="trace-label">${typeStr} | ${labelStr}</span>
    ${detailStr ? `<span class="trace-detail">${detailStr}</span>` : ''}
  `;

  traceContainer.appendChild(traceEl);
  scrollToBottom();
}

// ============================================
// CONVERSATION MANAGEMENT
// ============================================

async function loadConversations() {
  try {
    const res = await apiFetch('/api/conversations');
    if (!res.ok) throw new Error('Failed to load');
    const json = await res.json();
    state.conversations = json.data || json;
    renderConversationList();
    if (state.conversations.length > 0) {
      switchConversation(state.conversations[0].id);
    } else {
      await createConversation();
    }
  } catch (e) {
    console.error('Load conversations error:', e);
    await createConversation();
  }
}

async function createConversation() {
  try {
    const res = await apiFetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Conversation' })
    });
    const json = await res.json();
    const conv = json.data || json;
    state.conversations.unshift(conv);
    renderConversationList();
    await switchConversation(conv.id);
  } catch (e) {
    showToast('Failed to create conversation', 'error');
  }
}

async function switchConversation(id) {
  state.currentConversationId = id;
  state.messages = [];
  const container = $('#messages-container');

  // Clear messages except welcome screen
  const welcome = $('#welcome-screen');
  container.innerHTML = '';
  if (welcome) container.appendChild(welcome);

  // Clear reasoning panel traces on switch
  const reasoningList = $('#reasoning-trace-list');
  const reasoningEmpty = $('#reasoning-empty');
  if (reasoningList) {
    reasoningList.innerHTML = '';
    reasoningList.style.display = 'none';
  }
  if (reasoningEmpty) {
    reasoningEmpty.style.display = 'block';
  }

  // Update active state in sidebar
  $$('.conversation-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  try {
    const res = await apiFetch(`/api/conversations/${id}`);
    if (!res.ok) throw new Error('Failed to load');
    const json = await res.json();
    const conv = json.data || json;
    $('#chat-title').textContent = conv.title || 'New Conversation';

    if (conv.messages && conv.messages.length > 0) {
      hideWelcomeScreen();
      conv.messages.forEach(msg => {
        appendMessage(msg.role, msg.content, false, msg.id);
      });
    } else {
      showWelcomeScreen();
    }

    // Fetch and reconstruct traces
    try {
      const tracesRes = await apiFetch(`/api/conversations/${id}/traces`);
      if (tracesRes.ok) {
        const tracesJson = await tracesRes.json();
        const traces = tracesJson.data || [];
        traces.forEach(trace => {
          appendTrace({
            type: trace.event_type,
            timestamp: trace.timestamp,
            label: trace.label,
            detail: trace.detail,
            messageId: trace.message_id
          }, false);
        });
      }
    } catch (e) {
      console.error('Failed to load traces:', e);
    }
  } catch (e) {
    console.error('Switch conversation error:', e);
  }

  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    toggleSidebar(false);
  }
}

async function deleteConversation(id) {
  if (!window.confirm('Are you sure you want to delete this conversation? This action cannot be undone.')) {
    return;
  }
  
  try {
    await apiFetch(`/api/conversations/${id}`, { method: 'DELETE' });
    state.conversations = state.conversations.filter(c => c.id !== id);
    renderConversationList();
    if (state.currentConversationId === id) {
      if (state.conversations.length > 0) {
        switchConversation(state.conversations[0].id);
      } else {
        await createConversation();
      }
    }
    showToast('Conversation deleted', 'success');
  } catch (e) {
    showToast('Failed to delete conversation', 'error');
  }
}

function renderConversationList() {
  const list = $('#conversation-list');
  const searchQuery = ($('#conversation-search')?.value || '').toLowerCase();

  const filtered = state.conversations.filter(c =>
    !searchQuery || (c.title || '').toLowerCase().includes(searchQuery)
  );

  list.innerHTML = filtered.map(conv => `
    <div class="conversation-item${conv.id === state.currentConversationId ? ' active' : ''}" 
         data-id="${conv.id}" role="listitem" onclick="switchConversation('${conv.id}')">
      <div class="conversation-item-content">
        <div class="conversation-item-title">${escapeHtml(conv.title || 'New Conversation')}</div>
        <div class="conversation-item-time">${timeAgo(conv.updated_at || conv.created_at)}</div>
      </div>
      <button class="conversation-item-delete" onclick="event.stopPropagation(); deleteConversation('${conv.id}')" aria-label="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  `).join('');
}

async function updateConversationTitle(id, title) {
  try {
    await apiFetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    const conv = state.conversations.find(c => c.id === id);
    if (conv) conv.title = title;
    renderConversationList();
    if (state.currentConversationId === id) {
      $('#chat-title').textContent = title;
    }
  } catch (e) {
    // Silently fail on title update
  }
}

// ============================================
// MEMORY PANEL
// ============================================
function toggleMemoryPanel() {
  const panel = $('#memory-panel');
  const prefsPanel = $('#prefs-panel');
  const reasoningPanel = $('#reasoning-panel');
  if (prefsPanel.style.display !== 'none') prefsPanel.style.display = 'none';
  if (reasoningPanel && reasoningPanel.style.display !== 'none') reasoningPanel.style.display = 'none';

  if (panel.style.display === 'none') {
    panel.style.display = 'flex';
    loadMemories();
  } else {
    panel.style.display = 'none';
  }
}

async function loadMemories() {
  try {
    const res = await apiFetch('/api/memories');
    const json = await res.json();
    const memories = json.data || json;
    renderMemoryList(memories);
  } catch (e) {
    showToast('Failed to load memories', 'error');
  }
}

async function addMemory() {
  const key = $('#memory-key').value.trim();
  const value = $('#memory-value').value.trim();
  const category = $('#memory-category').value;
  if (!key || !value) { showToast('Please fill in key and value', 'warning'); return; }

  try {
    await apiFetch('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, category })
    });
    $('#memory-key').value = '';
    $('#memory-value').value = '';
    loadMemories();
    showToast('Memory added', 'success');
  } catch (e) {
    showToast('Failed to add memory', 'error');
  }
}

async function deleteMemory(id) {
  try {
    await apiFetch(`/api/memories/${id}`, { method: 'DELETE' });
    loadMemories();
    showToast('Memory deleted', 'success');
  } catch (e) {
    showToast('Failed to delete memory', 'error');
  }
}

function renderMemoryList(memories) {
  const list = $('#memory-list');
  if (!memories || memories.length === 0) {
    list.innerHTML = '<div class="panel-empty">No memories yet. Add some to personalize SAJAN.</div>';
    return;
  }
  list.innerHTML = memories.map(m => `
    <div class="panel-card">
      <div class="panel-card-header">
        <span class="panel-card-key">${escapeHtml(m.key)}</span>
        <span class="panel-card-badge badge-${m.category || 'personal'}">${m.category || 'personal'}</span>
      </div>
      <div class="panel-card-value">${escapeHtml(m.value)}</div>
      <button class="panel-card-delete" onclick="deleteMemory('${m.id}')" style="margin-top:6px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  `).join('');
}

// ============================================
// PREFERENCES PANEL
// ============================================
function togglePrefsPanel() {
  const panel = $('#prefs-panel');
  const memPanel = $('#memory-panel');
  const reasoningPanel = $('#reasoning-panel');
  if (memPanel.style.display !== 'none') memPanel.style.display = 'none';
  if (reasoningPanel && reasoningPanel.style.display !== 'none') reasoningPanel.style.display = 'none';

  if (panel.style.display === 'none') {
    panel.style.display = 'flex';
    loadPreferences();
  } else {
    panel.style.display = 'none';
  }
}

function toggleReasoningPanel() {
  const panel = $('#reasoning-panel');
  const memPanel = $('#memory-panel');
  const prefsPanel = $('#prefs-panel');
  if (memPanel && memPanel.style.display !== 'none') memPanel.style.display = 'none';
  if (prefsPanel && prefsPanel.style.display !== 'none') prefsPanel.style.display = 'none';

  if (panel) {
    if (panel.style.display === 'none') {
      panel.style.display = 'flex';
      const list = $('#reasoning-trace-list');
      const empty = $('#reasoning-empty');
      if (list && empty) {
        if (list.children.length > 0) {
          list.style.display = 'block';
          empty.style.display = 'none';
        } else {
          list.style.display = 'none';
          empty.style.display = 'block';
        }
      }
    } else {
      panel.style.display = 'none';
    }
  }
}

async function loadPreferences() {
  try {
    const res = await apiFetch('/api/preferences');
    const json = await res.json();
    const prefs = json.data || json;
    renderPrefsList(prefs);
  } catch (e) {
    showToast('Failed to load preferences', 'error');
  }
}

async function addPreference() {
  const key = $('#pref-key').value.trim();
  const value = $('#pref-value').value.trim();
  const type = $('#pref-type').value;
  if (!key || !value) { showToast('Please fill in key and value', 'warning'); return; }

  try {
    await apiFetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, type })
    });
    $('#pref-key').value = '';
    $('#pref-value').value = '';
    loadPreferences();
    showToast('Preference saved', 'success');
  } catch (e) {
    showToast('Failed to save preference', 'error');
  }
}

async function deletePreference(key) {
  try {
    await apiFetch(`/api/preferences/${encodeURIComponent(key)}`, { method: 'DELETE' });
    loadPreferences();
    showToast('Preference deleted', 'success');
  } catch (e) {
    showToast('Failed to delete preference', 'error');
  }
}

function renderPrefsList(prefs) {
  const list = $('#prefs-list');
  if (!prefs || prefs.length === 0) {
    list.innerHTML = '<div class="panel-empty">No preferences set. Add preferences to customize SAJAN\'s behavior.</div>';
    return;
  }
  list.innerHTML = prefs.map(p => `
    <div class="panel-card">
      <div class="panel-card-header">
        <span class="panel-card-key">${escapeHtml(p.key)}</span>
        <span class="panel-card-badge badge-${p.type || 'behavioral'}">${p.type || 'behavioral'}</span>
      </div>
      <div class="panel-card-value">${escapeHtml(p.value)}</div>
      <button class="panel-card-delete" onclick="deletePreference('${escapeHtml(p.key)}')" style="margin-top:6px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  `).join('');
}

// ============================================
// SETTINGS MODAL
// ============================================
function openSettings() {
  $('#settings-modal').style.display = 'flex';
  // Load saved API config
  const provider = localStorage.getItem('sajan-provider') || 'google';
  const model = localStorage.getItem('sajan-model') || '';
  $('#api-provider').value = provider;
  $('#api-model').value = model;
}

function closeSettings() {
  $('#settings-modal').style.display = 'none';
}

async function saveApiConfig() {
  const provider = $('#api-provider').value;
  const apiKey = $('#api-key').value.trim();
  const model = $('#api-model').value.trim();

  try {
    await apiFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey, model })
    });

    // Also send via WebSocket for live update
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'config', provider, apiKey, model }));
    }

    localStorage.setItem('sajan-provider', provider);
    localStorage.setItem('sajan-model', model);
    updateModelBadge(provider, model);
    showToast('API configuration saved', 'success');
    closeSettings();
  } catch (e) {
    showToast('Failed to save configuration', 'error');
  }
}

function updateModelBadge(provider, model) {
  const badge = $('#model-badge');
  if (!badge) return;
  if (provider === 'google') {
    const modelNames = {
      low: 'Gemini 3.1 Flash Lite',
      medium: 'Gemini 3.5 Flash',
      high: 'Gemini 3.5 Flash'
    };
    badge.textContent = modelNames[state.intelligenceMode] || 'Gemini 3.5 Flash';
  } else {
    const names = {
      openai: model || 'GPT-4o',
      anthropic: model || 'Claude Sonnet'
    };
    badge.textContent = names[provider] || provider;
  }
}

function switchTab(tabName) {
  $$('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  $$('.tab-content').forEach(c => c.style.display = 'none');
  $(`#tab-${tabName}`).style.display = 'block';
}

// ============================================
// THEME
// ============================================
function toggleTheme() {
  const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
  localStorage.setItem('sajan-theme', theme);
  const themeBtn = $('#theme-toggle');
  if (themeBtn) {
    const sun = themeBtn.querySelector('.icon-sun');
    const moon = themeBtn.querySelector('.icon-moon');
    if (theme === 'light') {
      if (sun) sun.style.display = 'block';
      if (moon) moon.style.display = 'none';
    } else {
      if (sun) sun.style.display = 'none';
      if (moon) moon.style.display = 'block';
    }
  }
}

// ============================================
// TOAST SYSTEM
// ============================================
function showToast(message, type = 'info', duration = 4000) {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="toast-dismiss" onclick="this.parentElement.remove()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================
// UI UTILITIES
// ============================================
function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function scrollToBottom(smooth = true) {
  const container = $('#messages-container');
  container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function toggleSidebar(forceState) {
  const app = $('#app');
  if (window.innerWidth <= 768) {
    const open = forceState !== undefined ? forceState : !app.classList.contains('sidebar-open');
    app.classList.toggle('sidebar-open', open);
  } else {
    app.classList.toggle('sidebar-collapsed');
  }
}

function getGreetingPrefix() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Midnight Inspiration';
  if (hour < 8) return 'Early Morning Focus';
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  if (hour < 20) return 'Good Evening';
  if (hour < 22) return 'Nighttime Clarity';
  return 'Late Night Genius';
}

function showWelcomeScreen() {
  const w = $('#welcome-screen');
  if (w) {
    w.style.display = 'flex';
    const titleEl = w.querySelector('.welcome-title');
    if (titleEl && state.userId) {
      titleEl.textContent = `${getGreetingPrefix()}, ${state.userId}`;
    } else if (titleEl) {
      titleEl.textContent = 'SAJAN';
    }
  }
}

function hideWelcomeScreen() {
  const w = $('#welcome-screen');
  if (w) w.style.display = 'none';
}

function showThinking() {
  $('#thinking-indicator').style.display = 'flex';
}

function hideThinking() {
  $('#thinking-indicator').style.display = 'none';
}

function setInputEnabled(enabled) {
  const input = $('#message-input');
  const btn = $('#send-btn');
  const micBtn = $('#mic-btn');
  const attachBtn = $('#attach-btn');
  
  if (input) input.disabled = !enabled;
  if (micBtn) micBtn.disabled = !enabled;
  if (attachBtn) attachBtn.disabled = !enabled;
  
  if (enabled) {
    if (input) input.focus();
    updateSendButton();
  } else {
    if (btn) btn.disabled = !state.isStreaming;
    updateSendButton();
  }
}

function updateSendButton() {
  const btn = $('#send-btn');
  const input = $('#message-input');
  
  if (state.isStreaming) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/></svg>`;
    btn.setAttribute('aria-label', 'Stop generation');
  } else {
    btn.disabled = (!input.value.trim() && !state.stagedFiles.length);
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
    btn.setAttribute('aria-label', 'Send message');
  }
}

function updateCharCount() {
  const input = $('#message-input');
  const counter = $('#char-count');
  const len = input.value.length;
  counter.textContent = len > 0 ? `${len}` : '';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// CODE COPY
// ============================================
function copyCode(btn) {
  const wrapper = btn.closest('.code-block-wrapper');
  const code = wrapper.querySelector('code');
  const text = code.textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
}

async function handleDeleteMessage(msgId, msgDiv) {
  try {
    const res = await apiFetch(`/api/messages/${msgId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete on server');
    
    // Remove from DOM: user bubble, its traces, and subsequent assistant bubble
    let sibling = msgDiv.nextElementSibling;
    const elementsToRemove = [msgDiv];
    while (sibling && !sibling.classList.contains('message-user')) {
      elementsToRemove.push(sibling);
      sibling = sibling.nextElementSibling;
    }
    elementsToRemove.forEach(el => el.remove());

    // Remove from state.messages
    const idx = state.messages.findIndex(m => m.id === msgId);
    if (idx !== -1) {
      state.messages.splice(idx, 1);
      if (idx < state.messages.length && state.messages[idx].role === 'assistant') {
        state.messages.splice(idx, 1);
      }
    }
    
    if (state.messages.length === 0) {
      showWelcomeScreen();
    }
    showToast('Message deleted', 'success');
  } catch (e) {
    console.error(e);
    showToast('Failed to delete message', 'error');
  }
}

async function handleEditMessage(msgId, msgDiv) {
  const userMsgObj = state.messages.find(m => m.id === msgId);
  const text = userMsgObj ? userMsgObj.content : '';
  
  if (text) {
    const input = $('#message-input');
    input.value = text;
    autoResizeTextarea(input);
    input.focus();
  }
  
  await handleDeleteMessage(msgId, msgDiv);
}

// ============================================
// EVENT LISTENERS
// ============================================
function setupEventListeners() {
  // Send message
  $('#send-btn').addEventListener('click', handleSend);
  $('#message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // File attachments
  const fileInput = $('#file-input');
  const attachBtn = $('#attach-btn');
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => {
      fileInput.click();
    });
    fileInput.addEventListener('change', handleFileSelect);
  }

  // Voice recording
  const micBtn = $('#mic-btn');
  if (micBtn) {
    micBtn.addEventListener('click', toggleRecording);
  }

  // Intelligence Mode Toggle
  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      modeBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.intelligenceMode = e.target.dataset.mode;
      const provider = localStorage.getItem('sajan-provider') || 'google';
      const model = localStorage.getItem('sajan-model') || '';
      updateModelBadge(provider, model);
    });
  });

  // Auto-resize textarea
  $('#message-input').addEventListener('input', (e) => {
    autoResizeTextarea(e.target);
    updateSendButton();
    updateCharCount();
  });

  // New chat
  $('#new-chat-btn').addEventListener('click', createConversation);

  // Sidebar toggle
  $('#sidebar-toggle')?.addEventListener('click', () => toggleSidebar());
  $('#mobile-sidebar-toggle')?.addEventListener('click', () => toggleSidebar());

  // Settings
  $('#settings-btn').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', closeSettings);
  $('#settings-modal').addEventListener('click', (e) => {
    if (e.target === $('#settings-modal')) closeSettings();
  });
  $$('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  $('#save-api-btn').addEventListener('click', saveApiConfig);
  $('#api-provider').addEventListener('change', (e) => {
    const provider = e.target.value;
    const defaults = { google: '', openai: 'gpt-4o-mini', anthropic: 'claude-3-5-sonnet-20240620' };
    $('#api-model').value = defaults[provider] || '';
  });

  // Password toggle
  $('#password-toggle').addEventListener('click', () => {
    const input = $('#api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Theme
  const themeToggle = $('#theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Memory panel
  $('#memory-btn').addEventListener('click', toggleMemoryPanel);
  $('#memory-close').addEventListener('click', () => { $('#memory-panel').style.display = 'none'; });
  $('#add-memory-btn').addEventListener('click', addMemory);

  // Preferences panel
  $('#prefs-btn').addEventListener('click', togglePrefsPanel);
  $('#prefs-close').addEventListener('click', () => { $('#prefs-panel').style.display = 'none'; });
  $('#add-pref-btn').addEventListener('click', addPreference);

  // Reasoning panel
  $('#reasoning-close')?.addEventListener('click', () => { $('#reasoning-panel').style.display = 'none'; });

  // Conversation search
  $('#conversation-search').addEventListener('input', () => renderConversationList());

  // Scroll to bottom button
  const msgContainer = $('#messages-container');
  const scrollBtn = $('#scroll-bottom-btn');
  msgContainer.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = msgContainer;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    scrollBtn.style.display = isNearBottom ? 'none' : 'flex';
  });
  scrollBtn.addEventListener('click', () => scrollToBottom());

  // Suggestion cards
  $$('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const text = card.dataset.suggestion;
      const input = $('#message-input');
      input.value = text;
      input.focus();
      autoResizeTextarea(input);
      updateSendButton();
      updateCharCount();
    });
  });

  // Edit/Delete user message event delegation
  $('#messages-container').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.edit-btn');
    const deleteBtn = e.target.closest('.delete-btn');
    
    if (editBtn || deleteBtn) {
      if (state.isStreaming) {
        showToast('Cannot modify messages while streaming is active.', 'warning');
        return;
      }
    }
    
    if (editBtn) {
      const msgDiv = editBtn.closest('.message-user');
      const msgId = msgDiv.dataset.id;
      if (msgId) {
        handleEditMessage(msgId, msgDiv);
      }
    } else if (deleteBtn) {
      const msgDiv = deleteBtn.closest('.message-user');
      const msgId = msgDiv.dataset.id;
      if (msgId) {
        handleDeleteMessage(msgId, msgDiv);
      }
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape: close modals/panels
    if (e.key === 'Escape') {
      if ($('#settings-modal').style.display !== 'none') closeSettings();
      else if ($('#memory-panel').style.display !== 'none') $('#memory-panel').style.display = 'none';
      else if ($('#prefs-panel').style.display !== 'none') $('#prefs-panel').style.display = 'none';
      else if ($('#reasoning-panel') && $('#reasoning-panel').style.display !== 'none') $('#reasoning-panel').style.display = 'none';
    }
    // Ctrl+N: new chat
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      createConversation();
    }
    // Ctrl+/: toggle sidebar
    if (e.ctrlKey && e.key === '/') {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Responsive
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      $('#app').classList.remove('sidebar-open');
    }
  });
}

// ============================================
// FILE ATTACHMENTS & VOICE INPUT HELPERS
// ============================================
async function handleFileSelect(e) {
  const files = e.target.files;
  if (!files.length) return;

  if (!state.currentConversationId) {
    await createConversation();
  }

  const uploadPromises = Array.from(files).map(file => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      const ext = file.name.split('.').pop().toLowerCase();
      const isDocument = ['txt', 'md', 'csv', 'pdf'].includes(ext);
      const isImage = ['png', 'jpg', 'jpeg'].includes(ext);

      if (!isDocument && !isImage) {
        showToast(`Unsupported file type: ${file.name}`, 'warning');
        resolve(null);
        return;
      }

      if (isDocument) {
        const formData = new FormData();
        formData.append('document', file);
        formData.append('conversationId', state.currentConversationId);
        showToast(`Indexing ${file.name} for semantic search...`, 'success');
        
        apiFetch('/api/rag-upload', {
          method: 'POST',
          body: formData
        }).then(res => res.json()).then(data => {
          if (data.error) throw new Error(data.error);
          showToast(`Indexed ${data.chunks} chunks from ${data.filename}`, 'success');
          // Add a dummy entry to stagedFiles so the UI shows it's attached for this message context
          resolve({
            id: data.docId, // Just tracking docId 
            name: file.name,
            type: 'text',
            content: '[Indexed for Semantic Search]'
          });
        }).catch(err => {
          showToast(`Upload error: ${err.message}`, 'error');
          resolve(null);
        });
      } else {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const content = event.target.result;
          try {
            const response = await apiFetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                file: content,
                filename: file.name,
                type: 'image'
              })
            });
            if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              showToast(`Failed to upload ${file.name}: ${errData.error || response.statusText}`, 'error');
              resolve(null);
              return;
            }
            const data = await response.json();
            resolve({
              id: data.fileId,
              name: file.name,
              type: 'image',
              content: content
            });
          } catch (error) {
            showToast(`Upload error: ${error.message}`, 'error');
            resolve(null);
          }
        };
        reader.readAsDataURL(file);
      }
    });
  });

  Promise.all(uploadPromises).then(results => {
    const validResults = results.filter(r => r !== null);
    state.stagedFiles = [...state.stagedFiles, ...validResults];
    renderFilePreviews();
    e.target.value = '';
    updateSendButton();
  });
}

function renderFilePreviews() {
  const container = $('#file-preview-area');
  if (!state.stagedFiles.length) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = state.stagedFiles.map((file, index) => {
    if (file.type === 'image') {
      return `
        <div class="preview-pill image-pill">
          <img class="preview-thumbnail" src="${file.content}" alt="${escapeHtml(file.name)}">
          <span class="preview-name">${escapeHtml(file.name)}</span>
          <button class="preview-remove-btn" onclick="removeStagedFile(${index})" aria-label="Remove">×</button>
        </div>
      `;
    } else {
      return `
        <div class="preview-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="preview-name">${escapeHtml(file.name)}</span>
          <button class="preview-remove-btn" onclick="removeStagedFile(${index})" aria-label="Remove">×</button>
        </div>
      `;
    }
  }).join('');
}

function removeStagedFile(index) {
  state.stagedFiles.splice(index, 1);
  renderFilePreviews();
  updateSendButton();
}

window.removeStagedFile = removeStagedFile;

let recognition = null;
let mediaRecorder = null;
let audioChunks = [];

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let finalTranscript = '';

  recognition.onstart = () => {
    finalTranscript = ''; // Reset transcript for each new recording session
    state.isRecording = true;
    const micBtn = $('#mic-btn');
    if (micBtn) {
      micBtn.classList.add('recording');
      micBtn.setAttribute('aria-label', 'Stop recording');
    }
    showToast('Voice input started. Speak now...', 'info');
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    const input = $('#message-input');
    if (!input) return;

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    if (recognition._initialText === undefined || recognition._initialText === null) {
      recognition._initialText = input.value;
    }
    
    const separator = (recognition._initialText && !recognition._initialText.endsWith(' ')) ? ' ' : '';
    input.value = recognition._initialText + separator + finalTranscript + interimTranscript;
    
    autoResizeTextarea(input);
    updateSendButton();
    updateCharCount();
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error !== 'no-speech') {
      showToast(`Speech recognition error: ${event.error}`, 'error');
    }
    stopRecording();
  };

  recognition.onend = () => {
    stopRecording();
  };
}

function toggleRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  const now = Date.now();
  if (now - state.lastMicClickTime < 500) {
    showToast('Please wait before clicking the microphone again.', 'warning');
    return;
  }
  state.lastMicClickTime = now;

  if (!SpeechRecognition) {
    // MediaRecorder fallback sequence
    if (state.isRecording) {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    } else {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          audioChunks = [];
          mediaRecorder = new MediaRecorder(stream);
          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunks.push(event.data);
            }
          };
          mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            stream.getTracks().forEach(track => track.stop());
            
            const formData = new FormData();
            formData.append('audio', audioBlob, 'audio.webm');
            
            showToast('Transcribing audio...', 'info');
            apiFetch('/api/transcribe', {
              method: 'POST',
              body: formData
            })
            .then(res => {
              if (!res.ok) throw new Error('Transcription server error');
              return res.json();
            })
            .then(data => {
              if (data.success && data.text) {
                const input = $('#message-input');
                const separator = (input.value && !input.value.endsWith(' ')) ? ' ' : '';
                input.value = input.value + separator + data.text;
                autoResizeTextarea(input);
                updateSendButton();
                updateCharCount();
                showToast('Transcription successful.', 'success');
              } else {
                showToast('Transcription failed.', 'error');
              }
            })
            .catch(err => {
              console.error(err);
              showToast('Error during transcription.', 'error');
            })
            .finally(() => {
              stopRecording();
            });
          };

          mediaRecorder.start();
          state.isRecording = true;
          const micBtn = $('#mic-btn');
          if (micBtn) {
            micBtn.classList.add('recording');
            micBtn.setAttribute('aria-label', 'Stop recording');
          }
          showToast('Recording voice (fallback)...', 'info');
        })
        .catch(err => {
          console.error(err);
          showToast('Microphone access denied or not available.', 'error');
          stopRecording();
        });
    }
    return;
  }

  if (!recognition) {
    setupSpeechRecognition();
  }

  if (state.isRecording) {
    recognition.stop();
  } else {
    const input = $('#message-input');
    if (recognition) {
      recognition._initialText = input ? input.value : '';
      recognition.start();
    }
  }
}

function stopRecording() {
  state.isRecording = false;
  const micBtn = $('#mic-btn');
  if (micBtn) {
    micBtn.classList.remove('recording');
    micBtn.setAttribute('aria-label', 'Voice input');
  }
  if (recognition) {
    recognition._initialText = null;
  }
}
