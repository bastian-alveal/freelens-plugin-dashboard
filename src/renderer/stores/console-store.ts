export interface ConsoleTab {
  id: string;
  type: "logs" | "shell" | "manifest";
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  container?: string;
  title: string;
}

export interface TabLogCache {
  lines: string[];
  filterText: string;
  viewMode: "structured" | "raw";
  tailLines: number;
}

export interface TabShellCache {
  history: Array<{ command: string; output: string; exitCode: number }>;
}

const STORAGE_KEY_TABS = "freelens_fleet_console_tabs";
const STORAGE_KEY_ACTIVE = "freelens_fleet_console_active_tab";
const STORAGE_KEY_LOGS = "freelens_fleet_console_logs_cache";
const STORAGE_KEY_SHELL = "freelens_fleet_console_shell_cache";
const STORAGE_KEY_COLLAPSED = "freelens_fleet_console_collapsed";
const STORAGE_KEY_HEIGHT = "freelens_fleet_console_height";
const STORAGE_KEY_DASH_TAB = "freelens_fleet_active_nav_tab";

class ConsoleStore {
  private tabs: ConsoleTab[] = [];
  private activeTabId: string | null = null;
  private isCollapsed: boolean = false;
  private isMaximized: boolean = false;
  private customHeight: number = 360;
  private logCache: Record<string, TabLogCache> = {};
  private shellCache: Record<string, TabShellCache> = {};
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      const rawTabs = window.localStorage.getItem(STORAGE_KEY_TABS);
      if (rawTabs) {
        const parsed = JSON.parse(rawTabs);
        if (Array.isArray(parsed)) this.tabs = parsed;
      }
      const rawActive = window.localStorage.getItem(STORAGE_KEY_ACTIVE);
      if (rawActive) this.activeTabId = rawActive;
      else if (this.tabs.length > 0) this.activeTabId = this.tabs[0].id;

      const rawLogs = window.localStorage.getItem(STORAGE_KEY_LOGS);
      if (rawLogs) this.logCache = JSON.parse(rawLogs);

      const rawShell = window.localStorage.getItem(STORAGE_KEY_SHELL);
      if (rawShell) this.shellCache = JSON.parse(rawShell);

      const rawHeight = window.localStorage.getItem(STORAGE_KEY_HEIGHT);
      if (rawHeight) {
        const h = Number(rawHeight);
        if (h >= 160 && h <= 900) this.customHeight = h;
      }

      const rawCollapsed = window.localStorage.getItem(STORAGE_KEY_COLLAPSED);
      if (rawCollapsed !== null) this.isCollapsed = rawCollapsed === "true";
    } catch (e) {
      console.warn("[ConsoleStore] Failed to load cached tabs from localStorage:", e);
    }
  }

  private saveToStorage() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(this.tabs));
      if (this.activeTabId) {
        window.localStorage.setItem(STORAGE_KEY_ACTIVE, this.activeTabId);
      } else {
        window.localStorage.removeItem(STORAGE_KEY_ACTIVE);
      }
      window.localStorage.setItem(STORAGE_KEY_COLLAPSED, String(this.isCollapsed));
      window.localStorage.setItem(STORAGE_KEY_HEIGHT, String(this.customHeight));

      // Persist trimmed log cache (keep at most last 1000 lines per tab to prevent storage bloat)
      const trimmedLogs: Record<string, TabLogCache> = {};
      for (const [key, val] of Object.entries(this.logCache)) {
        trimmedLogs[key] = {
          ...val,
          lines: (val.lines || []).slice(-1000),
        };
      }
      window.localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(trimmedLogs));
      window.localStorage.setItem(STORAGE_KEY_SHELL, JSON.stringify(this.shellCache));
    } catch (e) {
      console.warn("[ConsoleStore] Failed to save tabs to localStorage:", e);
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.saveToStorage();
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (err) {
        console.error("[ConsoleStore] Listener error:", err);
      }
    });
  }

  public getTabs(): ConsoleTab[] {
    return this.tabs;
  }

  public getActiveTabId(): string | null {
    return this.activeTabId;
  }

  public getIsCollapsed(): boolean {
    return this.isCollapsed;
  }

  public getIsMaximized(): boolean {
    return this.isMaximized;
  }

  public getCustomHeight(): number {
    return this.customHeight;
  }

  public setIsCollapsed(collapsed: boolean) {
    this.isCollapsed = collapsed;
    this.notify();
  }

  public setIsMaximized(maximized: boolean) {
    this.isMaximized = maximized;
    if (maximized) this.isCollapsed = false;
    this.notify();
  }

  public setCustomHeight(height: number) {
    this.customHeight = Math.max(160, Math.min(height, 800));
    this.notify();
  }

  public openTab(tab: ConsoleTab) {
    const existingIndex = this.tabs.findIndex((t) => t.id === tab.id);
    if (existingIndex >= 0) {
      this.tabs[existingIndex] = tab;
    } else {
      this.tabs.push(tab);
    }
    this.activeTabId = tab.id;
    this.isCollapsed = false;
    this.notify();
  }

  public selectTab(tabId: string) {
    this.activeTabId = tabId;
    this.isCollapsed = false;
    this.notify();
  }

  public closeTab(tabId: string) {
    const nextTabs = this.tabs.filter((t) => t.id !== tabId);
    this.tabs = nextTabs;
    if (this.activeTabId === tabId) {
      this.activeTabId = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].id : null;
    }
    delete this.logCache[tabId];
    delete this.shellCache[tabId];
    this.notify();
  }

  public closeAllTabs() {
    this.tabs = [];
    this.activeTabId = null;
    this.logCache = {};
    this.shellCache = {};
    this.notify();
  }

  // Logs Cache Methods
  public getLogCache(tabId: string): TabLogCache | undefined {
    return this.logCache[tabId];
  }

  public setLogCache(tabId: string, cache: Partial<TabLogCache>) {
    const current = this.logCache[tabId] || {
      lines: [],
      filterText: "",
      viewMode: "structured",
      tailLines: 100,
    };
    this.logCache[tabId] = { ...current, ...cache };
    // Debounced storage save for fast logging updates
    this.scheduleSave();
  }

  // Shell Cache Methods
  public getShellCache(tabId: string): TabShellCache | undefined {
    return this.shellCache[tabId];
  }

  public setShellCache(tabId: string, cache: Partial<TabShellCache>) {
    const current = this.shellCache[tabId] || { history: [] };
    this.shellCache[tabId] = { ...current, ...cache };
    this.scheduleSave();
  }

  private saveTimer: any = null;
  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveToStorage();
    }, 1500);
  }

  // Active Dashboard Nav Tab Persistence
  public getSavedNavTab(): string | null {
    try {
      return window.localStorage.getItem(STORAGE_KEY_DASH_TAB);
    } catch {
      return null;
    }
  }

  public setSavedNavTab(navTab: string) {
    try {
      window.localStorage.setItem(STORAGE_KEY_DASH_TAB, navTab);
    } catch {
      // ignore
    }
  }
}

// Global Singleton (persists in renderer memory as long as FreeLens runs)
export const consoleStore = new ConsoleStore();
