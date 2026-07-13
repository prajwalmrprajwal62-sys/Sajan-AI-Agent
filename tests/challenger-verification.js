import assert from 'node:assert';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { ConversationManager } from '../src/conversation-manager.js';
import { backup } from './backup.js';
import { restore } from './restore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const serverPort = 3005;
let serverProcess = null;

async function serverFetch(route, options = {}) {
  const url = `http://localhost:${serverPort}${route}`;
  return fetch(url, options);
}

async function runTests() {
  console.log('--- STARTING ADVERSARIAL CHALLENGER VERIFICATION ---');

  // =========================================================================
  // EDGE CASE 1: Rapid clicking of the Stop button during active streaming
  // =========================================================================
  console.log('\n[CASE 1] Testing rapid clicking of the Stop button during streaming...');
  
  // Create a conversation via REST
  const createRes = await serverFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': 'case1_user' },
    body: JSON.stringify({ title: 'Stream Abort Chat' })
  });
  const conv = (await createRes.json()).data;
  assert.ok(conv.id);

  // Connect WebSocket
  const wsUrl = `ws://localhost:${serverPort}`;
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  // Send a message to start streaming
  ws.send(JSON.stringify({
    type: 'chat',
    conversationId: conv.id,
    message: 'Hello Sajan, start streaming now.',
    mode: 'medium',
    userId: 'case1_user'
  }));

  // Wait for stream to start, then rapidly send 5 abort messages
  let streamStarted = false;
  let receivedChunks = [];
  let streamEndedPromise = new Promise((resolve) => {
    ws.on('message', (rawData) => {
      const data = JSON.parse(rawData.toString());
      if (data.type === 'stream_start') {
        streamStarted = true;
        // Rapidly send 5 abort messages
        for (let i = 0; i < 5; i++) {
          ws.send(JSON.stringify({ type: 'abort' }));
        }
      } else if (data.type === 'stream_chunk') {
        receivedChunks.push(data.content);
      } else if (data.type === 'stream_end') {
        resolve(data);
      }
    });
  });

  const endData = await streamEndedPromise;
  console.log('Stream ended. Full response:', endData.fullResponse);
  
  // Assertions:
  assert.ok(streamStarted, 'Stream should have started');
  assert.strictEqual(endData.fullResponse, 'Stopped by user', 'Response should be "Stopped by user"');
  
  // Verify that database saved "Stopped by user" for assistant message
  const getConvRes = await serverFetch(`/api/conversations/${conv.id}`, {
    headers: { 'x-user-id': 'case1_user' }
  });
  const convInDb = (await getConvRes.json()).data;
  const assistantMsg = convInDb.messages.find(m => m.role === 'assistant');
  assert.ok(assistantMsg, 'Assistant message should be saved');
  assert.strictEqual(assistantMsg.content, 'Stopped by user', 'Saved assistant message should be "Stopped by user"');

  ws.close();
  console.log('✔ [CASE 1] PASS: Rapid clicking of the Stop button handled correctly');

  // =========================================================================
  // EDGE CASE 2: Aborting when no stream is active or aborting multiple times
  // =========================================================================
  console.log('\n[CASE 2] Testing aborting when no stream is active or multiple times...');

  const ws2 = new WebSocket(wsUrl);
  await new Promise(r => ws2.on('open', r));

  // Send abort message multiple times before sending any chat message
  for (let i = 0; i < 3; i++) {
    ws2.send(JSON.stringify({ type: 'abort' }));
  }

  // Send a regular chat message to verify server is still responsive and not crashed
  ws2.send(JSON.stringify({
    type: 'chat',
    conversationId: conv.id,
    message: 'Are you still alive?',
    mode: 'medium',
    userId: 'case1_user'
  }));

  let responseChunks = [];
  const responseEnd = await new Promise((resolve) => {
    ws2.on('message', (rawData) => {
      const data = JSON.parse(rawData.toString());
      if (data.type === 'stream_chunk') {
        responseChunks.push(data.content);
      } else if (data.type === 'stream_end') {
        resolve(data);
      }
    });
  });

  assert.ok(responseEnd.fullResponse.length > 0, 'Server should respond normally after invalid aborts');
  assert.notStrictEqual(responseEnd.fullResponse, 'Stopped by user', 'Response should not be aborted');
  ws2.close();
  console.log('✔ [CASE 2] PASS: Aborts during inactive streams are ignored and do not crash the server');

  // =========================================================================
  // EDGE CASE 3: Editing or deleting message bubbles with invalid/corrupted IDs
  // =========================================================================
  console.log('\n[CASE 3] Testing message editing/deletion with invalid, corrupted, or non-existent IDs...');

  // A. Delete non-existent ID
  const delNonExistent = await serverFetch('/api/messages/non-existent-id', {
    method: 'DELETE'
  });
  assert.strictEqual(delNonExistent.status, 404, 'Deleting non-existent message ID should return 404');

  // B. Delete corrupted/invalid IDs
  const delCorrupted1 = await serverFetch('/api/messages/undefined', { method: 'DELETE' });
  assert.strictEqual(delCorrupted1.status, 404, 'Deleting "undefined" message ID should return 404');

  const delCorrupted2 = await serverFetch('/api/messages/null', { method: 'DELETE' });
  assert.strictEqual(delCorrupted2.status, 404, 'Deleting "null" message ID should return 404');

  const delCorrupted3 = await serverFetch('/api/messages/../../../etc/passwd', { method: 'DELETE' });
  assert.strictEqual(delCorrupted3.status, 404, 'Deleting path traversal style ID should return 404');

  console.log('✔ [CASE 3] PASS: Server robustly handles invalid and corrupted IDs with 404 responses');

  // =========================================================================
  // EDGE CASE 4: Deleting a user prompt with missing assistant message or abnormal sequencing
  // =========================================================================
  console.log('\n[CASE 4] Testing user prompt deletion with missing assistant message or abnormal sequencing (Standalone DB)...');

  // Initialize a standalone ConversationManager on a temporary DB
  const tempDbDir = path.join(dataDir, 'unit_test_temp');
  if (fs.existsSync(tempDbDir)) {
    fs.rmSync(tempDbDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDbDir, { recursive: true });

  const convManager = new ConversationManager(tempDbDir);
  await convManager._ensureReady();

  // Create a conversation
  const seqConv = convManager.createConversation('Abnormal Sequencing Chat', 'sequencing_user');

  // Scenario A: Deleting user message when subsequent assistant message is missing
  console.log('  Sub-case A: Deleting a user prompt with no assistant reply...');
  const userMsgA = convManager.addMessage(seqConv.id, 'user', 'Prompt A (no response)');
  
  // Call delete message on userMsgA directly
  const delResA = convManager.deleteMessage(userMsgA.id);
  assert.strictEqual(delResA, true, 'Deleting user message without assistant reply should succeed');

  // Verify database contains 0 messages
  const convAfterDelA = convManager.getConversation(seqConv.id, 'sequencing_user');
  assert.strictEqual(convAfterDelA.messages.length, 0, 'Database should be empty after deleting prompt A');

  // Scenario B: Abnormal sequencing (User 1, User 2, Assistant 1)
  console.log('  Sub-case B: Deleting user prompt in abnormal sequencing (User 1 -> User 2 -> Assistant 1)...');
  const userMsg1 = convManager.addMessage(seqConv.id, 'user', 'User message 1');
  await new Promise(r => setTimeout(r, 10));
  const userMsg2 = convManager.addMessage(seqConv.id, 'user', 'User message 2');
  await new Promise(r => setTimeout(r, 10));
  const assistantMsg1 = convManager.addMessage(seqConv.id, 'assistant', 'Assistant response 1');

  // Delete User message 1
  const delResB = convManager.deleteMessage(userMsg1.id);
  assert.strictEqual(delResB, true);

  // Retrieve remaining messages
  const convAfterDelB = convManager.getConversation(seqConv.id, 'sequencing_user');
  console.log('  Remaining messages after deleting User 1:', convAfterDelB.messages.map(m => `[${m.role}] ${m.content}`));

  // Assertions:
  // User 1 should be deleted.
  assert.ok(!convAfterDelB.messages.some(m => m.id === userMsg1.id), 'User message 1 should be deleted');
  // User 2 should NOT be deleted.
  assert.ok(convAfterDelB.messages.some(m => m.id === userMsg2.id), 'User message 2 should NOT be deleted');
  // Assistant 1 should be deleted.
  assert.ok(!convAfterDelB.messages.some(m => m.id === assistantMsg1.id), 'Assistant response 1 should be deleted');
  // Database should contain exactly 1 message (User message 2)
  assert.strictEqual(convAfterDelB.messages.length, 1, 'Database should contain exactly 1 message (User message 2)');
  assert.strictEqual(convAfterDelB.messages[0].id, userMsg2.id);

  console.log('✔ [CASE 4] PASS: Abnormal sequencing and missing assistant message are handled robustly');

  // =========================================================================
  // EDGE CASE 5: Verification of SQLite database integrity after deletion pairs
  // =========================================================================
  console.log('\n[CASE 5] Verifying SQLite database integrity after deletion pairs...');

  // Create a conversation for database integrity tests
  const dbConv = convManager.createConversation('DB Integrity Chat', 'db_integrity_user');

  // Insert 3 message pairs
  const u1 = convManager.addMessage(dbConv.id, 'user', 'U1');
  await new Promise(r => setTimeout(r, 10));
  const a1 = convManager.addMessage(dbConv.id, 'assistant', 'A1');
  await new Promise(r => setTimeout(r, 10));

  const u2 = convManager.addMessage(dbConv.id, 'user', 'U2');
  await new Promise(r => setTimeout(r, 10));
  const a2 = convManager.addMessage(dbConv.id, 'assistant', 'A2');
  await new Promise(r => setTimeout(r, 10));

  const u3 = convManager.addMessage(dbConv.id, 'user', 'U3');
  await new Promise(r => setTimeout(r, 10));
  const a3 = convManager.addMessage(dbConv.id, 'assistant', 'A3');

  // Total messages before delete: 6
  const initialConv = convManager.getConversation(dbConv.id, 'db_integrity_user');
  assert.strictEqual(initialConv.messages.length, 6);

  // Delete message pair 2 (by deleting U2)
  console.log('  Deleting U2 (should delete U2 and A2)...');
  const delResC = convManager.deleteMessage(u2.id);
  assert.strictEqual(delResC, true);

  // Verify integrity:
  const finalConv = convManager.getConversation(dbConv.id, 'db_integrity_user');
  console.log('  Remaining messages:', finalConv.messages.map(m => `[${m.role}] ${m.content}`));

  // Remaining should be exactly 4 messages
  assert.strictEqual(finalConv.messages.length, 4, 'Remaining count should be exactly 4');
  
  // Remaining messages should be exactly [U1, A1, U3, A3] in that order
  assert.strictEqual(finalConv.messages[0].id, u1.id);
  assert.strictEqual(finalConv.messages[1].id, a1.id);
  assert.strictEqual(finalConv.messages[2].id, u3.id);
  assert.strictEqual(finalConv.messages[3].id, a3.id);

  // Chronological order verification
  const timestamps = finalConv.messages.map(m => m.timestamp);
  const sortedTimestamps = [...timestamps].sort((a, b) => a.localeCompare(b));
  assert.deepStrictEqual(timestamps, sortedTimestamps, 'Timestamps order must be strictly ascending');

  // Check the physical file on disk to see if it reads back correctly after close
  convManager.close();
  
  const convManager2 = new ConversationManager(tempDbDir);
  await convManager2._ensureReady();
  const diskConv = convManager2.getConversation(dbConv.id, 'db_integrity_user');
  assert.strictEqual(diskConv.messages.length, 4);
  assert.strictEqual(diskConv.messages[0].content, 'U1');
  assert.strictEqual(diskConv.messages[1].content, 'A1');
  assert.strictEqual(diskConv.messages[2].content, 'U3');
  assert.strictEqual(diskConv.messages[3].content, 'A3');
  convManager2.close();

  // Cleanup temp DB directory
  fs.rmSync(tempDbDir, { recursive: true, force: true });

  console.log('✔ [CASE 5] PASS: SQLite database integrity, row count, and chronological order verified successfully');
}

// Spawning server on isolated port
console.log('[Setup] Backing up databases...');
backup();

console.log('[Setup] Clearing active database files...');
const filesToClear = ['sajan.db', 'memories.json', 'preferences.json'];
for (const file of filesToClear) {
  const filePath = path.join(dataDir, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

console.log(`[Setup] Spawning server on port ${serverPort}...`);
serverProcess = spawn('node', [
  '--import', './tests/mock-fetch-challenger.js',
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

let serverStarted = false;
serverProcess.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(`[Server] ${output.trim()}`);
  if ((output.includes('Database initialized') || output.includes('http://')) && !serverStarted) {
    serverStarted = true;
    runTests()
      .then(() => {
        console.log('\n--- ALL CHALLENGER VERIFICATION TESTS COMPLETED SUCCESSFULLY ---');
      })
      .catch((err) => {
        console.error('\n--- ADVERSARIAL CHALLENGER TEST FAILURE ---', err);
        process.exitCode = 1;
      })
      .finally(() => {
        console.log('[Teardown] Stopping server...');
        serverProcess.kill();
        console.log('[Teardown] Restoring databases...');
        restore();
      });
  }
});
