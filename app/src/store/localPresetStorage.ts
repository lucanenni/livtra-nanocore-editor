import type { PresetEntry } from '@nanocore/protocol';

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

const DEVICE_PRESET_NAMES_KEY = 'nanocore-editor.device-preset-names.v1';

/** The device's preset names as last read, so the preset list shows up before (or without) a fresh
 * read. `null` when nothing usable is stored. */
export function loadDevicePresetNames(): (string | null)[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEVICE_PRESET_NAMES_KEY) ?? 'null');
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((n) => (typeof n === 'string' ? n : null));
  } catch {
    return null;
  }
}

export function saveDevicePresetNames(names: (string | null)[]): void {
  try {
    localStorage.setItem(DEVICE_PRESET_NAMES_KEY, JSON.stringify(names));
  } catch {
    // Storage full or unavailable — the list is simply re-read on the next connect.
  }
}
