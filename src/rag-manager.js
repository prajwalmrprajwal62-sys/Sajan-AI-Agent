/**
 * SAJAN — RAG Manager
 * Handles document upload, chunking, embedding, and semantic retrieval
 * using sql.js for persistence and Gemini for embeddings.
 */

import initSqlJs from 'sql.js';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { generateId } from './utils.js';

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Simple recursive character splitter (~500 tokens / ~2000 chars)
function chunkText(text, chunkSize = 2000, overlap = 200) {
  if (!text) return [];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = i + chunkSize;
    if (end < text.length) {
      // Try to find a natural break point (double newline, then newline, then space)
      let breakIndex = text.lastIndexOf('\n\n', end);
      if (breakIndex <= i) breakIndex = text.lastIndexOf('\n', end);
      if (breakIndex <= i) breakIndex = text.lastIndexOf(' ', end);
      if (breakIndex > i) {
        end = breakIndex;
      }
    }
    const chunkText = text.substring(i, end).trim();
    if (chunkText) {
      chunks.push(chunkText);
    }
    i = end - overlap;
    if (i <= 0) i = end; // Prevent infinite loop on small texts
    else if (i >= text.length) break;
  }
  return chunks;
}

export class RagManager {
  constructor(dataDir, llmClient) {
    this.dataDir = dataDir;
    this.dbPath = join(dataDir, 'sajan_rag.db');
    this.db = null;
    this.llmClient = llmClient;
    this._ready = this._init();

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
  }

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

  async _ensureReady() {
    if (!this.db) await this._ready;
  }

  _save() {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
  }

  _createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        conversation_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Add column if it doesn't exist (for existing DBs)
    try {
      this.db.run(`ALTER TABLE documents ADD COLUMN conversation_id TEXT;`);
    } catch(e) {}

    this.db.run(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        FOREIGN KEY (doc_id) REFERENCES documents (id) ON DELETE CASCADE
      );
    `);
  }

  /**
   * Process a document: chunk it, embed chunks, store in DB.
   */
  async processDocument(filename, text, conversationId = null) {
    await this._ensureReady();
    const docId = generateId();
    
    const chunks = chunkText(text);
    if (chunks.length === 0) return { docId, numChunks: 0 };

    // Get all embeddings at once in one single API request
    const embeddings = await this.llmClient.getEmbeddingsBatch(chunks);

    this.db.run('BEGIN TRANSACTION;');
    try {
      this.db.run('INSERT INTO documents (id, filename, conversation_id) VALUES (?, ?, ?)', [docId, filename, conversationId]);
      
      const stmt = this.db.prepare('INSERT INTO chunks (id, doc_id, chunk_index, text, embedding_json) VALUES (?, ?, ?, ?, ?)');
      
      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i];
        const embedding = embeddings[i];
        stmt.run([generateId(), docId, i, chunkContent, JSON.stringify(embedding)]);
      }
      stmt.free();
      this.db.run('COMMIT;');
      this._save();
      
      return { docId, numChunks: chunks.length };
    } catch (e) {
      this.db.run('ROLLBACK;');
      throw e;
    }
  }

  /**
   * Search for topK relevant chunks based on semantic similarity.
   */
  async search(query, topK = 3, conversationId = null) {
    await this._ensureReady();
    
    // Get query embedding
    const queryEmbedding = await this.llmClient.getEmbedding(query);
    
    // Fetch all chunks
    const chunks = [];
    
    let stmt;
    if (conversationId) {
      stmt = this.db.prepare(`
        SELECT c.id, c.text, c.embedding_json, d.filename, c.chunk_index
        FROM chunks c
        JOIN documents d ON c.doc_id = d.id
        WHERE d.conversation_id = ?
      `);
      stmt.bind([conversationId]);
    } else {
      stmt = this.db.prepare(`
        SELECT c.id, c.text, c.embedding_json, d.filename, c.chunk_index
        FROM chunks c
        JOIN documents d ON c.doc_id = d.id
      `);
    }
    
    while (stmt.step()) {
      const row = stmt.getAsObject();
      chunks.push({
        id: row.id,
        filename: row.filename,
        chunk_index: row.chunk_index,
        text: row.text,
        embedding: JSON.parse(row.embedding_json)
      });
    }
    stmt.free();

    if (chunks.length === 0) return [];

    // Calculate similarities
    for (const chunk of chunks) {
      chunk.similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
    }

    // Sort by descending similarity and pick topK
    chunks.sort((a, b) => b.similarity - a.similarity);
    
    // Filter out highly irrelevant chunks (optional threshold, e.g., > 0.4)
    const topChunks = chunks.slice(0, topK).filter(c => c.similarity > 0.4);
    
    return topChunks.map(c => ({
      filename: c.filename,
      chunk_index: c.chunk_index,
      text: c.text,
      similarity: c.similarity
    }));
  }
}
