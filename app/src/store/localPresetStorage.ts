import type { PresetEntry } from './patchTypes';

const STORAGE_KEY = 'nanocore-editor.presets.v1';

export function loadPresets(): PresetEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function savePresets(presets: PresetEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Storage full or unavailable (private browsing) — silently ignore, export/import still works.
  }
}
