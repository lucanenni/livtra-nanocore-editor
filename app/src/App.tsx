import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './App.css';
import { ChainView } from './components/ChainView';
import { BlockEditor } from './components/BlockEditor';
import { ConnectionPanel } from './components/ConnectionPanel';
import { PresetPanel } from './components/PresetPanel';
import { GlobalSettingsPanel } from './components/GlobalSettingsPanel';
import { CCReferencePanel } from './components/CCReferencePanel';
import { TunerPanel } from './components/TunerPanel';
import { ActivityLog } from './components/ActivityLog';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { InfoPanel } from './components/InfoPanel';
import { usePatchStore } from './store/patchStore';
import { nanocoreSpec } from './data/nanocoreSpec';

type Tab = 'chain' | 'presets' | 'global' | 'ccref' | 'tuner' | 'log' | 'info';

/** The preset currently loaded on the device (from `readPresetFromDevice`), shown above the
 * chain — editable in place: renaming here sends the live rename SysEx directly (see
 * `patchStore.ts`'s `renamePresetOnDevice`), the same one-does-both flow as everything else in
 * this banner. The device's own display numbers presets from 1, so show `activeSlot + 1`. */
function LoadedPresetBanner() {
  const { t } = useTranslation();
  const connected = usePatchStore((s) => s.connection.connected);
  const activeSlot = usePatchStore((s) => s.activeSlot);
  const activeSlotName = usePatchStore((s) => s.activeSlotName);
  const renamePresetOnDevice = usePatchStore((s) => s.renamePresetOnDevice);
  const [draft, setDraft] = useState(activeSlotName ?? '');
  const [focused, setFocused] = useState(false);

  // Keep the input in sync with the device's own name (a fresh read, a reconnect, a preset
  // recall) — but not while the user is actively editing, or every keystroke's local state would
  // get clobbered by the stale value still in the store until the rename round-trips.
  useEffect(() => {
    if (!focused) setDraft(activeSlotName ?? '');
  }, [activeSlotName, focused]);

  if (!connected || !activeSlotName) return null;

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== activeSlotName) renamePresetOnDevice(trimmed);
    else setDraft(activeSlotName);
  };

  return (
    <p className="loaded-preset">
      {t('chain.loadedPresetPrefix', { number: activeSlot + 1, defaultValue: 'Patch {{number}} —' })}{' '}
      <input
        className="loaded-preset__name-input"
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
        aria-label={t('chain.loadedPresetRename', 'Rename this patch on the device (max 8 characters)') ?? ''}
      />
    </p>
  );
}

function App() {
  const { t } = useTranslation();
  const initTransport = usePatchStore((s) => s.initTransport);
  // Show the "plug in your NanoCore" notice only while actually on a hardware transport that
  // isn't connected — not on the Simulator (a deliberate choice) or once a device is live.
  const showConnectNotice = usePatchStore(
    (s) => s.connection.transportKind !== 'simulator' && s.connection.ready && !s.connection.connected,
  );
  const [tab, setTab] = useState<Tab>('chain');
  const [selectedBlock, setSelectedBlock] = useState<string>(nanocoreSpec.blocks[0].id);

  useEffect(() => {
    // Start on Web MIDI when the browser supports it (the common case — this is a hardware
    // editor) so a connected NanoCore is picked up automatically. Fall back to the Simulator on
    // an unsupported browser, or if the MIDI-access prompt is denied/dismissed — the editor
    // stays fully usable either way.
    const canWebMidi =
      typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
    void (async () => {
      await initTransport(canWebMidi ? 'webmidi' : 'simulator');
      if (canWebMidi && !usePatchStore.getState().connection.ready) {
        await initTransport('simulator');
      }
    })();
  }, [initTransport]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'chain', label: t('nav.chain', 'Effect Chain') },
    { id: 'presets', label: t('nav.presets', 'Presets') },
    { id: 'global', label: t('nav.global', 'Global Settings') },
    { id: 'ccref', label: t('nav.ccref', 'CC Reference') },
    { id: 'tuner', label: t('nav.tuner', 'Tuner') },
    { id: 'log', label: t('nav.log', 'MIDI Activity') },
    { id: 'info', label: t('nav.info', 'About') },
  ];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__title">
          <h1>{t('app.title', 'NanoCore Editor')}</h1>
          <p>{t('app.subtitle', 'Unofficial online editor for the Livtra NanoCore mini multi-effect processor')}</p>
        </div>
        <LanguageSwitcher />
      </header>

      {showConnectNotice && (
        <p className="app-notice">
          {t(
            'app.noHardwareNotice',
            "No NanoCore found — plug it in over USB (or pair Bluetooth) and it connects automatically. No hardware? Switch to the Simulator to build a patch offline.",
          )}
        </p>
      )}

      <div className="app-layout">
        <aside className="app-sidebar">
          <ConnectionPanel />
          <nav className="app-tabs" aria-label={t('nav.sections', 'Sections')}>
            {tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                className={`app-tabs__item ${tab === tb.id ? 'app-tabs__item--active' : ''}`}
                aria-pressed={tab === tb.id}
                onClick={() => setTab(tb.id)}
              >
                {tb.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="app-main">
          {tab === 'chain' && (
            <>
              <LoadedPresetBanner />
              <ChainView selected={selectedBlock} onSelect={setSelectedBlock} />
              <BlockEditor blockId={selectedBlock} />
            </>
          )}
          {tab === 'presets' && <PresetPanel />}
          {tab === 'global' && <GlobalSettingsPanel />}
          {tab === 'ccref' && <CCReferencePanel />}
          {tab === 'tuner' && <TunerPanel />}
          {tab === 'log' && <ActivityLog />}
          {tab === 'info' && <InfoPanel />}
        </main>
      </div>
    </div>
  );
}

export default App;
