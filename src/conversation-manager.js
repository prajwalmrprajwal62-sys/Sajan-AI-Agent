/**
 * SAJAN — Conversation Manager
 * SQLite-backed conversation and message persistence using sql.js (pure JS WASM).
 * Provides CRUD operations, search, and title generation.
 */

import initSqlJs from 'sql.js';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { generateId, getCurrentTimestamp } from './utils.js';

export class ConversationManager {
  /**
   * @param {string} dataDir - Directory to store sajan.db
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.dbPath = join(dataDir, 'sajan.db');
    this.db = null;
    this._ready = this._init();

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
  }

  /** @private — Initialize sql.js and load/create the database */
  async _init() {
    const SQL = await initSqlJs();

    if (existsSync(this.dbPath)) {
      const fileBuffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run('PRAGMA foreign_keys = ON;');
    this._createTables();
    this._save();
  }

  /** Ensure the database is ready before any operation */
  async _ensureReady() {
    if (!this.db) await this._ready;
  }

  /** @private — Save database to disk */
  _save() {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
  }

  // ---------------------------------------------------------------------------
  // Table creation
  // ---------------------------------------------------------------------------

  /** @private */
  _createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT 'New Conversation',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        user_id     TEXT NOT NULL DEFAULT 'default'
      )
    `);
    
    // Migration for existing tables
    try {
      this.db.run(`ALTER TABLE conversations ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`);
    } catch (e) {
      // Column exists
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role            TEXT NOT NULL,
        content         TEXT NOT NULL,
        timestamp       TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp
        ON messages(conversation_id, timestamp)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_conversations_updated
        ON conversations(updated_at)
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS trace_events (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        message_id      TEXT,
        event_type      TEXT NOT NULL,
        label           TEXT NOT NULL,
        detail          TEXT NOT NULL,
        timestamp       TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_trace_events_conversation
        ON trace_events(conversation_id)
    `);
  }

  /** @private — Helper to run a query and return result rows as objects */
  _queryAll(sql, params = []) {
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  /** @private — Helper to get a single row */
  _queryOne(sql, params = []) {
    const rows = this._queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  // ---------------------------------------------------------------------------
  // Conversation CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a new conversation.
   * @param {string} [title='New Conversation']
   * @returns {{ id: string, title: string, created_at: string, updated_at: string }}
   */
  createConversation(title = 'New Conversation', userId = 'default') {
    const now = getCurrentTimestamp();
    const conversation = {
      id: generateId(),
      title: title || 'New Conversation',
      created_at: now,
      updated_at: now,
      user_id: userId
    };

    this.db.run(
      'INSERT INTO conversations (id, title, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?)',
      [conversation.id, conversation.title, conversation.created_at, conversation.updated_at, conversation.user_id]
    );
    this._save();
    return conversation;
  }

  /**
   * Get a conversation by ID, including all its messages.
   * @param {string} id
   * @returns {{ id: string, title: string, created_at: string, updated_at: string, messages: object[] } | null}
   */
  getConversation(id, userId = 'default') {
    const conversation = this._queryOne(
      'SELECT * FROM conversations WHERE id = ? AND user_id = ?', [id, userId]
    );
    if (!conversation) return null;

    const messages = this._queryAll(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC', [id]
    );
    return { ...conversation, messages };
  }

  /**
   * List all conversations, sorted by most recently updated.
   * @returns {Array<{ id: string, title: string, created_at: string, updated_at: string }>}
   */
  listConversations(userId = 'default') {
    return this._queryAll('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC', [userId]);
  }

  /**
   * Delete a conversation and all its messages (cascade).
   * @param {string} id
   * @returns {boolean} True if a row was deleted.
   */
  deleteConversation(id, userId = 'default') {
    // Check ownership first
    const conv = this.getConversation(id, userId);
    if (!conv) return false;

    // Delete messages and traces first (sql.js cascade may not work reliably)
    this.db.run('DELETE FROM trace_events WHERE conversation_id = ?', [id]);
    this.db.run('DELETE FROM messages WHERE conversation_id = ?', [id]);
    this.db.run('DELETE FROM conversations WHERE id = ? AND user_id = ?', [id, userId]);
    const changes = this.db.getRowsModified();
    this._save();
    return changes > 0;
  }

  /**
   * Update the title of a conversation.
   * @param {string} id
   * @param {string} title
   * @returns {boolean}
   */
  updateTitle(id, title, userId = 'default') {
    this.db.run(
      'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [title, getCurrentTimestamp(), id, userId]
    );
    const changes = this.db.getRowsModified();
    this._save();
    return changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Message operations
  // ---------------------------------------------------------------------------

  /**
   * Add a message to a conversation.
   * @param {string} conversationId
   * @param {'user'|'assistant'|'system'} role
   * @param {string} content
   * @returns {{ id: string, conversation_id: string, role: string, content: string, timestamp: string }}
   */
  addMessage(conversationId, role, content) {
    const now = getCurrentTimestamp();
    const message = {
      id: generateId(),
      conversation_id: conversationId,
      role,
      content,
      timestamp: now,
    };

    this.db.run(
      'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
      [message.id, message.conversation_id, message.role, message.content, message.timestamp]
    );
    this.db.run(
      'UPDATE conversations SET updated_at = ? WHERE id = ?',
      [now, conversationId]
    );
    this._save();
    return message;
  }

  /**
   * Delete a user message and its subsequent assistant message.
   * @param {string} messageId - The user message ID
   * @param {string} [userId] - The user ID requesting deletion
   * @returns {boolean} True if the user message was found and deleted
   */
  deleteMessage(messageId, userId) {
    const userMsg = this._queryOne('SELECT * FROM messages WHERE id = ?', [messageId]);
    if (!userMsg) return false;

    // Check that the conversation belongs to the requested userId
    if (userId !== undefined) {
      const conv = this._queryOne('SELECT * FROM conversations WHERE id = ?', [userMsg.conversation_id]);
      if (!conv || conv.user_id !== userId) {
        return false;
      }
    }

    // Check that the target message's role is 'user'
    if (userMsg.role !== 'user') {
      return false;
    }

    // Find subsequent assistant message in the same conversation
    const assistantMsg = this._queryOne(
      'SELECT * FROM messages WHERE conversation_id = ? AND role = ? AND timestamp >= ? AND id != ? ORDER BY timestamp ASC LIMIT 1',
      [userMsg.conversation_id, 'assistant', userMsg.timestamp, messageId]
    );

    this.db.run('DELETE FROM messages WHERE id = ?', [messageId]);
    if (assistantMsg && assistantMsg.role === 'assistant') {
      this.db.run('DELETE FROM messages WHERE id = ?', [assistantMsg.id]);
    }
    
    this._save();
    return true;
  }

  /**
   * Add a trace event to a conversation.
   * @param {string} conversationId
   * @param {string|null} messageId
   * @param {string} eventType
   * @param {string} label
   * @param {string} detail
   * @returns {object} The created trace event object.
   */
  addTraceEvent(conversationId, messageId, eventType, label, detail) {
    const now = getCurrentTimestamp();
    const trace = {
      id: generateId(),
      conversation_id: conversationId,
      message_id: messageId || null,
      event_type: eventType,
      label,
      detail,
      timestamp: now
    };

    this.db.run(
      'INSERT INTO trace_events (id, conversation_id, message_id, event_type, label, detail, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [trace.id, trace.conversation_id, trace.message_id, trace.event_type, trace.label, trace.detail, trace.timestamp]
    );
    this._save();
    return trace;
  }

  /**
   * Get all trace events for a conversation, sorted by timestamp ASC.
   * @param {string} conversationId
   * @returns {object[]}
   */
  getTraceEvents(conversationId) {
    return this._queryAll(
      'SELECT * FROM trace_events WHERE conversation_id = ? ORDER BY timestamp ASC',
      [conversationId]
    );
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  /**
   * Search across all conversations' message content.
   * @param {string} query
   * @returns {object[]} Matching messages with conversation titles.
   */
  searchConversations(query, userId = 'default') {
    if (!query || typeof query !== 'string') return [];
    return this._queryAll(
      `SELECT m.*, c.title as conversation_title
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.content LIKE ? AND c.user_id = ?
       ORDER BY m.timestamp DESC
       LIMIT 50`,
      [`%${query}%`, userId]
    );
  }

  // ---------------------------------------------------------------------------
  // Title generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a conversation title from the first user message.
   * Takes the first 50 characters and cleans up.
   * @param {string} firstMessage
   * @returns {string}
   */
  generateTitle(firstMessage) {
    if (!firstMessage || typeof firstMessage !== 'string') {
      return 'New Conversation';
    }

    // Strip markdown formatting, code blocks, etc.
    let clean = firstMessage
      .replace(/```[\s\S]*?```/g, 'code snippet')
      .replace(/`[^`]+`/g, 'code')
      .replace(/[#*_~>]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (clean.length <= 50) {
      return clean || 'New Conversation';
    }

    // Truncate at word boundary
    let title = clean.slice(0, 50);
    const lastSpace = title.lastIndexOf(' ');
    if (lastSpace > 30) {
      title = title.slice(0, lastSpace);
    }

    return title.trimEnd() + '…';
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Close the database connection gracefully.
   */
  close() {
    try {
      if (this.db) {
        this._save();
        this.db.close();
        this.db = null;
      }
    } catch (error) {
      console.error('ConversationManager close error:', error.message);
    }
  }
}
