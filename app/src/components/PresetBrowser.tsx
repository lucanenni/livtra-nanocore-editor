import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nanocoreSpec } from '@nanocore/protocol';
import { usePatchStore } from '../store/patchStore';

const PRESET_COUNT = nanocoreSpec.meta.presetSlots;
/** Name an unsaved device slot holds. */
const EMPTY_SLOT_NAME = 'preset';
const GRID_OPEN_KEY = 'nanocore-editor.preset-grid-open';

function loadGridOpen(): boolean {
  try {
    return localStorage.getItem(GRID_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Above the effect chain: the preset loaded on the device, with ◀ ▶ to step through the device's
 * presets (like the official app) and its name editable in place — renaming also saves the preset to
 * its slot (`renameAndSaveActivePreset`), as ToneCommand does, or the device would drop the new name
 * on the next preset change. "All presets" opens a grid
 * of every preset by number and name (`presetNames`, read on connect) to jump straight to one.
 * The device's display numbers presets from 1, so everything shown here is `slot + 1`.
 */
export function PresetBrowser() {
  const { t } = useTranslation();
  const connected = usePatchStore((s) => s.connection.connected && s.connection.transportKind !== 'simulator');
  const activeSlot = usePatchStore((s) => s.activeSlot);
  const activeSlotName = usePatchStore((s) => s.activeSlotName);
  const presetNames = usePatchStore((s) => s.presetNames);
  const namesLoading = usePatchStore((s) => s.presetNamesLoading);
  const switchingTo = usePatchStore((s) => s.presetSwitchingTo);
  const selectDevicePreset = usePatchStore((s) => s.selectDevicePreset);
  const readPresetNames = usePatchStore((s) => s.readPresetNames);
  const renameAndSaveActivePreset = usePatchStore((s) => s.renameAndSaveActivePreset);
  const [draft, setDraft] = useState(activeSlotName ?? '');
  const [focused, setFocused] = useState(false);
  const [gridOpen, setGridOpen] = useState(loadGridOpen);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(activeSlotName ?? '');
  }, [activeSlotName, focused]);

  if (!connected) return null;

  const busy = switchingTo !== null;
  const step = (delta: number) => void selectDevicePreset((activeSlot + delta + PRESET_COUNT) % PRESET_COUNT);
  const toggleGrid = () => {
    const open = !gridOpen;
    setGridOpen(open);
    try {
      localStorage.setItem(GRID_OPEN_KEY, open ? '1' : '0');
    } catch {
      // Not remembered — the grid just starts closed next time.
    }
  };
  const commit = () => {
    const trimmed = draft.trim();
    if (activeSlotName && trimmed && trimmed !== activeSlotName) {
      setSaveFailed(false);
      void renameAndSaveActivePreset(trimmed).then((saved) => setSaveFailed(!saved));
    } else setDraft(activeSlotName ?? '');
  };

  return (
    <section className="preset-browser" aria-busy={busy || namesLoading}>
      <div className="preset-browser__bar">
        <button type="button" className="btn btn--small" onClick={() => step(-1)} disabled={busy} aria-label={t('devicePresets.prev', 'Previous preset') ?? ''}>
          ◀
        </button>
        <div className="preset-browser__current">
          {busy ? (
            <span className="preset-browser__loading" role="status">
              <span className="spinner" aria-hidden />{' '}
              {t('devicePresets.switchingNumber', { number: switchingTo + 1, defaultValue: 'Loading preset {{number}}…' })}
            </span>
          ) : (
            <>
              <span className="preset-browser__number">{String(activeSlot + 1).padStart(2, '0')}</span>
              {activeSlotName !== null && (
                <input
                  className="preset-browser__name-input"
                  value={draft}
                  maxLength={8}
                  onFocus={() => setFocused(true)}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    setFocused(false);
                    commit();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    else if (e.key === 'Escape') {
                      setDraft(activeSlotName);
                      e.currentTarget.blur();
                    }
                  }}
                  aria-label={t('devicePresets.rename', 'Rename and save this preset on the device (max 8 characters)') ?? ''}
                  title={t('devicePresets.rename', 'Rename and save this preset on the device (max 8 characters)') ?? ''}
                />
              )}
            </>
          )}
        </div>
        <button type="button" className="btn btn--small" onClick={() => step(1)} disabled={busy} aria-label={t('devicePresets.next', 'Next preset') ?? ''}>
          ▶
        </button>
        <div className="preset-browser__spacer" />
        <button
          type="button"
          className="btn btn--small btn--ghost preset-browser__toggle"
          onClick={toggleGrid}
          aria-expanded={gridOpen}
          aria-controls="preset-browser-grid"
        >
          {t('devicePresets.all', 'All presets')}
          <span className={`chevron ${gridOpen ? 'chevron--up' : ''}`} aria-hidden />
        </button>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={() => void readPresetNames()}
          disabled={namesLoading}
          aria-label={t('devicePresets.refresh', 'Re-read the preset names from the device') ?? ''}
        >
          ↻
        </button>
      </div>

      {saveFailed && (
        <p className="preset-browser__status" role="alert">
          {t('devicePresets.renameSaveFailed', 'No response from the device — the new name may not have been saved.')}
        </p>
      )}

      {gridOpen && (
        <div id="preset-browser-grid">
          {namesLoading && !presetNames && (
            <p className="preset-browser__status" role="status">
              <span className="spinner" aria-hidden /> {t('devicePresets.loading', 'Loading presets…')}
            </p>
          )}
          {presetNames && (
            <ol className="preset-browser__grid">
              {Array.from({ length: PRESET_COUNT }, (_, slot) => {
                const name = presetNames[slot] ?? '—';
                const active = slot === activeSlot;
                return (
                  <li key={slot}>
                    <button
                      type="button"
                      className={[
                        'preset-browser__item',
                        active ? 'preset-browser__item--active' : '',
                        name === EMPTY_SLOT_NAME ? 'preset-browser__item--empty' : '',
                      ].join(' ')}
                      aria-current={active ? 'true' : undefined}
                      disabled={busy}
                      onClick={() => void selectDevicePreset(slot)}
                    >
                      <span className="preset-browser__item-number">{String(slot + 1).padStart(2, '0')}</span>
                      <span className="preset-browser__item-name">{name}</span>
                      {slot === switchingTo && <span className="spinner" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
