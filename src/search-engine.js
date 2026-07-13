/**
 * SAJAN — Search Engine
 * Implements smart search-decision logic aligned with Claude Fable 5 rules.
 * Uses DuckDuckGo Instant Answer API for privacy-respecting web lookups.
 */

export class SearchEngine {
  constructor() {
    // Patterns that SHOULD trigger a search (current/changing information)
    this.searchTriggers = [
      // Temporal markers
      /\b(?:current|currently|right now|at the moment|as of today)\b/i,
      /\b(?:latest|newest|most recent|breaking)\b/i,
      /\b(?:today|tonight|this week|this month|this year)\b/i,
      /\b(?:just (?:happened|released|announced|dropped|launched))\b/i,
      /\b(?:upcoming|soon|expected)\b/i,

      // People in positions (current status matters)
      /\bwho (?:is|are) (?:the )?(?:current|new|acting|interim)\b/i,
      /\bwho (?:is|are) (?:the )?(?:president|prime minister|ceo|cto|cfo|coo|chairman|director|governor|mayor|king|queen|pope|secretary)\b/i,
      /\bcurrent (?:president|pm|prime minister|ceo|leader|head|chairman|director)\b/i,

      // Sports results
      /\bwho won\b/i,
      /\bwho (?:is )?(?:winning|leading)\b/i,
      /\b(?:score|scores|results?)\b.*\b(?:game|match|tournament|series|cup)\b/i,
      /\b(?:world cup|super bowl|wimbledon|olympics?|world series)\b/i,
      /\b(?:standings|rankings|table|leaderboard)\b/i,

      // Financial & market data
      /\b(?:stock|share)\s*(?:price|value|market)\b/i,
      /\bmarket\s*(?:cap|value|update|close|open)\b/i,
      /\b(?:crypto|bitcoin|ethereum|btc|eth)\s*(?:price|value)\b/i,
      /\bexchange rate\b/i,
      /\b(?:nasdaq|dow jones|s&p|nyse|ftse)\b/i,

      // News & events
      /\b(?:election|voting)\s*(?:results?|polls?|update)\b/i,
      /\bnews\s+(?:about|on|regarding)\b/i,
      /\bbreaking news\b/i,
      /\btrending\b/i,

      // People status
      /\bdid .+ die\b/i,
      /\bis .+ (?:still )?alive\b/i,
      /\bis .+ (?:still )?(?:president|ceo|married|dating|pregnant|retired)\b/i,

      // Weather
      /\bweather\s+(?:in|for|today|tomorrow|forecast|this week)\b/i,

      // New releases (entertainment, tech)
      /\bnew (?:movie|film|show|series|season|game|album|song|book|phone|iphone|galaxy|pixel|release|update)\b/i,
      /\brelease(?:d|s)?\s*(?:date|when)\b/i,
      /\bwhen (?:does|will|is)\s+.+\s+(?:come out|release|launch|premiere|air|drop)\b/i,
    ];

    // Patterns that should NOT trigger a search (static knowledge)
    this.noSearchPatterns = [
      // Definitions and concepts
      /\bwhat (?:is|are) (?:a |an |the )?(?:definition|meaning|concept)\b/i,
      /\bdefine\b/i,
      /\bexplain (?:the )?(?:concept|theory|principle|difference)\b/i,

      // How-to (basic/timeless)
      /\bhow (?:to|do (?:you|i)) (?:write|code|program|calculate|solve|cook|bake|make a)\b/i,
      /\brecipe for\b/i,

      // Math & science formulas
      /\b(?:formula|equation|theorem)\s+(?:for|of)\b/i,
      /\bcalculate\b/i,
      /\bwhat is \d+\s*[+\-*/^]\s*\d+\b/,
      /\bpythagorean|quadratic|binomial|derivative|integral\b/i,

      // Historical facts (well-established)
      /\b(?:world war|ww[12]|civil war|cold war|revolution)\b/i,
      /\b(?:ancient|medieval|renaissance|victorian)\b/i,
      /\b(?:who (?:was|were)|when did)\b.*\b(?:born|die|invent|discover|found|write|compose|paint)\b/i,
      /\bin (?:what year|which year) (?:was|did|were)\b/i,

      // Well-known deceased people
      /\b(?:einstein|newton|shakespeare|mozart|beethoven|darwin|galileo|da vinci|plato|aristotle|socrates|caesar|napoleon|lincoln|gandhi|mlk|martin luther king)\b/i,

      // Programming basics
      /\b(?:what is|explain|how does)\s+(?:a |an )?(?:variable|function|class|object|array|loop|recursion|algorithm|data structure|api|rest|http|tcp|sql|html|css|javascript|python|java|regex)\b/i,
      /\bwrite\s+(?:a |an )?(?:function|program|script|class|method)\b/i,

      // Philosophy, grammar, general knowledge
      /\b(?:why (?:is|do|does) the sky|how does gravity|what causes)\b/i,
      /\b(?:grammar|synonym|antonym|plural|singular)\b/i,
    ];
  }

  // ---------------------------------------------------------------------------
  // Search decision
  // ---------------------------------------------------------------------------

  /**
   * Decide whether a user message should trigger a web search.
   * Follows Claude Fable 5 logic: search only for current/changing information,
   * not for static knowledge the model already has.
   *
   * @param {string} message - The user's message.
   * @returns {boolean} True if a search should be performed.
   */
  shouldSearch(message) {
    if (!message || typeof message !== 'string') return false;

    const lower = message.toLowerCase();

    // Very short messages or greetings — no search
    if (lower.length < 10) return false;
    if (/^(?:hi|hello|hey|yo|sup|greetings|good\s+(?:morning|afternoon|evening|night))[\s!.?]*$/i.test(lower)) {
      return false;
    }

    // Check no-search patterns first (they take priority for ambiguous cases)
    if (this.noSearchPatterns.some((p) => p.test(message))) {
      // But override if there's a strong temporal signal
      const hasStrongTemporal =
        /\b(?:today|right now|currently|latest|this week|breaking|just happened)\b/i.test(lower);
      if (!hasStrongTemporal) return false;
    }

    // Check search triggers
    return this.searchTriggers.some((p) => p.test(message));
  }

  // ---------------------------------------------------------------------------
  // Query optimisation
  // ---------------------------------------------------------------------------

  /**
   * Extract 1-6 meaningful content words from a user message for use as
   * a search query. Removes stop words, question scaffolding, and meta-words.
   *
   * @param {string} userMessage - The raw user message.
   * @returns {string} Optimised search query string.
   */
  optimizeQuery(userMessage) {
    if (!userMessage || typeof userMessage !== 'string') return '';

    const STOP_WORDS = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'must',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they',
      'him', 'her', 'its', 'them', 'his', 'hers', 'their', 'theirs',
      'this', 'that', 'these', 'those',
      'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
      'and', 'or', 'but', 'not', 'no', 'nor', 'so', 'yet', 'for',
      'in', 'on', 'at', 'to', 'of', 'by', 'with', 'from', 'up', 'about',
      'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'under', 'over', 'out', 'off', 'down', 'again',
      'tell', 'me', 'know', 'please', 'thanks', 'thank',
      'just', 'also', 'very', 'really', 'much', 'many', 'some', 'any',
      'right', 'now', 'still',
    ]);

    const words = userMessage
      .toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

    // Deduplicate, prefer longer words
    const unique = [...new Set(words)];
    unique.sort((a, b) => b.length - a.length);

    return unique.slice(0, 6).join(' ');
  }

  // ---------------------------------------------------------------------------
  // Search execution
  // ---------------------------------------------------------------------------

  /**
   * Perform a search via the DuckDuckGo Instant Answer API.
   *
   * @param {string} query - The search query.
   * @returns {Promise<{ query: string, results: Array<{ title: string, text: string, url: string }>, answer: string|null }>}
   */
  async search(query) {
    if (!query || typeof query !== 'string') {
      return { query: '', results: [], answer: null };
    }

    const encodedQuery = encodeURIComponent(query.trim());
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      });

      if (!response.ok) {
        console.error(`DuckDuckGo API error: ${response.status}`);
        return { query, results: [], answer: null };
      }

      const htmlText = await response.text();
      const results = [];
      
      const snippetRegex = /<a class="result__snippet[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
      let match;
      while ((match = snippetRegex.exec(htmlText)) !== null) {
        results.push({
          title: 'Search Result',
          url: match[1].replace('//duckduckgo.com/l/?uddg=', '').split('&')[0],
          text: match[2].replace(/<[^>]*>?/gm, '').trim()
        });
      }

      // Cap results at 5 for context window efficiency
      return { query, results: results.slice(0, 5), answer: null };
    } catch (error) {
      console.error('Search error:', error.message);
      return { query, results: [], answer: null };
    }
  }

  // ---------------------------------------------------------------------------
  // Result formatting
  // ---------------------------------------------------------------------------

  /**
   * Format search results into a context string suitable for injection into
   * the system prompt.
   *
   * @param {{ query: string, results: Array<{ title: string, text: string, url: string }>, answer: string|null }} searchData
   * @returns {string} Formatted context string.
   */
  formatResults(searchData) {
    if (!searchData) return '';

    const parts = [];

    parts.push(`[Web Search Results for "${searchData.query}"]`);

    if (searchData.answer) {
      parts.push(`Direct Answer: ${searchData.answer}`);
    }

    if (searchData.results.length === 0 && !searchData.answer) {
      parts.push('No relevant results found. Rely on your training knowledge and note any uncertainty about current information.');
      return parts.join('\n');
    }

    for (let i = 0; i < searchData.results.length; i++) {
      const r = searchData.results[i];
      parts.push(`\n[${i + 1}] ${r.title}`);
      parts.push(r.text);
      if (r.url) parts.push(`Source: ${r.url}`);
    }

    parts.push(
      '\nUse the above search results to inform your response. Synthesize the information naturally — do not list sources unless the user asks. If the results seem outdated or insufficient, say so honestly.'
    );

    return parts.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract a readable domain name from a URL.
   * @private
   */
  _extractDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return 'Related';
    }
  }
}
