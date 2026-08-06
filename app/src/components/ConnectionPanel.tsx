import { useTranslation } from 'react-i18next';
import { usePatchStore } from '../store/patchStore';
import type { TransportKind } from '../store/patchStore';

export function ConnectionPanel() {
  const { t } = useTranslation();
  const connection = usePatchStore((s) => s.connection);
  const initTransport = usePatchStore((s) => s.initTransport);
  const refreshOutputs = usePatchStore((s) => s.refreshOutputs);
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

  return (
    <section className="connection-panel">
      <h2 className="panel-title">{t('connection.title', 'MIDI Connection')}</h2>

      <div className="connection-panel__stack">
        <span className="connection-panel__field-label">{t('connection.transport', 'Transport')}</span>
        <div className="segmented segmented--stacked">
          {(['simulator', 'webmidi'] as TransportKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`segmented__option ${connection.transportKind === kind ? 'segmented__option--active' : ''}`}
              aria-pressed={connection.transportKind === kind}
              onClick={() => initTransport(kind)}
            >
              {kind === 'simulator'
                ? t('connection.transportSimulator', 'Simulator (no hardware needed)')
                : t('connection.transportWebmidi', 'Web MIDI (hardware)')}
            </button>
          ))}
        </div>
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
      </div>

      {connection.error && <p className="connection-panel__error">{connection.error}</p>}

      <div className="connection-panel__stack">
        <label className="connection-panel__field-label" htmlFor="midi-output">
          {t('connection.output', 'Output')}
        </label>
        {connection.outputs.length === 0 ? (
          <span className="connection-panel__hint">{t('connection.noOutputs', 'No MIDI outputs found. Connect your NanoCore via USB and refresh.')}</span>
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
