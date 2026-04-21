import type {
  StrawberryExtensionManifest,
  StrawberryExtensionManifestAction,
} from '@strawberry/shared';

export interface ExtensionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface ExtensionActionDefinition extends StrawberryExtensionManifestAction {
  run: () => void | Promise<void>;
  isAvailable?: () => boolean;
}

export interface ExtensionDefinition extends Omit<StrawberryExtensionManifest, 'actions'> {
  actions: ExtensionActionDefinition[];
}

export interface RegisteredExtension extends ExtensionDefinition {
  enabled: boolean;
}

export interface ExtensionPaletteAction {
  id: string;
  extensionId: string;
  extensionName: string;
  label: string;
  description: string;
  keywords?: string[];
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface ExtensionRegistryOptions {
  storage?: ExtensionStorage | null;
  storageKey?: string;
}

export interface RegisterExtensionOptions {
  replace?: boolean;
}

export interface BuiltinExtensionOperations {
  runPipeline: () => void;
  runFocusedNode: () => void;
  createScriptNode: () => void;
  saveProject: () => void;
  connectWorker: () => void;
  toggleView: () => void;
  clearTerminal: () => void;
  hasWorkerManager: () => boolean;
  hasExecutableNodes: () => boolean;
  hasFocusedNode: () => boolean;
  hasTerminalEntries: () => boolean;
}

const DEFAULT_STORAGE_KEY = 'strawberry.extension-registry.v1';

function getDefaultStorage(): ExtensionStorage | null {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
    return null;
  }

  return globalThis.localStorage;
}

export class ExtensionRegistry {
  private readonly storage: ExtensionStorage | null;
  private readonly storageKey: string;
  private readonly extensions = new Map<string, ExtensionDefinition>();
  private readonly enabledById = new Map<string, boolean>();
  private readonly listeners = new Set<() => void>();

  constructor(options: ExtensionRegistryOptions = {}) {
    this.storage = options.storage ?? getDefaultStorage();
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.loadPersistedState();
  }

  public register(extension: ExtensionDefinition, options: RegisterExtensionOptions = {}): void {
    const exists = this.extensions.has(extension.id);
    if (exists && !options.replace) {
      throw new Error(Extension already registered: );
    }

    this.extensions.set(extension.id, extension);
    if (!this.enabledById.has(extension.id)) {
      this.enabledById.set(extension.id, extension.enabledByDefault !== false);
      this.persistState();
    }
    this.emit();
  }

  public unregister(extensionId: string): void {
    const removed = this.extensions.delete(extensionId);
    if (!removed) {
      return;
    }

    this.enabledById.delete(extensionId);
    this.persistState();
    this.emit();
  }

  public listExtensions(): RegisteredExtension[] {
    return [...this.extensions.values()]
      .map((extension) => ({
        ...extension,
        enabled: this.isEnabled(extension.id),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  public isEnabled(extensionId: string): boolean {
    return this.enabledById.get(extensionId) ?? false;
  }

  public setEnabled(extensionId: string, enabled: boolean): void {
    if (!this.extensions.has(extensionId)) {
      throw new Error(Cannot toggle unregistered extension: );
    }

    this.enabledById.set(extensionId, enabled);
    this.persistState();
    this.emit();
  }

  public toggle(extensionId: string): void {
    this.setEnabled(extensionId, !this.isEnabled(extensionId));
  }

  public getPaletteActions(): ExtensionPaletteAction[] {
    const actions: ExtensionPaletteAction[] = [];
    for (const extension of this.listExtensions()) {
      if (!extension.enabled) {
        continue;
      }

      for (const action of extension.actions) {
        actions.push({
          id: ${extension.id}:,
          extensionId: extension.id,
          extensionName: extension.name,
          label: action.label,
          description: action.description,
          keywords: action.keywords,
          disabled: action.isAvailable ? !action.isAvailable() : false,
          onSelect: action.run,
        });
      }
    }

    return actions;
  }

  public getManagementActions(): ExtensionPaletteAction[] {
    return this.listExtensions().map((extension) => ({
      id: manage:,
      extensionId: extension.id,
      extensionName: 'Extension Registry',
      label: ${extension.enabled ? 'Disable' : 'Enable'} Extension: ,
      description: extension.enabled
        ? Disable  actions from the command palette.
        : Enable  actions in the command palette.,
      keywords: [extension.id, 'extension', extension.enabled ? 'disable' : 'enable'],
      onSelect: () => {
        this.toggle(extension.id);
      },
    }));
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private loadPersistedState(): void {
    if (!this.storage) {
      return;
    }

    const raw = this.storage.getItem(this.storageKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [extensionId, enabled] of Object.entries(parsed)) {
        if (typeof enabled === 'boolean') {
          this.enabledById.set(extensionId, enabled);
        }
      }
    } catch (error) {
      console.warn('Failed to parse extension registry state', error);
      this.storage.removeItem(this.storageKey);
    }
  }

  private persistState(): void {
    if (!this.storage) {
      return;
    }

    const payload = Object.fromEntries(this.enabledById.entries());
    this.storage.setItem(this.storageKey, JSON.stringify(payload));
  }
}

export function createBuiltinExtensions(ops: BuiltinExtensionOperations): ExtensionDefinition[] {
  return [
    {
      id: 'workspace-accelerators',
      name: 'Workspace Accelerators',
      description: 'Command palette helpers for faster notebook and pipeline control.',
      version: '1.0.0',
      enabledByDefault: true,
      actions: [
        {
          id: 'run-focused-node',
          label: 'Run Focused Node',
          description: 'Execute the currently selected notebook/canvas node.',
          keywords: ['run', 'focused', 'node', 'execute'],
          isAvailable: () => ops.hasWorkerManager() && ops.hasFocusedNode(),
          run: () => {
            ops.runFocusedNode();
          },
        },
        {
          id: 'create-script-node',
          label: 'Create Script Node (Quick)',
          description: 'Instantly add a new script node and focus notebook editing.',
          keywords: ['create', 'node', 'script', 'notebook'],
          run: () => {
            ops.createScriptNode();
          },
        },
        {
          id: 'run-pipeline-safe',
          label: 'Run Pipeline (Safe Check)',
          description: 'Run the whole graph only when executable nodes and workers are available.',
          keywords: ['pipeline', 'graph', 'execute', 'safe'],
          isAvailable: () => ops.hasWorkerManager() && ops.hasExecutableNodes(),
          run: () => {
            ops.runPipeline();
          },
        },
      ],
    },
    {
      id: 'workspace-controls',
      name: 'Workspace Controls',
      description: 'Utility actions for viewport, persistence, and terminal maintenance.',
      version: '1.0.0',
      enabledByDefault: true,
      actions: [
        {
          id: 'save-project-now',
          label: 'Save Project Snapshot',
          description: 'Export current project state to a .berry archive.',
          keywords: ['save', 'berry', 'snapshot', 'export'],
          run: () => {
            ops.saveProject();
          },
        },
        {
          id: 'connect-worker-panel',
          label: 'Open Worker Connect',
          description: 'Open worker dashboard and focus websocket URL input.',
          keywords: ['worker', 'connect', 'dashboard'],
          isAvailable: () => ops.hasWorkerManager(),
          run: () => {
            ops.connectWorker();
          },
        },
        {
          id: 'toggle-view-mode',
          label: 'Toggle Workspace View',
          description: 'Switch between canvas and notebook layouts.',
          keywords: ['view', 'canvas', 'notebook', 'toggle'],
          run: () => {
            ops.toggleView();
          },
        },
        {
          id: 'clear-terminal-log',
          label: 'Clear Terminal Log',
          description: 'Clear streamed worker stdout/stderr lines from the terminal panel.',
          keywords: ['terminal', 'clear', 'logs'],
          isAvailable: () => ops.hasTerminalEntries(),
          run: () => {
            ops.clearTerminal();
          },
        },
      ],
    },
  ];
}
