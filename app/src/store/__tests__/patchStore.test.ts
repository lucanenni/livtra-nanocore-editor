import { beforeEach, describe, expect, it } from 'vitest';
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
  it('becomes ready with the simulator output auto-selected', () => {
    const { connection } = usePatchStore.getState();
    expect(connection.ready).toBe(true);
    expect(connection.transportKind).toBe('simulator');
    expect(connection.outputId).toBe('simulator');
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
