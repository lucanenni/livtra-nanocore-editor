import { useTranslation } from 'react-i18next';
import { BlockEditor } from './BlockEditor';

/**
 * Synth Mode (firmware 1.2+) — not part of the reorderable effect chain (see
 * `NanocoreSpec.synth`'s doc comment in `@nanocore/protocol`), so it gets its own tab instead of a
 * `ChainView` slot. Reuses `BlockEditor` as-is: Synth is modeled as an ordinary `BlockSpec`
 * (power toggle, voice/type select, per-voice params), so nothing about that component needed to
 * change for it.
 */
export function SynthPanel() {
  const { t } = useTranslation();

  return (
    <section className="synth-panel">
      <h2 className="panel-title">{t('synth.title', 'Synth Mode')}</h2>
      <p className="panel-hint">
        {t(
          'synth.hint',
          'Turns the guitar input into a synth voice instead of the normal effect chain. All 10 voices are mapped.',
        )}
      </p>
      <BlockEditor blockId="synth" />
    </section>
  );
}
