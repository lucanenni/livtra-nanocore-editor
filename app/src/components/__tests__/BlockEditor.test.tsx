import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { BlockEditor } from '../BlockEditor';
import { usePatchStore } from '../../store/patchStore';
import { nanocoreSpec } from '../../data/nanocoreSpec';

/**
 * Renders every (block, effect type) combination — all ~90 of them, including all 30 AMP
 * models and all 30 CAB models — through the real BlockEditor/ParamControl components. This
 * is the "click through every type by hand" QA pass, automated: it would catch a param whose
 * formatting (freq/time helpers, enum bucketing, i18n interpolation) throws for a real range
 * from the data model, or a duplicate React key crashing the param grid.
 */
describe('BlockEditor renders every documented block/type combination', () => {
  for (const block of nanocoreSpec.blocks) {
    for (const type of block.types) {
      it(`${block.id} / ${type.id}-${type.slug}`, () => {
        usePatchStore.getState().resetPatch();
        usePatchStore.getState().setBlockType(block.id, type.id);

        const { container, unmount } = render(
          <I18nextProvider i18n={i18n}>
            <BlockEditor blockId={block.id} />
          </I18nextProvider>,
        );

        expect(container.querySelector('.block-editor')).toBeTruthy();
        const expectedParamCount = (block.commonParams?.length ?? 0) + type.params.length;
        expect(container.querySelectorAll('.param-control')).toHaveLength(expectedParamCount);

        unmount();
        cleanup();
      });
    }
  }
});
