import { describe, expect, it } from "vitest";
import {
  THEME_STORAGE_KEY,
  normalizeThemePreference,
  readStoredThemePreference,
  resolveThemePreference,
  writeStoredThemePreference
} from "./theme-settings.js";

describe("theme settings helpers", () => {
  it("normalizes unsupported theme preferences to system", () => {
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("system")).toBe("system");
    expect(normalizeThemePreference("sepia")).toBe("system");
    expect(normalizeThemePreference(null)).toBe("system");
  });

  it("resolves explicit preferences before the system theme", () => {
    expect(resolveThemePreference("system", "light")).toBe("light");
    expect(resolveThemePreference("system", "dark")).toBe("dark");
    expect(resolveThemePreference("light", "dark")).toBe("light");
    expect(resolveThemePreference("dark", "light")).toBe("dark");
  });

  it("removes the override for system default and persists explicit preferences", () => {
    const storage = createMemoryStorage();

    writeStoredThemePreference("light", storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(readStoredThemePreference(storage)).toBe("light");

    writeStoredThemePreference("system", storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readStoredThemePreference(storage)).toBe("system");
  });

  it("falls back to system behavior when storage is unavailable", () => {
    const storage = createThrowingStorage();

    expect(readStoredThemePreference(storage)).toBe("system");
    expect(() => writeStoredThemePreference("dark", storage)).not.toThrow();
    expect(() => writeStoredThemePreference("system", storage)).not.toThrow();
  });
});

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
}

function createThrowingStorage() {
  return {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
    removeItem: () => {
      throw new Error("storage unavailable");
    }
  };
}
