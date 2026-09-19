import { Fragment, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { findBlock } from '../store/patchDefaults';
import { usePatchStore } from '../store/patchStore';

interface Props {
  selected: string;
  onSelect: (blockId: string) => void;
}

/** Reorders `order` by moving `draggedId` to sit right before `targetId` (or to the end, if
 * `targetId` is the last item and the drop happened past its midpoint — see `handleDrop`). */
function reorder(order: string[], draggedId: string, targetId: string, insertAfter: boolean): string[] {
  const without = order.filter((id) => id !== draggedId);
  let targetIndex = without.indexOf(targetId);
  if (insertAfter) targetIndex += 1;
  return [...without.slice(0, targetIndex), draggedId, ...without.slice(targetIndex)];
}

export function ChainView({ selected, onSelect }: Props) {
  const { t } = useTranslation();
  const patch = usePatchStore((s) => s.patch);
  const chainOrder = usePatchStore((s) => s.chainOrder);
  const setChainOrder = usePatchStore((s) => s.setChainOrder);

  // Only for the visual "being dragged" / "drop target" styling below — the actual reordering
  // logic reads the dragged block's id from `dataTransfer` instead (see handleDrop), not from
  // this state, since a `dragover`/`drop` handler's closure can run before React has flushed
  // the `setDraggedId` from `dragstart`, which would otherwise read a stale `null` here.
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (blockId: string) => (e: DragEvent<HTMLDivElement>) => {
    setDraggedId(blockId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', blockId);
  };

  const handleDragOver = (blockId: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault(); // required for onDrop to fire at all
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(blockId);
  };

  const handleDrop = (blockId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    if (sourceId && sourceId !== blockId) {
      const rect = e.currentTarget.getBoundingClientRect();
      const insertAfter = e.clientX - rect.left > rect.width / 2;
      setChainOrder(reorder(chainOrder, sourceId, blockId, insertAfter));
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <nav className="chain-view" aria-label={t('nav.chain', 'Effect Chain')}>
      {chainOrder.map((blockId, i) => {
        const block = findBlock(blockId);
        const state = patch[blockId];
        const blockName = t(`block.${block.id}.name`, block.name);
        // The on/off dot is color-only visually; fold the state into the accessible name too
        // (WCAG 1.4.1) rather than relying on the color difference alone.
        const stateLabel = state?.on ? t('block.on', 'On') : t('block.off', 'Off');
        return (
          <Fragment key={block.id}>
            <div
              className={[
                'chain-view__item',
                draggedId === block.id ? 'chain-view__item--dragging' : '',
                dragOverId === block.id ? 'chain-view__item--drag-over' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={handleDragStart(block.id)}
              onDragOver={handleDragOver(block.id)}
              onDrop={handleDrop(block.id)}
              onDragEnd={handleDragEnd}
            >
              <button
                type="button"
                className={`chain-view__block ${selected === block.id ? 'chain-view__block--active' : ''}`}
                aria-pressed={selected === block.id}
                aria-label={`${blockName} — ${stateLabel}`}
                onClick={() => onSelect(block.id)}
              >
                <span className={`chain-view__dot ${state?.on ? 'chain-view__dot--on' : ''}`} aria-hidden />
                <span className="chain-view__label" aria-hidden>
                  {blockName}
                </span>
              </button>
              {/* The ‹›  move buttons were here (moveBlockInChain) — hidden for now, they were
                  too small/fiddly next to drag-and-drop; re-add (e.g. as a keyboard-accessible
                  fallback) if drag-and-drop alone turns out not to be enough. */}
            </div>
            {i < chainOrder.length - 1 && (
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
