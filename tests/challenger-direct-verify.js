// tests/challenger-direct-verify.js
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { ConversationManager } from '../src/conversation-manager.js';
import { LLMClient } from '../src/llm-client.js';
import { setupMockDOM } from './mock-dom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

async function testModeToggleAndBadge() {
  console.log('[TEST] Verifying Mode Toggle and UI Badge...');
  setupMockDOM(3001);
  global.localStorage.setItem('sajan-provider', 'google');
  global.localStorage.setItem('sajan_username', 'challenger');

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

  const modeBtn = global.document.querySelector('.mode-btn');
  const badge = global.document.querySelector('#model-badge');

  assert.ok(modeBtn, 'Mode button should exist in UI');
  assert.ok(badge, 'Model badge should exist in UI');

  // Test Mode transition: low
  modeBtn.dataset.mode = 'low';
  modeBtn.click();
  assert.strictEqual(global.state.intelligenceMode, 'low', 'State intelligenceMode should be low');
  assert.strictEqual(badge.textContent, 'Gemini 1.5 Flash', 'Badge text should map low to Gemini 1.5 Flash');

  // Test Mode transition: medium
  modeBtn.dataset.mode = 'medium';
  modeBtn.click();
  assert.strictEqual(global.state.intelligenceMode, 'medium', 'State intelligenceMode should be medium');
  assert.strictEqual(badge.textContent, 'Gemini 2.5 Flash', 'Badge text should map medium to Gemini 2.5 Flash');

  // Test Mode transition: high
  modeBtn.dataset.mode = 'high';
  modeBtn.click();
  assert.strictEqual(global.state.intelligenceMode, 'high', 'State intelligenceMode should be high');
  assert.strictEqual(badge.textContent, 'Gemini 1.5 Pro', 'Badge text should map high to Gemini 1.5 Pro');

  console.log('✔ Mode Toggle and UI Badge verified successfully.');
}

async function testModelRouting() {
  console.log('[TEST] Verifying Model Routing...');
  const client = new LLMClient();
  client.updateConfig('google', 'test_key', null);

  const lowModel = client.getModel({ mode: 'low' });
  assert.strictEqual(lowModel, 'gemini-2.0-flash-lite', 'Low mode should route to gemini-2.0-flash-lite');

  const medModel = client.getModel({ mode: 'medium' });
  assert.strictEqual(medModel, 'gemini-2.5-flash', 'Medium mode should route to gemini-2.5-flash');

  const highModel = client.getModel({ mode: 'high' });
  assert.strictEqual(highModel, 'gemini-2.5-pro', 'High mode should route to gemini-2.5-pro');

  console.log('✔ Model Routing verified successfully.');
}

async function testSQLiteTracePersistenceAndCascades() {
  console.log('[TEST] Verifying SQLite Trace Persistence & Cascading Deletes...');
  const tempDbDir = path.join(dataDir, 'challenger_verify_temp');
  if (fs.existsSync(tempDbDir)) {
    fs.rmSync(tempDbDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDbDir, { recursive: true });

  const manager = new ConversationManager(tempDbDir);
  await manager._ensureReady();

  // Create conversation
  const conv = manager.createConversation('Test Trace Conv', 'test_user');
  assert.ok(conv.id);

  // Insert user message and assistant message
  const userMsg = manager.addMessage(conv.id, 'user', 'Hello Sajan');
  const assistantMsg = manager.addMessage(conv.id, 'assistant', 'Hello human');

  // Add trace events
  const trace1 = manager.addTraceEvent(conv.id, userMsg.id, 'safety', 'Safety Check', 'Passed safety scanning');
  const trace2 = manager.addTraceEvent(conv.id, assistantMsg.id, 'thinking', 'Thinking Trace', 'Deciding response path');

  // Retrieve traces
  const traces = manager.getTraceEvents(conv.id);
  assert.strictEqual(traces.length, 2, 'Should retrieve exactly 2 traces');

  assert.strictEqual(traces[0].id, trace1.id);
  assert.strictEqual(traces[0].conversation_id, conv.id);
  assert.strictEqual(traces[0].message_id, userMsg.id);
  assert.strictEqual(traces[0].event_type, 'safety');
  assert.strictEqual(traces[0].label, 'Safety Check');
  assert.strictEqual(traces[0].detail, 'Passed safety scanning');

  assert.strictEqual(traces[1].id, trace2.id);
  assert.strictEqual(traces[1].message_id, assistantMsg.id);
  assert.strictEqual(traces[1].event_type, 'thinking');

  // Test Cascading Delete - Case 1: Delete User message cascades to delete assistant message
  console.log('[TEST] Checking user message deletion cascading...');
  const deleteMsgResult = manager.deleteMessage(userMsg.id, 'test_user');
  assert.strictEqual(deleteMsgResult, true, 'deleteMessage should return true');

  const convAfterMsgDelete = manager.getConversation(conv.id, 'test_user');
  assert.strictEqual(convAfterMsgDelete.messages.length, 0, 'Both user and assistant messages should be deleted');

  // Test Cascading Delete - Case 2: Delete Conversation cascades to delete traces
  // Let's add a new message and trace back in
  const u2 = manager.addMessage(conv.id, 'user', 'Another user message');
  manager.addTraceEvent(conv.id, u2.id, 'plan', 'Planner Trace', 'Step 1 plan');

  const tracesBeforeDelete = manager.getTraceEvents(conv.id);
  assert.strictEqual(tracesBeforeDelete.length, 3, 'Traces list should contain old ones and new one');

  console.log('[TEST] Checking conversation deletion cascading...');
  const deleteConvResult = manager.deleteConversation(conv.id, 'test_user');
  assert.strictEqual(deleteConvResult, true, 'deleteConversation should return true');

  const tracesAfterDelete = manager.getTraceEvents(conv.id);
  assert.strictEqual(tracesAfterDelete.length, 0, 'All traces should be cascade-deleted on conversation delete');

  manager.close();
  fs.rmSync(tempDbDir, { recursive: true, force: true });
  console.log('✔ SQLite Trace Persistence and Cascading Deletes verified successfully.');
}

async function runAll() {
  console.log('--- RUNNING DIRECT CHALLENGER VERIFICATION CHECKS ---');
  try {
    await testModeToggleAndBadge();
    await testModelRouting();
    await testSQLiteTracePersistenceAndCascades();
    console.log('--- ALL CHECKS COMPLETED SUCCESSFULLY ---');
    process.exit(0);
  } catch (err) {
    console.error('❌ DIRECT CHALLENGER VERIFICATION FAILED:', err);
    process.exit(1);
  }
}

runAll();
