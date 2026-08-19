import { useTranslation } from 'react-i18next';
import { usePatchStore } from '../store/patchStore';
import type { TransportKind } from '../store/patchStore';

const TRANSPORTS: TransportKind[] = ['simulator', 'webmidi', 'bluetooth'];

export function ConnectionPanel() {
  const { t } = useTranslation();
  const connection = usePatchStore((s) => s.connection);
  const initTransport = usePatchStore((s) => s.initTransport);
  const refreshOutputs = usePatchStore((s) => s.refreshOutputs);
  const disconnectBluetooth = usePatchStore((s) => s.disconnectBluetooth);
  const setOutput = usePatchStore((s) => s.setOutput);
  const setChannel = usePatchStore((s) => s.setChannel);

  const statusLabel = connection.error
    ? t('connection.statusError', 'Error')
    : connection.initializing
      ? t('connection.statusInitializing', 'Connecting…')
      : connection.ready
        ? t('connection.statusReady', 'Ready')
        : t('connection.statusNotReady', 'Not connected');

  const statusClass = connection.error ? 'status-dot--error' : connection.ready ? 'status-dot--ok' : 'status-dot--idle';

  const transportLabel = (kind: TransportKind) => {
    if (kind === 'simulator') return t('connection.transportSimulator', 'Simulator (no hardware needed)');
    if (kind === 'bluetooth') return t('connection.transportBluetooth', 'Bluetooth (pair from this page)');
    return t('connection.transportWebmidi', 'Web MIDI (USB / OS-paired Bluetooth)');
  };

  return (
    <section className="connection-panel">
      <h2 className="panel-title">{t('connection.title', 'MIDI Connection')}</h2>

      <div className="connection-panel__stack">
        <span className="connection-panel__field-label">{t('connection.transport', 'Transport')}</span>
        <div className="segmented segmented--stacked">
          {TRANSPORTS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`segmented__option ${connection.transportKind === kind ? 'segmented__option--active' : ''}`}
              aria-pressed={connection.transportKind === kind}
              onClick={() => initTransport(kind)}
            >
              {transportLabel(kind)}
            </button>
          ))}
        </div>
        {connection.transportKind === 'bluetooth' ? (
          <p className="connection-panel__hint">
            {t(
              'connection.bluetoothHint',
              "Opens the browser's device picker (Chrome/Edge/Opera only, requires HTTPS or localhost) and connects directly to the NanoCore's Bluetooth MIDI service — no OS-level pairing needed. Toggle Bluetooth off/on on the device first if it doesn't show up, and make sure nothing else (e.g. the official phone app) already holds the connection. Already connected? Selecting this again won't re-prompt — use Disconnect below first to pick a different device.",
            )}
          </p>
        ) : (
          <p className="connection-panel__hint">
            {t(
              'connection.pairingHint',
              'USB and Bluetooth both work. For Bluetooth here, pair the NanoCore at the OS level first (on macOS: Audio MIDI Setup → MIDI Studio → Bluetooth) — toggle Bluetooth off/on on the device to wake its advertising, and make sure nothing else (e.g. the official phone app) already holds the connection. Once paired, it shows up below like any other port. (Or use the "Bluetooth" transport above to pair directly from this page instead.)',
            )}
          </p>
        )}
      </div>

      <div className="connection-panel__row">
        <span className="connection-panel__field-label">
          <span className={`status-dot ${statusClass}`} aria-hidden />
          {statusLabel}
        </span>
        {connection.transportKind === 'webmidi' && (
          <button type="button" className="btn btn--ghost btn--small" onClick={refreshOutputs}>
            {t('connection.refresh', 'Refresh')}
          </button>
        )}
        {connection.transportKind === 'bluetooth' && connection.ready && (
          <button type="button" className="btn btn--ghost btn--small" onClick={disconnectBluetooth}>
            {t('connection.disconnect', 'Disconnect')}
          </button>
        )}
      </div>

      {connection.error && <p className="connection-panel__error">{connection.error}</p>}

      <div className="connection-panel__stack">
        <label className="connection-panel__field-label" htmlFor="midi-output">
          {t('connection.output', 'Output')}
        </label>
        {connection.outputs.length === 0 ? (
          <span className="connection-panel__hint">
            {connection.transportKind === 'bluetooth'
              ? t('connection.noBluetoothOutput', 'Not connected yet — click the Bluetooth transport button above to open the device picker.')
              : t('connection.noOutputs', 'No MIDI outputs found. Connect your NanoCore via USB and refresh.')}
          </span>
        ) : (
          <select
            id="midi-output"
            value={connection.outputId ?? ''}
            onChange={(e) => setOutput(e.target.value)}
          >
            {connection.outputs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="connection-panel__row">
        <label className="connection-panel__field-label" htmlFor="midi-channel">
          {t('connection.channel', 'Channel')}
        </label>
        <input
          id="midi-channel"
          type="number"
          min={1}
          max={16}
          value={connection.channel}
          onChange={(e) => setChannel(Number(e.target.value))}
          className="connection-panel__channel-input"
        />
      </div>
      <p className="connection-panel__hint">{t('connection.channelHint', "Must match the NanoCore's own MIDI Channel setting (device channel 0 = Omni, any channel works).")}</p>
    </section>
  );
}
