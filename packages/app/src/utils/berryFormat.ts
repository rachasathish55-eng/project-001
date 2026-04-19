import JSZip from "jszip";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import type { TerminalLogEntry } from "../lib/terminal-logs";
import { useStore, type StoreState, type WorkerRecord, type WorkerStats } from "../store/useStore";

export type BerryViewMode = "canvas" | "notebook";

const BERRY_FORMAT = "strawberry-berry";
const BERRY_VERSION = 1;
const BERRY_PROJECT_ENTRY = "project.json";
const BERRY_DEFAULT_FILE_NAME = "strawberry-project.berry";

export interface BerryProjectWorkspaceState {
  viewMode: BerryViewMode;
}

export interface BerryProjectStoreState {
  nodes: StoreState["nodes"];
  edges: StoreState["edges"];
  workers: WorkerRecord[];
  workerStats: WorkerStats | null;
  connectionState: StoreState["connectionState"];
  terminalEntries: TerminalLogEntry[];
}

export interface BerryProjectDocument {
  format: typeof BERRY_FORMAT;
  version: typeof BERRY_VERSION;
  savedAt: string;
  workspace: BerryProjectWorkspaceState;
  store: BerryProjectStoreState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBerryViewMode(value: unknown): value is BerryViewMode {
  return value === "canvas" || value === "notebook";
}

function isConnectionState(value: unknown): value is StoreState["connectionState"] {
  return value === "disconnected" || value === "connecting" || value === "connected" || value === "reconnecting";
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function ensureBerryDocument(value: unknown): BerryProjectDocument {
  if (!isRecord(value)) {
    throw new Error("Berry archive did not contain a project document.");
  }

  if (value.format !== BERRY_FORMAT) {
    throw new Error("Unsupported Berry archive format.");
  }

  if (value.version !== BERRY_VERSION) {
    throw new Error("Unsupported Berry archive version.");
  }

  if (!isRecord(value.workspace) || !isBerryViewMode(value.workspace.viewMode)) {
    throw new Error("Berry archive is missing workspace state.");
  }

  if (!isRecord(value.store)) {
    throw new Error("Berry archive is missing store state.");
  }

  const { store } = value;
  if (
    !isArray(store.nodes) ||
    !isArray(store.edges) ||
    !isArray(store.workers) ||
    !isArray(store.terminalEntries) ||
    !isConnectionState(store.connectionState)
  ) {
    throw new Error("Berry archive store state is invalid.");
  }

  return {
    format: BERRY_FORMAT,
    version: BERRY_VERSION,
    savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date().toISOString(),
    workspace: {
      viewMode: value.workspace.viewMode,
    },
    store: {
      nodes: store.nodes as BerryProjectStoreState["nodes"],
      edges: store.edges as BerryProjectStoreState["edges"],
      workers: store.workers as BerryProjectStoreState["workers"],
      workerStats: store.workerStats === null || isRecord(store.workerStats) ? (store.workerStats as WorkerStats | null) : null,
      connectionState: store.connectionState,
      terminalEntries: store.terminalEntries as BerryProjectStoreState["terminalEntries"],
    },
  };
}

function ensureBerryExtension(path: string): string {
  return path.toLowerCase().endsWith(".berry") ? path : `${path}.berry`;
}

export function createBerryProjectDocument(viewMode: BerryViewMode): BerryProjectDocument {
  const state = useStore.getState();

  return {
    format: BERRY_FORMAT,
    version: BERRY_VERSION,
    savedAt: new Date().toISOString(),
    workspace: {
      viewMode,
    },
    store: {
      nodes: state.nodes,
      edges: state.edges,
      workers: state.workers,
      workerStats: state.workerStats,
      connectionState: state.connectionState,
      terminalEntries: state.terminalEntries,
    },
  };
}

export async function createBerryArchive(document: BerryProjectDocument): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(BERRY_PROJECT_ENTRY, JSON.stringify(document, null, 2));
  return zip.generateAsync({ type: "uint8array" });
}

export async function readBerryArchive(contents: Uint8Array): Promise<BerryProjectDocument> {
  const zip = await JSZip.loadAsync(contents);
  const entry = zip.file(BERRY_PROJECT_ENTRY);

  if (!entry) {
    throw new Error("Berry archive is missing project.json.");
  }

  const json = await entry.async("string");
  return ensureBerryDocument(JSON.parse(json) as unknown);
}

export function applyBerryProject(document: BerryProjectDocument): void {
  useStore.setState({
    nodes: document.store.nodes,
    edges: document.store.edges,
    workers: document.store.workers,
    workerStats: document.store.workerStats,
    connectionState: document.store.connectionState,
    terminalEntries: document.store.terminalEntries,
  });
}

export async function saveBerryProject(viewMode: BerryViewMode): Promise<string | null> {
  const targetPath = await save({
    title: "Save Berry project",
    defaultPath: BERRY_DEFAULT_FILE_NAME,
    filters: [{ name: "Berry project", extensions: ["berry"] }],
  });

  if (!targetPath) {
    return null;
  }

  const archive = await createBerryArchive(createBerryProjectDocument(viewMode));
  const finalPath = ensureBerryExtension(targetPath);
  await writeFile(finalPath, archive);
  return finalPath;
}

export async function loadBerryProject(): Promise<BerryViewMode | null> {
  const sourcePath = await open({
    title: "Load Berry project",
    multiple: false,
    filters: [{ name: "Berry project", extensions: ["berry"] }],
  });

  if (!sourcePath || Array.isArray(sourcePath)) {
    return null;
  }

  const archive = await readFile(sourcePath);
  const document = await readBerryArchive(archive);
  applyBerryProject(document);
  return document.workspace.viewMode;
}
