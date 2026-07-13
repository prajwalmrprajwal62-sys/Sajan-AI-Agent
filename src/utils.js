/**
 * SAJAN — Shared Utility Functions
 * Provides common helpers used across the entire backend.
 */

import { randomUUID } from 'crypto';

/**
 * Generate a unique identifier using crypto.randomUUID().
 * @returns {string} A v4 UUID string.
 */
export function generateId() {
  return randomUUID();
}

/**
 * Get the current timestamp as an ISO-8601 string.
 * @returns {string} ISO timestamp (e.g. "2026-07-09T18:15:00.000Z").
 */
export function getCurrentTimestamp() {
  return new Date().toISOString();
}

/**
 * Sanitize user input by stripping HTML tags and escaping special characters.
 * @param {string} text - Raw user input.
 * @returns {string} Cleaned text safe for storage and rendering.
 */
export function sanitizeInput(text) {
  if (typeof text !== 'string') return '';

  // Strip all HTML tags
  let clean = text.replace(/<[^>]*>/g, '');

  // Escape special HTML characters
  clean = clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  // Collapse excessive whitespace but keep single newlines
  clean = clean.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return clean;
}

/**
 * Truncate text to a maximum length with an ellipsis. Attempts to break
 * at a word boundary so the output reads naturally.
 * @param {string} text - Text to truncate.
 * @param {number} [maxLength=100] - Maximum character count (including ellipsis).
 * @returns {string} Truncated text.
 */
export function truncateText(text, maxLength = 100) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLength) return text;

  // Leave room for the ellipsis character
  const limit = maxLength - 1;
  let truncated = text.slice(0, limit);

  // Try to break at the last space so we don't cut a word in half
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > limit * 0.6) {
    truncated = truncated.slice(0, lastSpace);
  }

  return truncated.trimEnd() + '…';
}

/**
 * Promise-based delay.
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract meaningful content keywords from a text string.
 * Removes stop words, punctuation, and returns 1-6 of the most
 * significant words for use in search queries.
 * @param {string} text - Input text (typically a user message).
 * @returns {string[]} Array of 1-6 significant keywords.
 */
export function extractKeywords(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return [];

  const STOP_WORDS = new Set([
    // Articles & determiners
    'the', 'a', 'an', 'this', 'that', 'these', 'those',
    // Pronouns
    'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours',
    'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
    'it', 'its', 'they', 'them', 'their', 'theirs', 'myself', 'yourself',
    // Conjunctions & prepositions
    'and', 'or', 'but', 'nor', 'for', 'yet', 'so',
    'in', 'on', 'at', 'to', 'from', 'by', 'with', 'of', 'up', 'out',
    'into', 'onto', 'upon', 'over', 'under', 'above', 'below', 'between',
    'through', 'during', 'before', 'after', 'about', 'around', 'against',
    'along', 'among', 'without', 'within',
    // Be-verbs & auxiliaries
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
    'has', 'have', 'had', 'having',
    'do', 'does', 'did', 'doing',
    'will', 'would', 'shall', 'should',
    'can', 'could', 'may', 'might', 'must',
    // Common verbs
    'get', 'got', 'let', 'make', 'go', 'went', 'gone',
    'say', 'said', 'tell', 'told', 'know', 'knew', 'known',
    'think', 'thought', 'see', 'saw', 'seen', 'come', 'came',
    'take', 'took', 'taken', 'give', 'gave', 'given',
    // Question words & relatives
    'what', 'how', 'when', 'where', 'who', 'whom', 'which', 'why',
    // Adverbs & misc
    'not', 'no', 'yes', 'very', 'just', 'also', 'too', 'really',
    'here', 'there', 'now', 'then', 'still', 'already', 'always', 'never',
    'often', 'sometimes', 'ever', 'only', 'even', 'much', 'more', 'most',
    'some', 'any', 'all', 'each', 'every', 'both', 'few', 'many',
    'such', 'own', 'other', 'another',
    // Meta-conversation words
    'discussed', 'conversation', 'yesterday', 'today', 'please', 'thanks',
    'thank', 'okay', 'ok', 'sure', 'well', 'like', 'right',
    'thing', 'things', 'something', 'anything', 'everything', 'nothing',
  ]);

  // Lowercase, strip punctuation (keep hyphens inside words), split on whitespace
  const words = text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))   // trim leading/trailing quotes & hyphens
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  // Deduplicate while preserving order
  const unique = [...new Set(words)];

  // Prefer longer words (they tend to be more meaningful)
  unique.sort((a, b) => b.length - a.length);

  return unique.slice(0, 6);
}

/**
 * Detect whether a user query is about current or rapidly-changing events
 * that would benefit from a live web search.
 * @param {string} text - The user's message.
 * @returns {boolean} True if the query likely requires up-to-date information.
 */
export function isCurrentEventQuery(text) {
  if (typeof text !== 'string') return false;

  const lower = text.toLowerCase();

  const CURRENT_EVENT_PATTERNS = [
    // Temporal markers
    /\b(?:right now|at the moment|currently|as of today|this week|this month|this year)\b/,
    /\btoday\b/,
    /\blatest\b/,
    /\brecent(?:ly)?\b/,
    /\bnew(?:est|ly)?\b/,
    /\bjust (?:happened|released|announced|dropped|launched)\b/,
    /\bbreaking (?:news|story)\b/,

    // "Who/what is the current ..."
    /\bwho (?:is|are) (?:the )?(?:current|new|acting|interim)\b/,
    /\bwho (?:is|are) (?:the )?(?:president|prime minister|ceo|cto|head|leader|chairman|director|secretary|governor|mayor)\b/,
    /\bcurrent (?:president|pm|prime minister|ceo|leader|head|chairman|director|secretary)\b/,

    // Sports & entertainment
    /\bwho won\b/,
    /\bwho (?:is )?(?:winning|leading)\b/,
    /\bscore(?:s)?\b/,
    /\belection (?:results|polls|update)\b/,
    /\bworld cup\b/i,
    /\bsuper bowl\b/i,
    /\boscars?\b/i,
    /\bgrammy\b/i,

    // Financial & markets
    /\bstock (?:price|market)\b/,
    /\bshare price\b/,
    /\bmarket (?:cap|value|update)\b/,
    /\bcrypto (?:price|market)\b/,
    /\bbitcoin (?:price|value)\b/,
    /\bexchange rate\b/,

    // People & events
    /\bdid .+ die\b/,
    /\bis .+ (?:still )?alive\b/,
    /\bis .+ (?:still )?(?:president|ceo|married|dating|pregnant)\b/,
    /\bweather (?:in|for|today|tomorrow|forecast)\b/,

    // Releases & launches
    /\bnew (?:movie|show|series|season|game|album|song|book|iphone|phone|release)\b/,
    /\bupcoming\b/,
    /\breleased?\b/,
    /\blaunch(?:ed|ing)?\b/,

    // Trending
    /\btrending\b/,
    /\bviral\b/,
    /\bpopular right now\b/,
  ];

  return CURRENT_EVENT_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * Convert a Date (or ISO string) into a human-friendly relative time string.
 * @param {Date|string} date - The date to convert.
 * @returns {string} Relative time string such as "just now", "5m ago", "2h ago".
 */
export function timeAgo(date) {
  const then = date instanceof Date ? date : new Date(date);
  if (isNaN(then.getTime())) return 'unknown';

  const now = Date.now();
  const diffMs = now - then.getTime();

  // Future dates
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 30) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  if (years === 1) return '1 year ago';
  return `${years} years ago`;
}
