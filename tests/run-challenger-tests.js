// run-challenger-tests.js
// SAJAN Challenger Adversarial Test Suite

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { WebSocket } from 'ws';

import { backup } from './backup.js';
import { restore } from './restore.js';
import { setupMockDOM, getOrCreateElement } from './mock-dom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const serverPort = 3003;
let serverProcess = null;

async function serverFetch(route, options = {}) {
  const url = `http://localhost:${serverPort}${route}`;
  return fetch(url, options);
}

async function getConversationDetails(convId, userId = 'default') {
  const res = await serverFetch(`/api/conversations/${convId}`, {
    headers: { 'X-User-Id': userId }
  });
  if (!res.ok) return null;
  return (await res.json()).data;
}

before(async () => {
  console.log('[Challenger Setup] Backing up databases...');
  backup();

  console.log('[Challenger Setup] Clearing active database files for clean slate...');
  const filesToClear = ['sajan.db', 'memories.json', 'preferences.json'];
  for (const file of filesToClear) {
    const filePath = path.join(dataDir, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Removed active ${file}`);
    }
  }

  console.log(`[Challenger Setup] Spawning Express/WS server on isolated port ${serverPort}...`);
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
      GOOGLE_API_KEY: 'test_key_google',
    }
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server stderr] ${data}`);
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Server start timed out (10s)'));
    }, 10000);

    serverProcess.stdout.on('data', function listener(data) {
      const output = data.toString();
      if (output.includes('http://') || output.includes('Database initialized')) {
        clearTimeout(timeout);
        serverProcess.stdout.removeListener('data', listener);
        resolve();
      }
    });
  });

  console.log('[Challenger Setup] Server is running. Setting up mock DOM...');
  setupMockDOM(serverPort);
  global.localStorage.setItem('sajan_username', 'default');

  console.log('[Challenger Setup] Pre-processing and loading public/app.js...');
  const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
  let appJsContent = fs.readFileSync(appJsPath, 'utf8');

  appJsContent = appJsContent
    .replace('const state =', () => 'global.state =')
    .replace('const $ =', () => 'global.$ =')
    .replace('const $$ =', () => 'global.$$ =');

  const context = vm.createContext(global);
  const script = new vm.Script(appJsContent, { filename: 'app.js' });
  script.runInContext(context);

  global.document.dispatchEvent('DOMContentLoaded');

  // CRITICAL: Wait for WS connection to establish on client app
  console.log('[Challenger Setup] Waiting for WebSocket connection to open...');
  await new Promise((r) => setTimeout(r, 300));
  console.log('[Challenger Setup] Setup complete. Running tests...');
});

after(async () => {
  console.log('[Challenger Teardown] Cleaning up server process...');
  if (serverProcess) {
    serverProcess.kill();
  }
  console.log('[Challenger Teardown] Restoring backed-up databases...');
  restore();
  console.log('[Challenger Teardown] Teardown complete.');
});

// ---------------------------------------------------------------------------
// ADVERSARIAL CHALLENGES
// ---------------------------------------------------------------------------

test('Adversarial 1: Rapid clicking of the Stop button during active streaming', async () => {
  const clientWs = global.WebSocket.activeInstance;
  assert.ok(clientWs);

  // Trigger streaming
  global.startStreaming();
  assert.strictEqual(global.state.isStreaming, true);

  clientWs.sentMessages = [];

  // Simulate clicking the Stop button 10 times in rapid succession
  const stopBtn = global.document.querySelector('#send-btn');
  for (let i = 0; i < 10; i++) {
    stopBtn.click();
  }

  // Verify that 10 abort messages were sent through the WS connection
  const abortMsgs = clientWs.sentMessages.filter(msgStr => {
    try {
      const msg = JSON.parse(msgStr);
      return msg.type === 'abort';
    } catch {
      return false;
    }
  });

  assert.strictEqual(abortMsgs.length, 10, 'Should send exactly 10 abort requests to WS');

  // Verify client is still in streaming state (until server responds)
  assert.strictEqual(global.state.isStreaming, true, 'Client should remain in streaming state until server confirms');

  // Simulate server response to abort
  clientWs.receiveFromServer({
    type: 'stream_chunk',
    content: 'Stopped by user'
  });
  clientWs.receiveFromServer({
    type: 'stream_end',
    fullResponse: 'Stopped by user',
    conversationId: global.state.currentConversationId,
    userMessageId: 'user-msg-id-rapid',
    assistantMessageId: 'assistant-msg-id-rapid'
  });

  // Verify state transitions to false and inputs are re-enabled
  assert.strictEqual(global.state.isStreaming, false, 'Streaming should end');
  assert.strictEqual(global.document.querySelector('#message-input').disabled, false, 'Input should be re-enabled');
});

test('Adversarial 2: Aborting when no stream is active or aborting multiple times directly', async () => {
  // Connect directly via WebSocket to the running test server
  const wsUrl = `ws://localhost:${serverPort}`;
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  // Send abort when no stream is active
  let gotError = false;
  try {
    ws.send(JSON.stringify({ type: 'abort' }));
    ws.send(JSON.stringify({ type: 'abort' }));
    ws.send(JSON.stringify({ type: 'abort' }));
  } catch (e) {
    gotError = true;
  }

  assert.strictEqual(gotError, false, 'Sending abort on active socket with no active stream should not crash socket or throw');

  // Keep socket open a bit, make sure it is still alive and responsive
  ws.send(JSON.stringify({
    type: 'chat',
    conversationId: 'dummy-conv',
    message: 'Hello',
    mode: 'low',
    userId: 'default'
  }));

  const hasClosed = await new Promise((resolve) => {
    let closed = false;
    ws.on('close', () => { closed = true; resolve(true); });
    setTimeout(() => { resolve(closed); }, 100);
  });

  assert.strictEqual(hasClosed, false, 'WebSocket should remain open and healthy after invalid aborts');
  ws.close();
});

test('Adversarial 3: Editing/deleting message bubbles with invalid, corrupted, or non-existent IDs', async () => {
  const container = global.document.querySelector('#messages-container');
  const mockDiv = global.document.createElement('div');
  mockDiv.className = 'message-user';
  mockDiv.dataset.id = 'non-existent-msg-id';
  container.appendChild(mockDiv);

  const toastContainer = global.document.querySelector('#toast-container');
  toastContainer.innerHTML = ''; // reset toast container content

  // Call handleDeleteMessage which catches error internally and shows toast
  await global.handleDeleteMessage('non-existent-msg-id', mockDiv);

  // Verify mockDiv is still in the DOM since deletion failed on server
  assert.ok(container.children.includes(mockDiv), 'Mock div should still be in DOM since deletion failed');

  // Verify error toast was shown
  assert.ok(toastContainer.innerHTML.includes('Failed to delete message'), 'Toast should show deletion failure');

  // Clean up mock DOM elements
  mockDiv.remove();

  // B. Corrupted or invalid ID on DELETE API directly
  // Test with invalid formats on server.js to ensure it doesn't crash the server process
  const resNull = await serverFetch('/api/messages/null', { method: 'DELETE' });
  assert.strictEqual(resNull.status, 404, 'Deleting message with ID "null" should return 404');

  const resUndefined = await serverFetch('/api/messages/undefined', { method: 'DELETE' });
  assert.strictEqual(resUndefined.status, 404, 'Deleting message with ID "undefined" should return 404');

  const resEmpty = await serverFetch('/api/messages/   ', { method: 'DELETE' });
  assert.strictEqual(resEmpty.status, 404, 'Deleting message with whitespace/empty ID should return 404');

  // Verify server is still alive
  const resAlive = await serverFetch('/api/settings');
  assert.strictEqual(resAlive.status, 200, 'Server should remain alive and responsive after handling corrupted IDs');
});

test('Adversarial 4: Deleting prompts with abnormal sequencing (Case A: missing assistant response)', async () => {
  // Create a conversation for default user
  const createRes = await serverFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'default' },
    body: JSON.stringify({ title: 'Abnormal Sequencing Chat' })
  });
  const conv = (await createRes.json()).data;
  assert.ok(conv);

  // Use WebSocket to send a message normally and wait for stream to finish
  const wsUrl = `ws://localhost:${serverPort}`;
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  ws.send(JSON.stringify({
    type: 'chat',
    conversationId: conv.id,
    message: 'Message pair to trigger abnormal sequence',
    mode: 'low',
    userId: 'default'
  }));

  await new Promise(resolve => {
    ws.on('message', (rawData) => {
      if (JSON.parse(rawData.toString()).type === 'stream_end') resolve();
    });
  });
  ws.close();

  // Check that we have exactly 2 messages (user & assistant)
  let convData = await getConversationDetails(conv.id);
  assert.strictEqual(convData.messages.length, 2, 'Should start with exactly 2 messages');
  
  const userMsg = convData.messages[0];
  const assistantMsg = convData.messages[1];

  // Try to delete the assistant message directly - this should now be rejected (status 404)!
  const deleteAssistantRes = await serverFetch(`/api/messages/${assistantMsg.id}`, { method: 'DELETE' });
  assert.strictEqual(deleteAssistantRes.status, 404, 'Deleting assistant message directly should be rejected');

  // Verify that both messages still remain in database
  convData = await getConversationDetails(conv.id);
  assert.strictEqual(convData.messages.length, 2, 'Should still have 2 messages in database');

  // Now delete the user message (which should also cascade and delete the assistant message)
  const deleteUserRes = await serverFetch(`/api/messages/${userMsg.id}`, { method: 'DELETE' });
  assert.strictEqual(deleteUserRes.status, 200, 'Deleting user message should succeed');

  // Verify that the conversation is now empty
  convData = await getConversationDetails(conv.id);
  assert.strictEqual(convData.messages.length, 0, 'Database message count should be 0 after deleting user message');
});

test('Adversarial 4/5: Deleting assistant message directly (Vulnerability Check & Chronological Integrity)', async () => {
  // Create a clean conversation
  const createRes = await serverFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'default' },
    body: JSON.stringify({ title: 'Vulnerability Chat' })
  });
  const conv = (await createRes.json()).data;

  // We will insert 2 pairs of messages:
  // Pair 1: User 1 -> Assistant 1
  // Pair 2: User 2 -> Assistant 2
  const wsUrl = `ws://localhost:${serverPort}`;
  
  const ws1 = new WebSocket(wsUrl);
  await new Promise(r => ws1.on('open', r));
  ws1.send(JSON.stringify({
    type: 'chat',
    conversationId: conv.id,
    message: 'First user message',
    mode: 'low',
    userId: 'default'
  }));
  await new Promise(resolve => {
    ws1.on('message', (rawData) => {
      if (JSON.parse(rawData.toString()).type === 'stream_end') resolve();
    });
  });
  ws1.close();

  const ws2 = new WebSocket(wsUrl);
  await new Promise(r => ws2.on('open', r));
  ws2.send(JSON.stringify({
    type: 'chat',
    conversationId: conv.id,
    message: 'Second user message',
    mode: 'low',
    userId: 'default'
  }));
  await new Promise(resolve => {
    ws2.on('message', (rawData) => {
      if (JSON.parse(rawData.toString()).type === 'stream_end') resolve();
    });
  });
  ws2.close();

  // Retrieve all messages and assert counts & order
  const convData = await getConversationDetails(conv.id);
  assert.strictEqual(convData.messages.length, 4, 'Should have exactly 4 messages');
  
  const user1 = convData.messages[0];
  const assistant1 = convData.messages[1];
  const user2 = convData.messages[2];
  const assistant2 = convData.messages[3];

  assert.strictEqual(user1.role, 'user');
  assert.strictEqual(assistant1.role, 'assistant');
  assert.strictEqual(user2.role, 'user');
  assert.strictEqual(assistant2.role, 'assistant');

  // Verify chronological order based on timestamps
  assert.ok(new Date(user1.timestamp) <= new Date(assistant1.timestamp));
  assert.ok(new Date(assistant1.timestamp) <= new Date(user2.timestamp));
  assert.ok(new Date(user2.timestamp) <= new Date(assistant2.timestamp));

  // CHALLENGE: Call DELETE /api/messages/ with assistant1's ID!
  console.log(`[CHALLENGE] Deleting assistant message directly with ID: ${assistant1.id}`);
  const deleteRes = await serverFetch(`/api/messages/${assistant1.id}`, { method: 'DELETE' });
  assert.strictEqual(deleteRes.status, 404, 'Deleting assistant message directly should be rejected');

  // Retrieve post-deletion messages
  const postDeleteData = await getConversationDetails(conv.id);
  console.log('Post-deletion messages in DB:', postDeleteData.messages.map(m => `[${m.role}] ${m.content}`));

  const remainingIds = postDeleteData.messages.map(m => m.id);
  
  // Bug verification
  const assistant1Deleted = !remainingIds.includes(assistant1.id);
  const assistant2Deleted = !remainingIds.includes(assistant2.id);
  const user1Deleted = !remainingIds.includes(user1.id);
  const user2Deleted = !remainingIds.includes(user2.id);

  console.log(`Assistant 1 deleted? ${assistant1Deleted}`);
  console.log(`Assistant 2 deleted? ${assistant2Deleted}`);
  console.log(`User 1 deleted? ${user1Deleted}`);
  console.log(`User 2 deleted? ${user2Deleted}`);

  // Check if assistant2 was deleted as well (the cascading bug)
  let cascadeVulnerabilityFound = false;
  if (assistant2Deleted && !user2Deleted) {
    console.warn('❌ [VULNERABILITY CONFIRMED] Deleting assistant1 also cascaded and deleted assistant2, leaving user2 orphaned!');
    cascadeVulnerabilityFound = true;
  }

  // Database integrity check: check chronological order of remaining messages
  let prevTime = new Date(0);
  for (const msg of postDeleteData.messages) {
    const currTime = new Date(msg.timestamp);
    assert.ok(currTime >= prevTime, 'Chronological order of remaining messages must be preserved');
    prevTime = currTime;
  }

  // We write the result of this vulnerability check to a global flag or report it.
  global.cascadeVulnerabilityFound = cascadeVulnerabilityFound;
});
