import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchStore } from '../store/patchStore';

export function TunerPanel() {
  const { t } = useTranslation();
  const setTuner = usePatchStore((s) => s.setTuner);
  const [on, setOn] = useState(false);

  const toggle = () => {
    const next = !on;
    setOn(next);
    setTuner(next);
  };

  return (
    <section className="tuner-panel">
      <h2 className="panel-title">{t('tuner.title', 'Tuner')}</h2>
      <button type="button" className={`btn ${on ? 'btn--accent' : ''}`} onClick={toggle}>
        {t('tuner.toggle', 'Tuner')} — {on ? t('block.on', 'On') : t('block.off', 'Off')}
      </button>
      <p className="panel-hint">
        {t(
          'tuner.note',
          'Sends CC80 (0 = off, 127 = on) to remotely open/close the on-device tuner. The reference pitch (default 440Hz) is only adjustable on the device itself — no CC is documented for it.',
        )}
      </p>
    </section>
  );
}
