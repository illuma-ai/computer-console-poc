import { readStored, writeStored } from "./storage";
import type { KeyValueStorage } from "./storage";

/**
 * The colour theme. `system` follows the operating system; `light` and `dark` force one. The choice is a
 * per-browser convenience, so it lives in the browser store only.
 */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** The key the chosen theme is stored under. */
export const THEME_STORAGE_KEY = "computer-manager.sample.theme";

/**
 * Reads a theme name. Anything unknown falls back to `system`, so a stale value cannot break the page.
 *
 * @param value The raw stored value.
 */
export function readTheme(value: string | null): Theme {
  return THEMES.find((theme) => theme === value) ?? "system";
}

/** Reads the saved theme. `system` when none is saved or the store is unreachable. */
export function loadTheme(storage: KeyValueStorage | null): Theme {
  return readTheme(readStored(storage, THEME_STORAGE_KEY));
}

/** Saves the theme. Returns false when the store refused the write. */
export function saveTheme(storage: KeyValueStorage | null, theme: Theme): boolean {
  return writeStored(storage, THEME_STORAGE_KEY, theme);
}

/**
 * Whether the theme resolves to dark. `system` asks the operating system.
 *
 * @param theme The chosen theme.
 * @param prefersDark The operating system's preference (`prefers-color-scheme: dark`).
 */
export function isDark(theme: Theme, prefersDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && prefersDark);
}

/**
 * Applies the theme to the page: the `dark` class on the root element, which the stylesheet's dark tokens
 * are keyed on.
 *
 * @param theme The chosen theme.
 * @param root The root element to mark.
 * @param prefersDark The operating system's preference.
 */
export function applyTheme(theme: Theme, root: HTMLElement, prefersDark: boolean): void {
  root.classList.toggle("dark", isDark(theme, prefersDark));
  root.dataset["theme"] = theme;
}
