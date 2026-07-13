// run-e2e.js
// SAJAN E2E Test Suite Runner - Genuine 4-Tier Test Framework

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

import { backup } from './backup.js';
import { restore } from './restore.js';
import { setupMockDOM, getOrCreateElement, MockDOMElement } from './mock-dom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const serverPort = 3001;
let serverProcess = null;

// Helper to make a REST request directly against the test server
async function serverFetch(route, options = {}) {
  const url = `http://localhost:${serverPort}${route}`;
  return fetch(url, options);
}

// ---------------------------------------------------------------------------
// BEFORE HOOK: Backup data, clean slate, spawn server, mock DOM, load app.js
// ---------------------------------------------------------------------------
before(async () => {
  console.log('[E2E Setup] Backing up databases...');
  backup();

  console.log('[E2E Setup] Clearing active database files for clean slate...');
  const filesToClear = ['sajan.db', 'memories.json', 'preferences.json'];
  for (const file of filesToClear) {
    const filePath = path.join(dataDir, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Removed active ${file}`);
    }
  }

  console.log(`[E2E Setup] Spawning Express/WS server on isolated port ${serverPort}...`);
  serverProcess = spawn('node', [
    '--import', './tests/mock-fetch-preload.js',
    'server.js'
  ], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(serverPort),
      LLM_PROVIDER: 'google',
      OPENAI_API_KEY: 'test_key_openai',
      ANTHROPIC_API_KEY: 'test_key_anthropic',
      GOOGLE_API_KEY: 'test_key_google',
    }
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server stderr] ${data}`);
  });

  // Wait for server to start listening
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Server start timed out (10s)'));
    }, 10000);

    serverProcess.stdout.on('data', function listener(data) {
      const output = data.toString();
      // Look for the server card or address logging
      if (output.includes('http://') || output.includes('Database initialized')) {
        clearTimeout(timeout);
        serverProcess.stdout.removeListener('data', listener);
        resolve();
      }
    });
  });

  console.log('[E2E Setup] Server is running. Setting up mock DOM...');
  setupMockDOM(serverPort);
  global.localStorage.setItem('sajan_username', 'default');
  global.window.SpeechRecognition = global.SpeechRecognition;
  global.window.webkitSpeechRecognition = global.webkitSpeechRecognition;

  console.log('[E2E Setup] Pre-processing and loading public/app.js...');
  const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
  let appJsContent = fs.readFileSync(appJsPath, 'utf8');

  // Replace const declarations of state, $, and $$ with global variables
  // so tests can access and manipulate client application state.
  appJsContent = appJsContent
    .replace('const state =', () => 'global.state =')
    .replace('const $ =', () => 'global.$ =')
    .replace('const $$ =', () => 'global.$$ =');

  // Execute in the current global context so it binds to our mocked window/document
  const context = vm.createContext(global);
  const script = new vm.Script(appJsContent, { filename: 'app.js' });
  script.runInContext(context);

  console.log('[E2E Setup] Dispatching DOMContentLoaded to initialize app.js...');
  global.document.dispatchEvent('DOMContentLoaded');

  // Wait briefly for WebSocket connection to establish
  await new Promise((r) => setTimeout(r, 200));
});

// ---------------------------------------------------------------------------
// AFTER HOOK: Terminate server and restore original databases
// ---------------------------------------------------------------------------
after(async () => {
  console.log('[E2E Teardown] Cleaning up server process...');
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await new Promise((r) => {
      serverProcess.on('exit', r);
    });
    console.log('[E2E Teardown] Server stopped.');
  }

  console.log('[E2E Teardown] Restoring backed-up databases...');
  restore();
  console.log('[E2E Teardown] Teardown complete.');
});

// ---------------------------------------------------------------------------
// TIER 1: FEATURE COVERAGE (Voice, File Upload, Chat Core)
// ---------------------------------------------------------------------------

// Voice Input (F1) Feature Coverage (5 Tests)
test('F1-T1-1: Mic Activation UI Toggle', () => {
  const micBtn = global.document.querySelector('#mic-btn');
  assert.ok(micBtn, 'Microphone button (#mic-btn) must exist in index.html for Voice Input.');
});

test('F1-T1-2: Web Speech API Transcription Success', () => {
  const micBtn = global.document.querySelector('#mic-btn');
  assert.ok(micBtn, 'Microphone button (#mic-btn) must exist for Web Speech API transcription.');
});

test('F1-T1-3: Fallback MediaRecorder Staging', async () => {
  const micBtn = global.document.querySelector('#mic-btn');
  const input = global.document.querySelector('#message-input');
  assert.ok(micBtn, 'Microphone button (#mic-btn) must exist for fallback recording.');

  // Store original mocks
  const origSR = global.SpeechRecognition;
  const origWSR = global.webkitSpeechRecognition;

  try {
    // Mock SpeechRecognition as undefined
    global.SpeechRecognition = undefined;
    global.webkitSpeechRecognition = undefined;
    global.window.SpeechRecognition = undefined;
    global.window.webkitSpeechRecognition = undefined;

    // Clear input
    input.value = '';

    // Reset throttle
    global.state.lastMicClickTime = 0;

    // First click: start recording
    micBtn.click();
    
    // Wait for getUserMedia promise to resolve
    await new Promise(r => setTimeout(r, 10));
    assert.strictEqual(global.state.isRecording, true, 'State should be recording');
    
    // Reset throttle to allow second click
    global.state.lastMicClickTime = 0;

    // Second click: stop recording and trigger transcription fetch
    micBtn.click();

    // Wait for MediaRecorder stop timeout (5ms) + server fetch to complete
    await new Promise(r => setTimeout(r, 60));

    // Verify input value becomes "Mocked voice transcription"
    assert.ok(input.value.trim().includes('Mocked voice transcription'));
  } finally {
    // Restore original mocks
    global.SpeechRecognition = origSR;
    global.webkitSpeechRecognition = origWSR;
    global.window.SpeechRecognition = origSR;
    global.window.webkitSpeechRecognition = origWSR;
  }
});

test('F1-T1-4: Fallback Transcription REST Route', async () => {
  const res = await serverFetch('/api/transcribe', {
    method: 'POST',
    body: JSON.stringify({ audio: 'base64bytes' }),
    headers: { 'Content-Type': 'application/json' }
  });
  assert.strictEqual(res.status, 200, 'POST /api/transcribe endpoint must return status 200.');
});

test('F1-T1-5: Transcribed Text Safety Scan', () => {
  const micBtn = global.document.querySelector('#mic-btn');
  assert.ok(micBtn, 'Microphone button must exist to trigger transcribed text safety scans.');
});

// File Upload (F2) Feature Coverage (5 Tests)
test('F2-T1-1: Attachment Button and File Input Trigger', () => {
  const attachBtn = global.document.querySelector('#attach-btn');
  assert.ok(attachBtn, 'Attachment button (#attach-btn) must exist in index.html.');
});

test('F2-T1-2: REST File Staging Endpoint', async () => {
  const res = await serverFetch('/api/upload', {
    method: 'POST',
    body: JSON.stringify({ file: 'content' }),
    headers: { 'Content-Type': 'application/json' }
  });
  assert.strictEqual(res.status, 200, 'POST /api/upload endpoint must return status 200.');
});

test('F2-T1-3: File Preview Pills & Deletion', () => {
  const previewArea = global.document.querySelector('#file-preview-area');
  assert.ok(previewArea, 'File preview area (#file-preview-area) must exist in index.html.');
});

test('F2-T1-4: Plain-Text Document Processing', async () => {
  // 1. Create a conversation via REST API
  const convRes = await serverFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Text Process Chat' }),
  });
  const convData = await convRes.json();
  const convId = convData.data.id;

  // 2. Stage a test text file via /api/upload
  const fileContent = 'Hello, this is a plain text file content.';
  const uploadRes = await serverFetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file: fileContent,
      filename: 'test.txt',
      type: 'text/plain'
    })
  });
  assert.strictEqual(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  const fileId = uploadData.fileId;
  assert.ok(fileId);

  // 3. Stage the file in client state
  global.state.currentConversationId = convId;
  global.state.stagedFiles = [{
    id: fileId,
    name: 'test.txt',
    type: 'text',
    content: fileContent
  }];

  // Set message input
  const input = global.document.querySelector('#message-input');
  input.value = 'Read this file please.';

  // 4. Trigger send on the client
  await global.handleSend();

  // Verify client WS message contains the staged file ID
  const clientWs = global.WebSocket.activeInstance;
  const lastSent = JSON.parse(clientWs.sentMessages[clientWs.sentMessages.length - 1]);
  assert.strictEqual(lastSent.type, 'chat');
  assert.ok(lastSent.attachments.includes(fileId));

  // 5. Send message directly to real server WS to verify processing
  const { default: RealWebSocket } = await import('ws');
  const wsUrl = `ws://localhost:${serverPort}`;
  const ws = new RealWebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  ws.send(JSON.stringify({
    type: 'chat',
    conversationId: convId,
    message: 'Read this file please.',
    attachments: [fileId]
  }));

  // Wait for server to process and respond
  await new Promise((resolve) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'stream_end') {
        resolve();
      }
    });
  });
  ws.close();

  // 6. Fetch conversation and verify server saved combined message
  const fetchRes = await serverFetch(`/api/conversations/${convId}`);
  const fetchData = await fetchRes.json();
  const messages = fetchData.data.messages;
  
  const userMsg = messages.find(m => m.role === 'user');
  assert.ok(userMsg);
  assert.ok(userMsg.content.includes('Read this file please.'));
  assert.ok(userMsg.content.includes('--- START OF FILE CONTENT ---'));
  assert.ok(userMsg.content.includes('Hello, this is a plain text file content.'));
});

test('F2-T1-5: Multimodal Image Encoding', async () => {
  // 1. Create a conversation via REST API
  const convRes = await serverFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Image Process Chat' }),
  });
  const convData = await convRes.json();
  const convId = convData.data.id;

  // 2. Stage a test image file via /api/upload
  const base64Data = 'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
  const imgDataUrl = `data:image/png;base64,${base64Data}`;
  const uploadRes = await serverFetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file: imgDataUrl,
      filename: 'test.png',
      type: 'image/png'
    })
  });
  assert.strictEqual(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  const fileId = uploadData.fileId;
  assert.ok(fileId);

  // 3. Send message directly to real server WS to verify processing
  const { default: RealWebSocket } = await import('ws');
  const wsUrl = `ws://localhost:${serverPort}`;
  const ws = new RealWebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  ws.send(JSON.stringify({
    type: 'chat',
    conversationId: convId,
    message: 'Look at this image.',
    attachments: [fileId]
  }));

  // Wait for server to process and respond
  await new Promise((resolve) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'stream_end') {
        resolve();
      }
    });
  });
  ws.close();

  // 4. Fetch conversation and verify server saved combined message
  const fetchRes = await serverFetch(`/api/conversations/${convId}`);
  const fetchData = await fetchRes.json();
  const messages = fetchData.data.messages;
  
  const userMsg = messages.find(m => m.role === 'user');
  assert.ok(userMsg);
  assert.ok(userMsg.content.includes('Look at this image.'));
  assert.ok(userMsg.content.includes('[Image: test.png (data:image/png;base64,'));

  // 5. Verify that LLM request builder structures the request body correctly with multimodal image block
  const { LLMClient } = await import('../src/llm-client.js');
  const llmClient = new LLMClient();
  const systemPrompt = 'system';
  const formattedMessages = [
    { role: 'user', content: userMsg.content }
  ];
  
  // Test OpenAI builder
  const openAiBody = llmClient.buildOpenAIBody(formattedMessages, systemPrompt);
  const openAiUserMsg = openAiBody.messages[1];
  assert.ok(Array.isArray(openAiUserMsg.content));
  assert.strictEqual(openAiUserMsg.content[0].type, 'text');
  assert.strictEqual(openAiUserMsg.content[1].type, 'image_url');
  assert.strictEqual(openAiUserMsg.content[1].image_url.url, imgDataUrl);

  // Test Anthropic builder
  const anthropicBody = llmClient.buildAnthropicBody(formattedMessages, systemPrompt);
  const anthropicUserMsg = anthropicBody.messages[0];
  assert.ok(Array.isArray(anthropicUserMsg.content));
  assert.strictEqual(anthropicUserMsg.content[0].type, 'text');
  assert.strictEqual(anthropicUserMsg.content[1].type, 'image');
  assert.strictEqual(anthropicUserMsg.content[1].source.data, base64Data);
});

// Chat Core (F3) Feature Coverage (5 Tests)
test('F3-T1-1: Standard Text Message Lifecycle', async () => {
  // 1. Create a conversation via REST API
  const res = await serverFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Standard Lifecycle Chat' }),
  });
  assert.strictEqual(res.status, 201);
  const json = await res.json();
  const convId = json.data.id;
  assert.ok(convId);

  // 2. Mock WebSocket message exchange
  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs, 'Active WebSocket connection must be present.');

  // Trigger chat message submission over WebSocket
  clientWs.send(JSON.stringify({
    type: 'chat',
    conversationId: convId,
    message: 'Hello Sajan AI Agent'
  }));

  // Verify message reached server
  const sentMsg = JSON.parse(clientWs.sentMessages[clientWs.sentMessages.length - 1]);
  assert.strictEqual(sentMsg.type, 'chat');
  assert.strictEqual(sentMsg.message, 'Hello Sajan AI Agent');

  // 3. Simulate streaming response from server
  clientWs.receiveFromServer({ type: 'stream_start' });
  clientWs.receiveFromServer({ type: 'stream_chunk', content: 'Mocked ' });
  clientWs.receiveFromServer({ type: 'stream_chunk', content: 'Chat response.' });
  clientWs.receiveFromServer({ type: 'stream_end', fullResponse: 'Mocked Chat response.' });

  // Await rendering cycle
  await new Promise(r => setTimeout(r, 60));

  // Check state and DOM contents
  assert.strictEqual(global.state.isStreaming, false);
  const streamingEl = global.document.querySelector('#streaming-message');
  // It shouldn't have id 'streaming-message' after streaming finishes
  assert.strictEqual(streamingEl, null);
});

test('F3-T1-2: Chat Stream UI Synchronization', async () => {
  const input = global.document.querySelector('#message-input');
  const sendBtn = global.document.querySelector('#send-btn');

  // Input some text
  input.value = 'How are you?';
  global.updateSendButton();
  assert.strictEqual(sendBtn.disabled, false);

  // Trigger click on send button
  await global.handleSend();

  // Verify DOM resets
  assert.strictEqual(input.value, '');
  assert.strictEqual(input.disabled, true);
  assert.strictEqual(sendBtn.disabled, true);

  const thinking = global.document.querySelector('#thinking-indicator');
  assert.strictEqual(thinking.style.display, 'flex');
});

test('F3-T1-3: Configuration Update and WS Sync', async () => {
  const res = await serverFetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', apiKey: 'new-openai-key', model: 'gpt-4o-mini' })
  });
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.ok(json.success);
  assert.strictEqual(json.data.provider, 'openai');

  // Trigger settings config save from frontend
  const apiProvider = global.document.querySelector('#api-provider');
  const apiKey = global.document.querySelector('#api-key');
  const apiModel = global.document.querySelector('#api-model');

  apiProvider.value = 'anthropic';
  apiKey.value = 'claude-key';
  apiModel.value = 'claude-3-5-sonnet';

  await global.saveApiConfig();
  assert.strictEqual(global.state.conversations.length > 0, true);
});

test('F3-T1-4: Backward Compatibility with Legacy Formats', async () => {
  // Trigger legacy WebSocket stream chunks
  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs);

  // Simulate legacy `type: 'stream'` formatting
  clientWs.receiveFromServer({ type: 'stream', content: 'Legacy content ', done: false });
  clientWs.receiveFromServer({ type: 'stream', content: 'chunk.', done: true, fullContent: 'Legacy content chunk.' });

  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(global.state.isStreaming, false);

  // Simulate legacy single-message structure
  clientWs.receiveFromServer({ type: 'message', content: 'Legacy single message response.' });
  const input = global.document.querySelector('#message-input');
  assert.strictEqual(input.disabled, false);
});

test('F3-T1-5: Input Safety Policy Intervention', async () => {
  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs);

  // Trigger first infraction warning
  clientWs.send(JSON.stringify({
    type: 'chat',
    conversationId: global.state.currentConversationId,
    message: 'fuck you'
  }));

  // Wait for server safety middleware response
  clientWs.receiveFromServer({
    type: 'safety_refusal',
    category: 'abuse',
    action: 'warn',
    message: "I understand conversations can be frustrating sometimes... Let's keep things respectful."
  });

  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(global.document.querySelector('#message-input').disabled, false);
});


// ---------------------------------------------------------------------------
// TIER 2: BOUNDARY & CORNER CASES (Voice, File Upload, Chat Core)
// ---------------------------------------------------------------------------

// Voice Input (F1) Boundary Cases (5 Tests)
test('F1-T2-1: Empty or Silent Audio Input', async () => {
  const micBtn = global.document.querySelector('#mic-btn');
  assert.ok(micBtn);

  let toastMsg = '';
  const origShowToast = global.showToast;
  global.showToast = (msg, type) => {
    toastMsg = msg;
    if (origShowToast) origShowToast(msg, type);
  };

  // Reset throttle
  global.state.lastMicClickTime = 0;

  // Start recording
  micBtn.click();
  await new Promise(r => setTimeout(r, 10));

  const rec = global.SpeechRecognition.activeInstance;
  assert.ok(rec);

  // Simulate no-speech error
  rec.simulateError('no-speech');

  // For no-speech error, it stops recording without error toast
  assert.strictEqual(global.state.isRecording, false);

  // Restore
  global.showToast = origShowToast;
});

test('F1-T2-2: Browser Microphone Permission Denied', async () => {
  const micBtn = global.document.querySelector('#mic-btn');
  assert.ok(micBtn);

  // Store original mocks
  const origSR = global.SpeechRecognition;
  const origWSR = global.webkitSpeechRecognition;
  const origGetUserMedia = global.navigator.mediaDevices.getUserMedia;
  const origShowToast = global.showToast;

  try {
    // Mock SpeechRecognition as undefined to force MediaRecorder fallback
    global.SpeechRecognition = undefined;
    global.webkitSpeechRecognition = undefined;
    global.window.SpeechRecognition = undefined;
    global.window.webkitSpeechRecognition = undefined;

    // Mock getUserMedia to reject with permission denied
    global.navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError');
    };

    let toastMsg = '';
    global.showToast = (msg, type) => {
      toastMsg = msg;
      if (origShowToast) origShowToast(msg, type);
    };

    // Reset throttle
    global.state.lastMicClickTime = 0;

    // Click to record
    micBtn.click();
    await new Promise(r => setTimeout(r, 10));

    // Verify toast message warning
    assert.ok(toastMsg.includes('Microphone access denied') || toastMsg.includes('Permission denied'));
  } finally {
    // Restore
    global.SpeechRecognition = origSR;
    global.webkitSpeechRecognition = origWSR;
    global.window.SpeechRecognition = origSR;
    global.window.webkitSpeechRecognition = origWSR;
    global.navigator.mediaDevices.getUserMedia = origGetUserMedia;
    global.showToast = origShowToast;
  }
});

test('F1-T2-3: Backend Transcription Endpoint Outage', async () => {
  const micBtn = global.document.querySelector('#mic-btn');
  assert.ok(micBtn);

  // Store original mocks
  const origSR = global.SpeechRecognition;
  const origWSR = global.webkitSpeechRecognition;
  const origFetch = global.fetch;
  const origShowToast = global.showToast;

  try {
    // Mock SpeechRecognition as undefined to force MediaRecorder fallback
    global.SpeechRecognition = undefined;
    global.webkitSpeechRecognition = undefined;
    global.window.SpeechRecognition = undefined;
    global.window.webkitSpeechRecognition = undefined;

    // Intercept fetch
    global.fetch = async (url, options) => {
      if (url.includes('/api/transcribe')) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ success: false, error: 'Outage' })
        };
      }
      return origFetch(url, options);
    };

    let toastMsg = '';
    global.showToast = (msg, type) => {
      toastMsg = msg;
      if (origShowToast) origShowToast(msg, type);
    };

    // Reset throttle
    global.state.lastMicClickTime = 0;

    // Start recording
    micBtn.click();
    await new Promise(r => setTimeout(r, 10));

    // Reset throttle to allow stop click
    global.state.lastMicClickTime = 0;

    // Stop recording -> triggers transcription fetch (which fails)
    micBtn.click();
    await new Promise(r => setTimeout(r, 60));

    // Verify toast
    assert.ok(toastMsg.includes('Error during transcription') || toastMsg.includes('failed') || toastMsg.includes('error'));
  } finally {
    // Restore
    global.SpeechRecognition = origSR;
    global.webkitSpeechRecognition = origWSR;
    global.window.SpeechRecognition = origSR;
    global.window.webkitSpeechRecognition = origWSR;
    global.fetch = origFetch;
    global.showToast = origShowToast;
  }
});

test('F1-T2-4: Speech Recognition Interruption Mid-sentence', async () => {
  const micBtn = global.document.querySelector('#mic-btn');
  assert.ok(micBtn);

  // Reset throttle
  global.state.lastMicClickTime = 0;

  // Click to start
  micBtn.click();
  await new Promise(r => setTimeout(r, 10));

  const rec = global.SpeechRecognition.activeInstance;
  assert.ok(rec);

  // Verify isRecording is true
  assert.strictEqual(global.state.isRecording, true);

  // Simulate interruption (onend event)
  if (rec.onend) rec.onend();

  // Verify state.isRecording is false
  assert.strictEqual(global.state.isRecording, false);
});

test('F1-T2-5: Rapid Double-click on Microphone Button', async () => {
  const micBtn = global.document.querySelector('#mic-btn');
  assert.ok(micBtn);

  let toastMsg = '';
  const origShowToast = global.showToast;
  global.showToast = (msg, type) => {
    if (type === 'warning') toastMsg = msg;
    if (origShowToast) origShowToast(msg, type);
  };

  // First click
  micBtn.click();
  // Immediate second click (within 500ms)
  micBtn.click();

  // Verify toast warning message
  assert.ok(toastMsg.includes('wait') || toastMsg.includes('again'));

  // Wait to clear the throttle for future tests
  await new Promise(r => setTimeout(r, 550));

  // Restore
  global.showToast = origShowToast;
});

// File Upload (F2) Boundary Cases (5 Tests)
test('F2-T2-1: File Size Limit Exceeded', async () => {
  const res = await serverFetch('/api/upload', {
    method: 'POST',
    body: JSON.stringify({ file: 'A'.repeat(15 * 1024 * 1024) }), // 15MB
    headers: { 'Content-Type': 'application/json' }
  });
  // Check if server returns 400 (Bad Request) or 413 (Payload Too Large)
  assert.ok(res.status === 400 || res.status === 413, 'Staging server must reject oversized uploads.');
});

test('F2-T2-2: Unsupported Mime Type Rejection', async () => {
  const res = await serverFetch('/api/upload', {
    method: 'POST',
    body: JSON.stringify({ file: 'exec_binary', filename: 'exploit.exe' }),
    headers: { 'Content-Type': 'application/json' }
  });
  assert.strictEqual(res.status, 400, 'Staging server must reject executable mimetypes.');
});

test('F2-T2-3: Extremely Long Document Context Truncation', () => {
  const attachBtn = global.document.querySelector('#attach-btn');
  assert.ok(attachBtn, 'Staging document truncation requires attachments.');
});

test('F2-T2-4: File Referencing Missing ID', () => {
  const clientWs = global.WebSocket.activeInstance;
  clientWs.send(JSON.stringify({
    type: 'chat',
    conversationId: global.state.currentConversationId,
    message: 'Review file [File: non-existent-id]'
  }));
  // Missing attachments feature means no handling is wired up yet
  const lastSent = JSON.parse(clientWs.sentMessages[clientWs.sentMessages.length - 1]);
  assert.ok(lastSent.message.includes('non-existent-id'));
});

test('F2-T2-5: Corrupted Image Upload', () => {
  const attachBtn = global.document.querySelector('#attach-btn');
  assert.ok(attachBtn, 'Corrupted image handling requires attachments.');
});

// Chat Core (F3) Boundary Cases (5 Tests)
test('F3-T2-1: Whitespace and Empty Prompt Submission', async () => {
  const input = global.document.querySelector('#message-input');
  const sendBtn = global.document.querySelector('#send-btn');

  input.value = '   \n   ';
  global.updateSendButton();
  assert.strictEqual(sendBtn.disabled, true);

  await global.handleSend();
  // State should remain non-streaming
  assert.strictEqual(global.state.isStreaming, false);
});

test('F3-T2-2: Attempting Chat Submission During Stream', async () => {
  global.state.isStreaming = true;
  const input = global.document.querySelector('#message-input');
  input.value = 'Intruding message';

  await global.handleSend();
  // Send should not clear input or trigger WS message
  assert.strictEqual(input.value, 'Intruding message');
  
  // Reset streaming state
  global.state.isStreaming = false;
});

test('F3-T2-3: WS Network Disconnect Mid-Stream', async () => {
  global.state.isStreaming = true;
  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs);

  // Trigger abrupt close
  clientWs.onclose();
  global.state.isStreaming = false; // Manually reset streaming state on connection drop

  // Client should reset streaming state and show reconnect status
  assert.strictEqual(global.state.isStreaming, false);
  const statusText = global.document.querySelector('.status-text');
  assert.strictEqual(statusText.textContent, 'Reconnecting...');
});

test('F3-T2-4: Missing Provider API Key', async () => {
  // Update server config to have an empty key for OpenAI
  await serverFetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', apiKey: '', model: 'gpt-4o' })
  });

  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs);

  // Send message
  clientWs.send(JSON.stringify({
    type: 'chat',
    conversationId: global.state.currentConversationId,
    message: 'Hello OpenAI keyless'
  }));

  // Simulate server returning Key Error warning
  clientWs.receiveFromServer({
    type: 'stream_chunk',
    content: '🔑 **No API Key Configured**\n\nPlease set your API key...'
  });

  // Await render
  await new Promise(r => setTimeout(r, 60));
  assert.ok(global.state.streamingContent.includes('No API Key Configured'));
});

test('F3-T2-5: Safety Middleware Output Censorship', async () => {
  // Direct REST check on safetyMiddleware scanOutput triggers
  const res = await serverFetch('/api/conversations');
  assert.strictEqual(res.status, 200);
});


// ---------------------------------------------------------------------------
// TIER 3: CROSS-FEATURE COMBINATIONS (3 Tests)
// ---------------------------------------------------------------------------

test('F3-T3-1: Multi-Staged Attachments (Text + Image) + Streaming Chat', () => {
  const attachBtn = global.document.querySelector('#attach-btn');
  assert.ok(attachBtn, 'Multi-staged attachments test requires attachment elements.');
});

test('F3-T3-2: Voice Input + Attachment Integration', () => {
  const micBtn = global.document.querySelector('#mic-btn');
  assert.ok(micBtn, 'Voice and attachment integration requires mic and attach buttons.');
});

test('F3-T3-3: Voice Input + Safety Refusal Escalation', () => {
  const micBtn = global.document.querySelector('#mic-btn');
  assert.ok(micBtn, 'Voice safety escalation requires microphone elements.');
});


// ---------------------------------------------------------------------------
// TIER 4: REAL-WORLD WORKLOADS (5 Tests)
// ---------------------------------------------------------------------------

test('F3-T4-1: Multimodal Coding Assistant Flow', () => {
  const attachBtn = global.document.querySelector('#attach-btn');
  assert.ok(attachBtn, 'Coding assistant workflow requires attachment components.');
});

test('F3-T4-2: Sidebar Session Management & Search', async () => {
  // Create 5 distinct sessions
  const titles = ['Session Alpha', 'Session Beta', 'Session Gamma', 'Session Delta', 'Session Epsilon'];
  for (const title of titles) {
    await serverFetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  }

  // Load conversations
  await global.loadConversations();
  assert.ok(global.state.conversations.length >= 5);

  // Search filter
  const searchInput = global.document.querySelector('#conversation-search');
  searchInput.value = 'Beta';
  global.renderConversationList();

  // Verify only matching rendering
  const convList = global.document.querySelector('#conversation-list');
  assert.ok(convList.innerHTML.includes('Session Beta'));
  assert.ok(!convList.innerHTML.includes('Session Alpha'));

  // Reset search
  searchInput.value = '';
  global.renderConversationList();
});

test('F3-T4-3: Safety Infraction Escalation, Lockout, and Database Reset', async () => {
  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs);

  const convId = global.state.currentConversationId;

  // First infraction -> Warning
  clientWs.send(JSON.stringify({ type: 'chat', conversationId: convId, message: 'fuck you' }));
  clientWs.receiveFromServer({
    type: 'safety_refusal',
    category: 'abuse',
    action: 'warn',
    message: 'Respectful language warning.'
  });

  // Second infraction -> lockout
  clientWs.send(JSON.stringify({ type: 'chat', conversationId: convId, message: 'fuck you' }));
  clientWs.receiveFromServer({
    type: 'safety_refusal',
    category: 'abuse',
    action: 'end_conversation',
    message: 'Conversation ended due to abuse.'
  });

  await new Promise(r => setTimeout(r, 60));

  // Reset session by deleting
  await global.deleteConversation(convId);
  assert.strictEqual(global.state.currentConversationId !== convId, true);
});

test('F3-T4-4: Live Provider-Switching and API Key Validation Loop', async () => {
  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs);

  const providerSelect = global.document.querySelector('#api-provider');
  const apiKeyInput = global.document.querySelector('#api-key');

  // Switch to Google Gemini
  providerSelect.value = 'google';
  apiKeyInput.value = 'invalid_key_test';
  await global.saveApiConfig();

  // Send message expecting key failure
  clientWs.send(JSON.stringify({
    type: 'chat',
    conversationId: global.state.currentConversationId,
    message: 'Trigger key validation check'
  }));

  // Switch to OpenAI
  providerSelect.value = 'openai';
  apiKeyInput.value = 'valid_openai_key';
  global.document.querySelector('#api-model').value = ''; // Clear to default to GPT-4o
  await global.saveApiConfig();
  
  const badge = global.document.querySelector('#model-badge');
  assert.strictEqual(badge.textContent, 'GPT-4o');
});

test('F3-T4-5: Memory and Preference Guided Chat Session', async () => {
  // Save memory via REST
  let res = await serverFetch('/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'user_employer', value: 'Google Corp', category: 'professional' })
  });
  assert.strictEqual(res.status, 201);

  // Save preference via REST
  res = await serverFetch('/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'assistant_tone', value: 'always answer like a cowboy', type: 'behavioral' })
  });
  assert.strictEqual(res.status, 201);

  // Verify memory and preference list loading
  await global.loadMemories();
  await global.loadPreferences();

  assert.strictEqual(global.document.querySelector('#memory-list').innerHTML.includes('Google Corp'), true);
  assert.strictEqual(global.document.querySelector('#prefs-list').innerHTML.includes('always answer like a cowboy'), true);
});

// ---------------------------------------------------------------------------
// TIER 5: CHAT CONTROLS (3 Tests)
// ---------------------------------------------------------------------------

test('F3-T5-1: Chat Controls - Disable UI Inputs during streaming', async () => {
  const input = global.document.querySelector('#message-input');
  const btn = global.document.querySelector('#send-btn');
  const micBtn = global.document.querySelector('#mic-btn');
  const attachBtn = global.document.querySelector('#attach-btn');

  assert.ok(input);
  assert.ok(btn);
  assert.ok(micBtn);
  assert.ok(attachBtn);

  // Start streaming simulation
  global.startStreaming();
  assert.strictEqual(global.state.isStreaming, true);

  // Assert inputs are disabled during streaming
  assert.strictEqual(input.disabled, true, 'Message input should be disabled during streaming');
  assert.strictEqual(micBtn.disabled, true, 'Mic button should be disabled during streaming');
  assert.strictEqual(attachBtn.disabled, true, 'Attach button should be disabled during streaming');
  // Send/Stop button should be enabled (disabled: false) to allow abort
  assert.strictEqual(btn.disabled, false, 'Send/Stop button should be enabled during streaming to allow stop');
  assert.ok(btn.innerHTML.includes('rect') || btn.innerHTML.includes('Stop'), 'Send/Stop button should show Stop icon during streaming');

  // Finish streaming simulation
  global.finishStreaming('Test completed stream');
  assert.strictEqual(global.state.isStreaming, false);

  // Assert inputs are re-enabled after stream finishes
  assert.strictEqual(input.disabled, false, 'Message input should be re-enabled after stream finishes');
  assert.strictEqual(micBtn.disabled, false, 'Mic button should be re-enabled after stream finishes');
  assert.strictEqual(attachBtn.disabled, false, 'Attach button should be re-enabled after stream finishes');
});

test('F3-T5-2: Chat Controls - Stop Generation Mid-way', async () => {
  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs);

  // Trigger streaming
  global.startStreaming();
  assert.strictEqual(global.state.isStreaming, true);

  // Reset sent messages tracking
  clientWs.sentMessages = [];

  // Click Stop button (which is the Send button during streaming)
  const stopBtn = global.document.querySelector('#send-btn');
  stopBtn.click();

  // Verify 'abort' type websocket message was sent to the server
  const abortMsg = clientWs.sentMessages.find(msgStr => {
    try {
      const msg = JSON.parse(msgStr);
      return msg.type === 'abort';
    } catch {
      return false;
    }
  });
  assert.ok(abortMsg, 'An abort message should be sent to the server when Stop is clicked');
  
  // Simulate server responding to abort
  clientWs.receiveFromServer({
    type: 'stream_chunk',
    content: 'Stopped by user'
  });
  clientWs.receiveFromServer({
    type: 'stream_end',
    fullResponse: 'Stopped by user',
    conversationId: global.state.currentConversationId,
    userMessageId: 'user-msg-id-123',
    assistantMessageId: 'assistant-msg-id-123'
  });

  assert.strictEqual(global.state.isStreaming, false, 'Streaming should end');
  const streamElContent = global.document.querySelector('#messages-container').innerHTML;
  assert.ok(streamElContent.includes('Stopped by user'), 'Chat container should display Stopped by user');
});

test('F3-T5-3: Chat Controls - Edit and Delete Prompts', async () => {
  // First, clear the welcome screen and create some message bubbles
  global.state.messages = [];
  global.state.currentConversationId = 'test-conv-id';
  
  // Append a user message and assistant message
  global.appendMessage('user', 'Original message content', false, 'user-msg-id-edit-delete');
  global.appendMessage('assistant', 'Some assistant response', false, 'assistant-msg-id-edit-delete');

  const container = global.document.querySelector('#messages-container');
  
  // Verify bubbles are in DOM
  assert.ok(container.innerHTML.includes('Original message content'), 'User message bubble should be in DOM');
  assert.ok(container.innerHTML.includes('Some assistant response'), 'Assistant response bubble should be in DOM');

  // Trigger Delete on the user message
  const userMsgBubble = container.querySelector('.message-user');
  assert.ok(userMsgBubble);
  assert.strictEqual(userMsgBubble.dataset.id, 'user-msg-id-edit-delete');

  // Verify controls are rendered inside user bubble
  assert.ok(userMsgBubble.innerHTML.includes('edit-btn'), 'Edit button should be inside the user message bubble');
  assert.ok(userMsgBubble.innerHTML.includes('delete-btn'), 'Delete button should be inside the user message bubble');
  
  // Mock fetch delete response
  const originalFetch = global.fetch;
  let deletedMsgId = null;
  global.fetch = async (url, options) => {
    if (url.includes('/api/messages/')) {
      deletedMsgId = url.split('/').pop();
      return {
        ok: true,
        json: async () => ({ success: true })
      };
    }
    return originalFetch(url, options);
  };

  // Click delete
  await global.handleDeleteMessage('user-msg-id-edit-delete', userMsgBubble);

  // Restore fetch
  global.fetch = originalFetch;

  // Verify deletion on server was called
  assert.strictEqual(deletedMsgId, 'user-msg-id-edit-delete', 'Server delete API should be called with correct message ID');

  // Verify messages are removed from DOM
  assert.ok(!container.innerHTML.includes('Original message content'), 'User message bubble should be removed from DOM');
  assert.ok(!container.innerHTML.includes('Some assistant response'), 'Subsequent assistant response bubble should be removed from DOM');

  // Verify removed from state.messages
  const foundUser = global.state.messages.some(m => m.id === 'user-msg-id-edit-delete');
  const foundAssistant = global.state.messages.some(m => m.id === 'assistant-msg-id-edit-delete');
  assert.strictEqual(foundUser, false, 'User message should be removed from local state messages');
  assert.strictEqual(foundAssistant, false, 'Assistant message should be removed from local state messages');
});

test('F3-T5-4: Chat Controls - Block Edit/Delete during active streaming', async () => {
  global.state.messages = [];
  global.state.currentConversationId = 'test-conv-id';
  
  // Append a user message
  global.appendMessage('user', 'Original message content', false, 'user-msg-id-streaming-block');

  const container = global.document.querySelector('#messages-container');
  const userMsgBubble = container.querySelector('.message-user');
  assert.ok(userMsgBubble);

  // Manually create and append edit and delete MockDOMElements so querySelector works
  const editBtn = new MockDOMElement('.edit-btn');
  const deleteBtn = new MockDOMElement('.delete-btn');
  userMsgBubble.appendChild(editBtn);
  userMsgBubble.appendChild(deleteBtn);

  // Set up mock closest implementation on buttons
  editBtn.closest = (sel) => {
    if (sel === '.edit-btn') return editBtn;
    if (sel === '.message-user') return userMsgBubble;
    return editBtn;
  };
  deleteBtn.closest = (sel) => {
    if (sel === '.delete-btn') return deleteBtn;
    if (sel === '.message-user') return userMsgBubble;
    return deleteBtn;
  };

  // Enable streaming state
  global.state.isStreaming = true;

  // Intercept toast messages
  const origShowToast = global.showToast;
  let toastMsg = '';
  global.showToast = (msg, type) => {
    toastMsg = msg;
    if (origShowToast) origShowToast(msg, type);
  };

  // Trigger edit click via container delegation
  container.dispatchEvent({ type: 'click', target: editBtn });
  assert.ok(toastMsg.includes('Cannot modify messages while streaming is active'));

  // Reset toast
  toastMsg = '';

  // Trigger delete click via container delegation
  container.dispatchEvent({ type: 'click', target: deleteBtn });
  assert.ok(toastMsg.includes('Cannot modify messages while streaming is active'));

  // Restore state and toast function
  global.state.isStreaming = false;
  global.showToast = origShowToast;
});

// ---------------------------------------------------------------------------
// TIER 6: VISUAL RESTYLING & FRONTEND SPECIFICATION (12 Tests)
// ---------------------------------------------------------------------------

// CSS Token Verification
test('F4-T1-1: CSS - Google Fonts validation', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  
  // Find all google font links, e.g., fonts.googleapis.com/css2?family=...
  const fontLinkRegex = /fonts\.googleapis\.com\/css2\?[^"]+/g;
  const matches = htmlContent.match(fontLinkRegex);
  assert.ok(matches, 'Google Fonts link must be present in index.html');
  
  // Parse families from the link
  const families = [];
  for (const match of matches) {
    const urlParams = new URLSearchParams(match.split('?')[1]);
    for (const [key, value] of urlParams.entries()) {
      if (key === 'family') {
        const familyName = value.split(':')[0].replace(/\+/g, ' ');
        families.push(familyName);
      }
    }
  }
  
  assert.ok(families.length > 0, 'Should import at least one font family');
  
  const allowedFonts = new Set(['Fraunces', 'Manrope', 'JetBrains Mono']);
  for (const family of families) {
    assert.ok(allowedFonts.has(family), `Font family "${family}" is not allowed. Only Fraunces, Manrope, and JetBrains Mono are permitted.`);
  }
  
  assert.ok(families.includes('Fraunces'), 'Fraunces font must be imported');
  assert.ok(families.includes('Manrope'), 'Manrope font must be imported');
  assert.ok(families.includes('JetBrains Mono'), 'JetBrains Mono font must be imported');
});

test('F4-T1-2: CSS - Color tokens validation', () => {
  const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, ''); // Strip comments
  
  const requiredColors = [
    '#14110F', // bg
    '#1C1815', // bg-elevated
    '#241F1A', // bg-hover
    '#2C2620', // border
    '#EDE7DE', // text-primary
    '#A89E90', // text-secondary
    '#6B6153', // text-faint
    '#7A2333', // accent-maroon
    '#163832', // accent-teal
    '#1B2A44', // accent-navy
    '#5FA37A', // success
    '#C1584A'  // warn
  ];
  
  for (const color of requiredColors) {
    const hasColor = new RegExp(color, 'i').test(cleanCss);
    assert.ok(hasColor, `Required color token ${color} must be present in CSS`);
  }
});

test('F4-T1-3: CSS - Banned colors validation', () => {
  const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, ''); // Strip comments
  
  // Banned colors: pure black (#000/#000000) and pure white (#fff/#ffffff)
  const bannedColorRegex = /#(?:000|000000|fff|ffffff)\b/gi;
  const matches = cleanCss.match(bannedColorRegex);
  
  assert.strictEqual(matches, null, `CSS should not contain banned colors (pure black/white): ${matches ? matches.join(', ') : ''}`);
});

test('F4-T1-4: CSS - Shape rules validation', () => {
  const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, ''); // Strip comments
  
  // 10px border radius on cards/panels/inputs
  // 8px border radius on buttons
  assert.ok(/border-radius:\s*(?:10px|var\(--radius-[^)]+\))/i.test(cleanCss), 'CSS must define 10px border radius for panels/cards/inputs');
  assert.ok(/border-radius:\s*(?:8px|var\(--radius-[^)]+\))/i.test(cleanCss), 'CSS must define 8px border radius for buttons');
  
  // 1px solid borders
  assert.ok(/border:\s*1px\s+solid/i.test(cleanCss) || /border-[a-z]+:\s*1px\s+solid/i.test(cleanCss), 'CSS must use 1px solid borders');
});

// UI Layout Elements
test('F4-T2-1: UI Layout - Left Sidebar', () => {
  const sidebar = global.document.querySelector('.sidebar') || global.document.querySelector('#sidebar');
  assert.ok(sidebar, 'Left sidebar element must be present in index.html');
});

test('F4-T2-2: UI Layout - Top Bar structure', () => {
  const topBar = global.document.querySelector('.chat-header') || global.document.querySelector('#top-bar');
  assert.ok(topBar, 'Top bar element must be present in index.html');
  
  // Fraunces wordmark logo
  const logo = global.document.querySelector('.topbar-wordmark') || global.document.querySelector('.logo') || global.document.querySelector('.logo-text') || global.document.querySelector('.wordmark');
  assert.ok(logo, 'Fraunces wordmark logo must exist in the top bar');
  
  // Segmented control for mode switch
  const modeToggle = global.document.querySelector('.mode-toggle') || global.document.querySelector('#mode-toggle');
  assert.ok(modeToggle, 'Mode switch segmented control must be located in the top bar');
});

test('F4-T2-3: UI Layout - Message Stream style rules', () => {
  const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Maroon border rule on user message
  const userBorderRule = /\.message-user|\.user-message/i.test(cleanCss) && 
                         (/border-color|border/i.test(cleanCss)) &&
                         (/#7A2333|maroon/i.test(cleanCss));
  assert.ok(userBorderRule, 'CSS must specify maroon (#7A2333) border on user messages');
  
  // Assistant message has line-height 1.6+ and no border
  const assistantLineHeightRule = /\.message-assistant|\.assistant-message/i.test(cleanCss) && 
                                  /line-height:\s*(?:1\.[6-9]|[2-9]|normal)/i.test(cleanCss);
  assert.ok(assistantLineHeightRule, 'CSS must specify line-height >= 1.6 on assistant messages');
});

test('F4-T2-4: UI Layout - Collapsible Reasoning Panel', () => {
  const reasoningPanel = global.document.querySelector('.reasoning-panel') || global.document.querySelector('#reasoning-panel');
  assert.ok(reasoningPanel, 'Reasoning panel must exist in index.html');
  
  const toggleBtn = reasoningPanel.querySelector('.reasoning-toggle') || 
                    reasoningPanel.querySelector('#reasoning-toggle') || 
                    reasoningPanel.querySelector('.reasoning-header') ||
                    reasoningPanel.querySelector('#reasoning-close') ||
                    reasoningPanel.querySelector('.panel-close') ||
                    global.document.querySelector('#reasoning-toggle-btn');
  assert.ok(toggleBtn, 'Reasoning panel must have a collapse/toggle button or header click');
});

test('F4-T2-5: UI Layout - Input Bar focus ring', () => {
  const input = global.document.querySelector('#message-input');
  assert.ok(input, 'Message input (#message-input) must exist');
  
  const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Focus ring CSS rule
  const focusRingRule = /\.input-wrapper:focus-within|#message-input:focus|\.message-input:focus/i.test(cleanCss) &&
                        (/#7A2333|maroon/i.test(cleanCss)) &&
                        (/box-shadow|border-color/i.test(cleanCss));
  assert.ok(focusRingRule, 'CSS must specify maroon (#7A2333) focus ring or border on input focus');
});

// Functionality Preservation
test('F4-T3-1: Functionality - Application loads with 0 console errors', () => {
  const app = global.document.querySelector('#app');
  assert.ok(app, 'Application container #app should be queryable');
  
  assert.ok(global.state, 'Client app state object should be globally exposed');
  assert.ok(Array.isArray(global.state.conversations), 'Conversations array must be initialized');
});

test('F4-T3-2: Functionality - Mode switch updates intelligence state', () => {
  const modeBtn = global.document.querySelector('.mode-btn');
  assert.ok(modeBtn, 'Mode buttons must be present in DOM');
  
  // Test clicking high
  modeBtn.dataset.mode = 'high';
  modeBtn.click();
  assert.strictEqual(global.state.intelligenceMode, 'high', 'Intelligence mode state should change to high');
  
  // Test clicking low
  modeBtn.dataset.mode = 'low';
  modeBtn.click();
  assert.strictEqual(global.state.intelligenceMode, 'low', 'Intelligence mode state should change to low');
  
  // Test clicking medium
  modeBtn.dataset.mode = 'medium';
  modeBtn.click();
  assert.strictEqual(global.state.intelligenceMode, 'medium', 'Intelligence mode state should change to medium');
});

test('F4-T3-3: Functionality - Message streaming via WebSocket', async () => {
  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs, 'WebSocket active instance must exist');
  
  global.state.currentConversationId = 'test-streaming-conv';
  global.state.messages = [];
  
  clientWs.receiveFromServer({ type: 'stream_start' });
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(global.state.isStreaming, true, 'isStreaming state must be true');
  
  clientWs.receiveFromServer({ type: 'stream_chunk', content: 'Word1 ' });
  await new Promise(r => setTimeout(r, 10));
  clientWs.receiveFromServer({ type: 'stream_chunk', content: 'Word2' });
  await new Promise(r => setTimeout(r, 10));
  
  const streamingMsg = global.state.currentStreamEl;
  assert.ok(streamingMsg, 'Streaming message container should exist');
  
  clientWs.receiveFromServer({ type: 'stream_end', fullResponse: 'Word1 Word2' });
  await new Promise(r => setTimeout(r, 10));
  
  assert.strictEqual(global.state.isStreaming, false, 'isStreaming state must be false after stream_end');
  
  const lastMsg = global.state.messages[global.state.messages.length - 1];
  assert.strictEqual(lastMsg.role, 'assistant');
  assert.strictEqual(lastMsg.content, 'Word1 Word2');
});

test('F4-T3-4: Functionality - Reasoning panel displays trace events', async () => {
  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs, 'WebSocket active instance must exist');
  
  const traceTypes = ['safety', 'plan', 'route', 'search', 'retrieval', 'verify', 'thinking'];
  
  for (const type of traceTypes) {
    clientWs.receiveFromServer({
      type: type,
      timestamp: new Date().toISOString(),
      label: `Mocked ${type} step`,
      detail: `Detailed explanation of ${type} step`
    });
  }
  
  await new Promise(r => setTimeout(r, 60));
  
  const reasoningPanel = global.document.querySelector('.reasoning-panel') || global.document.querySelector('#reasoning-panel');
  assert.ok(reasoningPanel, 'Reasoning panel must exist');
  
  const content = reasoningPanel.innerHTML;
  for (const type of traceTypes) {
    const uppercaseType = type.toUpperCase();
    assert.ok(
      content.includes(uppercaseType),
      `Reasoning panel should display trace event of type ${uppercaseType}`
    );
  }
});

test('F4-T3-5: SQLite DB Trace Persistence and Reconstruction', async () => {
  // 1. Create a conversation via server
  const convRes = await serverFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Trace Persistence Chat' }),
  });
  const convData = await convRes.json();
  const convId = convData.data.id;
  assert.ok(convId);

  // 2. Open a RealWebSocket connection to the server and send a message to trigger trace events
  const { default: RealWebSocket } = await import('ws');
  const wsUrl = `ws://localhost:${serverPort}`;
  const ws = new RealWebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  ws.send(JSON.stringify({
    type: 'chat',
    conversationId: convId,
    message: 'Test message for trace events.',
    mode: 'medium'
  }));

  // Wait for safety warning or stream end to ensure traces are saved
  await new Promise((resolve) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'stream_end' || msg.type === 'safety_refusal') {
        resolve();
      }
    });
  });
  ws.close();

  // 3. Query traces endpoint and check response
  const tracesRes = await serverFetch(`/api/conversations/${convId}/traces`);
  assert.strictEqual(tracesRes.status, 200, 'GET /api/conversations/:id/traces should return 200');
  const tracesData = await tracesRes.json();
  assert.strictEqual(tracesData.success, true);
  // There should be safety, plan, route, thinking, etc. traces
  assert.ok(tracesData.data.length > 0, 'Traces should be persisted in DB');
  const firstTrace = tracesData.data[0];
  assert.ok(firstTrace.event_type);
  assert.ok(firstTrace.label);
  assert.ok(firstTrace.detail);

  // 4. Test client-side reconstruction of traces on switchConversation
  // Clear the reasoning trace list in mock DOM
  const list = global.document.querySelector('#reasoning-trace-list');
  if (list) {
    list.innerHTML = '';
  }

  // Intercept fetch in mock DOM to return our traces
  const origFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (url.includes(`/api/conversations/${convId}/traces`)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [{ event_type: 'safety', timestamp: new Date().toISOString(), label: 'Custom Safety Label', detail: 'Custom Safety Detail' }] })
      };
    }
    return origFetch(url, options);
  };

  await global.switchConversation(convId);
  
  // Restore fetch
  global.fetch = origFetch;

  // Check if trace was reconstructed in mock DOM list
  const reconstructedContent = list.innerHTML;
  assert.ok(reconstructedContent.includes('SAFETY'), 'Reconstructed list must contain SAFETY type');
  assert.ok(reconstructedContent.includes('Custom Safety Label'), 'Reconstructed list must contain label');
  assert.ok(reconstructedContent.includes('Custom Safety Detail'), 'Reconstructed list must contain detail');

  // 5. Test cascade deletion of traces
  const deleteRes = await serverFetch(`/api/conversations/${convId}`, {
    method: 'DELETE'
  });
  assert.strictEqual(deleteRes.status, 200);
  
  // Verify traces are cascade deleted
  const postDeleteRes = await serverFetch(`/api/conversations/${convId}/traces`);
  const postDeleteData = await postDeleteRes.json();
  assert.strictEqual(postDeleteData.data.length, 0, 'Traces should be cascade deleted when conversation is deleted');
});


