/**
 * SAJAN — Main Server
 * Express + WebSocket server that wires together all modules:
 * LLM client, safety middleware, memory manager, conversation manager,
 * search engine, preferences engine, copyright guard, and system prompt.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
config();

// Module imports
import { LLMClient } from './src/llm-client.js';
import { SafetyMiddleware } from './src/safety-middleware.js';
import { MemoryManager } from './src/memory-manager.js';
import { ConversationManager } from './src/conversation-manager.js';
import { SearchEngine } from './src/search-engine.js';
import { PreferencesEngine } from './src/preferences-engine.js';
import { CopyrightGuard } from './src/copyright-guard.js';
import { buildSystemPrompt } from './src/system-prompt.js';
import { RagManager } from './src/rag-manager.js';
import { sanitizeInput, getCurrentTimestamp } from './src/utils.js';

import multer from 'multer';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ---------------------------------------------------------------------------
// Directory setup
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, 'data');

// In-memory staged files map
const stagedFiles = new Map();

// ---------------------------------------------------------------------------
// Instantiate all modules
// ---------------------------------------------------------------------------
const llmClient = new LLMClient();

// Load persistent config
const CONFIG_FILE = join(DATA_DIR, 'local_config.json');
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    llmClient.updateConfig(savedConfig.provider, savedConfig.apiKey, savedConfig.model);
    console.log(`[Server] Loaded saved config from local_config.json`);
    console.log(`[Server] Provider: ${savedConfig.provider}, Model: ${savedConfig.model}`);
    console.log(`[Server] Active Google models — Low: ${llmClient.liveGoogleModels.low}, Medium: ${llmClient.liveGoogleModels.medium}, High: ${llmClient.liveGoogleModels.high}`);
  } catch (e) {
    console.error('[Server] Failed to load local_config.json', e);
  }
}

const safetyMiddleware = new SafetyMiddleware();
const memoryManager = new MemoryManager(DATA_DIR);
const conversationManager = new ConversationManager(DATA_DIR);
const searchEngine = new SearchEngine();
const preferencesEngine = new PreferencesEngine(DATA_DIR);
const copyrightGuard = new CopyrightGuard();
const ragManager = new RagManager(DATA_DIR, llmClient);

// Setup multer for file uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
const server = createServer(app);

// Middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.static(join(__dirname, 'public')));

// CORS headers (for development)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// REST API — Conversations
// ---------------------------------------------------------------------------

/** List all conversations */
app.get('/api/conversations', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const conversations = conversationManager.listConversations(userId);
    res.json({ success: true, data: conversations });
  } catch (error) {
    console.error('GET /api/conversations error:', error);
    res.status(500).json({ success: false, error: 'Failed to list conversations.' });
  }
});

/** Create a new conversation */
app.post('/api/conversations', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const { title } = req.body;
    const conversation = conversationManager.createConversation(title, userId);
    res.status(201).json({ success: true, data: conversation });
  } catch (error) {
    console.error('POST /api/conversations error:', error);
    res.status(500).json({ success: false, error: 'Failed to create conversation.' });
  }
});

/** Get a conversation with its messages */
app.get('/api/conversations/:id', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const conversation = conversationManager.getConversation(req.params.id, userId);
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found.' });
    }
    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error(`GET /api/conversations/${req.params.id} error:`, error);
    res.status(500).json({ success: false, error: 'Failed to get conversation.' });
  }
});

/** Get traces for a conversation */
app.get('/api/conversations/:id/traces', (req, res) => {
  try {
    const traces = conversationManager.getTraceEvents(req.params.id);
    res.json({ success: true, data: traces });
  } catch (error) {
    console.error(`GET /api/conversations/${req.params.id}/traces error:`, error);
    res.status(500).json({ success: false, error: 'Failed to get traces.' });
  }
});

/** Update a conversation title */
app.patch('/api/conversations/:id', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'title is required.' });
    }
    conversationManager.updateTitle(req.params.id, title, userId);
    res.json({ success: true, data: { id: req.params.id, title } });
  } catch (error) {
    console.error(`PATCH /api/conversations/${req.params.id} error:`, error);
    res.status(500).json({ success: false, error: 'Failed to update conversation.' });
  }
});

/** Delete a conversation */
app.delete('/api/conversations/:id', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const deleted = conversationManager.deleteConversation(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Conversation not found.' });
    }
    copyrightGuard.reset(req.params.id);
    res.json({ success: true, message: 'Conversation deleted.' });
  } catch (error) {
    console.error(`DELETE /api/conversations/${req.params.id} error:`, error);
    res.status(500).json({ success: false, error: 'Failed to delete conversation.' });
  }
});

/** Delete a message pair */
app.delete('/api/messages/:id', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const deleted = conversationManager.deleteMessage(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Message pair not found.' });
    }
    res.json({ success: true, message: 'Message pair deleted.' });
  } catch (error) {
    console.error(`DELETE /api/messages/${req.params.id} error:`, error);
    res.status(500).json({ success: false, error: 'Failed to delete message pair.' });
  }
});

// ---------------------------------------------------------------------------
// REST API — Memories
// ---------------------------------------------------------------------------

/** Get all memories for the default user */
app.get('/api/memories', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const memories = memoryManager.getMemories(userId);
    res.json({ success: true, data: memories });
  } catch (error) {
    console.error('GET /api/memories error:', error);
    res.status(500).json({ success: false, error: 'Failed to get memories.' });
  }
});

/** Add a new memory */
app.post('/api/memories', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const { key, value, category } = req.body;
    if (!key || !value) {
      return res.status(400).json({ success: false, error: 'key and value are required.' });
    }
    const memory = memoryManager.addMemory(userId, key, value, category);
    res.status(201).json({ success: true, data: memory });
  } catch (error) {
    console.error('POST /api/memories error:', error);
    res.status(500).json({ success: false, error: 'Failed to add memory.' });
  }
});

/** Delete a memory */
app.delete('/api/memories/:id', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const deleted = memoryManager.deleteMemory(userId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Memory not found.' });
    }
    res.json({ success: true, message: 'Memory deleted.' });
  } catch (error) {
    console.error(`DELETE /api/memories/${req.params.id} error:`, error);
    res.status(500).json({ success: false, error: 'Failed to delete memory.' });
  }
});

// ---------------------------------------------------------------------------
// REST API — Preferences
// ---------------------------------------------------------------------------

/** Get all preferences for the default user */
app.get('/api/preferences', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const preferences = preferencesEngine.getPreferences(userId);
    res.json({ success: true, data: preferences });
  } catch (error) {
    console.error('GET /api/preferences error:', error);
    res.status(500).json({ success: false, error: 'Failed to get preferences.' });
  }
});

/** Set a preference */
app.post('/api/preferences', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const { key, value, type, always } = req.body;
    if (!key || !value) {
      return res.status(400).json({ success: false, error: 'key and value are required.' });
    }
    const preference = preferencesEngine.setPreference(userId, key, value, type, always);
    res.status(201).json({ success: true, data: preference });
  } catch (error) {
    console.error('POST /api/preferences error:', error);
    res.status(500).json({ success: false, error: 'Failed to set preference.' });
  }
});

/** Delete a preference */
app.delete('/api/preferences/:key', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  try {
    const deleted = preferencesEngine.deletePreference(userId, req.params.key);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Preference not found.' });
    }
    res.json({ success: true, message: 'Preference deleted.' });
  } catch (error) {
    console.error(`DELETE /api/preferences/${req.params.key} error:`, error);
    res.status(500).json({ success: false, error: 'Failed to delete preference.' });
  }
});

// ---------------------------------------------------------------------------
// REST API — LLM Configuration
// ---------------------------------------------------------------------------

/** Update LLM provider configuration at runtime */
app.post('/api/config', (req, res) => {
  try {
    const { provider, apiKey, model } = req.body;
    llmClient.updateConfig(provider, apiKey, model);
    try {
      // FIX: use llmClient.getApiKey() so we don't save an empty string if the UI omitted it
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ provider, apiKey: llmClient.getApiKey(), model }, null, 2));
    } catch (e) {
      console.error('[Server] Failed to write local_config.json', e);
    }
    res.json({
      success: true,
      message: 'Configuration updated.',
      data: { provider: llmClient.provider, model: llmClient.getModel() },
    });
  } catch (error) {
    console.error('POST /api/config error:', error);
    res.status(500).json({ success: false, error: 'Failed to update configuration.' });
  }
});

/** Get current LLM provider configuration */
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: { provider: llmClient.provider, model: llmClient.getModel() },
  });
});

// ---------------------------------------------------------------------------
// REST API — File Upload & Voice Transcription (Stubs)
// ---------------------------------------------------------------------------

/** Route POST /api/upload */
app.post('/api/upload', (req, res) => {
  try {
    const { file, filename, type } = req.body;
    if (!file) {
      return res.status(400).json({ success: false, error: 'file is required.' });
    }
    if (file.length > 10 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: 'File size exceeds 10MB limit.' });
    }
    if (filename && filename.endsWith('.exe')) {
      return res.status(400).json({ success: false, error: 'Executable files are not allowed.' });
    }
    const fileId = uuidv4();
    stagedFiles.set(fileId, { file, filename: filename || 'unnamed', type: type || 'text/plain' });
    res.status(200).json({ success: true, fileId });
  } catch (error) {
    console.error('POST /api/upload error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload file.' });
  }
});

/** Route POST /api/transcribe */
app.post('/api/transcribe', async (req, res) => {
  try {
    let audioBuffer = null;
    let mimeType = 'audio/webm';

    if (req.body && req.body.audio) {
      audioBuffer = Buffer.from(req.body.audio, 'base64');
    } else {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)$/);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1];
        const boundaryBuffer = Buffer.from('--' + boundary);
        let start = buffer.indexOf(boundaryBuffer);
        if (start !== -1) {
          const nextStart = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
          if (nextStart !== -1) {
            const part = buffer.subarray(start + boundaryBuffer.length, nextStart);
            const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
            if (headerEnd !== -1) {
              const headers = part.subarray(0, headerEnd).toString();
              const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
              if (mimeMatch) {
                mimeType = mimeMatch[1].trim();
              }
              audioBuffer = part.subarray(headerEnd + 4, part.length - 2);
            }
          }
        }
      }
    }

    if (!audioBuffer) {
      return res.status(400).json({ success: false, error: 'audio is required.' });
    }

    if (process.env.OPENAI_API_KEY) {
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: mimeType });
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-1');
      
      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: formData
      });
      
      if (whisperRes.ok) {
        const data = await whisperRes.json();
        return res.status(200).json({ success: true, text: data.text });
      } else {
        const errorText = await whisperRes.text();
        console.error('Whisper API error:', errorText);
        return res.status(whisperRes.status).json({ success: false, error: 'Whisper transcription failed.' });
      }
    } else {
      return res.status(200).json({ success: true, text: 'Mocked voice transcription' });
    }
  } catch (error) {
    console.error('POST /api/transcribe error:', error);
    res.status(500).json({ success: false, error: 'Failed to transcribe audio.' });
  }
});

// ---------------------------------------------------------------------------
// RAG Upload Endpoint
// ---------------------------------------------------------------------------
app.post('/api/rag-upload', upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  const ext = req.file.originalname.split('.').pop().toLowerCase();
  let text = '';
  
  try {
    if (ext === 'pdf') {
      const pdfData = await pdfParse(req.file.buffer);
      text = pdfData.text;
    } else if (ext === 'txt' || ext === 'md') {
      text = req.file.buffer.toString('utf8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use .txt, .md, or .pdf' });
    }
    
    if (!text.trim()) {
      return res.status(400).json({ error: 'File is empty or could not extract text' });
    }
    
    // TEMPORARY: Log available models for this API key
    try {
      const apiKey = llmClient.getApiKey();
      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const listRes = await fetch(listUrl);
      const listData = await listRes.json();
      console.log('--- AVAILABLE MODELS ---');
      if (listData.models) {
        const embedModels = listData.models.filter(m => m.name.includes('embed'));
        console.log(embedModels.map(m => m.name));
      } else {
        console.log('ListModels response:', listData);
      }
      console.log('------------------------');
    } catch (e) {
      console.error('ListModels failed:', e);
    }
    const conversationId = req.body.conversationId;
    
    const { docId, numChunks } = await ragManager.processDocument(req.file.originalname, text, conversationId);
    res.json({ success: true, docId, chunks: numChunks, filename: req.file.originalname });
  } catch (err) {
    console.error('RAG Upload Error:', err);
    res.status(500).json({ error: 'Failed to process document' });
  }
});

// ---------------------------------------------------------------------------
// Fallback — serve index.html for SPA routing
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  const indexPath = join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).json({ error: 'Not found' });
    }
  });
});

// ---------------------------------------------------------------------------
// WebSocket Server
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[WS] Client connected from ${clientIp}`);

  ws.on('message', async (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON message.' }));
      return;
    }

    switch (data.type) {
      case 'chat':
        await handleChatMessage(ws, data);
        break;

      case 'config':
        handleConfigMessage(ws, data);
        break;

      case 'abort':
        if (ws.activeAbortController) {
          ws.activeAbortController.abort();
          console.log('[WS] Aborted active stream per user request');
          ws.send(JSON.stringify({ type: 'done' }));
        }
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${data.type}` }));
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client disconnected (${clientIp})`);
  });

  ws.on('error', (error) => {
    console.error(`[WS] Error (${clientIp}):`, error.message);
  });
});

// ---------------------------------------------------------------------------
// Chat message handler — the full SAJAN pipeline
// ---------------------------------------------------------------------------

/**
 * Full chat pipeline:
 * 1. Safety scan input
 * 2. Save user message
 * 3. Check if search needed
 * 4. Get relevant memories
 * 5. Get applicable preferences
 * 6. Build system prompt
 * 7. Stream LLM response
 * 8. Safety scan output
 * 9. Filter forbidden phrases
 * 10. Copyright check
 * 11. Save assistant response
 * 12. Extract memories from conversation
 * 13. Send completion
 */
function emitTrace(ws, type, label, detail, conversationId = null, messageId = null) {
  ws.send(JSON.stringify({
    type,
    label,
    detail,
    timestamp: new Date().toISOString(),
    messageId
  }));

  if (conversationId) {
    try {
      conversationManager.addTraceEvent(conversationId, messageId, type, label, detail);
    } catch (e) {
      console.error('[Server] Error saving trace event:', e);
    }
  }
}

async function handleChatMessage(ws, data) {
  const { conversationId, message, attachments, mode = 'medium' } = data;
  const userId = data.userId || 'default';

  if (!conversationId || (!message && (!attachments || !attachments.length))) {
    ws.send(JSON.stringify({ type: 'error', message: 'conversationId and message or attachments are required.' }));
    return;
  }

  let combinedMessage = message || '';
  if (attachments && Array.isArray(attachments)) {
    for (const fileId of attachments) {
      const stagedFile = stagedFiles.get(fileId);
      if (stagedFile) {
        const ext = stagedFile.filename.split('.').pop().toLowerCase();
        const isText = ['txt', 'md', 'csv'].includes(ext) || stagedFile.type === 'text';
        if (isText) {
          combinedMessage += `\n\n--- START OF FILE CONTENT ---\n${stagedFile.file}\n--- END OF FILE CONTENT ---`;
        } else {
          combinedMessage += `\n[Image: ${stagedFile.filename} (${stagedFile.file})]`;
        }
      }
    }
  }

  const sanitizedMessage = sanitizeInput(combinedMessage);

  // Extract image blocks from messages before scanning inputs (to prevent scanning base64 strings)
  const imageRegex = /\[Image:\s*([^(\n]+?)\s*\(([^)]+)\)\]/g;
  const messageForScanning = sanitizedMessage.replace(imageRegex, '[Image: $1]');

  // --- Step 1: Save user message ---
  const userMsg = conversationManager.addMessage(conversationId, 'user', sanitizedMessage);
  ws.send(JSON.stringify({ type: 'message_ack', messageId: userMsg.id }));

  // --- Step 2: Safety scan input ---
  const inputScan = safetyMiddleware.scanInput(messageForScanning, conversationId);
  emitTrace(ws, 'safety', 'Input Safety Scan', inputScan.safe ? 'Passed checks' : `Failed: ${inputScan.category}`, conversationId, userMsg.id);
  if (!inputScan.safe) {
    // Save the refusal as assistant message
    conversationManager.addMessage(conversationId, 'assistant', inputScan.refusalMessage);

    ws.send(JSON.stringify({
      type: 'safety_refusal',
      category: inputScan.category,
      action: inputScan.action,
      message: inputScan.refusalMessage,
    }));
    return;
  }

  // Generate title from first message if conversation is new
  const conversation = conversationManager.getConversation(conversationId, userId);
  if (conversation && conversation.messages.length === 1) {
    const title = conversationManager.generateTitle(messageForScanning);
    conversationManager.updateTitle(conversationId, title, userId);
    ws.send(JSON.stringify({ type: 'title_update', conversationId, title }));
  }

  // --- Step 2.5: Multi-agent Planner Routing ---
  let classification = 'direct';
  try {
    const hasAttachments = attachments && attachments.length > 0;
    const refersToFiles = /\b(file|files|document|documents|pdf|txt|md|csv|upload|uploaded|attachment|attachments|context|chunk|chunks)\b/i.test(messageForScanning);

    // Strong research/debugging cues should win over weak code-like punctuation.
    const researchRegex = /\b(why|how|what|when|where|which|explain|explain why|investigate|research|analyze|analyse|figure out|find out|look up|lookup|tell me about|give me|information|insight|insights|overview|detailed|summary|summarize|compare|comparison|difference|differences|trends|trend|data|statistics|facts|opinion|opinions|perspective|pros and cons|advantages|disadvantages|benefits|impact|effects|history|evolution|future|prediction|predictions|guide|tutorial|review|update|updates|related to|about)\b/i;

    // Temporal/search terms
    const searchRegex = /\b(news|new|current|weather|stock|stocks|president|election|today|now|yesterday|tomorrow|latest|recent|recentness|temperature|forecast|price|market|index|currency|exchange|crypto|bitcoin|who is|what is the price of|find out|search|lookup|todays|tech|technology|developments|happening|world|global|industry)\b/i;

    // Require explicit programming vocabulary or actual code structure.
    const codeKeywordRegex = /\b(function|class|const|let|var|import|require|return|public|private|protected|def|fn|print|console\.log|async|await|throw|catch|try|extends|implements|interface|python|javascript|typescript|js|ts|html|css|cpp|rust|golang|sql|json|yaml|xml|bash|sh|cmd)\b/i;
    const codeStructureRegex = /```|=>|\b\w+\s*\([^)]*\)\s*\{/;

    if (hasAttachments || refersToFiles) {
      classification = 'retrieval';
    } else if (researchRegex.test(messageForScanning) || searchRegex.test(messageForScanning)) {
      classification = 'research';
    } else if (codeKeywordRegex.test(messageForScanning) || codeStructureRegex.test(messageForScanning)) {
      classification = 'code';
    } else {
      classification = 'direct';
    }
    emitTrace(ws, 'plan', 'Agent Routing', `Classified request as: ${classification}`, conversationId, userMsg?.id);
  } catch (err) {
    console.error('Planner error:', err);
    emitTrace(ws, 'plan', 'Agent Routing', `Classification failed, defaulting to direct`, conversationId, userMsg?.id);
  }

  // --- Step 3: Search check ---
  let searchContext = '';
  // Only search if mode is high, OR if the planner classified it as research and mode is medium
  const shouldSearch = mode === 'high' ? true : (mode === 'low' ? false : (classification === 'research' || searchEngine.shouldSearch(messageForScanning)));
  
  if (shouldSearch) {
    ws.send(JSON.stringify({ type: 'status', message: 'Searching the web...' }));
    try {
      const query = searchEngine.optimizeQuery(messageForScanning);
      if (query) {
        emitTrace(ws, 'search', 'Web Search', `Executed query: "${query}"`, conversationId, userMsg?.id);
        const results = await searchEngine.search(query);
        searchContext = searchEngine.formatResults(results);
      }
    } catch (error) {
      console.error('Search error:', error.message);
      // Non-fatal: continue without search results
    }
  }

  // --- Step 4: Get relevant memories ---
  const memories = memoryManager.getRelevantMemories(userId, messageForScanning);
  if (memories.length > 0) {
    emitTrace(ws, 'memory', 'Memory Context', `Injected ${memories.length} relevant memories`, conversationId, userMsg?.id);
  }

  // --- Step 4.5: RAG Semantic Search ---
  let ragContext = '';
  if (classification === 'retrieval' || mode === 'high') {
    try {
      await new Promise(r => setTimeout(r, 400)); // Pacing delay
      const ragChunks = await ragManager.search(messageForScanning, 3, conversationId);
      if (ragChunks.length > 0) {
        const sourceList = ragChunks.map(c => `[source: chunk ${c.chunk_index} of ${c.filename}]`).join(', ');
        emitTrace(ws, 'retrieval', 'Document RAG', `Retrieved ${ragChunks.length} chunks from: ${sourceList}`, conversationId, userMsg?.id);
        
        ragContext = 'Use the following retrieved document chunks to answer the user if relevant:\n\n' + 
          ragChunks.map((c, i) => `--- Chunk ${c.chunk_index} from ${c.filename} ---\n${c.text}`).join('\n\n') +
          '\n\nIMPORTANT: When the model\'s answer draws on retrieved content, explicitly show which source chunk it came from in the response (e.g. "[source: chunk 3 of docs.pdf]").';
      }
    } catch (error) {
      console.error('RAG retrieval error:', error.message);
    }
  }

  // --- Step 5: Get applicable preferences ---
  const preferences = preferencesEngine.getApplicablePreferences(userId, messageForScanning);

  // --- Step 6: Build system prompt ---
  const isHighCaution = safetyMiddleware.isHighCaution(conversationId);
  let systemPrompt = buildSystemPrompt({
    memories,
    searchContext,
    preferences,
    isHighCaution,
    currentDate: getCurrentTimestamp(),
  });
  
  if (ragContext) {
    systemPrompt += '\n\n' + ragContext;
  }

  // Add specialized routing prompts
  switch (classification) {
    case 'code':
      systemPrompt += '\n\n[ROUTING] You are in CODE mode. Prioritize writing clean, well-documented, production-ready code. Explain your architectural choices clearly. Avoid lengthy preambles; get straight to the code.';
      break;
    case 'research':
      systemPrompt += '\n\n[ROUTING] You are in RESEARCH mode. Use the provided web search context extensively. Synthesize multiple sources, cross-reference claims, and cite facts carefully. Present a balanced overview.';
      break;
    case 'retrieval':
      systemPrompt += '\n\n[ROUTING] You are in RETRIEVAL mode. The user is asking about a specific document or context. Stick strictly to the provided document chunks. If the answer is not in the text, say so explicitly.';
      break;
    case 'direct':
    default:
      systemPrompt += '\n\n[ROUTING] You are in DIRECT mode. Engage naturally and conversationally. Answer concisely and directly without unnecessary formatting or padding.';
      break;
  }

  // --- Step 7: Build message history for LLM ---
  const conversationData = conversationManager.getConversation(conversationId, userId);
  const llmMessages = (conversationData?.messages || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  // --- Step 8: Stream LLM response ---
  let fullResponse = '';
  ws.send(JSON.stringify({ type: 'stream_start' }));

  // Emit route trace
  const activeModel = llmClient.getModel({ mode });
  emitTrace(ws, 'route', 'Intelligence Routing', `Routed to ${activeModel} (mode: ${mode})`, conversationId, userMsg?.id);

  // Pass mode to streamChat options
  const abortController = new AbortController();
  ws.activeAbortController = abortController;

  try {
    const streamOpts = { mode, signal: abortController.signal };
    if (classification === 'research') {
      streamOpts.enableGoogleSearch = true;
    }
    await new Promise(r => setTimeout(r, 400)); // Pacing delay
    
    // Dynamically constrain the thinking process based on mode to save tokens
    let modifiedSystemPrompt = systemPrompt;
    if (mode === 'low') {
      modifiedSystemPrompt += `\n\n[INSTRUCTION]: Answer directly. Do not output any internal thought process.`;
    } else if (mode === 'medium') {
      modifiedSystemPrompt += `\n\n[INSTRUCTION]: Think briefly (1 short stage/paragraph max) before answering to save tokens.`;
    } else if (mode === 'high') {
      modifiedSystemPrompt += `\n\n[INSTRUCTION]: You may think deeply (up to 2 or 3 stages) to fully reason about the complex request.`;
    }

    let fullThought = '';
    
    for await (const chunk of llmClient.streamChat(llmMessages, modifiedSystemPrompt, streamOpts)) {
      if (typeof chunk === 'string') {
        fullResponse += chunk;
        ws.send(JSON.stringify({ type: 'stream_chunk', content: chunk }));
      } else if (chunk && chunk.type === 'thinking') {
        fullThought += chunk.content;
      }
    }
    
    // Emit a single consolidated thinking trace at the end to prevent visual spam
    if (fullThought) {
      emitTrace(ws, 'thinking', 'Reasoning Trace', fullThought, conversationId, userMsg?.id);
    }

  } catch (error) {
    if (error.name === 'AbortError' || abortController.signal.aborted) {
      console.log('LLM stream aborted by user');
      ws.send(JSON.stringify({ type: 'stream_chunk', content: 'Stopped by user' }));
      fullResponse = 'Stopped by user';
    } else {
      console.error('LLM stream error:', error);
      const errMsg = 'I encountered an error generating a response. Please try again.';
      ws.send(JSON.stringify({ type: 'stream_chunk', content: errMsg }));
      fullResponse = errMsg;
    }
  } finally {
    if (ws.activeAbortController === abortController) {
      ws.activeAbortController = null;
    }
  }

  // --- Step 9: Safety scan output ---
  const outputScan = safetyMiddleware.scanOutput(fullResponse, conversationId);
  let finalResponse = outputScan.filteredResponse;

  // --- Step 10: Filter forbidden phrases ---
  finalResponse = memoryManager.filterForbiddenPhrases(finalResponse);

  // --- Step 11: Copyright check (log violations, don't block) ---
  const copyrightResult = copyrightGuard.enforceCompliance(finalResponse, conversationId);
  if (!copyrightResult.compliant) {
    console.warn(`[Copyright] Violations in conversation ${conversationId}:`, copyrightResult.violations);
  }

  // --- Step 12: Save assistant response ---
  const assistantMsg = conversationManager.addMessage(conversationId, 'assistant', finalResponse);

  // --- Step 13: Extract memories from conversation ---
  try {
    const allMessages = conversationData?.messages || [];
    const newMessages = allMessages.slice(-2); // Only scan recent messages
    memoryManager.extractMemoriesFromConversation(userId, newMessages);
  } catch (error) {
    console.error('Memory extraction error:', error.message);
  }

  // --- Step 14: Send completion ---
  ws.send(JSON.stringify({
    type: 'stream_end',
    fullResponse: finalResponse,
    conversationId,
    searchPerformed: searchContext.length > 0,
    userMessageId: userMsg ? userMsg.id : null,
    assistantMessageId: assistantMsg ? assistantMsg.id : null,
  }));

  // --- Step 15: Async Grounding Verification (Fire and Forget) ---
  const sourceMaterial = ragContext || searchContext;
  console.log(`[Verify check] Mode: ${mode}, Classification: ${classification}, Search Context length: ${searchContext.length}, Rag Context length: ${ragContext.length}`);
  
  // Skip verification if the response is an error/rate-limit message (don't waste tokens verifying error text)
  const isErrorResponse = finalResponse && (
    finalResponse.includes('⏳') || finalResponse.includes('⚠️') || finalResponse.includes('❌') || finalResponse.includes('🔑') ||
    finalResponse.includes('rate limit') || finalResponse.includes('Rate limit') ||
    finalResponse.includes('All rate limits exhausted') ||
    finalResponse.includes('Connection Error') ||
    finalResponse.includes('Stopped by user') ||
    finalResponse.includes('encountered an error')
  );

  // Skip verification for direct questions (as requested by user)
  if (classification === 'direct') {
    console.log(`[Verify skip] Skipping verification — direct questions do not need verification.`);
  } else if (mode !== 'low' && sourceMaterial && finalResponse && !isErrorResponse) {
    (async () => {
      try {
        const verificationPrompt = `Analyze the following SOURCE MATERIAL and the FINAL ANSWER.
Count how many distinct factual claims in the FINAL ANSWER are actually supported by the SOURCE MATERIAL.
Respond with ONLY one line in exactly this format, nothing else:
CLAIMS_SUPPORTED: X/Y
where X is the number of supported claims and Y is the total number of claims.

SOURCE MATERIAL:
${sourceMaterial}

FINAL ANSWER:
${finalResponse}`;
          
          let verifyResponse = '';
          await new Promise(r => setTimeout(r, 400)); // Pacing delay
          for await (const chunk of llmClient.streamChat([{ role: 'user', content: verificationPrompt }], 'You are a strict fact checker.', { mode: 'low' })) {
            if (typeof chunk === 'string') verifyResponse += chunk;
          }
          console.log(`[Verify LLM Output]: ${verifyResponse}`);
          const match = verifyResponse.match(/CLAIMS_SUPPORTED:\s*(\d+)\s*\/\s*(\d+)/i);
          if (match) {
            const supported = match[1];
            const total = match[2];
            emitTrace(ws, 'verify', 'VERIFY', `${supported}/${total} claims supported`, conversationId, userMsg?.id);
          } else {
            console.log('[Verify Regex] No match found in response.');
          }
      } catch (e) {
        console.error('[Verify Error]', e.message);
      }
    })();
  } else {
    if (isErrorResponse) {
      console.log(`[Verify skip] Skipping verification — response is an error message.`);
    } else {
      console.log(`[Verify skip] sourceMaterial or finalResponse was empty.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Config message handler
// ---------------------------------------------------------------------------

function handleConfigMessage(ws, data) {
  const { provider, apiKey, model } = data;
  llmClient.updateConfig(provider, apiKey, model);
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ provider, apiKey: llmClient.getApiKey(), model }, null, 2));
  } catch (e) {
    console.error('[Server] Failed to write local_config.json', e);
  }
  ws.send(JSON.stringify({
    type: 'config_updated',
    provider: llmClient.provider,
    model: llmClient.getModel(),
  }));
  console.log(`[Config] Provider updated to: ${llmClient.provider}, Model: ${llmClient.getModel()}`);
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || 'localhost';

// Wait for async database init before starting
async function startServer() {
  try {
    await conversationManager._ready;
    console.log('[Server] Database initialized.');
  } catch (err) {
    console.error('[Server] Database init failed:', err.message);
    process.exit(1);
  }

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════════════╗');
    console.log('  ║            SAJAN AI Agent v1.0.0              ║');
    console.log('  ║       Claude Fable 5 Inspired Backend         ║');
    console.log('  ╠═══════════════════════════════════════════════╣');
    console.log(`  ║  Server:    http://${HOST}:${PORT}              ║`);
    console.log(`  ║  Provider:  ${llmClient.provider.padEnd(33)}║`);
    console.log(`  ║  Model:     ${llmClient.getModel().padEnd(33)}║`);
    console.log('  ╚═══════════════════════════════════════════════╝');
    console.log('');
  });
}

startServer();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function gracefulShutdown(signal) {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

  // Close WebSocket connections
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });

  // Close the HTTP server
  server.close(() => {
    console.log('[Server] HTTP server closed.');

    // Close the database
    try {
      conversationManager.close();
      console.log('[Server] Database connection closed.');
    } catch (error) {
      console.error('[Server] Error closing database:', error.message);
    }

    // Save any pending data
    try {
      memoryManager.save();
      preferencesEngine.save();
      console.log('[Server] Data saved to disk.');
    } catch (error) {
      console.error('[Server] Error saving data:', error.message);
    }

    console.log('[Server] Goodbye! 👋');
    process.exit(0);
  });

  // Force exit after 5 seconds if graceful shutdown stalls
  setTimeout(() => {
    console.error('[Server] Forced exit after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});
