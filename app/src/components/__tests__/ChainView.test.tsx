import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { ChainView } from '../ChainView';
import { usePatchStore } from '../../store/patchStore';

/**
 * jsdom doesn't implement the real `DataTransfer`/drag-event APIs, so these use the standard
 * RTL pattern of a plain-object stand-in passed as `dataTransfer` — it only needs to support
 * the get/setData calls ChainView actually makes (see docs/... n/a, this is just a test detail).
 */
function fakeDataTransfer() {
  let stored = '';
  const types: string[] = [];
  return {
    effectAllowed: '',
    dropEffect: '',
    types,
    setData: (_type: string, value: string) => {
      stored = value;
      types.push('text/plain');
    },
    getData: () => stored,
  };
}

/**
 * jsdom has no `DragEvent` constructor at all, so RTL's `fireEvent.dragOver/drop(el, {clientX})`
 * silently drops `clientX` (it falls back to a plain `Event`, which ignores unrecognized init
 * properties — see https://github.com/jsdom/jsdom/issues/1568). Build the event via `createEvent`
 * and set `clientX` on it directly (a plain own-property assignment, since the fallback really is
 * just an `Event` instance) before firing, so ChainView's "which half was it dropped on" check has
 * something real to read.
 */
function fireDragEventAt(
  type: 'dragOver' | 'drop',
  node: Element,
  dataTransfer: ReturnType<typeof fakeDataTransfer>,
  clientX: number,
) {
  const event = createEvent[type](node, { dataTransfer });
  Object.defineProperty(event, 'clientX', { value: clientX });
  fireEvent(node, event);
}

function renderChain() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ChainView selected="fx1" onSelect={() => {}} />
    </I18nextProvider>,
  );
}

describe('ChainView drag-and-drop reorder', () => {
  beforeEach(async () => {
    await usePatchStore.getState().initTransport('simulator');
  });

  it('drops on the right half of a target to insert right after it, taking effect immediately', () => {
    usePatchStore.getState().resetPatch();
    usePatchStore.getState().clearLog();
    const before = usePatchStore.getState().chainOrder;
    const { container } = renderChain();

    const items = container.querySelectorAll('.chain-view__item');
    const sourceEl = items[1]; // second block in the default chain
    const targetEl = items[3]; // fourth block

    const dt = fakeDataTransfer();
    fireEvent.dragStart(sourceEl, { dataTransfer: dt });
    // Right half of the target's bounding box (all-zero in jsdom, so any positive clientX) ->
    // insert after it.
    fireDragEventAt('dragOver', targetEl, dt, 1e6);
    fireDragEventAt('drop', targetEl, dt, 1e6);
    fireEvent.dragEnd(sourceEl, { dataTransfer: dt });

    const expected = [...before];
    const [moved] = expected.splice(1, 1);
    expected.splice(expected.indexOf(before[3]) + 1, 0, moved);
    expect(usePatchStore.getState().chainOrder).toEqual(expected);
    // No submit/apply button involved — the SysEx for the new order is already in the log.
    expect(usePatchStore.getState().log[0]).toMatchObject({ kind: 'sysex' });

    cleanup();
  });

  it('does nothing when a block is dropped on itself', () => {
    usePatchStore.getState().resetPatch();
    usePatchStore.getState().clearLog();
    const before = usePatchStore.getState().chainOrder;
    const { container } = renderChain();

    const item = container.querySelectorAll('.chain-view__item')[2];
    const dt = fakeDataTransfer();
    fireEvent.dragStart(item, { dataTransfer: dt });
    fireEvent.drop(item, { dataTransfer: dt });

    expect(usePatchStore.getState().chainOrder).toEqual(before);
    expect(usePatchStore.getState().log).toHaveLength(0);

    cleanup();
  });
});

describe('ChainView Synth Mode toggle', () => {
  beforeEach(async () => {
    await usePatchStore.getState().initTransport('simulator');
    usePatchStore.getState().resetPatch();
  });

  it('hides AMP/CAB and shows a fixed Synth tile at the front when Synth Mode turns on', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ChainView selected="fx1" onSelect={() => {}} />
      </I18nextProvider>,
    );

    expect(screen.getByRole('button', { name: /AMP/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Synth/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.getByRole('button', { name: /^Synth/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /AMP/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CAB/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /FX1/ })).toBeInTheDocument();

    cleanup();
  });

  it('falls the selection back to the first visible block when the current one disappears', () => {
    const onSelect = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ChainView selected="amp" onSelect={onSelect} />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onSelect).toHaveBeenCalledWith('synth');
    cleanup();
  });

  it('turning it back off restores AMP/CAB and removes the Synth tile', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ChainView selected="fx1" onSelect={() => {}} />
      </I18nextProvider>,
    );

    const toggle = screen.getByRole('checkbox');
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: /AMP/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /CAB/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Synth/ })).not.toBeInTheDocument();

    cleanup();
  });
});
