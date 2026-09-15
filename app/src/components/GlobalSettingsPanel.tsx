import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nanocoreSpec } from '../data/nanocoreSpec';
import { usePatchStore } from '../store/patchStore';
import { encodeSigned7Bit, GLOBAL_SETTING_FIELD } from '../midi/sysex';

const STORAGE_KEY = 'nanocore-editor.device-reference.v1';

interface DeviceReference {
  wireless: boolean;
  loopback: boolean;
  inputGain: number;
  usbVolume: number;
  btVolume: number;
  midiChannel: number;
}

const DEFAULTS: DeviceReference = {
  wireless: true,
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
 * Wireless, Loopback, Input Gain, USB/BT Volume and MIDI Channel are all live now — sent and read
 * via SysEx (opcodes 0x65/0x66, see midi/sysex.ts's GLOBAL_SETTINGS_POLL_OPCODE doc comment for
 * the format and how it was found 2026-09-12). While connected, this panel reflects and controls
 * the real device; while disconnected it falls back to a local-only reference you can jot values
 * into by hand. Language has no CC/SysEx at all (confirmed absent from a real capture that
 * changed it) — it's a ToneCommand UI-only setting, not shown here.
 */
export function GlobalSettingsPanel() {
  const { t } = useTranslation();
  const [ref, setRef] = useState<DeviceReference>(load);
  const globalSettings = usePatchStore((s) => s.globalSettings);
  const setGlobalSetting = usePatchStore((s) => s.setGlobalSetting);
  const connectionReady = usePatchStore((s) => s.connection.ready && !!s.connection.outputId && s.connection.connected);
  const live = connectionReady ? globalSettings : null;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ref));
  }, [ref]);

  const wireless = live?.wireless ?? ref.wireless;
  const loopback = live?.loopback ?? ref.loopback;
  const inputGain = live?.inputGainDb ?? ref.inputGain;
  const usbVolume = live?.usbVolume ?? ref.usbVolume;
  const btVolume = live?.btVolume ?? ref.btVolume;
  const midiChannel = live?.midiChannel ?? ref.midiChannel;

  return (
    <section className="global-settings">
      <h2 className="panel-title">{t('global.title', 'Global Settings')}</h2>
      <p className="panel-hint">
        {live
          ? t('global.hintLive', 'Live — reflects and controls the device directly.')
          : t(
              'global.hint',
              "Not connected — this is a local-only reference, nothing here is transmitted until you connect. Once connected, these become live device controls.",
            )}
      </p>

      <label className="global-settings__row">
        <span>{t('global.wireless', 'Wireless')}</span>
        <input
          type="checkbox"
          checked={wireless}
          onChange={(e) => {
            const value = e.target.checked;
            if (live) void setGlobalSetting(GLOBAL_SETTING_FIELD.WIRELESS, value ? 1 : 0);
            else setRef((r) => ({ ...r, wireless: value }));
          }}
        />
      </label>

      <label className="global-settings__row">
        <span>{t('global.loopback', 'Loopback')}</span>
        <input
          type="checkbox"
          checked={loopback}
          onChange={(e) => {
            const value = e.target.checked;
            if (live) void setGlobalSetting(GLOBAL_SETTING_FIELD.LOOPBACK, value ? 1 : 0);
            else setRef((r) => ({ ...r, loopback: value }));
          }}
        />
      </label>

      <label className="global-settings__row">
        <span>{t('global.inputGain', 'Input Gain')}</span>
        <input
          type="range"
          min={-20}
          max={20}
          value={inputGain}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (live) void setGlobalSetting(GLOBAL_SETTING_FIELD.INPUT_GAIN, encodeSigned7Bit(value));
            else setRef((r) => ({ ...r, inputGain: value }));
          }}
        />
        <span className="global-settings__value">{inputGain} dB</span>
      </label>

      <label className="global-settings__row">
        <span>{t('global.usbVolume', 'USB Volume')}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={usbVolume}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (live) void setGlobalSetting(GLOBAL_SETTING_FIELD.USB_VOLUME, value);
            else setRef((r) => ({ ...r, usbVolume: value }));
          }}
        />
        <span className="global-settings__value">{usbVolume}</span>
      </label>

      <label className="global-settings__row">
        <span>{t('global.btVolume', 'BT Volume')}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={btVolume}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (live) void setGlobalSetting(GLOBAL_SETTING_FIELD.BT_VOLUME, value);
            else setRef((r) => ({ ...r, btVolume: value }));
          }}
        />
        <span className="global-settings__value">{btVolume}</span>
      </label>

      <label className="global-settings__row">
        <span>{t('global.midiChannel', 'MIDI Channel')}</span>
        <input
          type="number"
          min={0}
          max={16}
          value={midiChannel}
          onChange={(e) => {
            const value = Math.min(16, Math.max(0, Number(e.target.value)));
            if (live) void setGlobalSetting(GLOBAL_SETTING_FIELD.MIDI_CHANNEL, value);
            else setRef((r) => ({ ...r, midiChannel: value }));
          }}
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
