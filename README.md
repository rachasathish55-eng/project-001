# project-001

project-001 is the first scaffold for the Strawberry desktop platform.

It uses a pnpm monorepo layout so app, agent, and shared code can evolve together.

The desktop client will live in `packages/app`.

The background Claw Worker daemon will live in `packages/agent`.

Shared TypeScript types and contracts will live in `packages/shared`.

The desktop app target is Tauri, pairing Rust system capabilities with a React UI.

The agent package is a placeholder for Python-based automation and worker processes.

The shared package will centralize types that both the app and tooling can import.

`turbo.json` provides a simple build pipeline for future package-level tasks.

This repository starts intentionally small so the next implementation steps stay focused.

Future work can add per-package scripts, Rust configuration, and frontend build tooling.

The root `package.json` defines the workspace boundary for all packages under `packages/*`.

`pnpm-workspace.yaml` mirrors that layout for pnpm.

The scaffold is ready for incremental development.

Each package currently contains only the manifest needed to establish ownership.

This keeps the monorepo structure explicit from the start.

The task-complete marker directory is reserved for automation output.

That marker will be written once the scaffold is committed and pushed.

The result is a clean base for project-001.
