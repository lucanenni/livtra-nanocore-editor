import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nanocoreSpec } from '../data/nanocoreSpec';

const STORAGE_KEY = 'nanocore-editor.device-reference.v1';

interface DeviceReference {
  loopback: boolean;
  inputGain: number;
  usbVolume: number;
  btVolume: number;
  midiChannel: number;
}

const DEFAULTS: DeviceReference = {
  loopback: true,
  inputGain: 0,
  usbVolume: 100,
  btVolume: 100,
  midiChannel: 0,
};

function load(): DeviceReference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/**
 * None of these settings have a documented MIDI CC (see docs/MIDI_MAPPING_NOTES.md) — they
 * live only on the device / companion app. This panel is a local scratchpad so you can jot
 * down your hardware's current values; nothing here is ever transmitted.
 */
export function GlobalSettingsPanel() {
  const { t } = useTranslation();
  const [ref, setRef] = useState<DeviceReference>(load);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ref));
  }, [ref]);

  return (
    <section className="global-settings">
      <h2 className="panel-title">{t('global.title', 'Global Settings (device reference)')}</h2>
      <p className="panel-hint">{t('global.hint', 'These are set on the device itself or via the official companion app — no MIDI CC is documented for them. Mirror your hardware\'s values here just to keep track.')}</p>

      <label className="global-settings__row">
        <span>{t('global.loopback', 'Loopback')}</span>
        <input
          type="checkbox"
          checked={ref.loopback}
          onChange={(e) => setRef((r) => ({ ...r, loopback: e.target.checked }))}
        />
      </label>

      <label className="global-settings__row">
        <span>{t('global.inputGain', 'Input Gain')}</span>
        <input
          type="range"
          min={-20}
          max={20}
          value={ref.inputGain}
          onChange={(e) => setRef((r) => ({ ...r, inputGain: Number(e.target.value) }))}
        />
        <span className="global-settings__value">{ref.inputGain} dB</span>
      </label>

      <label className="global-settings__row">
        <span>{t('global.usbVolume', 'USB Volume')}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={ref.usbVolume}
          onChange={(e) => setRef((r) => ({ ...r, usbVolume: Number(e.target.value) }))}
        />
        <span className="global-settings__value">{ref.usbVolume}</span>
      </label>

      <label className="global-settings__row">
        <span>{t('global.btVolume', 'BT Volume')}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={ref.btVolume}
          onChange={(e) => setRef((r) => ({ ...r, btVolume: Number(e.target.value) }))}
        />
        <span className="global-settings__value">{ref.btVolume}</span>
      </label>

      <label className="global-settings__row">
        <span>{t('global.midiChannel', 'MIDI Channel')}</span>
        <input
          type="number"
          min={0}
          max={16}
          value={ref.midiChannel}
          onChange={(e) => setRef((r) => ({ ...r, midiChannel: Number(e.target.value) }))}
        />
      </label>
      <p className="panel-hint">{t('global.midiChannelHint', '0 = Omni (receives on all channels)')}</p>

      <div className="global-settings__row">
        <span>{t('global.firmware', 'Firmware')}</span>
        <span className="global-settings__value">{nanocoreSpec.meta.firmware}</span>
      </div>
    </section>
  );
}
