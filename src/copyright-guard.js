/**
 * SAJAN — Copyright Guard
 * Enforces copyright compliance by tracking source quotes, detecting
 * excessive quoting, scanning for lyrics/poetry, and ensuring fair-use limits.
 */

export class CopyrightGuard {
  constructor() {
    /**
     * Per-conversation tracking of which sources have already been quoted.
     * @type {Map<string, Set<string>>}
     */
    this.sourceQuotes = new Map();
  }

  // ---------------------------------------------------------------------------
  // Quote-length check
  // ---------------------------------------------------------------------------

  /**
   * Scan text for quoted passages (text enclosed in quotation marks) and flag
   * any that exceed 15 words — the fair-use boundary we enforce.
   *
   * @param {string} text - The text to scan.
   * @returns {{ hasViolations: boolean, violations: Array<{ quote: string, wordCount: number }> }}
   */
  checkQuoteLength(text) {
    if (!text || typeof text !== 'string') {
      return { hasViolations: false, violations: [] };
    }

    const violations = [];

    // Match text inside double quotes, smart quotes, or guillemets
    const quotePatterns = [
      /"([^"]+)"/g,        // straight double quotes
      /\u201C([^\u201D]+)\u201D/g, // smart double quotes " "
      /\u00AB([^\u00BB]+)\u00BB/g, // guillemets « »
      /'([^']{40,})'/g,    // single quotes — only flag long ones to avoid false positives
    ];

    for (const pattern of quotePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const quote = match[1].trim();
        const wordCount = quote.split(/\s+/).filter(Boolean).length;
        if (wordCount > 15) {
          violations.push({ quote, wordCount });
        }
      }
    }

    return {
      hasViolations: violations.length > 0,
      violations,
    };
  }

  // ---------------------------------------------------------------------------
  // Source-quote tracking
  // ---------------------------------------------------------------------------

  /**
   * Track that a quote has been used from a specific source within a conversation.
   * Returns false (and does NOT add) if the source has already been quoted in
   * this conversation — enforcing a one-quote-per-source limit.
   *
   * @param {string} conversationId - The conversation identifier.
   * @param {string} source - The source name / URL / identifier.
   * @returns {boolean} True if the quote was recorded; false if the source was already quoted.
   */
  trackSourceQuote(conversationId, source) {
    if (!conversationId || !source) return false;

    const normalizedSource = source.toLowerCase().trim();

    if (!this.sourceQuotes.has(conversationId)) {
      this.sourceQuotes.set(conversationId, new Set());
    }

    const sources = this.sourceQuotes.get(conversationId);
    if (sources.has(normalizedSource)) {
      return false; // Already quoted from this source
    }

    sources.add(normalizedSource);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Lyrics / poetry detection
  // ---------------------------------------------------------------------------

  /**
   * Detect whether text appears to contain song lyrics or poetry by analysing
   * structural cues: short lines, rhyming endings, verse-like grouping,
   * and common lyric markers.
   *
   * @param {string} text - The text to scan.
   * @returns {{ isLikelyLyrics: boolean, confidence: number, reasons: string[] }}
   */
  scanForLyrics(text) {
    if (!text || typeof text !== 'string') {
      return { isLikelyLyrics: false, confidence: 0, reasons: [] };
    }

    const reasons = [];
    let score = 0;

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    // --- Structural heuristics ---

    // Short lines (lyrics/poetry tend to be short)
    if (lines.length >= 4) {
      const avgLength = lines.reduce((s, l) => s + l.length, 0) / lines.length;
      if (avgLength < 50) {
        score += 2;
        reasons.push('Short average line length (typical of verse)');
      }
    }

    // Repeated lines or refrains (choruses)
    const lineCounts = new Map();
    for (const line of lines) {
      const lower = line.toLowerCase().replace(/[^\w\s]/g, '');
      lineCounts.set(lower, (lineCounts.get(lower) || 0) + 1);
    }
    const repeatedLines = [...lineCounts.values()].filter((c) => c >= 2).length;
    if (repeatedLines >= 2) {
      score += 3;
      reasons.push('Multiple repeated lines (chorus/refrain pattern)');
    }

    // Rhyming endings (check last word of consecutive or alternating lines)
    const endWords = lines
      .map((l) => {
        const words = l.replace(/[^\w\s]/g, '').split(/\s+/);
        return words[words.length - 1]?.toLowerCase() || '';
      })
      .filter(Boolean);

    let rhymeCount = 0;
    for (let i = 0; i < endWords.length - 1; i++) {
      // Consecutive rhyme (AA)
      if (this._roughRhyme(endWords[i], endWords[i + 1])) {
        rhymeCount++;
      }
      // Alternate rhyme (ABAB)
      if (i + 2 < endWords.length && this._roughRhyme(endWords[i], endWords[i + 2])) {
        rhymeCount++;
      }
    }
    if (rhymeCount >= 3) {
      score += 3;
      reasons.push('Significant rhyming pattern detected');
    } else if (rhymeCount >= 1) {
      score += 1;
      reasons.push('Some rhyming detected');
    }

    // Verse/stanza grouping (blank-line separated blocks)
    const stanzas = text.split(/\n\s*\n/).filter((s) => s.trim().length > 0);
    if (stanzas.length >= 2 && stanzas.length <= 8) {
      const stanzaLineCounts = stanzas.map(
        (s) => s.split('\n').filter((l) => l.trim()).length
      );
      const consistent =
        stanzaLineCounts.length >= 2 &&
        stanzaLineCounts.every((c) => Math.abs(c - stanzaLineCounts[0]) <= 1);
      if (consistent) {
        score += 2;
        reasons.push('Consistent stanza structure');
      }
    }

    // Lyric markers
    const lyricMarkers = [
      /\b(?:verse|chorus|bridge|refrain|hook|outro|intro)\s*[:)(\d]/i,
      /\[(?:verse|chorus|bridge|refrain|hook|outro|intro)/i,
      /\bla\s+la\s+la\b/i,
      /\boh+\b/i,
      /\bna\s+na\s+na\b/i,
    ];
    if (lyricMarkers.some((p) => p.test(text))) {
      score += 3;
      reasons.push('Contains explicit lyric markers');
    }

    const confidence = Math.min(score / 10, 1);
    return {
      isLikelyLyrics: confidence >= 0.4,
      confidence: Math.round(confidence * 100) / 100,
      reasons,
    };
  }

  // ---------------------------------------------------------------------------
  // Full compliance check
  // ---------------------------------------------------------------------------

  /**
   * Run all copyright checks on a piece of text and return a unified result.
   *
   * @param {string} text - The text to audit.
   * @param {string} conversationId - Current conversation identifier.
   * @returns {{ compliant: boolean, violations: string[], suggestions: string[] }}
   */
  enforceCompliance(text, conversationId) {
    const violations = [];
    const suggestions = [];

    // Quote-length check
    const quoteResult = this.checkQuoteLength(text);
    if (quoteResult.hasViolations) {
      for (const v of quoteResult.violations) {
        violations.push(
          `Quoted passage of ${v.wordCount} words exceeds the 15-word fair-use limit.`
        );
      }
      suggestions.push(
        'Paraphrase quoted passages or reduce them to 15 words or fewer.',
        'Consider summarising the source material in your own words instead.'
      );
    }

    // Lyrics / poetry detection
    const lyricsResult = this.scanForLyrics(text);
    if (lyricsResult.isLikelyLyrics) {
      violations.push(
        `Text appears to contain song lyrics or poetry (confidence: ${(lyricsResult.confidence * 100).toFixed(0)}%).`
      );
      suggestions.push(
        'Instead of reproducing lyrics, describe the song\'s themes or provide a brief (1-2 line) excerpt.',
        'Link to a licensed lyrics service like Genius or AZLyrics for the full text.'
      );
    }

    return {
      compliant: violations.length === 0,
      violations,
      suggestions,
    };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Reset all tracking state for a conversation (e.g. when conversation ends).
   * @param {string} conversationId
   */
  reset(conversationId) {
    this.sourceQuotes.delete(conversationId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Rough phonetic rhyme check — compares the last 2-3 characters of each word.
   * Not a full phonetic engine, but good enough for heuristic detection.
   * @private
   */
  _roughRhyme(wordA, wordB) {
    if (!wordA || !wordB || wordA === wordB) return false;
    if (wordA.length < 2 || wordB.length < 2) return false;

    // Compare last 3 characters (or last 2 if words are short)
    const suffixLen = Math.min(3, Math.min(wordA.length, wordB.length));
    const suffA = wordA.slice(-suffixLen);
    const suffB = wordB.slice(-suffixLen);

    if (suffA === suffB) return true;

    // Fallback: last 2 characters
    if (wordA.slice(-2) === wordB.slice(-2)) return true;

    return false;
  }
}
