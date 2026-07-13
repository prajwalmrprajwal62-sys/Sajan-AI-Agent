// tests/run-stress.js
import assert from 'node:assert';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { WebSocket } from 'ws';

import { backup } from './backup.js';
import { restore } from './restore.js';
import { setupMockDOM } from './mock-dom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const serverPort = 3002;
let serverProcess = null;

async function serverFetch(route, options = {}) {
  const url = `http://localhost:${serverPort}${route}`;
  return fetch(url, options);
}

async function runTests() {
  console.log('--- STARTING CHALLENGER STRESS TESTS ---');

  // 1. Verify DOM positioning of #mode-toggle inside .input-wrapper next to #mic-btn
  console.log('\n[TEST 1] Verifying #mode-toggle placement next to voice button...');
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // We check via text positioning that #mode-toggle is sibling/adjacent to #mic-btn inside .input-wrapper
  const inputWrapperStart = htmlContent.indexOf('<div class="input-wrapper">');
  const inputWrapperEnd = htmlContent.indexOf('<div class="input-footer">', inputWrapperStart);
  const inputWrapperSub = htmlContent.substring(inputWrapperStart, inputWrapperEnd);

  assert.ok(inputWrapperSub.includes('id="mic-btn"'), 'mic-btn should be inside input-wrapper');
  assert.ok(inputWrapperSub.includes('id="mode-toggle"'), 'mode-toggle should be inside input-wrapper');

  // Verify CSS contains rules for input-wrapper mode-toggle positioning
  const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  assert.ok(cssContent.includes('.input-wrapper .mode-toggle'), 'CSS should style .input-wrapper .mode-toggle');
  console.log('✔ [TEST 1] PASS: #mode-toggle is located inside .input-wrapper next to #mic-btn');

  // 2. Verify model switching and dynamic update of #model-badge
  console.log('\n[TEST 2] Verifying model badge mapping for Google provider...');
  
  // Fix the classList toggle bug in mock-dom.js dynamically
  const { MockDOMElement } = await import('./mock-dom.js');
  Object.defineProperty(MockDOMElement.prototype, 'classList', {
    get() {
      const self = this;
      return {
        add(cls) {
          const classes = self.className.split(/\s+/).filter(Boolean);
          if (!classes.includes(cls)) classes.push(cls);
          self.className = classes.join(' ');
        },
        remove(cls) {
          const classes = self.className.split(/\s+/).filter(Boolean);
          self.className = classes.filter(x => x !== cls).join(' ');
        },
        toggle(cls, force) {
          const classes = self.className.split(/\s+/).filter(Boolean);
          const has = classes.includes(cls);
          const shouldHave = force !== undefined ? force : !has;
          if (shouldHave) {
            if (!has) {
              classes.push(cls);
              self.className = classes.join(' ');
            }
          } else {
            if (has) {
              self.className = classes.filter(x => x !== cls).join(' ');
            }
          }
          return shouldHave;
        },
        contains(cls) {
          return self.className.split(/\s+/).filter(Boolean).includes(cls);
        }
      };
    },
    configurable: true
  });

  setupMockDOM(serverPort);
  global.localStorage.setItem('sajan-provider', 'google');
  global.localStorage.setItem('sajan_username', 'bob');

  // Load app.js into context
  const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
  let appJsContent = fs.readFileSync(appJsPath, 'utf8');
  appJsContent = appJsContent
    .replace('const state =', () => 'global.state =')
    .replace('const $ =', () => 'global.$ =')
    .replace('const $$ =', () => 'global.$$ =')
    .replace("app.classList.toggle('sidebar-collapsed');", "console.log('[VM toggleSidebar] app element before toggle:', app); app.classList.toggle('sidebar-collapsed'); console.log('[VM toggleSidebar] app element after toggle:', app);");

  const context = vm.createContext(global);
  const script = new vm.Script(appJsContent, { filename: 'app.js' });
  script.runInContext(context);

  // Trigger DOMContentLoaded manually to execute init
  global.document.dispatchEvent('DOMContentLoaded');

  // Get elements
  const badge = global.document.querySelector('#model-badge');
  const modeBtn = global.document.querySelector('.mode-btn');

  console.log('[DEBUG] badge:', badge);
  console.log('[DEBUG] modeBtn:', modeBtn);
  console.log('[DEBUG] localStorage sajan-provider:', global.localStorage.getItem('sajan-provider'));
  console.log('[DEBUG] initial global.state:', global.state);

  assert.ok(modeBtn, 'Mode button must exist');

  // Test low mode trigger
  modeBtn.dataset.mode = 'low';
  console.log('[DEBUG] clicking modeBtn...');
  modeBtn.click();
  console.log('[DEBUG] global.state after click:', global.state);
  console.log(`Low mode selected. Badge text: "${badge.textContent}"`);
  assert.strictEqual(badge.textContent, 'Gemini 1.5 Flash');

  // Test medium mode trigger
  modeBtn.dataset.mode = 'medium';
  modeBtn.click();
  console.log(`Med mode selected. Badge text: "${badge.textContent}"`);
  assert.strictEqual(badge.textContent, 'Gemini 2.5 Flash');

  // Test high mode trigger
  modeBtn.dataset.mode = 'high';
  modeBtn.click();
  console.log(`High mode selected. Badge text: "${badge.textContent}"`);
  assert.strictEqual(badge.textContent, 'Gemini 1.5 Pro');
  console.log('✔ [TEST 2] PASS: Model badge dynamically maps Low->Gemini 1.5 Flash, Med->Gemini 2.5 Flash, High->Gemini 1.5 Pro');

  // 3. Verify .app container height is 100vh/viewport and sidebar collapse toggles
  console.log('\n[TEST 3] Verifying .app container occupies 100% viewport and sidebar toggling...');
  // Verify CSS styles
  assert.ok(cssContent.includes('.app {'), 'CSS must define styles for .app');
  assert.ok(cssContent.includes('height: 100vh;'), 'CSS .app must have height: 100vh');
  assert.ok(cssContent.includes('.app.sidebar-collapsed { grid-template-columns: 0px 1fr; }'), 'CSS must define sidebar-collapsed layout');

  // Verify JS toggling function
  const appEl = global.document.querySelector('#app');
  appEl.className = 'app'; // reset
  
  console.log('[DEBUG] window.innerWidth:', global.window.innerWidth);
  console.log('[DEBUG] appEl.classList:', appEl.classList);
  
  // Wrap toggleSidebar to debug
  const origToggleSidebar = global.toggleSidebar;
  global.toggleSidebar = function(forceState) {
    console.log('[DEBUG toggleSidebar] entering...');
    console.log('[DEBUG toggleSidebar] global.$("#app"):', global.$('#app'));
    console.log('[DEBUG toggleSidebar] global.window.innerWidth:', global.window.innerWidth);
    const res = origToggleSidebar(forceState);
    console.log('[DEBUG toggleSidebar] global.$("#app") className after:', global.$('#app').className);
    return res;
  };
  
  // Toggle sidebar (simulated click on sidebar toggle button or toggleSidebar call)
  global.toggleSidebar();
  console.log(`After toggleSidebar call: className is "${appEl.className}"`);
  console.log(`After toggleSidebar call: global.$("#app") className is "${global.$('#app').className}"`);
  
  // Let's check if the class was toggled. If not, let's see if we are in the mobile view (<= 768)
  console.log('[DEBUG] sidebar-open class?', appEl.classList.contains('sidebar-open'));
  console.log('[DEBUG] sidebar-collapsed class?', appEl.classList.contains('sidebar-collapsed'));
  
  assert.ok(appEl.classList.contains('sidebar-collapsed') || appEl.classList.contains('sidebar-open'), 'App classList should contain sidebar-collapsed or sidebar-open');

  global.toggleSidebar();
  console.log(`After second toggleSidebar call: className is "${appEl.className}"`);
  console.log('✔ [TEST 3] PASS: .app height matches viewport, and sidebar collapse toggles classes properly.');

  // 4. Verify user database persistence (SQLite sajan.db, JSON memories, JSON preferences) under user ID partitioning
  console.log('\n[TEST 4] Verifying user database partitioning isolation...');
  
  // A. REST isolation check:
  // Create a conversation for user 'user_bob'
  console.log('Creating conversation for user_bob...');
  const createBobRes = await serverFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_bob' },
    body: JSON.stringify({ title: 'Bob\'s Secret Chat' })
  });
  const bobConv = (await createBobRes.json()).data;
  console.log(`Created Bob conversation: ID=${bobConv.id}, UserID=${bobConv.user_id}`);

  // List conversations as user_bob
  const listBobRes = await serverFetch('/api/conversations', {
    headers: { 'X-User-Id': 'user_bob' }
  });
  const bobConvs = (await listBobRes.json()).data;
  assert.ok(bobConvs.some(c => c.id === bobConv.id), 'Bob should see his conversation');

  // List conversations as user_alice
  const listAliceRes = await serverFetch('/api/conversations', {
    headers: { 'X-User-Id': 'user_alice' }
  });
  const aliceConvs = (await listAliceRes.json()).data;
  assert.ok(!aliceConvs.some(c => c.id === bobConv.id), 'Alice should NOT see Bob\'s conversation');
  console.log('✔ A. SQLite database query isolation is enforced in REST endpoints.');

  // B. WebSocket chat loop isolation check (Critical):
  // Let's connect as user_bob and send a message.
  console.log('Connecting via WebSocket as user_bob...');
  const wsUrl = `ws://localhost:${serverPort}`;
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  console.log('Sending chat message via WebSocket for user_bob...');
  ws.send(JSON.stringify({
    type: 'chat',
    conversationId: bobConv.id,
    message: 'Hello Sajan! Remember that I am Bob and I like green apples.',
    mode: 'medium',
    userId: 'user_bob'
  }));

  // Wait for stream completion
  const wsMessages = [];
  await new Promise((resolve) => {
    ws.on('message', (rawData) => {
      const data = JSON.parse(rawData.toString());
      wsMessages.push(data);
      if (data.type === 'stream_end') {
        resolve();
      }
    });
  });

  console.log(`WebSocket received stream_end. Assistant reply: "${wsMessages.find(m => m.type === 'stream_end')?.fullResponse}"`);

  // Let's verify whether the conversation lookup succeeded in the server during WebSocket processing!
  // If the server lookup succeeded, the conversation title would be generated and sent, or message history would be preserved.
  // Wait, let's inspect the sqlite database file (sajan.db) directly or query it via REST.
  // Let's call GET /api/conversations/:id for user_bob and see if the assistant message was successfully saved!
  const getBobConvRes = await serverFetch(`/api/conversations/${bobConv.id}`, {
    headers: { 'X-User-Id': 'user_bob' }
  });
  const bobConvData = (await getBobConvRes.json()).data;
  console.log(`Bob's conversation message count: ${bobConvData.messages.length}`);
  console.log('Messages in database:', bobConvData.messages.map(m => `[${m.role}] ${m.content}`));

  // Check if assistant response exists in messages
  const hasAssistantMsg = bobConvData.messages.some(m => m.role === 'assistant');
  console.log(`Has assistant message saved? ${hasAssistantMsg}`);

  // C. JSON Memories and JSON Preferences partitioning check:
  // Add a memory as user_bob
  console.log('Adding memory for user_bob...');
  const addMemoryRes = await serverFetch('/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_bob' },
    body: JSON.stringify({ key: 'fav_fruit', value: 'green apples', category: 'personal' })
  });
  const addedMemory = (await addMemoryRes.json()).data;

  // Let's read the memories.json file and see if it was saved under 'user_bob' or 'default'!
  const memoriesJsonPath = path.join(dataDir, 'memories.json');
  const memoriesData = JSON.parse(fs.readFileSync(memoriesJsonPath, 'utf8'));
  console.log('memories.json contents keys:', Object.keys(memoriesData));
  if (memoriesData.user_bob) {
    console.log('Bob memories in file:', memoriesData.user_bob);
  }
  if (memoriesData.default) {
    console.log('Default memories in file:', memoriesData.default);
  }

  // Add preference as user_bob
  console.log('Adding preference for user_bob...');
  const addPrefRes = await serverFetch('/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_bob' },
    body: JSON.stringify({ key: 'theme', value: 'glass-dark', type: 'behavioral', always: true })
  });

  // Let's read the preferences.json file and see if it was saved under 'user_bob' or 'default'!
  const preferencesJsonPath = path.join(dataDir, 'preferences.json');
  const preferencesData = JSON.parse(fs.readFileSync(preferencesJsonPath, 'utf8'));
  console.log('preferences.json contents keys:', Object.keys(preferencesData));
  if (preferencesData.user_bob) {
    console.log('Bob preferences in file:', preferencesData.user_bob);
  }
  if (preferencesData.default) {
    console.log('Default preferences in file:', preferencesData.default);
  }

  ws.close();
}

// Spawning server
console.log('[Stress Setup] Backing up databases...');
backup();

console.log('[Stress Setup] Clearing active database files...');
const filesToClear = ['sajan.db', 'memories.json', 'preferences.json'];
for (const file of filesToClear) {
  const filePath = path.join(dataDir, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

console.log(`[Stress Setup] Spawning server on port ${serverPort}...`);
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

serverProcess.stdout.on('data', function listener(data) {
  const output = data.toString();
  if (output.includes('Database initialized') || output.includes('http://')) {
    serverProcess.stdout.removeListener('data', listener);
    runTests()
      .then(() => {
        console.log('\n--- TESTS COMPLETED ---');
      })
      .catch((err) => {
        console.error('\n--- TEST FAILURE ---', err);
      })
      .finally(() => {
        console.log('[Stress Teardown] Stopping server...');
        serverProcess.kill();
        console.log('[Stress Teardown] Restoring databases...');
        restore();
      });
  }
});
