import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { amp, buildReplyFrame, cab, crc32, fx2, parseActiveSlotFromAmpProfile, parseCommandMessage } from '@nanocore/protocol';
import { FakeTransport } from '@nanocore/protocol/testing/FakeTransport';
import { LIVE_FX2_TYPE7, SLOT0_CLNARP_P1, SLOT0_CLNARP_P2, hex } from '@nanocore/protocol/testing/realCaptures';
import { NanoCoreSession } from '../session';
import { registerTools } from '../tools';

/** A user-loaded NAM profile in AMP slot 6 (factory Fd65Dk) and an IR in CAB slot 3 (factory Eng412A). */
const CUSTOM_PROFILES: Record<number, string> = { 5: 'My Amp NAM' };
/** Slots 1 and 2 share a name, as a pack of IRs often does once the catalog cuts names to 16 characters. */
const CUSTOM_IRS: Record<number, string> = { 0: 'Acoustic Mic IR', 1: 'Acoustic Mic IR', 2: 'My Cab IR' };

/** A `0x36`/`0x56` catalog record (30 bytes) naming `slot`. */
function catalogRecord(slot: number, name: string): number[] {
  const payload = Array.from({ length: 30 }, () => 0);
  payload[0] = slot;
  payload[1] = 1;
  // 300-byte body of `slot` repeated (what 0x39/0x59 serve below), with its CRC-32.
  const crc = crc32(Array.from({ length: 300 }, () => slot));
  payload[3] = 300 & 0xff;
  payload[4] = 300 >> 8;
  [0, 8, 16, 24].forEach((shift, i) => (payload[7 + i] = (crc >>> shift) & 0xff));
  Array.from(name).forEach((ch, i) => (payload[14 + i] = ch.charCodeAt(0)));
  return payload;
}

/** A scripted NanoCore behind a FakeTransport: answers the patch read with real captured frames
 * (live profile + the two saved pages), the global-settings poll, a preset save, and the profile
 * and IR catalogs. */
function scriptedDevice(): FakeTransport {
  const t = new FakeTransport();
  const liveSlot = parseActiveSlotFromAmpProfile(LIVE_FX2_TYPE7) ?? 0;
  const retag = (frame: number[]) => frame.map((b, i) => (i === 15 ? liveSlot : b));
  let page = 0;
  t.onSysEx = (b) => {
    const command = parseCommandMessage(b);
    if (command?.opcode === 0x36) {
      const slot = command.payload[0];
      const factory = slot < 30 ? amp.types[slot].name : fx2.types.find((ty) => ty.id === slot - 30)!.name;
      return [buildReplyFrame(command.seq, 0x36, 0, catalogRecord(slot, CUSTOM_PROFILES[slot] ?? factory))];
    }
    if (command?.opcode === 0x39 || command?.opcode === 0x59) {
      // Body of every slot: 300 bytes of `slot`, 59 bytes per reply like the real pedal.
      const [slot, lo, hi] = command.payload;
      const at = lo | (hi << 8);
      const data = Array.from({ length: Math.min(59, 300 - at) }, () => slot);
      return [buildReplyFrame(command.seq, command.opcode, 0, [slot, lo, hi, 300 & 0xff, 300 >> 8, ...data])];
    }
    if (command?.opcode === 0x56) {
      const slot = command.payload[0];
      return [buildReplyFrame(command.seq, 0x56, 0, catalogRecord(slot, CUSTOM_IRS[slot] ?? cab.types[slot].name))];
    }
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
    for (const n of ['verify_profile', 'listen', 'connect', 'get_patch', 'set_block', 'set_param', 'set_chain_order', 'rename_patch', 'save_to_slot', 'recall_preset', 'get_global_settings', 'set_global_setting', 'list_profiles', 'upload_profile', 'describe_block']) {
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

  it('explains the firmware update offline, without ever offering to flash it', async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'firmware_update_info')?.annotations?.readOnlyHint).toBe(true);
    const info = (await call('firmware_update_info')).json();
    expect(info.downloadsUrl).toBe('https://www.livtramusic.com/downloads');
    expect(info.canThisServerUpdateFirmware).toBe(false);
    expect(info.steps.join(' ')).toMatch(/Export your presets/);
    expect(transport.sent).toHaveLength(0);
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

  it('names custom NAM profiles and IRs, and selects them by that name', async () => {
    const ampSpec = (await call('describe_block', { block: 'amp' })).json();
    expect(ampSpec.types.find((ty: { id: number }) => ty.id === 5)).toMatchObject({ name: 'Fd65Dk', profile: 'My Amp NAM' });
    expect(ampSpec.types.find((ty: { id: number }) => ty.id === 0).profile).toBeUndefined();

    const setAmp = await call('set_block', { block: 'amp', type: 'my amp nam' });
    expect(setAmp.isError).toBe(false);
    expect(setAmp.json()).toMatchObject({ type: 'Fd65Dk', profile: 'My Amp NAM' });

    const setCab = await call('set_block', { block: 'cab', type: 'My Cab IR' });
    expect(setCab.isError).toBe(false);
    expect(setCab.json()).toMatchObject({ type: 'Eng412A', profile: 'My Cab IR' });

    const patch = (await call('get_patch')).json();
    expect(patch.blocks.amp.profile).toBe('My Amp NAM');
    expect(patch.blocks.cab.profile).toBe('My Cab IR');
  });

  it('numbers custom names that several slots share, and refuses the bare shared name', async () => {
    const cabSpec = (await call('describe_block', { block: 'cab' })).json();
    expect(cabSpec.types.slice(0, 2).map((ty: { profile?: string }) => ty.profile)).toEqual(['#1 Acoustic Mic IR', '#2 Acoustic Mic IR']);

    const ambiguous = await call('set_block', { block: 'cab', type: 'acoustic mic ir' });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toMatch(/"#1 Acoustic Mic IR", "#2 Acoustic Mic IR"/);

    const second = await call('set_block', { block: 'cab', type: '#2 Acoustic Mic IR' });
    expect(second.json()).toMatchObject({ type: cab.types[1].name, profile: '#2 Acoustic Mic IR' });
  });

  it('verify_profile reads a slot back and checks it against the pedal CRC', async () => {
    const amp6 = await call('verify_profile', { slot: 6 });
    expect(amp6.isError).toBe(false);
    expect(amp6.json()).toMatchObject({ slot: 6, kind: 'AMP', name: 'My Amp NAM', factoryName: 'Fd65Dk', bytes: 300, intact: true });
    const ir3 = await call('verify_profile', { slot: 3, ir: true });
    expect(ir3.json()).toMatchObject({ kind: 'IR', name: 'My Cab IR', factoryName: 'Eng412A', intact: true });
    expect((await call('verify_profile', { slot: 31, ir: true })).text).toMatch(/IR slot must be 1-30/);
  });

    it('listen reports what the pedal pushes on its own, and nothing else', async () => {
    const listening = call('listen', { seconds: 1 });
    await new Promise((r) => setTimeout(r, 100));
    // MOD switched on from the pedal (a real captured 0x02 push), a reply to some request (not a
    // push, ignored), then a push this server can't decode.
    transport.push(hex('f0 7d 4e 43 72 00 02 61 00 02 00 05 01 f7'));
    transport.push(hex('f0 7d 4e 43 71 00 02 05 00 41 00 01 00 00 00 f7'));
    transport.push(hex('f0 7d 4e 43 72 00 02 61 00 7e 00 00 00 f7'));
    const result = (await listening).json();
    expect(result.events.map((e: { kind: string }) => e.kind)).toEqual(['block', 'unknown']);
    expect(result.events[0]).toMatchObject({ block: 'mod', on: true });
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

describe('an empty preset', () => {
  it('is explained as empty rather than blamed on another app first', async () => {
    await call('connect');
    transport.onSysEx = (b) => (b[9] === 0x63 ? [LIVE_FX2_TYPE7] : []); // live state answers, saved pages never do
    const r = await call('recall_preset', { number: 64 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/no saved data for preset \d+/);
    expect(r.text).toMatch(/never saved|reset/);
  }, 20000);
});

describe('connect', () => {
  it('explains what is available when there is no matching port', async () => {
    transport.listOutputs = () => [{ id: 'x', name: 'Some Audio Interface' }];
    const r = await call('connect');
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No known Livtra pedal found/);
    expect(r.text).toMatch(/Some Audio Interface/);
  });

  it('auto-connects to a Mosaic the same way as a NanoCore, with no port given', async () => {
    transport.listOutputs = () => [{ id: 'y', name: 'Mosaic' }];
    const r = await call('connect');
    expect(r.isError).toBe(false);
    expect(r.json()).toMatchObject({ connected: 'Mosaic' });
  });
});
