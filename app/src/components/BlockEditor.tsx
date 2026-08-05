import { useTranslation } from 'react-i18next';
import { usePatchStore } from '../store/patchStore';
import { activeParams, findBlock, findType } from '../store/patchDefaults';
import { ParamControl } from './ParamControl';
import { RoutingWarning } from './RoutingWarning';

interface Props {
  blockId: string;
}

export function BlockEditor({ blockId }: Props) {
  const { t } = useTranslation();
  const block = findBlock(blockId);
  const blockState = usePatchStore((s) => s.patch[blockId]);
  const setBlockOn = usePatchStore((s) => s.setBlockOn);
  const setBlockType = usePatchStore((s) => s.setBlockType);
  const setParam = usePatchStore((s) => s.setParam);

  if (!blockState) return null;

  const type = findType(block, blockState.typeId);
  const params = activeParams(block, blockState.typeId);
  const isBigList = block.types.length > 6;

  return (
    <section className="block-editor">
      <header className="block-editor__header">
        <h2 className="block-editor__title">{t(`block.${block.id}.name`, block.name)}</h2>
        <label className="block-editor__power">
          <span>{t('block.power', 'Power')}</span>
          <input
            type="checkbox"
            checked={blockState.on}
            onChange={(e) => setBlockOn(block.id, e.target.checked)}
            aria-label={t('block.on', 'On')}
          />
          <span className={`pill ${blockState.on ? 'pill--on' : 'pill--off'}`}>
            {blockState.on ? t('block.on', 'On') : t('block.off', 'Off')}
          </span>
        </label>
      </header>

      <div className="block-editor__type-row">
        <label className="block-editor__type-label" htmlFor={`type-${block.id}`}>
          {t('block.type', 'Type')}
        </label>
        <select
          id={`type-${block.id}`}
          className={`block-editor__type-select ${isBigList ? 'block-editor__type-select--wide' : ''}`}
          value={blockState.typeId}
          onChange={(e) => setBlockType(block.id, Number(e.target.value))}
        >
          {block.types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {t(`type.${block.id}.${ty.slug}.name`, ty.name)}
            </option>
          ))}
        </select>
      </div>

      {type.description && (
        <p className="block-editor__description">{t(`type.${block.id}.${type.slug}.description`, type.description)}</p>
      )}

      {(block.note || type.note) && <p className="block-editor__note">{block.note ?? type.note}</p>}

      {block.id === 'mod' && <RoutingWarning />}

      {params.length === 0 ? (
        <p className="block-editor__no-params">
          {t('block.noParams', 'This effect type has no user-adjustable parameters — it self-adjusts automatically.')}
        </p>
      ) : (
        <div className="block-editor__params">
          {params.map((spec) => (
            <ParamControl
              key={spec.id}
              spec={spec}
              value={blockState.params[spec.id] ?? (spec.kind === 'range' ? spec.min : 0)}
              onChange={(v) => setParam(block.id, spec.id, v)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
