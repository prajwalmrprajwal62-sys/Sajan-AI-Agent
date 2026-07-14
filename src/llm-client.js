/**
 * SAJAN — Multi-Provider LLM Client
 * Supports OpenAI, Anthropic, and Google Gemini with streaming responses.
 * Uses native fetch (Node 18+) — no third-party HTTP libraries needed.
 *
 * Features:
 * - Automatic retry with exponential backoff for 429 (rate limit) errors
 * - Fallback model support for Google (gemini-3.5-flash → gemini-3.1-flash)
 * - Human-readable error messages instead of raw JSON dumps
 */

import { config } from 'dotenv';
config();

/**
 * Parse a message content string containing potential [Image: name (base64)] blocks
 * into an array of text and image descriptor objects.
 */
function parseContent(content) {
  if (typeof content !== 'string') return [];
  
  const results = [];
  const imageRegex = /\[Image:\s*([^(\n]+?)\s*\(([^)]+)\)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = imageRegex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore) {
      results.push({ type: 'text', text: textBefore });
    }
    
    const filename = match[1].trim();
    const dataUrl = match[2].trim();
    
    let mimeType = 'image/png';
    let base64Data = dataUrl;
    
    const dataUrlMatch = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1];
      base64Data = dataUrlMatch[2];
    } else {
      if (filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg')) {
        mimeType = 'image/jpeg';
      } else if (filename.toLowerCase().endsWith('.gif')) {
        mimeType = 'image/gif';
      } else if (filename.toLowerCase().endsWith('.webp')) {
        mimeType = 'image/webp';
      }
    }
    
    results.push({
      type: 'image',
      filename,
      mimeType,
      base64Data
    });
    
    lastIndex = imageRegex.lastIndex;
  }
  
  const textAfter = content.substring(lastIndex);
  if (textAfter) {
    results.push({ type: 'text', text: textAfter });
  }
  
  return results;
}

export class LLMClient {
  constructor() {
    this.provider = process.env.LLM_PROVIDER || 'openai';
    this.apiKeys = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      google: process.env.GOOGLE_API_KEY,
    };
    this.models = {
      openai: process.env.MODEL_NAME || 'gpt-4o',
      anthropic: process.env.MODEL_NAME || 'claude-sonnet-4-20250514',
      google: process.env.MODEL_NAME || 'gemini-2.5-flash',
    };

    // Retry configuration
    this.maxRetries = 3;
    this.baseRetryDelay = 2000; // 2 seconds

    // Google Fallback keys for rate limit rotation (loaded securely from env variable GOOGLE_API_KEYS)
    const envKeys = process.env.GOOGLE_API_KEYS ? process.env.GOOGLE_API_KEYS.split(',').map(k => k.trim()).filter(Boolean) : [];
    this.googleKeysPool = envKeys;
    
    // If a custom key is provided that isn't in the pool, add it
    if (this.apiKeys.google && !this.googleKeysPool.includes(this.apiKeys.google)) {
      this.googleKeysPool.unshift(this.apiKeys.google);
    }
    this.currentGoogleKeyIndex = 0;

    // Use Gemini 2.x flash models for all modes
    this.liveGoogleModels = {
      low: 'gemini-2.0-flash-lite',
      medium: 'gemini-2.5-flash',
      high: 'gemini-2.5-flash'
    };
    this.googleFallbackModels = ['gemini-2.5-flash', 'gemini-2.0-flash-lite'];
  }

  /** Return the API key for the active provider. */
  getApiKey() {
    if (this.provider === 'google' && this.googleKeysPool.length > 0) {
      return this.googleKeysPool[this.currentGoogleKeyIndex];
    }
    return this.apiKeys[this.provider];
  }

  /** Rotate to the next Google API key in the pool. */
  rotateGoogleKey() {
    this.currentGoogleKeyIndex = (this.currentGoogleKeyIndex + 1) % this.googleKeysPool.length;
    const newKey = this.googleKeysPool[this.currentGoogleKeyIndex];
    console.log(`[LLM] Rotated Google API Key to ${newKey.substring(0, 4)}...${newKey.substring(newKey.length - 4)}`);
  }

  /** Return the model identifier for the active provider. */
  getModel(options = {}) {
    // Dynamic mode selection for Google models
    if (this.provider === 'google' && options.mode) {
      if (options.mode === 'low') return this.liveGoogleModels.low || 'gemini-3.1-flash-lite';
      if (options.mode === 'medium') return this.liveGoogleModels.medium || 'gemini-3.5-flash';
      if (options.mode === 'high') return this.liveGoogleModels.high || 'gemini-3.5-flash';
    }
    return this.models[this.provider];
  }

  // ---------------------------------------------------------------------------
  // Request body builders
  // ---------------------------------------------------------------------------

  buildOpenAIBody(messages, systemPrompt, options = {}) {
    const formattedMessages = messages.map(m => {
      const parts = parseContent(m.content);
      const hasImages = parts.some(p => p.type === 'image');
      if (!hasImages) {
        return { role: m.role, content: m.content };
      }
      
      const contentArray = parts.map(p => {
        if (p.type === 'text') {
          return { type: 'text', text: p.text };
        } else {
          return {
            type: 'image_url',
            image_url: {
              url: `data:${p.mimeType};base64,${p.base64Data}`
            }
          };
        }
      });
      return { role: m.role, content: contentArray };
    });

    return {
      model: this.getModel(options),
      messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages],
      stream: true,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    };
  }

  buildAnthropicBody(messages, systemPrompt, options = {}) {
    const formattedMessages = messages.map(m => {
      const parts = parseContent(m.content);
      const hasImages = parts.some(p => p.type === 'image');
      if (!hasImages) {
        return { role: m.role, content: m.content };
      }
      
      const contentArray = parts.map(p => {
        if (p.type === 'text') {
          return { type: 'text', text: p.text };
        } else {
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: p.mimeType,
              data: p.base64Data
            }
          };
        }
      });
      return { role: m.role, content: contentArray };
    });

    return {
      model: this.getModel(options),
      system: systemPrompt,
      messages: formattedMessages,
      stream: true,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
    };
  }

  buildGoogleBody(messages, systemPrompt, options = {}, modelOverride = null) {
    const contents = messages.map((m) => {
      const parts = parseContent(m.content);
      const partsArray = parts.map(p => {
        if (p.type === 'text') {
          return { text: p.text };
        } else {
          return {
            inlineData: {
              mimeType: p.mimeType,
              data: p.base64Data
            }
          };
        }
      });
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: partsArray
      };
    });

    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.mode === 'high' ? 4096 : 2048,
      },
    };

    if (options.mode === 'medium') {
      body.generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: 512
      };
    } else if (options.mode === 'high') {
      body.generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: -1
      };
    }

    if (options.enableGoogleSearch) {
      body.tools = [{ google_search: {} }];
    }

    return body;
  }

  // ---------------------------------------------------------------------------
  // Error parsing — human-readable messages
  // ---------------------------------------------------------------------------

  /**
   * Parse an API error response and return a clean, human-readable message.
   * @param {number} status - HTTP status code
   * @param {string} rawError - Raw error response body
   * @param {string} provider - Provider name
   * @returns {{ message: string, isRateLimit: boolean, retryAfter: number | null }}
   */
  parseApiError(status, rawError, provider) {
    let retryAfter = null;
    let isRateLimit = status === 429;
    let isFreeTier = false;
    let isDailyLimit = false;
    let message = '';
    let parsedError = null;

    try {
      parsedError = JSON.parse(rawError);
    } catch (_) {
      parsedError = null;
    }

    const errorObject = parsedError?.error ?? parsedError ?? {};
    const googleMessage = errorObject.message || rawError;
    const reason = errorObject.details?.[0]?.reason || '';

    message = `API Error ${status}: ${googleMessage} ${reason ? `(Reason: ${reason})` : ''}`;

    // Extract retry logic for backend to handle rate limits
    if (isRateLimit || /(rate[\s_-]?limit|quota|resource[\s_-]?exhausted)/i.test(rawError)) {
      isRateLimit = true;
      const retryMatch = rawError.match(/"retryDelay":\s*"(\d+)s?"/);
      if (retryMatch) {
        retryAfter = parseInt(retryMatch[1], 10) * 1000;
      }
    }
    
    const normalizedErrorText = rawError.toLowerCase();
    isFreeTier = /(free[\s_-]?tier)/i.test(normalizedErrorText);
    isDailyLimit = /(daily|per[\s_-]?day)/i.test(normalizedErrorText);

    return { message, isRateLimit, retryAfter, isFreeTier, isDailyLimit };
  }

  /**
   * Sleep helper for retry delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Streaming chat — async generator with retry logic
  // ---------------------------------------------------------------------------

  async *streamChat(messages, systemPrompt, options = {}) {
    if (!this.getApiKey()) {
      yield '🔑 **No API Key Configured**\n\nPlease set your API key in the Settings panel (⚙️ bottom-left).\n\nYou can get a free API key from:\n- **Google**: [aistudio.google.com](https://aistudio.google.com/)\n- **OpenAI**: [platform.openai.com](https://platform.openai.com/)\n- **Anthropic**: [console.anthropic.com](https://console.anthropic.com/)';
      return;
    }

    try {
      switch (this.provider) {
        case 'openai':
          yield* this._streamWithRetry(() => this.streamOpenAI(messages, systemPrompt, options), 'OpenAI');
          break;
        case 'anthropic':
          yield* this._streamWithRetry(() => this.streamAnthropic(messages, systemPrompt, options), 'Anthropic');
          break;
        case 'google':
          yield* this._streamGoogleWithFallback(messages, systemPrompt, options);
          break;
        default:
          yield `❌ **Unknown Provider** — "${this.provider}" is not supported. Use: openai, anthropic, or google.`;
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        throw error;
      }
      console.error('LLM streaming error:', error);
      yield '⚠️ **Connection Error** — I couldn\'t connect to the AI service. Please check your internet connection and API key, then try again.';
    }
  }

  /**
   * Google-specific streaming with API key rotation and long-wait rate limit recovery.
   */
  async *_streamGoogleWithFallback(messages, systemPrompt, options) {
    const primaryModel = this.getModel(options);
    const modelsToTry = [primaryModel, ...this.googleFallbackModels.filter(m => m !== primaryModel)];

    for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
      const model = modelsToTry[modelIdx];
      let lastError = null;

      let modelFailed = false;

      // We allow a large number of attempts to cycle through all keys + wait
      for (let attempt = 0; attempt <= 15; attempt++) {
        if (modelFailed) break;

        try {
          let hasYielded = false;
          for await (const chunk of this._streamGoogleModel(messages, systemPrompt, options, model)) {
            if (chunk.__isError) {
              lastError = chunk;
              if (chunk.isRateLimit) {
                // If it's a daily limit on free tier, don't retry, just fail
                if (chunk.isDailyLimit && chunk.isFreeTier) {
                  yield chunk.message;
                  return;
                }
                
                // If we have more keys to try, rotate immediately
                if (this.googleKeysPool.length > 1 && attempt % this.googleKeysPool.length !== (this.googleKeysPool.length - 1)) {
                  this.rotateGoogleKey();
                  console.log(`[LLM] Rate limited on ${model}. Rotating API key and retrying immediately...`);
                  break; // Break inner loop to retry immediately
                }
                
                // If we've exhausted all keys, it means the model is either hitting a global rate limit across all our keys,
                // or the model is completely unavailable for free-tier users (limit: 0).
                console.log(`[LLM] All API keys exhausted on ${model}. Falling back to next model...`);
                modelFailed = true;
                break; // Break inner loop
              }
            } else {
              hasYielded = true;
              yield chunk;
            }
          }
          if (hasYielded) return; // Success — we're done
          if (lastError && !lastError.isRateLimit) {
            yield lastError.message;
            return; // Non-retryable error
          }
        } catch (error) {
          if (error.name === 'AbortError' || error.message?.includes('aborted')) {
            throw error;
          }
          console.error(`[LLM] Error with ${model}:`, error.message);
          if (attempt === 15) {
            yield '⚠️ **Connection Error** — Could not reach the Google API. Please check your internet and try again.';
            return;
          }
        }
      }
    }

    // If we get here, all models and retries failed
    yield '⏳ **All rate limits exhausted.** Your free tier quota is completely used up across all keys. Please wait a few minutes or enable billing at [Google AI Studio](https://aistudio.google.com/).';
  }

  /**
   * Generic retry wrapper for OpenAI/Anthropic
   */
  async *_streamWithRetry(streamFn, providerName) {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        let hasYielded = false;
        for await (const chunk of streamFn()) {
          if (chunk.__isError) {
            if (chunk.isRateLimit && attempt < this.maxRetries) {
              const delay = chunk.retryAfter || (this.baseRetryDelay * Math.pow(2, attempt));
              console.log(`[LLM] Rate limited on ${providerName}, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
              await this.sleep(delay);
              break;
            } else {
              yield chunk.message;
              return;
            }
          } else {
            hasYielded = true;
            yield chunk;
          }
        }
        if (hasYielded) return;
      } catch (error) {
        if (error.name === 'AbortError' || error.message?.includes('aborted')) {
          throw error;
        }
        if (attempt === this.maxRetries) {
          yield `⚠️ **Connection Error** — Could not reach ${providerName}. Please check your internet and try again.`;
          return;
        }
        const delay = this.baseRetryDelay * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Provider-specific streaming implementations
  // ---------------------------------------------------------------------------

  async *streamOpenAI(messages, systemPrompt, options) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.getApiKey()}`,
      },
      body: JSON.stringify(this.buildOpenAIBody(messages, systemPrompt, options)),
      signal: options.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      const parsed = this.parseApiError(response.status, err, 'OpenAI');
      yield { __isError: true, ...parsed };
      return;
    }

    yield* this._readSSEStream(response, (parsed) => {
      return parsed.choices?.[0]?.delta?.content || null;
    }, '[DONE]');
  }

  async *streamAnthropic(messages, systemPrompt, options) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.getApiKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(this.buildAnthropicBody(messages, systemPrompt, options)),
      signal: options.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      const parsed = this.parseApiError(response.status, err, 'Anthropic');
      yield { __isError: true, ...parsed };
      return;
    }

    yield* this._readSSEStream(response, (parsed) => {
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        return parsed.delta.text;
      }
      return null;
    });
  }

  /**
   * Stream from a specific Google model (used by fallback logic)
   */
  async *_streamGoogleModel(messages, systemPrompt, options, model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.getApiKey()}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.buildGoogleBody(messages, systemPrompt, options, model)),
      signal: options.signal,
    });

    console.log(`[LLM] Google API response for ${model}: ${response.status}`);

    if (!response.ok) {
      const err = await response.text();
      console.log(`[LLM] Google API error text:`, err);
      const parsed = this.parseApiError(response.status, err, 'Google Gemini');
      yield { __isError: true, ...parsed };
      return;
    }

    yield* this._readSSEStream(response, (parsed) => {
      try {
        const parts = parsed.candidates?.[0]?.content?.parts || [];
        if (!parts.length) return null;

        const thoughtParts = [];
        const answerParts = [];
        
        for (const p of parts) {
          if (p.thought === true && p.text) {
            thoughtParts.push(p.text);
          } else if (p.text) {
            answerParts.push(p.text);
          }
        }

        const yields = [];
        if (thoughtParts.length > 0) {
          yields.push({ type: 'thinking', content: thoughtParts.join('') });
        }
        if (answerParts.length > 0) {
          yields.push(answerParts.join(''));
        }

        return yields.length > 0 ? yields : null;
      } catch (err) {
        console.error('[LLM] Thinking parsing error:', err);
        return parsed.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }
    });
  }

  // Keep backward compat — this is called by _streamWithRetry for non-Google
  async *streamGoogle(messages, systemPrompt, options) {
    yield* this._streamGoogleModel(messages, systemPrompt, options, this.getModel(options));
  }

  // ---------------------------------------------------------------------------
  // Shared SSE stream reader
  // ---------------------------------------------------------------------------

  /**
   * Read an SSE stream and extract content using a provided extractor function.
   * @param {Response} response - Fetch response with SSE body
   * @param {function} extractor - Function that takes parsed JSON and returns content string or null
   * @param {string} [doneSignal] - Optional done signal (e.g., '[DONE]' for OpenAI)
   */
  async *_readSSEStream(response, extractor, doneSignal = null) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (doneSignal && data === doneSignal) return;
        try {
          const parsed = JSON.parse(data);
          const content = extractor(parsed);
          if (content !== null && content !== undefined) {
            if (Array.isArray(content)) {
              for (const item of content) yield item;
            } else {
              yield content;
            }
          }
        } catch {
          // Ignore malformed chunks
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime configuration update (for settings panel changes)
  // ---------------------------------------------------------------------------

  updateConfig(provider, apiKey, model) {
    if (provider) this.provider = provider;
    if (apiKey) {
      const isNewKey = this.apiKeys[this.provider] !== apiKey;
      this.apiKeys[this.provider] = apiKey;
      if (this.provider === 'google' && isNewKey && !this.googleKeysPool.includes(apiKey)) {
        this.googleKeysPool.unshift(apiKey);
        this.currentGoogleKeyIndex = 0;
      }
    }
    if (model) {
      const lowerModel = model.toLowerCase();
      // Prevent cross-provider model mismatches which cause 400 errors
      if (this.provider === 'anthropic' && !lowerModel.includes('claude')) {
        this.models[this.provider] = 'claude-3-5-sonnet-20240620';
      } else if (this.provider === 'openai' && !lowerModel.includes('gpt') && !lowerModel.includes('o1') && !lowerModel.includes('o3')) {
        this.models[this.provider] = 'gpt-4o-mini';
      } else if (this.provider === 'google' && !lowerModel.includes('gemini')) {
        this.models[this.provider] = this.liveGoogleModels.low || 'gemini-3.5-flash';
      } else {
        this.models[this.provider] = model;
        // Also update liveGoogleModels so mode-based routing uses the correct model
        if (this.provider === 'google' && lowerModel.includes('gemini')) {
          this.liveGoogleModels.low = model;
          this.liveGoogleModels.medium = model;
          this.liveGoogleModels.high = model;
          // Update fallback chain too
          if (!this.googleFallbackModels.includes(model)) {
            this.googleFallbackModels.unshift(model);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Embeddings
  // ---------------------------------------------------------------------------

  async getEmbedding(text) {
    if (this.provider !== 'google') {
      throw new Error('Embeddings currently only supported for Google provider in this setup.');
    }
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('API Key missing for Google provider');

    const cleanKey = apiKey.trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${cleanKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] }
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[LLMClient] Embedding error body:', errBody);
      throw new Error(`Embedding failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.embedding.values;
  }

  async getEmbeddingsBatch(texts) {
    if (this.provider !== 'google') {
      throw new Error('Embeddings currently only supported for Google provider in this setup.');
    }
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('API Key missing for Google provider');

    const cleanKey = apiKey.trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${cleanKey}`;
    
    const requests = texts.map(text => ({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] }
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[LLMClient] Batch embedding error body:', errBody);
      throw new Error(`Batch embedding failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.embeddings || !Array.isArray(data.embeddings)) {
      throw new Error('Malformed batch embedding response');
    }
    return data.embeddings.map(e => e.values);
  }
}
