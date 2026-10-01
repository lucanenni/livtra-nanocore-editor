import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseActiveSlotFromAmpProfile } from '@nanocore/protocol';
import { FakeTransport } from '@nanocore/protocol/testing/FakeTransport';
import { LIVE_FX2_TYPE7, SLOT0_CLNARP_P1, SLOT0_CLNARP_P2, hex } from '@nanocore/protocol/testing/realCaptures';
import { NanoCoreSession } from '../session';
import { registerTools } from '../tools';

/** A scripted NanoCore behind a FakeTransport: answers the patch read with real captured frames
 * (live profile + the two saved pages), the global-settings poll, and a preset save. */
function scriptedDevice(): FakeTransport {
  const t = new FakeTransport();
  const liveSlot = parseActiveSlotFromAmpProfile(LIVE_FX2_TYPE7) ?? 0;
  const retag = (frame: number[]) => frame.map((b, i) => (i === 15 ? liveSlot : b));
  let page = 0;
  t.onSysEx = (b) => {
    switch (b[9]) {
      case 0x63:
        return [LIVE_FX2_TYPE7];
      case 0x41:
        return [retag(++page % 2 === 1 ? SLOT0_CLNARP_P1 : SLOT0_CLNARP_P2)];
      case 0x65:
        return [hex('f0 7d 4e 43 71 00 02 6e 00 65 00 00 07 00 00 01 00 01 00 64 64 00 00 f7')];
      case 0x46:
        return [[0xf0, 0x7d, 0x4e, 0x43, 0x71, 0, 2, 0, 0, 0x46, 0, 0, 0, 0, 0, 4, 0xf7]]; // ack for slot index 4
      default:
        return [];
    }
  };
  return t;
}

let transport: FakeTransport;
let session: NanoCoreSession;
let client: Client;

beforeEach(async () => {
  transport = scriptedDevice();
  session = new NanoCoreSession(() => transport);
  const server = new McpServer({ name: 'nanocore-test', version: '0' });
  registerTools(server, session);
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterEach(async () => {
  session.close();
  await client.close();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0].text;
  return { isError: Boolean(res.isError), text, json: () => JSON.parse(text) };
}

const sentLabels = () => transport.sent.map((m) => m.description);

describe('tool catalogue', () => {
  it('exposes the tools and marks the overwriting ones destructive', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ['connect', 'get_patch', 'set_block', 'set_param', 'set_chain_order', 'rename_patch', 'save_to_slot', 'recall_preset', 'get_global_settings', 'set_global_setting', 'list_profiles', 'upload_profile', 'describe_block']) {
      expect(names).toContain(n);
    }
    const destructive = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name).sort();
    expect(destructive).toEqual(['save_to_slot', 'upload_profile']);
    expect(tools.find((t) => t.name === 'get_patch')?.annotations?.readOnlyHint).toBe(true);
  });
});

describe('before connecting', () => {
  it('refuses device operations with a clear message', async () => {
    const r = await call('set_param', { block: 'fx1', param: 'Threshold', value: -20 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Not connected/);
    expect(transport.sent).toHaveLength(0);
  });

  it('still describes the spec offline', async () => {
    const overview = (await call('describe_block')).json();
    expect(overview.blocks).toHaveLength(8);
    const amp = (await call('describe_block', { block: 'amp' })).json();
    expect(amp.types.length).toBeGreaterThan(20);
  });
});

describe('connected', () => {
  beforeEach(async () => {
    const r = await call('connect');
    expect(r.isError).toBe(false);
  });

  it('connects to the port named Nanocore and reads the preset', async () => {
    expect(session.portName).toBe('Nanocore');
    expect(session.presetName).toBe('ClnArp');
  });

  it('get_patch reports the live state of all 8 blocks in readable units', async () => {
    const patch = (await call('get_patch')).json();
    expect(patch.preset.name).toBe('ClnArp');
    expect(Object.keys(patch.blocks)).toHaveLength(8);
    expect(patch.chainOrder).toHaveLength(8);
    expect(patch.blocks.fx2.on).toBe(true); // live FX2 is on in the captured frame
    for (const block of Object.values<{ params: Record<string, unknown> }>(patch.blocks)) {
      expect(Object.keys(block.params).length).toBeGreaterThan(0);
    }
  });

  it('set_param validates, sends the CC and updates the picture', async () => {
    const patch = (await call('get_patch')).json();
    const fx1Type = patch.blocks.fx1.type as string;
    expect(fx1Type).toBeTruthy();
    transport.sent.length = 0;

    const bad = await call('set_param', { block: 'fx1', param: 'No Such Thing', value: 1 });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/has no parameter/);
    expect(transport.sent).toHaveLength(0);

    const spec = (await call('describe_block', { block: 'fx1' })).json();
    const type = spec.types.find((t: { name: string }) => t.name === fx1Type);
    const param = type.params.find((p: { min?: number }) => p.min !== undefined);
    const tooBig = await call('set_param', { block: 'fx1', param: param.label, value: param.max + 1000 });
    expect(tooBig.isError).toBe(true);
    expect(tooBig.text).toMatch(/must be between/);
    expect(transport.sent).toHaveLength(0);

    const good = await call('set_param', { block: 'FX1', param: param.label.toLowerCase(), value: param.min });
    expect(good.isError).toBe(false);
    expect(good.json()).toMatchObject({ block: 'fx1', param: param.label, value: param.min });
    expect(transport.sent).toHaveLength(1);
    expect(session.patch.fx1.params[param.id]).toBe(param.min);
  });

  it('set_block switches a block and changes its type by name', async () => {
    transport.sent.length = 0;
    const r = await call('set_block', { block: 'rev', on: true, type: 'Hall' });
    expect(r.isError).toBe(false);
    expect(r.json()).toMatchObject({ name: 'REV', on: true, type: 'Hall' });
    expect(sentLabels()).toEqual(expect.arrayContaining([expect.stringMatching(/^REV type -> Hall/), 'REV ON']));

    const none = await call('set_block', { block: 'rev' });
    expect(none.isError).toBe(true);
    const unknown = await call('set_block', { block: 'rev', type: 'Nonexistent' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/Unknown REV type/);
  });

  it('remembers an AMP model set from here, since the pedal cannot report it back unsaved', async () => {
    const amp = (await call('describe_block', { block: 'amp' })).json();
    const target = amp.types[amp.types.length - 1].name as string;
    const set = await call('set_block', { block: 'amp', type: target });
    expect(set.isError).toBe(false);
    expect(set.json().type).toBe(target);
    const patch = (await call('get_patch')).json(); // re-reads the (saved) state from the device
    expect(patch.blocks.amp.type).toBe(target);
  });

  it('set_chain_order sends the prime message and the order, and rejects a bad list', async () => {
    transport.sent.length = 0;
    const order = ['eq', 'fx1', 'mod', 'fx2', 'amp', 'cab', 'del', 'rev'];
    const r = await call('set_chain_order', { order });
    expect(r.isError).toBe(false);
    expect(sentLabels()).toEqual(['Chain order (prime)', `Chain order -> ${order.join(' > ')}`]);

    const reread = (await call('get_patch')).json(); // the device only reports the saved order
    expect(reread.chainOrder).toEqual(order);

    transport.sent.length = 0;
    const dup = await call('set_chain_order', { order: ['eq', 'eq', 'mod', 'fx2', 'amp', 'cab', 'del', 'rev'] });
    expect(dup.isError).toBe(true);
    expect(transport.sent).toHaveLength(0);
  });

  it('rename_patch cuts to 8 characters', async () => {
    const r = await call('rename_patch', { name: 'Crunchy Lead' });
    expect(r.json()).toEqual({ name: 'Crunchy ' });
  });

  it('save_to_slot needs explicit confirmation and a valid slot', async () => {
    transport.sent.length = 0;
    const unconfirmed = await call('save_to_slot', { number: 5 });
    expect(unconfirmed.isError).toBe(true);
    expect(transport.sent).toHaveLength(0);

    const tooHigh = await call('save_to_slot', { number: 65, confirm: true });
    expect(tooHigh.isError).toBe(true);
    expect(transport.sent).toHaveLength(0);

    const saved = await call('save_to_slot', { number: 5, confirm: true });
    expect(saved.isError).toBe(false);
    expect(sentLabels()).toEqual(['Save to slot 4']); // device slots are 0-based
  });

  it('reads global settings', async () => {
    const s = (await call('get_global_settings')).json();
    expect(s).toMatchObject({ wireless: false, loopback: true, inputGainDb: 0, usbVolume: 100, btVolume: 100, midiChannel: 0 });
  });

  it('set_global_setting rejects out-of-range values before sending', async () => {
    transport.sent.length = 0;
    const r = await call('set_global_setting', { setting: 'usb_volume', value: 150 });
    expect(r.isError).toBe(true);
    expect(transport.sent).toHaveLength(0);
  });

  it('upload_profile requires confirmation, a .ead extension and a readable file', async () => {
    transport.sent.length = 0;
    const unconfirmed = await call('upload_profile', { slot: 31, file_path: '/tmp/x.ead' });
    expect(unconfirmed.isError).toBe(true);
    const wrongExt = await call('upload_profile', { slot: 31, file_path: '/tmp/x.txt', confirm: true });
    expect(wrongExt.isError).toBe(true);
    expect(wrongExt.text).toMatch(/\.ead/);
    const missing = await call('upload_profile', { slot: 31, file_path: '/nonexistent/x.ead', confirm: true });
    expect(missing.isError).toBe(true);
    expect(transport.sent).toHaveLength(0);
  });

  it('disconnect releases the pedal and later calls are refused', async () => {
    await call('disconnect');
    const r = await call('get_patch');
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Not connected/);
  });
});

describe('connect', () => {
  it('explains what is available when there is no matching port', async () => {
    transport.listOutputs = () => [{ id: 'x', name: 'Some Audio Interface' }];
    const r = await call('connect');
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No NanoCore found/);
    expect(r.text).toMatch(/Some Audio Interface/);
  });
});
