import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchStore } from '../store/patchStore';

function downloadJSON(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function PresetPanel() {
  const { t } = useTranslation();
  const presets = usePatchStore((s) => s.presets);
  const activePresetId = usePatchStore((s) => s.activePresetId);
  const activePresetDirty = usePatchStore((s) => s.activePresetDirty);
  const savePresetLocal = usePatchStore((s) => s.savePresetLocal);
  const renamePreset = usePatchStore((s) => s.renamePreset);
  const updateActivePreset = usePatchStore((s) => s.updateActivePreset);
  const deletePreset = usePatchStore((s) => s.deletePreset);
  const applyPreset = usePatchStore((s) => s.applyPreset);
  const exportPresets = usePatchStore((s) => s.exportPresets);
  const importPresets = usePatchStore((s) => s.importPresets);
  const exportCurrentPatch = usePatchStore((s) => s.exportCurrentPatch);
  const importPatch = usePatchStore((s) => s.importPatch);
  const sendFullPatch = usePatchStore((s) => s.sendFullPatch);
  const recallProgram = usePatchStore((s) => s.recallProgram);
  const stepPreset = usePatchStore((s) => s.stepPreset);
  const connectionReady = usePatchStore((s) => s.connection.ready && !!s.connection.outputId);

  const [newName, setNewName] = useState('');
  const [programNumber, setProgramNumber] = useState(0);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importPatchMessage, setImportPatchMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patchFileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    savePresetLocal(newName);
    setNewName('');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importPresets(String(reader.result));
      setImportMessage(
        result.ok
          ? t('preset.importResult', { count: 1, defaultValue: 'Import complete.' })
          : t('preset.importError', { error: result.error, defaultValue: 'Import failed: {{error}}' }),
      );
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportPatchFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importPatch(String(reader.result));
      setImportPatchMessage(
        result.ok
          ? t('preset.importPatchResult', 'Patch loaded into the editor.')
          : t('preset.importError', { error: result.error, defaultValue: 'Import failed: {{error}}' }),
      );
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <section className="preset-panel">
      <h2 className="panel-title">{t('preset.title', 'Preset Library')}</h2>

      <div className="preset-panel__push">
        <button type="button" className="btn btn--accent" onClick={sendFullPatch} disabled={!connectionReady}>
          {t('preset.sendToDevice', 'Send patch to device')}
        </button>
        <p className="panel-hint">
          {t(
            'preset.sendToDeviceHint',
            "Transmits every block's on/off, type and parameter CC for the current patch. Remember to save it on the device afterwards (long-press MASTER) if you want it to persist.",
          )}
        </p>
      </div>

      <div className="preset-panel__current-io">
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => downloadJSON('nanocore-patch.json', exportCurrentPatch())}
        >
          {t('preset.exportCurrent', 'Export current patch (.json)')}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => patchFileInputRef.current?.click()}>
          {t('preset.importCurrent', 'Import patch (.json)')}
        </button>
        <input ref={patchFileInputRef} type="file" accept="application/json" hidden onChange={handleImportPatchFile} />
      </div>
      {importPatchMessage && <p className="panel-hint">{importPatchMessage}</p>}

      <div className="preset-panel__new">
        <input
          type="text"
          placeholder={t('preset.newName', 'Preset name') ?? ''}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="button" className="btn" onClick={handleSave}>
          {t('preset.save', 'Save as new preset')}
        </button>
      </div>

      {activePresetId && activePresetDirty && (
        <div className="preset-panel__dirty">
          <span>{t('preset.dirty', 'Unsaved changes')}</span>
          <button type="button" className="btn btn--small" onClick={updateActivePreset}>
            {t('preset.update', 'Update')}
          </button>
        </div>
      )}

      {presets.length === 0 ? (
        <p className="panel-hint">{t('preset.empty', 'No saved presets yet. Build a patch and click "Save as new preset".')}</p>
      ) : (
        <ul className="preset-panel__list">
          {presets.map((p) => (
            <li key={p.id} className={`preset-panel__item ${p.id === activePresetId ? 'preset-panel__item--active' : ''}`}>
              <input
                className="preset-panel__item-name"
                value={p.name}
                onChange={(e) => renamePreset(p.id, e.target.value)}
              />
              <button type="button" className="btn btn--small" onClick={() => applyPreset(p.id)}>
                {t('preset.load', 'Load')}
              </button>
              <button
                type="button"
                className="btn btn--small btn--danger"
                onClick={() => {
                  if (window.confirm(t('preset.confirmDelete', { name: p.name, defaultValue: 'Delete preset "{{name}}"?' }) ?? '')) {
                    deletePreset(p.id);
                  }
                }}
              >
                {t('preset.delete', 'Delete')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="preset-panel__io">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => downloadJSON('nanocore-presets.json', exportPresets())}
        >
          {t('preset.export', 'Export all (.json)')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => fileInputRef.current?.click()}>
          {t('preset.import', 'Import (.json)')}
        </button>
        <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={handleImportFile} />
      </div>
      {importMessage && <p className="panel-hint">{importMessage}</p>}

      <div className="preset-panel__recall">
        <h3 className="panel-subtitle">{t('preset.recallTitle', 'Recall device preset')}</h3>
        <p className="panel-hint">
          {t(
            'preset.recallHint',
            'Program Change only tells the NanoCore which of its own stored presets to load — it does not read the resulting parameters back into this editor.',
          )}
        </p>
        <p className="panel-hint">
          {t(
            'preset.recallOffsetHint',
            'Confirmed on hardware: the device\'s own preset display is 1 higher than the number here — sending 0 recalls what the device shows as preset "1", sending 5 recalls "6", and so on.',
          )}
        </p>
        <div className="preset-panel__recall-row">
          <button type="button" className="btn btn--small" onClick={() => stepPreset('prev')} disabled={!connectionReady}>
            {t('preset.prev', 'Previous')}
          </button>
          <input
            type="number"
            min={0}
            max={127}
            value={programNumber}
            onChange={(e) => setProgramNumber(Number(e.target.value))}
            aria-label={t('preset.programNumber', 'Preset number (0-127)') ?? ''}
          />
          <button type="button" className="btn btn--small" onClick={() => recallProgram(programNumber)} disabled={!connectionReady}>
            {t('preset.recall', 'Recall')}
          </button>
          <button type="button" className="btn btn--small" onClick={() => stepPreset('next')} disabled={!connectionReady}>
            {t('preset.next', 'Next')}
          </button>
        </div>
      </div>
    </section>
  );
}
