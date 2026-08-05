import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { nanocoreSpec } from '../data/nanocoreSpec';
import { usePatchStore } from '../store/patchStore';

interface Props {
  selected: string;
  onSelect: (blockId: string) => void;
}

export function ChainView({ selected, onSelect }: Props) {
  const { t } = useTranslation();
  const patch = usePatchStore((s) => s.patch);

  return (
    <nav className="chain-view" aria-label={t('nav.chain', 'Effect Chain')}>
      {nanocoreSpec.blocks.map((block, i) => {
        const state = patch[block.id];
        return (
          <Fragment key={block.id}>
            <button
              type="button"
              className={`chain-view__block ${selected === block.id ? 'chain-view__block--active' : ''}`}
              onClick={() => onSelect(block.id)}
            >
              <span className={`chain-view__dot ${state?.on ? 'chain-view__dot--on' : ''}`} aria-hidden />
              <span className="chain-view__label">{t(`block.${block.id}.name`, block.name)}</span>
            </button>
            {i < nanocoreSpec.blocks.length - 1 && (
              <span className="chain-view__arrow" aria-hidden>
                ›
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
