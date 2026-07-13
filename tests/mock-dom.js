// mock-dom.js
// Simulates a browser DOM environment inside Node.js for executing and testing public/app.js.

import { URL } from 'url';

// ---------------------------------------------------------------------------
// Mock DOM Element Class
// ---------------------------------------------------------------------------
export class MockDOMElement {
  constructor(tagOrSelector) {
    this.tagName = (tagOrSelector || 'div').toUpperCase();
    this.id = tagOrSelector.startsWith('#') ? tagOrSelector.slice(1) : '';
    this.className = tagOrSelector.startsWith('.') ? tagOrSelector.slice(1) : '';
    this.style = { display: '' };
    this.dataset = {};
    this.disabled = false;
    this._value = '';
    this._textContent = '';
    this._innerHTML = '';
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.parentElement = null;
  }

  get value() {
    return this._value;
  }
  set value(val) {
    this._value = String(val);
    // Trigger input events if bound
    this.dispatchEvent({ type: 'input', target: this });
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    if (idx === -1 || idx === this.parentElement.children.length - 1) return null;
    return this.parentElement.children[idx + 1];
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    if (idx <= 0) return null;
    return this.parentElement.children[idx - 1];
  }

  get textContent() {
    if (this.children.length > 0) {
      return (this._textContent || '') + this.children.map(c => c.textContent).join('');
    }
    return this._textContent;
  }
  set textContent(val) {
    this.children = [];
    this._textContent = String(val);
    this._innerHTML = String(val);
  }

  get innerHTML() {
    if (this.children.length > 0) {
      return (this._innerHTML || '') + this.children.map(c => c.innerHTML).join('');
    }
    return this._innerHTML;
  }
  set innerHTML(val) {
    this.children = [];
    this._innerHTML = String(val);
    this._textContent = String(val);
  }

  addEventListener(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  removeEventListener(event, cb) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(x => x !== cb);
  }

  dispatchEvent(event) {
    const eventType = typeof event === 'string' ? event : event.type;
    const ev = typeof event === 'string' ? { type: event, target: this } : event;
    if (this.listeners[eventType]) {
      for (const cb of this.listeners[eventType]) {
        cb(ev);
      }
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  appendChild(el) {
    this.children.push(el);
    el.parentElement = this;
    return el;
  }

  removeChild(el) {
    this.children = this.children.filter(c => c !== el);
    if (el.parentElement === this) el.parentElement = null;
    return el;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  focus() {}
  
  closest(selector) {
    // Basic match
    return this;
  }

  querySelector(selector) {
    if (typeof selector !== 'string') return null;
    
    const matches = (el) => {
      if (selector.startsWith('.')) {
        return el.classList.contains(selector.slice(1));
      }
      if (selector.startsWith('#')) {
        return el.id === selector.slice(1);
      }
      return el.tagName === selector.toUpperCase();
    };

    const search = (el) => {
      if (matches(el)) return el;
      for (const child of el.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };

    for (const child of this.children) {
      const found = search(child);
      if (found) return found;
    }
    return null;
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  get scrollHeight() {
    return 500;
  }
  get clientHeight() {
    return 300;
  }
  get scrollTop() {
    return 100;
  }
  scrollTo() {}

  get classList() {
    const self = this;
    return {
      add(cls) {
        const classes = self.className.split(/\s+/).filter(Boolean);
        if (!classes.includes(cls)) classes.push(cls);
        self.className = classes.join(' ');
      },
      remove(cls) {
        const classes = self.className.split(/\s+/).filter(Boolean);
        self.className = classes.filter(x => x !== cls).join(' ');
      },
      toggle(cls, force) {
        const classes = self.className.split(/\s+/).filter(Boolean);
        const has = classes.includes(cls);
        const shouldHave = force !== undefined ? force : !has;
        if (shouldHave) {
          if (!has) {
            classes.push(cls);
            self.className = classes.join(' ');
          }
        } else {
          if (has) {
            self.className = classes.filter(x => x !== cls).join(' ');
          }
        }
        return shouldHave;
      },
      contains(cls) {
        return self.className.split(/\s+/).filter(Boolean).includes(cls);
      }
    };
  }
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Global Element Registry
// ---------------------------------------------------------------------------
const elementRegistry = {};

export function getOrCreateElement(selector) {
  if (!elementRegistry[selector]) {
    elementRegistry[selector] = new MockDOMElement(selector);
  }
  return elementRegistry[selector];
}

export function clearRegistry() {
  for (const key of Object.keys(elementRegistry)) {
    delete elementRegistry[key];
  }
}

// ---------------------------------------------------------------------------
// Setup Globals
// ---------------------------------------------------------------------------
export function setupMockDOM(serverPort = 3001) {
  clearRegistry();

  // Read index.html to find real elements
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const idsInHtml = new Set();
  const classesInHtml = new Set();

  if (fs.existsSync(htmlPath)) {
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const idRegex = /id="([^"]+)"/g;
    let match;
    while ((match = idRegex.exec(htmlContent)) !== null) {
      idsInHtml.add(match[1]);
    }
    const classRegex = /class="([^"]+)"/g;
    while ((match = classRegex.exec(htmlContent)) !== null) {
      const clsList = match[1].split(/\s+/);
      for (const cls of clsList) {
        classesInHtml.add(cls);
      }
    }
  }

  global.window = {
    innerWidth: 1024,
    confirm(msg) { return true; },
    addEventListener(event, cb) {
      if (!this._listeners) this._listeners = {};
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(cb);
    },
    removeEventListener() {},
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event.type;
      if (this._listeners && this._listeners[type]) {
        for (const cb of this._listeners[type]) cb(event);
      }
    },
    localStorage: {
      store: {},
      getItem(key) { return this.store[key] || null; },
      setItem(key, val) { this.store[key] = String(val); },
      removeItem(key) { delete this.store[key]; },
      clear() { this.store = {}; }
    }
  };

  global.localStorage = global.window.localStorage;
  global.location = {
    protocol: 'http:',
    host: `localhost:${serverPort}`
  };

  global.document = {
    listeners: {},
    addEventListener(event, cb) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(cb);
    },
    removeEventListener(event, cb) {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter(x => x !== cb);
    },
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event.type;
      const ev = typeof event === 'string' ? { type, target: this } : event;
      if (this.listeners[type]) {
        for (const cb of this.listeners[type]) {
          cb(ev);
        }
      }
    },
    querySelector(selector) {
      if (typeof selector !== 'string') return null;
      if (selector.startsWith('#')) {
        const id = selector.slice(1);
        if (!idsInHtml.has(id)) return null;
      } else if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (!classesInHtml.has(cls)) return null;
      }
      return getOrCreateElement(selector);
    },
    querySelectorAll(selector) {
      if (typeof selector !== 'string') return [];
      if (selector.startsWith('#')) {
        const id = selector.slice(1);
        if (!idsInHtml.has(id)) return [];
      } else if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (!classesInHtml.has(cls)) return [];
      }
      return [getOrCreateElement(selector)];
    },
    createElement(tag) {
      return new MockDOMElement(tag);
    },
    documentElement: getOrCreateElement('html')
  };


  Object.defineProperty(global, 'navigator', {
    value: {
      clipboard: {
        writeText: async (txt) => {
          global.window.copiedText = txt;
          return Promise.resolve();
        }
      },
      mediaDevices: {
        getUserMedia: async (constraints) => {
          return {
            getTracks() {
              return [{ stop() {} }];
            }
          };
        }
      }
    },
    configurable: true,
    writable: true
  });

  // -------------------------------------------------------------------------
  // Mock external markdown & highlight script APIs
  // -------------------------------------------------------------------------
  global.marked = {
    parse(text) {
      return `<p>${text}</p>`;
    },
    Renderer: class Renderer {},
    setOptions() {}
  };

  global.hljs = {
    getLanguage(lang) { return true; },
    highlight(code, options) { return { value: code }; },
    highlightAuto(code) { return { value: code }; }
  };

  // -------------------------------------------------------------------------
  // Mock Web Speech API (SpeechRecognition / webkitSpeechRecognition)
  // -------------------------------------------------------------------------
  class MockSpeechRecognition {
    constructor() {
      this.onstart = null;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.continuous = false;
      this.interimResults = false;
      this.lang = 'en-US';
    }
    start() {
      MockSpeechRecognition.activeInstance = this;
      setTimeout(() => {
        if (this.onstart) this.onstart();
      }, 5);
    }
    stop() {
      setTimeout(() => {
        if (this.onend) this.onend();
      }, 5);
    }
    simulateResult(transcript) {
      if (this.onresult) {
        this.onresult({
          resultIndex: 0,
          results: [[{ transcript }]]
        });
      }
      this.stop();
    }
    simulateError(errorName) {
      if (this.onerror) {
        this.onerror({ error: errorName });
      }
      this.stop();
    }
  }
  global.webkitSpeechRecognition = MockSpeechRecognition;
  global.SpeechRecognition = MockSpeechRecognition;

  // -------------------------------------------------------------------------
  // Mock MediaRecorder
  // -------------------------------------------------------------------------
  class MockMediaRecorder {
    constructor(stream) {
      this.stream = stream;
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
      MockMediaRecorder.activeInstance = this;
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      setTimeout(() => {
        if (this.ondataavailable) {
          this.ondataavailable({ data: new global.Blob(['mock audio data'], { type: 'audio/wav' }) });
        }
        if (this.onstop) this.onstop();
      }, 5);
    }
  }
  global.MediaRecorder = MockMediaRecorder;
  
  global.Blob = class Blob {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
      this.size = parts.reduce((acc, p) => acc + (p.length || 0), 0);
    }
  };

  // -------------------------------------------------------------------------
  // Mock WebSocket
  // -------------------------------------------------------------------------
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = MockWebSocket.CONNECTING;
      this.sentMessages = [];
      MockWebSocket.activeInstance = this;

      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) this.onopen();
      }, 5);
    }

    send(data) {
      this.sentMessages.push(data);
      if (MockWebSocket.onMessageSent) {
        MockWebSocket.onMessageSent(this, data);
      }
    }

    close(code, reason) {
      this.readyState = MockWebSocket.CLOSED;
      setTimeout(() => {
        if (this.onclose) this.onclose({ code, reason });
      }, 5);
    }

    receiveFromServer(data) {
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify(data) });
      }
    }
  }
  MockWebSocket.prototype.CONNECTING = 0;
  MockWebSocket.prototype.OPEN = 1;
  MockWebSocket.prototype.CLOSING = 2;
  MockWebSocket.prototype.CLOSED = 3;
  global.WebSocket = MockWebSocket;

  // -------------------------------------------------------------------------
  // Intercept relative fetch calls to point to the serverPort
  // -------------------------------------------------------------------------
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    let finalUrl = url;
    if (typeof url === 'string' && url.startsWith('/')) {
      finalUrl = `http://localhost:${serverPort}${url}`;
    }
    return originalFetch(finalUrl, options);
  };
}
