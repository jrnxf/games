// Per-device data in localStorage, one key prefix per game. Every access is
// guarded: private windows and blocked storage throw, and games must still work.

export interface Store {
  load(key: string): string | null;
  save(key: string, value: string | null): void;
  loadJson<T>(key: string): T | null;
}

export function store(prefix: string): Store {
  const load = (key: string): string | null => {
    try {
      return localStorage.getItem(prefix + key);
    } catch {
      return null;
    }
  };
  return {
    load,
    save(key, value) {
      try {
        if (value === null) localStorage.removeItem(prefix + key);
        else localStorage.setItem(prefix + key, value);
      } catch {
        // Storage is optional.
      }
    },
    loadJson<T>(key: string): T | null {
      const raw = load(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
  };
}
