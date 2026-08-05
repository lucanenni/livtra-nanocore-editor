import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './App.css';
import { ChainView } from './components/ChainView';
import { BlockEditor } from './components/BlockEditor';
import { ConnectionPanel } from './components/ConnectionPanel';
import { PresetPanel } from './components/PresetPanel';
import { GlobalSettingsPanel } from './components/GlobalSettingsPanel';
import { TunerPanel } from './components/TunerPanel';
import { ActivityLog } from './components/ActivityLog';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { usePatchStore } from './store/patchStore';
import { nanocoreSpec } from './data/nanocoreSpec';

type Tab = 'chain' | 'presets' | 'global' | 'tuner' | 'log';

function App() {
  const { t } = useTranslation();
  const initTransport = usePatchStore((s) => s.initTransport);
  const [tab, setTab] = useState<Tab>('chain');
  const [selectedBlock, setSelectedBlock] = useState<string>(nanocoreSpec.blocks[0].id);

  useEffect(() => {
    // Default to the Simulator so the whole editor is usable before hardware arrives.
    initTransport('simulator');
  }, [initTransport]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'chain', label: t('nav.chain', 'Effect Chain') },
    { id: 'presets', label: t('nav.presets', 'Presets') },
    { id: 'global', label: t('nav.global', 'Global Settings') },
    { id: 'tuner', label: t('nav.tuner', 'Tuner') },
    { id: 'log', label: t('nav.log', 'MIDI Activity') },
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

      <p className="app-notice">
        {t(
          'app.noHardwareNotice',
          'No NanoCore connected yet — build your patch and try it in the Simulator. Switch to Web MIDI once your hardware arrives.',
        )}
      </p>

      <div className="app-layout">
        <aside className="app-sidebar">
          <ConnectionPanel />
          <nav className="app-tabs">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                className={`app-tabs__item ${tab === tb.id ? 'app-tabs__item--active' : ''}`}
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
              <ChainView selected={selectedBlock} onSelect={setSelectedBlock} />
              <BlockEditor blockId={selectedBlock} />
            </>
          )}
          {tab === 'presets' && <PresetPanel />}
          {tab === 'global' && <GlobalSettingsPanel />}
          {tab === 'tuner' && <TunerPanel />}
          {tab === 'log' && <ActivityLog />}
        </main>
      </div>
    </div>
  );
}

export default App;
