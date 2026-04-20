# project-001 (Strawberry Studios) — Master Project Spec
**Version:** 3.0 | **Status:** Fresh Start | **Repo:** https://github.com/rachasathish55-eng/project-001
**Builder:** Copilot CLI (gpt-5-mini primary, gpt-4o-mini fallback)
**Brain:** OpenClaw (Gemini)

---

## Vision

**A Distributed AI Operating System — Your project-001**

AI researchers constantly juggle: local Jupyter → SSH session → cloud VM → broken terminal.
Strawberry Studios replaces all of that with ONE visual desktop interface where every compute
resource (local machine, AWS EC2, Google Colab) appears as a connected Worker node.

**The product in one sentence:** A Tauri desktop app where you drag-drop AI pipelines on a
canvas, write code in notebook cells, and execute on any connected hardware — all in one window.

---

## Architecture

\`\`\`
┌──────────────────────────────────────────────────────────────────────┐
│           VIRTUAL AI LAB — DESKTOP APP (Tauri — Rust + React/Vite)  │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐ │
│  │  Node Editor │  │   Notebook   │  │  Terminal  │  │  Workers  │ │
│  │  (ReactFlow  │  │  (CodeMirror │  │ (streaming │  │ Dashboard │ │
│  │   canvas)    │  │   6 cells)   │  │  stdout)   │  │  + gauges)│ │
│  └──────────────┘  └──────────────┘  └────────────┘  └───────────┘ │
│         │                 │                                          │
│         └─────────────────┘                                         │
│            USM (Zustand) — One StrawberryNode = one cell            │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │           Strawberry RPC (Rust + Tauri commands)               │  │
│  │   WebSocket (primary) │ gRPC (future) │ HTTP fallback          │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
           │                    │                     │
           ▼                    ▼                     ▼
    Local Machine           AWS EC2            Google Colab
    Claw Worker             Claw Worker        Claw Worker
    (Python daemon          port 7331          port 7331
     port 7331)
\`\`\`

---

## Core Data Model

\`\`\`typescript
interface StrawberryNode {
  id: string;
  type: 'script' | 'dataset' | 'model' | 'condition' | 'output';
  name: string;
  code: string;                    // Python/Rust/Mojo source
  language: 'python' | 'rust' | 'mojo';
  inputs: Port[];                  // incoming data edges
  outputs: Port[];                 // outgoing data edges
  position: { x: number; y: number };  // canvas position
  status: 'idle' | 'queued' | 'running' | 'success' | 'error';
  lastOutput: string;              // stdout from last run
  lastError: string | null;
  runDuration: number | null;      // ms
  assignedWorker: string | null;   // which Claw Worker runs this
}
// ONE node = ONE notebook cell. Always. They are the same object.
\`\`\`

---

## Claw Worker Protocol (WebSocket JSON Messages)

\`\`\`typescript
// Desktop → Worker (Commands)
{ type: 'ping' }
{ type: 'exec', id: string, code: string, env: Record<string,string> }
{ type: 'kill', id: string }
{ type: 'upload', path: string, data: string }  // base64
{ type: 'download', path: string }
{ type: 'ls', path: string }
{ type: 'status' }

// Worker → Desktop (Events)
{ type: 'pong', uptime: number }
{ type: 'identity', hostname, os, cpu, ram_gb, gpu: [...], python, has_docker }
{ type: 'stdout', id: string, data: string }
{ type: 'stderr', id: string, data: string }
{ type: 'exit', id: string, code: number, duration: number }
{ type: 'telemetry', cpu: number, ram: number, gpu: {...}, disk: {...} }
{ type: 'file', path: string, data: string }
{ type: 'error', message: string }
{ type: 'heartbeat' }  // every 5s automatically
\`\`\`

---

## Tech Stack (Locked — Do Not Change)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Desktop shell | Tauri (Rust) | NOT Electron. ~15MB binary. |
| Frontend | React + TypeScript + **Vite** | Standard Tauri+Vite setup |
| Node editor | ReactFlow | Best-in-class graph UI |
| Notebook | CodeMirror 6 | \`@codemirror/view\`, \`@codemirror/lang-python\` |
| State / USM | Zustand | Single store, both views derive from it |
| Animations | Framer Motion | Subtle, not showy |
| Claw Worker | Pure Python asyncio + websockets | NO FastAPI, NO Flask, single file |
| Build | pnpm + Turbo | Monorepo build pipeline |
| Package format | .berry (ZIP+JSON) | Phase 3 |

---

## Build Order (Bottom-Up — Critical)

Build from bottom up. Do NOT jump to UI before the foundation is solid.

### Phase 1 — Foundation

| Task ID | Title | Done When |
|---------|-------|-----------|
|P1-001| ✅ done | feat/P1-001-monorepo-scaffold |
| claw-worker-core | ✅ done | feat/claw-worker-daemon |
|shared-types| ✅ done | ✅ done |
|tauri-shell|Blank Tauri window|\`pnpm dev\` opens a Tauri window with dark background|

### Phase 2 — Core UI

| Task ID | Title | Done When |
|---------|-------|-----------|
| usm-store | Zustand USM store | Create/update/delete nodes, topological sort util, tests |
| worker-connection | WS connection manager | TypeScript class that connects to Claw Worker, dispatches commands |
| node-editor | ReactFlow canvas | Nodes render from store, drag to move, connect edges, status badges |
| terminal-panel | Streaming terminal | Ring-buffer log panel, stdout from running nodes |
| worker-dashboard | Worker sidebar | Connected workers, CPU/GPU/RAM gauges from telemetry |

### Phase 3 — Killer Features

| Task ID | Title | Done When |
|---------|-------|-----------|
| notebook-view | CodeMirror notebook | Cells from USM nodes, run button, markdown cells |
| exec-pipeline | Run pipeline | Topological sort → exec nodes sequentially on workers |
| usm-bidirectional | Node↔cell sync | Edit notebook = updates node; edit node = updates cell |
| berry-format | .berry save/load | Export ZIP, import ZIP, reconstruct full project |

### Phase 4 — Polish

| Task ID | Title |
|---------|-------|
| dark-theme | Full dark theme + CSS variables |
| animations | Framer Motion node transitions |
| keyboard-shortcuts | Command palette (Cmd+K) |
| multi-worker | Assign nodes to specific workers |
| auto-reconnect | Worker reconnect with exponential backoff |

---

## Guiding Principles for Copilot CLI (The Builder)

1. **Bottom-up always.** Claw Worker fully before Tauri UI.
2. **One task, small scope.** Each task completable in <20 minutes.
3. **Check before writing.** \`ls\` and \`cat\` existing files first.
4. **No FastAPI in Claw Worker.** Pure asyncio + websockets only.
5. **Always write completion marker.** \`/home/ubuntu/workspace/.task-complete/{task_id}.json\`
6. **Git commit after every task.** Clear message.
7. **Experimental.** If something fails, try a simpler approach first.

---

## 📊 Progress Tracker

| Phase | Task ID | Title | Status | Notes |
|-------|---------|-------|--------|-------|
| P1 | P1-001 | pnpm+turbo monorepo | ✅ done | feat/P1-001-monorepo-scaffold |
| P1 | claw-worker-core | Full Claw Worker daemon | ✅ done | feat/claw-worker-daemon |
|P1|shared-types|TypeScript type definitions| ✅ done | ✅ done |
|P1|tauri-shell|Blank Tauri window| feat/tauri-shell-pending ||
| P2 | usm-store | Zustand USM store | ⬜ pending | |
| P2 | worker-connection | WS connection manager | ⬜ pending | |
| P2 | node-editor | ReactFlow canvas | ⬜ pending | |
| P2 | terminal-panel | Streaming terminal | ⬜ pending | |
| P2 | worker-dashboard | Worker sidebar | ⬜ pending | |
| P3 | notebook-view | CodeMirror notebook | ⬜ pending | |
| P3 | exec-pipeline | Run pipeline | ⬜ pending | |
| P3 | usm-bidirectional | Node↔cell sync | ⬜ pending | |
| P3 | berry-format | .berry save/load | ⬜ pending | |
| P4 | dark-theme | Dark theme polish | ⬜ pending | |
| P4 | animations | Framer Motion | ⬜ pending | |

*Status: ✅ done | 🔄 running | ❌ failed | ⬜ pending*
