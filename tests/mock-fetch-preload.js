// mock-fetch-preload.js
// Preloaded in the child server process to mock external API requests offline.

const originalFetch = global.fetch;

global.fetch = async (url, options) => {
  const urlStr = String(url);

  // 1. Intercept OpenAI Chat Completions
  if (urlStr.includes('api.openai.com/v1/chat/completions')) {
    console.log('[MOCK FETCH] Intercepted OpenAI completions.');
    
    // Check if we want to simulate key validation error
    if (options && options.headers && options.headers.Authorization === 'Bearer invalid_key_test') {
      return new Response(
        JSON.stringify({
          error: {
            message: "Incorrect API key provided: invalid_key_test.",
            type: "invalid_request_error",
            code: "invalid_api_key"
          }
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const responseStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const chunks = [
          'data: {"choices":[{"delta":{"content":"[Mocked OpenAI Response: "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"This is a streamed reply from Sajan mocked LLM client."}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"]"}}]}\n\n',
          'data: [DONE]\n\n'
        ];
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });
    return new Response(responseStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    });
  }

  // 2. Intercept Anthropic Messages
  if (urlStr.includes('api.anthropic.com/v1/messages')) {
    console.log('[MOCK FETCH] Intercepted Anthropic messages.');
    const responseStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const chunks = [
          'data: {"type":"message_start"}\n\n',
          'data: {"type":"content_block_start"}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"[Mocked Anthropic Response: "}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Streaming from the mock Anthropic service."}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"]"}}\n\n',
          'data: {"type":"message_stop"}\n\n'
        ];
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });
    return new Response(responseStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    });
  }

  // 3. Intercept Google Gemini completions
  if (urlStr.includes('generativelanguage.googleapis.com')) {
    console.log('[MOCK FETCH] Intercepted Google Gemini completions.');
    
    // Embeddings check:
    if (urlStr.includes(':embedContent')) {
      console.log('[MOCK FETCH] Intercepted Google Gemini embedding.');
      const mockValues = Array.from({ length: 768 }, () => Math.random());
      return new Response(
        JSON.stringify({
          embedding: {
            values: mockValues
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (urlStr.includes(':batchEmbedContents')) {
      console.log('[MOCK FETCH] Intercepted Google Gemini batch embedding.');
      let numRequests = 1;
      if (options && options.body) {
        try {
          const bodyObj = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
          if (bodyObj.requests && Array.isArray(bodyObj.requests)) {
            numRequests = bodyObj.requests.length;
          }
        } catch (_) {}
      }
      
      const embeddings = Array.from({ length: numRequests }, () => ({
        values: Array.from({ length: 768 }, () => Math.random())
      }));

      return new Response(
        JSON.stringify({ embeddings }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Inspect headers or body to check if we should simulate rate limit
    let isRateLimitRequested = false;
    let isKeyMissingRequested = false;
    
    if (options && options.body) {
      try {
        const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        if (bodyStr.includes('SIMULATE_RATE_LIMIT_429')) {
          isRateLimitRequested = true;
        }
      } catch (_) {}
    }

    if (urlStr.includes('key=invalid_key_test')) {
      isKeyMissingRequested = true;
    }

    if (isRateLimitRequested) {
      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: "Resource has been exhausted (e.g. queries per minute limit reached).",
            status: "RESOURCE_EXHAUSTED",
            details: [
              {
                "reason": "RATE_LIMIT_EXCEEDED"
              }
            ]
          }
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (isKeyMissingRequested) {
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: "API key not valid. Please pass a valid API key.",
            status: "INVALID_ARGUMENT"
          }
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const responseStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const chunks = [
          'data: {"candidates":[{"content":{"parts":[{"text":"[Mocked Google Gemini Response: "}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"Sajan response via mock Gemini."}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"]"}]}}]}\n\n'
        ];
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });
    return new Response(responseStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    });
  }

  // 4. Intercept audio transcription API call
  if (urlStr.includes('api.openai.com/v1/audio/transcriptions')) {
    console.log('[MOCK FETCH] Intercepted voice transcription API.');
    return new Response(JSON.stringify({ text: "Mocked voice transcription result" }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Pass-through anything else (like internal calls on localhost)
  return originalFetch(url, options);
};
