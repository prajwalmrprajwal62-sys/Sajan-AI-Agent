/**
 * SAJAN — Memory Manager
 * Persistent memory system with JSON file storage. Handles user facts,
 * preferences, and contextual recall following Claude Fable 5 memory rules.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { generateId, getCurrentTimestamp } from './utils.js';

export class MemoryManager {
  /**
   * @param {string} dataDir - Directory to store memories.json
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = join(dataDir, 'memories.json');

    /** @type {Map<string, Array<object>>} userId → array of memory objects */
    this.memories = new Map();

    // Phrases that must never leak into output text
    this.forbiddenPhrases = [
      'I can see',
      'I see',
      'Looking at',
      'I notice',
      'I observe',
      'I detect',
      'According to',
      'It shows',
      'It indicates',
      'what I know about you',
      'your information',
      'your memories',
      'your data',
      'your profile',
      'Based on your memories',
      'Based on my memories',
      "Based on Claude's memories",
      'I remember',
      'I recall',
      'From memory',
      'My memories show',
      'In my memory',
      'According to my knowledge',
    ];

    // Greeting patterns (used to decide what memories to surface)
    this.greetingPatterns = [
      /^(?:hi|hello|hey|yo|sup|greetings|howdy|hiya|what'?s up)\b/i,
      /^good\s+(?:morning|afternoon|evening|night)\b/i,
      /^(?:namaste|bonjour|hola|ciao)\b/i,
    ];

    // Patterns requesting explicit personalisation
    this.personalizationPatterns = [
      /\bbased on (?:what you know|my (?:info|profile|preferences|history))\b/i,
      /\bpersonali[sz]e\b/i,
      /\btailor(?:ed)?\s+(?:to|for)\s+me\b/i,
      /\busing (?:what you know|my (?:info|data))\b/i,
      /\bremember(?:ed)?\s+(?:about|that)\s+me\b/i,
    ];

    // Technical-query indicators
    this.technicalPatterns = [
      /\b(?:code|coding|program(?:ming)?|debug(?:ging)?|compile|runtime|syntax)\b/i,
      /\b(?:python|javascript|typescript|java|rust|go|c\+\+|sql|html|css|react|node|docker)\b/i,
      /\b(?:algorithm|data structure|api|rest|graphql|database|server|deploy)\b/i,
      /\b(?:machine learning|deep learning|neural network|nlp|ai|ml)\b/i,
      /\b(?:git|github|ci\/cd|devops|kubernetes|aws|azure|gcp)\b/i,
    ];

    this.load();
  }

  // ---------------------------------------------------------------------------
  // CRUD operations
  // ---------------------------------------------------------------------------

  /**
   * Add a new memory for a user.
   * @param {string} userId
   * @param {string} key - Short label (e.g. "name", "favourite_language").
   * @param {string} value - The memory content.
   * @param {'personal'|'professional'|'preference'|'sensitive'} category
   * @returns {object} The created memory object.
   */
  addMemory(userId, key, value, category = 'personal') {
    const validCategories = ['personal', 'professional', 'preference', 'sensitive'];
    if (!validCategories.includes(category)) category = 'personal';

    if (!this.memories.has(userId)) {
      this.memories.set(userId, []);
    }

    const memory = {
      id: generateId(),
      key: key.toLowerCase().trim(),
      value: value.trim(),
      category,
      createdAt: getCurrentTimestamp(),
      updatedAt: getCurrentTimestamp(),
    };

    // Upsert: if a memory with the same key already exists, update it
    const userMemories = this.memories.get(userId);
    const existingIndex = userMemories.findIndex(
      (m) => m.key === memory.key && m.category === memory.category
    );

    if (existingIndex !== -1) {
      userMemories[existingIndex] = {
        ...userMemories[existingIndex],
        value: memory.value,
        updatedAt: memory.updatedAt,
      };
      this.save();
      return userMemories[existingIndex];
    }

    userMemories.push(memory);
    this.save();
    return memory;
  }

  /**
   * Get all memories for a user.
   * @param {string} userId
   * @returns {object[]}
   */
  getMemories(userId) {
    return this.memories.get(userId) || [];
  }

  /**
   * Update an existing memory by ID.
   * @param {string} userId
   * @param {string} memoryId
   * @param {object} updates - Fields to merge.
   * @returns {object|null} Updated memory or null if not found.
   */
  updateMemory(userId, memoryId, updates) {
    const userMemories = this.memories.get(userId);
    if (!userMemories) return null;

    const index = userMemories.findIndex((m) => m.id === memoryId);
    if (index === -1) return null;

    userMemories[index] = {
      ...userMemories[index],
      ...updates,
      updatedAt: getCurrentTimestamp(),
    };

    this.save();
    return userMemories[index];
  }

  /**
   * Delete a memory by ID.
   * @param {string} userId
   * @param {string} memoryId
   * @returns {boolean} True if deleted.
   */
  deleteMemory(userId, memoryId) {
    const userMemories = this.memories.get(userId);
    if (!userMemories) return false;

    const index = userMemories.findIndex((m) => m.id === memoryId);
    if (index === -1) return false;

    userMemories.splice(index, 1);
    this.save();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Search & relevance
  // ---------------------------------------------------------------------------

  /**
   * Basic keyword search across a user's memories.
   * @param {string} userId
   * @param {string} query
   * @returns {object[]} Matching memories.
   */
  searchMemories(userId, query) {
    const userMemories = this.memories.get(userId);
    if (!userMemories || !query) return [];

    const lowerQuery = query.toLowerCase();
    const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 1);

    return userMemories.filter((m) => {
      const text = `${m.key} ${m.value}`.toLowerCase();
      return queryWords.some((w) => text.includes(w));
    });
  }

  /**
   * Retrieve memories relevant to a user message, following Claude Fable 5
   * memory-surfacing rules.
   *
   * Rules:
   * - Greeting → only return the user's name (if known).
   * - Explicit personalisation request → return all non-sensitive memories.
   * - Technical query → return expertise-level memory only.
   * - Generic question → return nothing.
   * - NEVER return sensitive memories unless user explicitly mentioned the topic.
   *
   * @param {string} userId
   * @param {string} userMessage
   * @returns {object[]}
   */
  getRelevantMemories(userId, userMessage) {
    const userMemories = this.memories.get(userId);
    if (!userMemories || userMemories.length === 0) return [];

    const msg = (userMessage || '').trim();
    if (!msg) return [];

    // 1) Greeting → only name
    if (this.greetingPatterns.some((p) => p.test(msg))) {
      const nameMem = userMemories.find(
        (m) => m.key === 'name' && m.category !== 'sensitive'
      );
      return nameMem ? [nameMem] : [];
    }

    // 2) Explicit personalisation → all non-sensitive
    if (this.personalizationPatterns.some((p) => p.test(msg))) {
      return userMemories.filter((m) => m.category !== 'sensitive');
    }

    // 3) Technical query → expertise level only
    if (this.technicalPatterns.some((p) => p.test(msg))) {
      const expertiseMems = userMemories.filter(
        (m) =>
          m.category === 'professional' ||
          m.key.includes('expertise') ||
          m.key.includes('skill') ||
          m.key.includes('experience') ||
          m.key.includes('language') ||
          m.key.includes('framework') ||
          m.key.includes('stack')
      );
      return expertiseMems.filter((m) => m.category !== 'sensitive');
    }

    // 4) Check if the user explicitly mentions a sensitive topic
    const lowerMsg = msg.toLowerCase();
    const mentionedSensitive = userMemories.filter(
      (m) =>
        m.category === 'sensitive' &&
        (lowerMsg.includes(m.key.toLowerCase()) ||
          lowerMsg.includes(m.value.toLowerCase().slice(0, 20)))
    );

    // 5) Check for topic-relevant non-sensitive memories
    const msgWords = lowerMsg.split(/\s+/).filter((w) => w.length > 2);
    const relevant = userMemories.filter((m) => {
      if (m.category === 'sensitive') return false;
      const memText = `${m.key} ${m.value}`.toLowerCase();
      return msgWords.some((w) => memText.includes(w));
    });

    // If no specific relevance found, return empty (generic question rule)
    if (relevant.length === 0 && mentionedSensitive.length === 0) {
      return [];
    }

    return [...relevant, ...mentionedSensitive];
  }

  // ---------------------------------------------------------------------------
  // Forbidden-phrase filtering
  // ---------------------------------------------------------------------------

  /**
   * Remove all forbidden memory-related phrases from text.
   * @param {string} text
   * @returns {string} Cleaned text.
   */
  filterForbiddenPhrases(text) {
    if (!text || typeof text !== 'string') return text;

    let filtered = text;

    for (const phrase of this.forbiddenPhrases) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      filtered = filtered.replace(regex, '');
    }

    // Clean up artefacts but preserve newlines
    filtered = filtered
      .replace(/^[ \t]*[,.:;][ \t]*/gm, '')
      .trim();

    return filtered;
  }

  // ---------------------------------------------------------------------------
  // Conversation extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract factual information about the user from conversation messages
   * and store as memories. Looks for introductions, preferences, and
   * professional details.
   *
   * @param {string} userId
   * @param {Array<{role: string, content: string}>} messages
   * @returns {object[]} Newly created memories.
   */
  extractMemoriesFromConversation(userId, messages) {
    const created = [];
    if (!messages || !Array.isArray(messages)) return created;

    // Only scan user messages
    const userMessages = messages.filter((m) => m.role === 'user');

    for (const msg of userMessages) {
      const content = msg.content || '';
      const lower = content.toLowerCase();

      // Name extraction: "my name is X", "I'm X", "call me X"
      const namePatterns = [
        /(?:my name is|i'?m|i am|call me|this is|they call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
        /^(?:hi|hello|hey),?\s+i'?m\s+([A-Z][a-z]+)/i,
      ];
      for (const pat of namePatterns) {
        const match = content.match(pat);
        if (match && match[1] && match[1].length > 1 && match[1].length < 30) {
          const mem = this.addMemory(userId, 'name', match[1].trim(), 'personal');
          created.push(mem);
          break;
        }
      }

      // Location: "I live in X", "I'm from X", "I'm based in X"
      const locationPatterns = [
        /(?:i (?:live|reside|stay) in|i'?m (?:from|based in|located in))\s+([A-Z][a-zA-Z\s,]+?)(?:\.|,|!|\?|$)/i,
      ];
      for (const pat of locationPatterns) {
        const match = content.match(pat);
        if (match && match[1] && match[1].trim().length > 1) {
          const loc = match[1].trim().replace(/[.,!?]+$/, '');
          if (loc.length < 50) {
            const mem = this.addMemory(userId, 'location', loc, 'personal');
            created.push(mem);
          }
          break;
        }
      }

      // Profession: "I'm a/an X", "I work as a/an X", "my job is X"
      const professionPatterns = [
        /(?:i(?:'m| am) an?\s+)([\w\s]+?)(?:\s+(?:at|in|for|and|who|that|,|\.|$))/i,
        /(?:i work as an?\s+)([\w\s]+?)(?:\s+(?:at|in|for|and|,|\.|$))/i,
        /(?:my (?:job|profession|role|title|position) is\s+)([\w\s]+?)(?:\s+(?:at|in|for|and|,|\.|$))/i,
      ];
      for (const pat of professionPatterns) {
        const match = content.match(pat);
        if (match && match[1]) {
          const prof = match[1].trim();
          // Filter out non-profession matches
          const nonProfessions = ['not', 'also', 'just', 'here', 'going', 'trying', 'looking', 'having', 'doing', 'making'];
          if (prof.length > 2 && prof.length < 40 && !nonProfessions.includes(prof.toLowerCase())) {
            const mem = this.addMemory(userId, 'profession', prof, 'professional');
            created.push(mem);
          }
          break;
        }
      }

      // Preferences: "I prefer X", "I like X", "my favourite X is Y"
      const prefPatterns = [
        /(?:i (?:prefer|like|love|enjoy|use|always use))\s+(.+?)(?:\s+(?:because|since|as|over|instead|\.|,|!|$))/i,
        /(?:my fav(?:ou?rite)?\s+(\w+)\s+is)\s+(.+?)(?:\s*[\.,!?]|$)/i,
      ];
      for (const pat of prefPatterns) {
        const match = content.match(pat);
        if (match) {
          if (match[2]) {
            // "my favourite X is Y" pattern
            const key = `favourite_${match[1].toLowerCase().trim()}`;
            const value = match[2].trim().replace(/[.,!?]+$/, '');
            if (value.length > 0 && value.length < 100) {
              const mem = this.addMemory(userId, key, value, 'preference');
              created.push(mem);
            }
          } else if (match[1]) {
            const pref = match[1].trim().replace(/[.,!?]+$/, '');
            if (pref.length > 1 && pref.length < 100) {
              const mem = this.addMemory(userId, 'preference', pref, 'preference');
              created.push(mem);
            }
          }
          break;
        }
      }

      // Programming languages / frameworks: "I code in X", "I use X"
      const techPatterns = [
        /(?:i (?:code|program|develop|work) (?:in|with))\s+([\w\s,+#]+?)(?:\s*[\.,!?]|$)/i,
        /(?:i (?:mainly |mostly )?use)\s+([\w\s,+#]+?)\s+(?:for|at|in|to|and|\.|,|$)/i,
      ];
      for (const pat of techPatterns) {
        const match = content.match(pat);
        if (match && match[1]) {
          const tech = match[1].trim().replace(/[.,!?]+$/, '');
          if (tech.length > 0 && tech.length < 80) {
            const mem = this.addMemory(userId, 'tech_stack', tech, 'professional');
            created.push(mem);
          }
          break;
        }
      }

      // Sensitive: health-related disclosures
      const sensitivePatterns = [
        /(?:i (?:have|was diagnosed with|suffer from|struggle with|deal with))\s+(.+?)(?:\s*[\.,!?]|$)/i,
      ];
      for (const pat of sensitivePatterns) {
        const match = content.match(pat);
        if (match && match[1]) {
          const topic = match[1].trim().replace(/[.,!?]+$/, '');
          const healthKeywords = ['anxiety', 'depression', 'adhd', 'ptsd', 'bipolar', 'autism', 'diabetes', 'cancer', 'asthma', 'allergy', 'chronic', 'disability', 'disorder'];
          if (healthKeywords.some((k) => topic.toLowerCase().includes(k)) && topic.length < 80) {
            const mem = this.addMemory(userId, 'health_info', topic, 'sensitive');
            created.push(mem);
          }
          break;
        }
      }
    }

    return created;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /** Write all memories to disk as JSON. */
  save() {
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }

      const data = {};
      for (const [userId, mems] of this.memories) {
        data[userId] = mems;
      }

      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('MemoryManager save error:', error.message);
    }
  }

  /** Load memories from disk. Creates file if it doesn't exist. */
  load() {
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }

      if (!existsSync(this.filePath)) {
        writeFileSync(this.filePath, '{}', 'utf-8');
        return;
      }

      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw || '{}');

      this.memories.clear();
      for (const [userId, mems] of Object.entries(data)) {
        if (Array.isArray(mems)) {
          this.memories.set(userId, mems);
        }
      }
    } catch (error) {
      console.error('MemoryManager load error:', error.message);
      this.memories.clear();
    }
  }
}
