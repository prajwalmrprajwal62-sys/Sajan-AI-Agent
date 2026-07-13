# SAJAN AI Agent (v1.0)

A sophisticated, full-stack AI assistant with multi-agent routing, real-time web search, RAG (Retrieval-Augmented Generation), long-term memory extraction, safety middleware, and grounding verification layers.

SAJAN is designed to serve as a premium agentic workspace, featuring a gorgeous dark mode interface, dynamic reasoning tracing, and fallback model/key rotation.

---

## 🚀 Key Features

*   **Multi-Agent Router (Intelligence Modes)**
    *   **Low Mode (Direct)**: Directly answers simple questions or jokes without consuming unnecessary tokens.
    *   **Medium Mode (Balanced)**: Uses local retrieval or light reasoning tools.
    *   **High Mode (Deep Research)**: Actively triggers multi-step planning, web search query optimization, RAG retrieval, and factual grounding checks.
*   **Real-time Web Search Integration**: Scrapes and synthesizes query-optimized web results (duckduckgo integration).
*   **Factual Grounding Verification**: For research questions, SAJAN fact-checks its own answers against the source material/RAG search context to emit accuracy ratios (e.g. `VERIFY: 6/7 claims supported`).
*   **Long-Term Memory Engine**: Scans conversation context asynchronously to extract permanent preferences and user facts, saving them to inject dynamically on subsequent turns.
*   **Input & Output Safety Middleware**: Real-time screening for prompt injection, sensitive topics, and compliance checks.
*   **Robust Fallback & Key Rotation**: Automatically cycles through a pool of Google API keys if a 429 rate limit is encountered, falling back from 3.5 to 3.1 flash models dynamically.
*   **Theme Engine & Voice Control**: Premium UI supporting instant dark/light mode toggles, and state-of-the-art Web Speech recording with cursor insertion.

---

## 🛠️ Tech Stack

*   **Frontend**: Vanilla HTML5, CSS3, Javascript (Modern ES6, dynamic styling, WebSockets).
*   **Backend**: Node.js (Express, WebSocket Server (`ws`), SQLite3).
*   **Core AI Integration**: Google Gemini API (targeting `gemini-3.5-flash` and `gemini-3.1-flash`).
*   **Database**: SQLite (for conversation history, trace events, RAG vector embeddings storage).

---

## 🔧 Installation & Setup

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed (v18+ recommended).

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Setup
Create a `.env` file in the root directory (you can copy `.env.example` as a template):
```env
PORT=3000
HOST=localhost
GOOGLE_API_KEY=your_primary_gemini_api_key
MODEL_NAME=gemini-3.5-flash
```

### 4. Running the Application
Start the Node.js server:
```bash
npm start
```
Open your browser and navigate to `http://localhost:3000`.

---

## 📁 Repository Structure
```
├── data/                    # User memories, preferences, and SQLite databases (git ignored)
├── public/                  # Static assets
│   ├── index.html           # Main SPA UI structure
│   ├── app.js               # Core client-side WebSocket/UI logic
│   └── styles.css           # Custom theme variables and premium stylesheet
├── src/                     # Core application layers
│   ├── conversation-manager.js # Chat history & database connector
│   ├── copyright-guard.js   # Content licensing helper
│   ├── llm-client.js        # Multi-provider LLM API router & fallback controller
│   ├── memory-manager.js    # Memory extraction & injection layer
│   ├── safety-middleware.js # Real-time content filtering
│   ├── search-engine.js     # Web scraping & query optimization
│   └── system-prompt.js     # Base agent prompts & rules
├── server.js                # Core Express/WebSocket server entrypoint
└── package.json             # Project metadata and dependencies
```

---

## 🛡️ License
Private Repository. Developed for Prajwal M R.
