# yald

A cross-platform Electron app with React + TypeScript for AI agent chat, voice, and plugin-enabled skills.

## 🚀 Overview

`yald` combines:

- Electron main/preload/renderer split with Vite (+ HMR)
- React app UI in `src/renderer` with Zustand state
- Voice and transcription integration via backend service and Ollama
- Local `SKILL.md` agent skills loader
- Optional LiveKit voice and remote agent backends

This README helps contributors and users run the project locally, build packages, and customize it for own workflows.

## 📦 Repo Structure

- `/src` - Electron app source
  - `main` Electron main + native integration
  - `preload` type-safe IPC bridges
  - `renderer` React UI + components
- `/backend` - Bun + Hono/LiveKit agent voice backend (optional)
- `/build` - platform packaging assets
- `/scripts` - electron-vite runner scripts
- `/resources` - static assets

## 🛠️ Prerequisites

- Node 20+ (recommended) and pnpm (latest)
- Bun 1.0+ (only if using the optional voice backend)
- Git
- OS-specific: Windows build requires Visual Studio build tools; macOS requires Xcode Command Line Tools

> 🔐 Security note: do not commit `.env` or any secret keys to Git. This repo already includes `.env` and `.env.*` in `.gitignore`.

## 🧩 Setup

1. Clone repository

```bash
git clone https://github.com/<your-org>/yald.git
cd yald
```

2. Install dependencies

```bash
pnpm install
```

3. (Optional) install `backend` dependencies

```bash
bun --cwd backend install
```

## 🧪 Local Development

### App (Electron + Renderer)

```bash
pnpm dev
```

- Runs Electron with Vite dev server
- Supports HMR in renderer (UI)
- Restarts Electron on `main`/`preload` changes

### Backend (voice + agent integration)

```bash
pnpm voice:backend:dev
```

`backend` serves as an optional proxy for

- Ollama chat requests
- Whisper transcription
- Realtime voice pass-through

### `backend` start

```bash
pnpm voice:backend:start
```

## ⚙️ Configuration

### Electron App settings (Settings popover)

- `Ollama host`:
  - `https://ollama.com` (default)
  - `http://127.0.0.1:11434` (local Ollama)
  - `http://127.0.0.1:8787` (optional backend)
- `Ollama Cloud API key`: required for public cloud; optional for local host
- Voice/LiveKit settings as in the UI (token, server URL, device options)

### Environment variables for backend

In `backend/.env` or process env:

- `OLLAMA_HOST` (proxy target, default `https://ollama.com`)
- `OLLAMA_API_KEY` (reverse-proxy key)
- `WHISPER_BIN` (optional path to Whisper binary, e.g. `whisper` or `whisper.exe`)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` if using LiveKit in backend

## 🧠 Features

### Agent skills

- Supports importing `SKILL.md` files in Settings ▸ Agent Skills ▸ Install
- Adds prompt templates to Ollama calls
- List loaded skills in chat: `/skills`

### Voice and Streaming

- Backend exposes websocket endpoints for realtime voice:
  - `/realtime/voice`
  - `/v1/realtime/voice`
- Transcription endpoints:
  - `POST /audio/transcriptions`
  - `POST /v1/audio/transcriptions`

### App endpoints (backend)

- `GET /health` and `/v1/health`
- `POST /api/chat`

## 📦 Production Builds

Run typecheck + build + electron-builder for platform targets:

```bash
pnpm build
pnpm build:win
pnpm build:mac
pnpm build:linux
```

Built artifacts in `dist/` by default (electron-builder).

## 🧹 Lint, Format, Typecheck

```bash
pnpm format
pnpm lint
pnpm typecheck
```

## 🧪 Tests

- Unit tests currently not included.
- Use `pnpm lint` and `pnpm typecheck` as safe checks.

## 🛠️ Contributing

1. Fork repo
2. Create feature branch: `git checkout -b feat/your-thing`
3. Code, lint, typecheck
4. Commit with clear message
5. Open PR against `main` with description + testing steps

### Developer workflows

- Add a new component in `src/renderer/src/components`
- Keep state in `src/renderer/src/stores`
- IPC interactions in `src/main` and `src/preload`

## 🧩 How to Use (Quick Start)

1. Run backend (optional): `pnpm voice:backend:dev`
2. Run app: `pnpm dev`
3. Set `Ollama host` in app Settings
4. Add API key if needed
5. Use chat input and slash commands in UI
6. Install skill file via Settings ▸ Agent Skills

## 🔍 Troubleshooting

- If `pnpm dev` fails with port in use: stop conflicting process or change port in `electron.vite.config.ts`
- If backend cannot reach Ollama, verify `OLLAMA_HOST`/`OLLAMA_API_KEY`
- If audio device not listed, confirm microphone permissions and LiveKit URL

## 📄 Notes

- `src/main` handles native shell, data storage, and process hosting
- `src/renderer` is React UI + client logic
- `backend` is optional and not required for basic chat UI functionality

## 📞 Maintainer

- Repo owner and contacts in Git metadata (update as appropriate)

---

> Tip: Keep branches small and PRs focused. For major feature work, open an issue first to align behavior and architecture.
