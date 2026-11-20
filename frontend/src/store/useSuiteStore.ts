import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ToastItem } from '../types/music';
import type {
  AppSettings,
  IslandNotesTasks,
  PlatformCapabilities,
  WindowRouteKind,
} from '../types/suite';
import { DEFAULT_SETTINGS } from '../types/suite';
import {
  detectBrowserCapabilities,
  getWindowRoute,
  isTauriRuntime,
  mergeSettings,
  safeInvoke,
  safeListen,
} from './tauriBridge';

const SETTINGS_STORAGE_KEY = 'constellation.suite.settings.v1';
const NOTES_TASKS_STORAGE_KEY = 'constellation.suite.notes_tasks.v1';

const DEFAULT_NOTES_TASKS: IslandNotesTasks = {
  notes: '',
  tasks: [],
};

export interface SuiteContextValue {
  settings: AppSettings;
  settingsLoaded: boolean;
  updateSettings: (
    updater: Partial<AppSettings> | ((prev: AppSettings) => AppSettings),
  ) => void;
  updateSection: <K extends keyof AppSettings>(
    section: K,
    patch: Partial<AppSettings[K]>,
  ) => void;
  resetSettings: () => void;
  capabilities: PlatformCapabilities;
  notesTasks: IslandNotesTasks;
  saveNotesTasks: (next: IslandNotesTasks) => void;
  toasts: ToastItem[];
  pushToast: (message: string, tone?: ToastItem['tone']) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  mixerOpen: boolean;
  setMixerOpen: (open: boolean) => void;
  lockOpen: boolean;
  setLockOpen: (open: boolean) => void;
  windowRoute: WindowRouteKind;
}

const SuiteContext = createContext<SuiteContextValue | null>(null);

function readLocalSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return mergeSettings(DEFAULT_SETTINGS);
    return mergeSettings(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return mergeSettings(DEFAULT_SETTINGS);
  }
}

function readLocalNotesTasks(): IslandNotesTasks {
  try {
    const raw = localStorage.getItem(NOTES_TASKS_STORAGE_KEY);
    if (!raw) return DEFAULT_NOTES_TASKS;
    const parsed = JSON.parse(raw) as Partial<IslandNotesTasks>;
    return {
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  } catch {
    return DEFAULT_NOTES_TASKS;
  }
}

export function SuiteProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => readLocalSettings());
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [capabilities, setCapabilities] = useState<PlatformCapabilities>(() =>
    detectBrowserCapabilities(),
  );
  const [notesTasks, setNotesTasks] = useState<IslandNotesTasks>(() => readLocalNotesTasks());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);

  const windowRoute = useMemo(() => getWindowRoute(), []);
  const saveTimerRef = useRef<number | null>(null);
  const toastTimersRef = useRef<number[]>([]);

  const pushToast = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2400);
    toastTimersRef.current.push(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      for (const timer of toastTimersRef.current) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  // Load initial settings, capabilities, and notes/tasks from Tauri if present
  useEffect(() => {
    let active = true;

    async function hydrate() {
      if (isTauriRuntime()) {
        const [remoteSettings, remoteCaps, remoteNotes] = await Promise.all([
          safeInvoke<Partial<AppSettings>>('get_settings'),
          safeInvoke<PlatformCapabilities>('get_platform_capabilities'),
          safeInvoke<IslandNotesTasks>('get_island_notes_tasks'),
        ]);

        if (!active) return;

        if (remoteSettings) {
          const merged = mergeSettings(remoteSettings);
          setSettings(merged);
          try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
          } catch {
            // Ignore storage quota issues
          }
        }
        if (remoteCaps) {
          setCapabilities(remoteCaps);
        }
        if (remoteNotes) {
          const cleanNotes: IslandNotesTasks = {
            notes: typeof remoteNotes.notes === 'string' ? remoteNotes.notes : '',
            tasks: Array.isArray(remoteNotes.tasks) ? remoteNotes.tasks : [],
          };
          setNotesTasks(cleanNotes);
          try {
            localStorage.setItem(NOTES_TASKS_STORAGE_KEY, JSON.stringify(cleanNotes));
          } catch {
            // Ignore storage quota issues
          }
        }
      }
      if (active) setSettingsLoaded(true);
    }

    void hydrate();
    return () => {
      active = false;
    };
  }, []);

  // Cross-window settings and notes synchronization
  useEffect(() => {
    let cancelled = false;
    let unlistenSettings: (() => void) | null = null;
    let unlistenNotes: (() => void) | null = null;

    void safeListen<Partial<AppSettings>>('settings-synced', (payload) => {
      if (cancelled) return;
      const merged = mergeSettings(payload);
      setSettings(merged);
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
      } catch {
        // Ignore storage error
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenSettings = fn;
    });

    void safeListen<IslandNotesTasks>('notes-tasks-synced', (payload) => {
      if (cancelled) return;
      const cleanNotes: IslandNotesTasks = {
        notes: typeof payload?.notes === 'string' ? payload.notes : '',
        tasks: Array.isArray(payload?.tasks) ? payload.tasks : [],
      };
      setNotesTasks(cleanNotes);
      try {
        localStorage.setItem(NOTES_TASKS_STORAGE_KEY, JSON.stringify(cleanNotes));
      } catch {
        // Ignore storage error
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenNotes = fn;
    });

    const onStorage = (ev: StorageEvent) => {
      if (ev.key === SETTINGS_STORAGE_KEY && ev.newValue) {
        try {
          setSettings(mergeSettings(JSON.parse(ev.newValue) as Partial<AppSettings>));
        } catch {
          // Ignore malformed storage payload
        }
      } else if (ev.key === NOTES_TASKS_STORAGE_KEY && ev.newValue) {
        try {
          const parsed = JSON.parse(ev.newValue) as Partial<IslandNotesTasks>;
          setNotesTasks({
            notes: typeof parsed.notes === 'string' ? parsed.notes : '',
            tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
          });
        } catch {
          // Ignore malformed storage payload
        }
      }
    };

    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      if (unlistenSettings) unlistenSettings();
      if (unlistenNotes) unlistenNotes();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const persistSettings = useCallback((next: AppSettings) => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void safeInvoke('save_settings', { settings: next });
    }, 80);
  }, []);

  const updateSettings = useCallback(
    (updater: Partial<AppSettings> | ((prev: AppSettings) => AppSettings)) => {
      setSettings((prev) => {
        const next =
          typeof updater === 'function'
            ? mergeSettings(updater(prev))
            : mergeSettings({
                lyrics: updater.lyrics ? { ...prev.lyrics, ...updater.lyrics } : prev.lyrics,
                live: updater.live ? { ...prev.live, ...updater.live } : prev.live,
                glow: updater.glow ? { ...prev.glow, ...updater.glow } : prev.glow,
                island: updater.island ? { ...prev.island, ...updater.island } : prev.island,
                desktop: updater.desktop ? { ...prev.desktop, ...updater.desktop } : prev.desktop,
                lock: updater.lock ? { ...prev.lock, ...updater.lock } : prev.lock,
                utilities: updater.utilities
                  ? { ...prev.utilities, ...updater.utilities }
                  : prev.utilities,
              });
        persistSettings(next);
        return next;
      });
    },
    [persistSettings],
  );

  const updateSection = useCallback(
    <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => {
      setSettings((prev) => {
        const next: AppSettings = {
          ...prev,
          [section]: {
            ...prev[section],
            ...patch,
          },
        };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings],
  );

  const resetSettings = useCallback(() => {
    const fresh = mergeSettings(DEFAULT_SETTINGS);
    setSettings(fresh);
    persistSettings(fresh);
    pushToast('Suite settings restored', 'info');
  }, [persistSettings, pushToast]);

  const saveNotesTasks = useCallback((next: IslandNotesTasks) => {
    setNotesTasks(next);
    try {
      localStorage.setItem(NOTES_TASKS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota error
    }
    void safeInvoke('save_island_notes_tasks', { data: next });
  }, []);

  const value = useMemo<SuiteContextValue>(
    () => ({
      settings,
      settingsLoaded,
      updateSettings,
      updateSection,
      resetSettings,
      capabilities,
      notesTasks,
      saveNotesTasks,
      toasts,
      pushToast,
      settingsOpen,
      setSettingsOpen,
      mixerOpen,
      setMixerOpen,
      lockOpen,
      setLockOpen,
      windowRoute,
    }),
    [
      settings,
      settingsLoaded,
      updateSettings,
      updateSection,
      resetSettings,
      capabilities,
      notesTasks,
      saveNotesTasks,
      toasts,
      pushToast,
      settingsOpen,
      mixerOpen,
      lockOpen,
      windowRoute,
    ],
  );

  return createElement(SuiteContext.Provider, { value }, children);
}

export function useSuiteStore(): SuiteContextValue {
  const ctx = useContext(SuiteContext);
  if (!ctx) {
    throw new Error('useSuiteStore must be used within a SuiteProvider');
  }
  return ctx;
}
