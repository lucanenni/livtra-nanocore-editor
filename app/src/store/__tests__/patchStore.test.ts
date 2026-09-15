import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePatchStore } from '../patchStore';
import { nanocoreSpec } from '../../data/nanocoreSpec';

async function ready() {
  await usePatchStore.getState().initTransport('simulator');
  // Simulator init is synchronous under the hood, but await the promise chain regardless.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  await ready();
  usePatchStore.getState().resetPatch();
  usePatchStore.getState().clearLog();
});

describe('patchStore connection lifecycle', () => {
  it('becomes ready with the simulator output auto-selected and already connected', () => {
    const { connection } = usePatchStore.getState();
    expect(connection.ready).toBe(true);
    expect(connection.transportKind).toBe('simulator');
    expect(connection.outputId).toBe('simulator');
    expect(connection.connected).toBe(true); // no real device ambiguity, no Connect step needed
  });

  it('gates every send on connection.connected (a picked-but-not-connected output sends nothing)', () => {
    // Simulates the real-transport case: an output is selected but Connect hasn't been clicked
    // yet (see ConnectionPanel.tsx) — sends should be silent no-ops, not go out anyway.
    usePatchStore.setState((s) => ({ connection: { ...s.connection, connected: false } }));
    usePatchStore.getState().setBlockOn('fx1', true);
    expect(usePatchStore.getState().log).toHaveLength(0);

    usePatchStore.getState().connectDevice();
    expect(usePatchStore.getState().connection.connected).toBe(true);
    usePatchStore.getState().setBlockOn('fx1', true);
    expect(usePatchStore.getState().log).toHaveLength(1);
  });

  it('disconnectDevice stops sends without touching the output selection', () => {
    const outputIdBefore = usePatchStore.getState().connection.outputId;
    usePatchStore.getState().disconnectDevice();
    expect(usePatchStore.getState().connection.connected).toBe(false);
    expect(usePatchStore.getState().connection.outputId).toBe(outputIdBefore);

    usePatchStore.getState().setBlockOn('fx1', true);
    expect(usePatchStore.getState().log).toHaveLength(0);
  });

  it('setOutput requires a fresh connectDevice — it never carries "connected" over to a new pick', () => {
    usePatchStore.setState((s) => ({
      connection: { ...s.connection, outputs: [...s.connection.outputs, { id: 'other', name: 'Other device' }] },
    }));
    usePatchStore.getState().setOutput('other');
    // Real transports (not the Simulator) must not stay "connected" just because a different
    // output was picked — connectDevice below is what actually applies the change.
    usePatchStore.setState((s) => ({ connection: { ...s.connection, transportKind: 'webmidi' } }));
    usePatchStore.getState().setOutput('other');
    expect(usePatchStore.getState().connection.connected).toBe(false);
  });

  it('readPresetFromDevice times out harmlessly against the Simulator (nothing to read from)', async () => {
    vi.useFakeTimers();
    const before = usePatchStore.getState().patch;
    const promise = usePatchStore.getState().readPresetFromDevice();
    await vi.runAllTimersAsync();
    await promise;
    expect(usePatchStore.getState().patch).toEqual(before); // untouched — the Simulator never replies
    vi.useRealTimers();
  });

  it('readPresetFromDevice does nothing (no throw) when no output is selected', async () => {
    usePatchStore.setState((s) => ({ connection: { ...s.connection, outputId: null } }));
    await expect(usePatchStore.getState().readPresetFromDevice()).resolves.toBeUndefined();
  });
});

describe('patchStore block editing', () => {
  it('setBlockOn sends exactly one CC with the documented on/off convention', () => {
    usePatchStore.getState().setBlockOn('fx1', true);
    const log = usePatchStore.getState().log;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'cc', cc: 20, value: 127, channel: 1 });
    expect(usePatchStore.getState().patch.fx1.on).toBe(true);
  });

  it('setBlockType sends the exact type id (not scaled) and remaps params to the new type', () => {
    usePatchStore.getState().setBlockType('fx2', 8); // Pitch
    const log = usePatchStore.getState().log;
    expect(log[0]).toMatchObject({ kind: 'cc', cc: 41, value: 8 });
    expect(usePatchStore.getState().patch.fx2.typeId).toBe(8);
    expect(usePatchStore.getState().patch.fx2.params).toHaveProperty('pitch');
    expect(usePatchStore.getState().patch.fx2.params).toHaveProperty('mix');
  });

  it('setParam scales a real-world value onto CC 0-127 for the currently selected type', () => {
    // FX1 defaults to Gate; Threshold is -100..0 dB on CC50.
    usePatchStore.getState().setParam('fx1', 'threshold', 0); // max -> 127
    let log = usePatchStore.getState().log;
    expect(log[0]).toMatchObject({ kind: 'cc', cc: 50, value: 127 });

    usePatchStore.getState().setParam('fx1', 'threshold', -100); // min -> 0
    log = usePatchStore.getState().log;
    expect(log[0]).toMatchObject({ kind: 'cc', cc: 50, value: 0 });
  });

  it('does nothing (no throw, no log entry) when no output is selected', () => {
    usePatchStore.setState((s) => ({ connection: { ...s.connection, outputId: null } }));
    expect(() => usePatchStore.getState().setBlockOn('fx1', true)).not.toThrow();
    expect(usePatchStore.getState().log).toHaveLength(0);
  });

  it('setBlockType sends SysEx (not CC) for AMP, since typeCC is confirmed not to work', () => {
    usePatchStore.getState().setBlockType('amp', 15); // Pey51501
    const log = usePatchStore.getState().log;
    expect(log[0]).toMatchObject({ kind: 'sysex' });
    expect(log[0].bytes).toContain(15); // model index appears verbatim in the SysEx bytes
    expect(log.some((m) => m.kind === 'cc' && m.cc === 43)).toBe(false); // never falls back to typeCC
    expect(usePatchStore.getState().patch.amp.typeId).toBe(15);
  });

  it('setBlockType sends SysEx (not CC) for CAB, since typeCC is confirmed not to work', () => {
    usePatchStore.getState().setBlockType('cab', 19); // Ran112B
    const log = usePatchStore.getState().log;
    expect(log[0]).toMatchObject({ kind: 'sysex' });
    expect(log[0].bytes).toContain(19);
    expect(usePatchStore.getState().patch.cab.typeId).toBe(19);
  });
});

describe('patchStore.moveBlockInChain', () => {
  it('swaps a block with its neighbor and sends the resulting order via SysEx', () => {
    const before = usePatchStore.getState().chainOrder;
    usePatchStore.getState().moveBlockInChain(before[1], 'left');

    const after = usePatchStore.getState().chainOrder;
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);

    const log = usePatchStore.getState().log;
    expect(log[0]).toMatchObject({ kind: 'sysex' });
  });

  it('is a no-op at either end of the chain (no state change, no message sent)', () => {
    const order = usePatchStore.getState().chainOrder;
    usePatchStore.getState().moveBlockInChain(order[0], 'left');
    expect(usePatchStore.getState().chainOrder).toEqual(order);
    expect(usePatchStore.getState().log).toHaveLength(0);

    usePatchStore.getState().moveBlockInChain(order[order.length - 1], 'right');
    expect(usePatchStore.getState().chainOrder).toEqual(order);
    expect(usePatchStore.getState().log).toHaveLength(0);
  });
});

describe('patchStore.setChainOrder', () => {
  it('accepts a full reorder (e.g. from a ChainView drag-and-drop) and sends a prime + set pair via SysEx', () => {
    const order = usePatchStore.getState().chainOrder;
    const reversed = [...order].reverse();
    usePatchStore.getState().setChainOrder(reversed);

    expect(usePatchStore.getState().chainOrder).toEqual(reversed);
    const log = usePatchStore.getState().log;
    // One "prime" message (fieldId 0x00, matching ToneCommand's own traffic) plus one for the
    // whole reorder — not one per swap. See buildChainOrderPrimeSysEx's doc comment.
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ kind: 'sysex' });
    expect(log[1]).toMatchObject({ kind: 'sysex' });
  });

  it('rejects an order that drops or duplicates a block, leaving state and the log untouched', () => {
    const order = usePatchStore.getState().chainOrder;
    usePatchStore.getState().setChainOrder([order[0], order[0], ...order.slice(2)]);
    expect(usePatchStore.getState().chainOrder).toEqual(order);
    expect(usePatchStore.getState().log).toHaveLength(0);
  });
});

describe('patchStore.sendFullPatch', () => {
  it('emits on/off + type + every active param CC for all 8 blocks', () => {
    usePatchStore.getState().sendFullPatch();
    const log = usePatchStore.getState().log;

    let expectedCount = 0;
    for (const block of nanocoreSpec.blocks) {
      const state = usePatchStore.getState().patch[block.id];
      const type = block.types.find((t) => t.id === state.typeId)!;
      expectedCount += 2 + (block.commonParams?.length ?? 0) + type.params.length;
    }
    expect(log).toHaveLength(expectedCount);

    // Spot check: FX1 defaults to Gate (off), so we should see its on/off, type, and threshold CCs.
    const fx1Messages = log.filter((m) => [20, 40, 50].includes(m.cc ?? -1));
    expect(fx1Messages.length).toBeGreaterThanOrEqual(3);
  });
});

describe('patchStore preset library (localStorage-backed)', () => {
  it('saves, updates, applies and deletes a local preset', () => {
    usePatchStore.getState().setBlockOn('fx1', true);
    usePatchStore.getState().savePresetLocal('Test Preset');

    const afterSave = usePatchStore.getState();
    expect(afterSave.presets.some((p) => p.name === 'Test Preset')).toBe(true);
    expect(afterSave.activePresetId).not.toBeNull();
    expect(afterSave.activePresetDirty).toBe(false);

    usePatchStore.getState().setBlockOn('fx2', true);
    expect(usePatchStore.getState().activePresetDirty).toBe(true);

    usePatchStore.getState().updateActivePreset();
    expect(usePatchStore.getState().activePresetDirty).toBe(false);

    const id = usePatchStore.getState().activePresetId!;
    usePatchStore.getState().resetPatch();
    expect(usePatchStore.getState().patch.fx2.on).toBe(false);

    usePatchStore.getState().applyPreset(id);
    expect(usePatchStore.getState().patch.fx2.on).toBe(true);

    usePatchStore.getState().deletePreset(id);
    expect(usePatchStore.getState().presets.some((p) => p.id === id)).toBe(false);
  });

  it('round-trips export -> import', () => {
    usePatchStore.getState().savePresetLocal('Exportable');
    const json = usePatchStore.getState().exportPresets();
    const before = usePatchStore.getState().presets.length;

    const result = usePatchStore.getState().importPresets(json);
    expect(result.ok).toBe(true);
    expect(usePatchStore.getState().presets.length).toBe(before + before); // duplicated with fresh ids
  });

  it('reports a parse error for invalid JSON without throwing', () => {
    const result = usePatchStore.getState().importPresets('not json');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('single-patch export/import (distinct from the preset library)', () => {
  it('round-trips the current patch through export -> import unchanged', () => {
    usePatchStore.getState().setBlockOn('fx1', true);
    usePatchStore.getState().setBlockType('fx2', 8); // Pitch
    usePatchStore.getState().setParam('fx1', 'threshold', -42);

    const json = usePatchStore.getState().exportCurrentPatch();
    usePatchStore.getState().resetPatch();
    expect(usePatchStore.getState().patch.fx1.on).toBe(false);

    const result = usePatchStore.getState().importPatch(json);
    expect(result.ok).toBe(true);
    expect(usePatchStore.getState().patch.fx1.on).toBe(true);
    expect(usePatchStore.getState().patch.fx1.params.threshold).toBe(-42);
    expect(usePatchStore.getState().patch.fx2.typeId).toBe(8);
  });

  it('rejects invalid JSON without throwing', () => {
    const result = usePatchStore.getState().importPatch('not json');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects a patch missing a required block', () => {
    const result = usePatchStore.getState().importPatch(JSON.stringify({ fx1: { on: true, typeId: 0, params: {} } }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fx2/i); // first block after fx1 in nanocoreSpec.blocks order
  });

  it('rejects a block with an invalid type id', () => {
    const patch = JSON.parse(usePatchStore.getState().exportCurrentPatch());
    patch.fx1.typeId = 999;
    const result = usePatchStore.getState().importPatch(JSON.stringify(patch));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fx1/);
  });

  it('fills in missing params with defaults instead of rejecting the whole file', () => {
    const patch = JSON.parse(usePatchStore.getState().exportCurrentPatch());
    delete patch.fx1.params.threshold; // Gate's only param
    const result = usePatchStore.getState().importPatch(JSON.stringify(patch));
    expect(result.ok).toBe(true);
    expect(typeof usePatchStore.getState().patch.fx1.params.threshold).toBe('number');
  });
});
