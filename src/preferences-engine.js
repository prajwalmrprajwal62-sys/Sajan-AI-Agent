/**
 * SAJAN — Preferences Engine
 * Manages user behavioural and contextual preferences with smart applicability
 * logic following Claude Fable 5 guidelines.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getCurrentTimestamp } from './utils.js';

export class PreferencesEngine {
  /**
   * @param {string} dataDir - Directory to store preferences.json
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = join(dataDir, 'preferences.json');

    /** @type {Map<string, Map<string, object>>} userId → (key → preference object) */
    this.preferences = new Map();

    // Domain keywords for matching behavioural preferences to user messages
    this.domainKeywords = {
      coding: [
        'code', 'coding', 'program', 'programming', 'script', 'function',
        'class', 'method', 'variable', 'debug', 'compile', 'build',
        'deploy', 'test', 'unit test', 'api', 'endpoint', 'server',
        'frontend', 'backend', 'database', 'query', 'framework', 'library',
        'git', 'commit', 'branch', 'merge', 'pull request', 'docker',
        'kubernetes', 'ci/cd', 'devops', 'algorithm', 'data structure',
      ],
      writing: [
        'write', 'writing', 'essay', 'article', 'blog', 'post', 'content',
        'story', 'narrative', 'draft', 'edit', 'proofread', 'grammar',
        'tone', 'style', 'paragraph', 'thesis', 'outline', 'copy',
        'headline', 'subtitle', 'manuscript', 'creative writing',
      ],
      math: [
        'math', 'mathematics', 'calculate', 'equation', 'formula', 'algebra',
        'geometry', 'calculus', 'statistics', 'probability', 'number',
        'graph', 'function', 'derivative', 'integral', 'proof', 'theorem',
      ],
      science: [
        'science', 'scientific', 'experiment', 'hypothesis', 'research',
        'physics', 'chemistry', 'biology', 'astronomy', 'geology',
        'molecule', 'atom', 'cell', 'organism', 'evolution', 'quantum',
      ],
      business: [
        'business', 'startup', 'company', 'revenue', 'profit', 'strategy',
        'marketing', 'sales', 'customer', 'client', 'meeting', 'proposal',
        'pitch', 'investor', 'funding', 'market', 'competition', 'brand',
      ],
      communication: [
        'email', 'message', 'letter', 'memo', 'presentation', 'speech',
        'pitch', 'respond', 'reply', 'draft', 'formal', 'informal',
        'professional', 'casual', 'slack', 'teams',
      ],
      learning: [
        'learn', 'study', 'explain', 'teach', 'tutorial', 'course',
        'beginner', 'intermediate', 'advanced', 'concept', 'understand',
        'example', 'practice', 'exercise', 'homework', 'assignment',
      ],
    };

    this.load();
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Set (create or update) a preference.
   * @param {string} userId
   * @param {string} key - Preference identifier (e.g. "code_style", "response_length").
   * @param {string} value - The preference value.
   * @param {'behavioral'|'contextual'} type
   * @param {boolean} [always=false] - If true, always apply regardless of context.
   * @returns {object} The preference object.
   */
  setPreference(userId, key, value, type = 'behavioral', always = false) {
    const validTypes = ['behavioral', 'contextual'];
    if (!validTypes.includes(type)) type = 'behavioral';

    if (!this.preferences.has(userId)) {
      this.preferences.set(userId, new Map());
    }

    const userPrefs = this.preferences.get(userId);
    const normalizedKey = key.toLowerCase().trim();

    const pref = {
      key: normalizedKey,
      value: value.trim(),
      type,
      always: Boolean(always),
      domain: this._inferDomain(normalizedKey, value),
      createdAt: userPrefs.has(normalizedKey)
        ? userPrefs.get(normalizedKey).createdAt
        : getCurrentTimestamp(),
      updatedAt: getCurrentTimestamp(),
    };

    userPrefs.set(normalizedKey, pref);
    this.save();
    return pref;
  }

  /**
   * Get all preferences for a user.
   * @param {string} userId
   * @returns {object[]}
   */
  getPreferences(userId) {
    const userPrefs = this.preferences.get(userId);
    if (!userPrefs) return [];
    return [...userPrefs.values()];
  }

  /**
   * Update a preference by key.
   * @param {string} userId
   * @param {string} key
   * @param {object} updates - Fields to merge.
   * @returns {object|null}
   */
  updatePreference(userId, key, updates) {
    const userPrefs = this.preferences.get(userId);
    if (!userPrefs) return null;

    const normalizedKey = key.toLowerCase().trim();
    const existing = userPrefs.get(normalizedKey);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...updates,
      key: normalizedKey, // keep key immutable
      updatedAt: getCurrentTimestamp(),
    };

    // Re-infer domain if value changed
    if (updates.value) {
      updated.domain = this._inferDomain(normalizedKey, updates.value);
    }

    userPrefs.set(normalizedKey, updated);
    this.save();
    return updated;
  }

  /**
   * Delete a preference by key.
   * @param {string} userId
   * @param {string} key
   * @returns {boolean}
   */
  deletePreference(userId, key) {
    const userPrefs = this.preferences.get(userId);
    if (!userPrefs) return false;

    const normalizedKey = key.toLowerCase().trim();
    const deleted = userPrefs.delete(normalizedKey);
    if (deleted) this.save();
    return deleted;
  }

  // ---------------------------------------------------------------------------
  // Applicability logic (Claude Fable 5 rules)
  // ---------------------------------------------------------------------------

  /**
   * Determine whether a preference should be applied given the current user message.
   *
   * Rules:
   * - If `preference.always` → always apply.
   * - Behavioral preferences: apply only if the user's task/domain matches.
   * - Contextual preferences: apply only if the message explicitly references
   *   the preference or requests personalisation.
   *
   * @param {object} preference
   * @param {string} userMessage
   * @returns {{ applies: boolean, reason: string }}
   */
  shouldApply(preference, userMessage) {
    if (!preference || !userMessage) {
      return { applies: false, reason: 'Missing preference or message.' };
    }

    const msg = userMessage.toLowerCase();

    // Always-apply overrides everything
    if (preference.always) {
      return { applies: true, reason: 'Preference is marked as always-apply.' };
    }

    // --- Behavioral preferences ---
    if (preference.type === 'behavioral') {
      // Check if the message domain matches the preference domain
      const domain = preference.domain;
      if (domain && this.domainKeywords[domain]) {
        const domainMatch = this.domainKeywords[domain].some((kw) =>
          msg.includes(kw.toLowerCase())
        );
        if (domainMatch) {
          return {
            applies: true,
            reason: `Message matches "${domain}" domain of this preference.`,
          };
        }
      }

      // Fallback: check if any keyword from the preference key/value appears in the message
      const prefWords = `${preference.key} ${preference.value}`
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const keywordMatch = prefWords.some((w) => msg.includes(w));

      if (keywordMatch) {
        return {
          applies: true,
          reason: 'Message contains keywords related to this preference.',
        };
      }

      return {
        applies: false,
        reason: 'Message does not match the domain or keywords of this behavioral preference.',
      };
    }

    // --- Contextual preferences ---
    if (preference.type === 'contextual') {
      // Check if the user explicitly references this preference
      const prefKey = preference.key.toLowerCase();
      const prefValue = preference.value.toLowerCase();

      if (msg.includes(prefKey) || msg.includes(prefValue.slice(0, 20))) {
        return {
          applies: true,
          reason: 'Message explicitly references this contextual preference.',
        };
      }

      // Check for personalisation requests
      const personalizationTriggers = [
        'based on what you know',
        'my preference',
        'my preferences',
        'personali',
        'tailor',
        'the way i like',
        'how i prefer',
        'remember my',
        'as i mentioned',
      ];

      if (personalizationTriggers.some((t) => msg.includes(t))) {
        return {
          applies: true,
          reason: 'Message contains a personalisation request.',
        };
      }

      return {
        applies: false,
        reason: 'Message does not reference this contextual preference or request personalisation.',
      };
    }

    return { applies: false, reason: 'Unknown preference type.' };
  }

  /**
   * Return only the preferences that are relevant to the current user message.
   * @param {string} userId
   * @param {string} userMessage
   * @returns {object[]} Applicable preferences.
   */
  getApplicablePreferences(userId, userMessage) {
    const allPrefs = this.getPreferences(userId);
    if (allPrefs.length === 0 || !userMessage) return [];

    return allPrefs.filter((pref) => {
      const { applies } = this.shouldApply(pref, userMessage);
      return applies;
    });
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /** Write preferences to disk as JSON. */
  save() {
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }

      const data = {};
      for (const [userId, prefsMap] of this.preferences) {
        data[userId] = Object.fromEntries(prefsMap);
      }

      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('PreferencesEngine save error:', error.message);
    }
  }

  /** Load preferences from disk. Creates file if it doesn't exist. */
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

      this.preferences.clear();
      for (const [userId, prefsObj] of Object.entries(data)) {
        const prefsMap = new Map();
        for (const [key, pref] of Object.entries(prefsObj)) {
          prefsMap.set(key, pref);
        }
        this.preferences.set(userId, prefsMap);
      }
    } catch (error) {
      console.error('PreferencesEngine load error:', error.message);
      this.preferences.clear();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Infer a domain from a preference key and value.
   * @private
   * @returns {string|null}
   */
  _inferDomain(key, value) {
    const combined = `${key} ${value}`.toLowerCase();

    for (const [domain, keywords] of Object.entries(this.domainKeywords)) {
      if (keywords.some((kw) => combined.includes(kw))) {
        return domain;
      }
    }

    return null;
  }
}
