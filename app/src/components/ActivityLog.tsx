import { useTranslation } from 'react-i18next';
import { usePatchStore } from '../store/patchStore';

export function ActivityLog() {
  const { t } = useTranslation();
  const log = usePatchStore((s) => s.log);
  const clearLog = usePatchStore((s) => s.clearLog);

  return (
    <section className="activity-log">
      <header className="activity-log__header">
        <h2 className="panel-title">{t('log.title', 'MIDI Activity')}</h2>
        <button type="button" className="btn btn--ghost btn--small" onClick={clearLog}>
          {t('log.clear', 'Clear')}
        </button>
      </header>
      {log.length === 0 ? (
        <p className="panel-hint">{t('log.empty', 'Nothing sent yet. Move a control to see outgoing MIDI messages here.')}</p>
      ) : (
        <ul className="activity-log__list">
          {log.map((msg, i) => (
            <li key={i} className="activity-log__item">
              <span className="activity-log__tag">
                {msg.kind === 'cc' ? t('log.cc', 'CC{{cc}}', { cc: msg.cc }) : t('log.pc', 'PC')}
              </span>
              <span className="activity-log__value">{msg.kind === 'cc' ? msg.value : msg.program}</span>
              <span className="activity-log__desc">{msg.description}</span>
              <span className="activity-log__channel">ch{msg.channel}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
