/**
 * NanoCore's SysEx protocol — reverse-engineered from real MIDI traffic captured between the
 * official Livtra "ToneCommand" app and a real NanoCore device (see docs/MIDI_MAPPING_NOTES.md
 * for the full write-up and the captured examples this is derived from). Not documented in the
 * manual or MIDI Control User Guide — the manual's own AMP/CAB type-select CCs (43/44) are
 * confirmed to have no effect on real hardware; SysEx is the only way to change these. AMP/CAB
 * model select and chain reorder are both confirmed working end-to-end against a real NanoCore.
 *
 * Frame: F0 7D 4E 43 <dir> <conn> 02 <seqLo> <seqHi> <opcode> 00 <len> 00 00 <fieldId>
 *        <value bytes...> F7
 *  - Manufacturer ID 0x7D ("non-commercial/educational", used by smaller companies without a
 *    registered MMA id) followed by an ASCII device tag "NC" (NanoCore).
 *  - <dir>: 0x70 host->device (all we send), 0x71 device->host ack (echoes <seqLo>/<seqHi>),
 *    0x72 unsolicited device->host push.
 *  - <conn>: observed as both 0x00 and 0x02 across different capture sessions with no apparent
 *    effect — likely a per-connection/session tag the device doesn't validate. We always send 0.
 *  - <seqLo>/<seqHi>: a per-message transaction id the device echoes back in its ack. Nothing
 *    suggests it's validated beyond that — a simple incrementing counter is enough.
 *  - opcode 0x6D = "set field": <fieldId> + <value bytes> follow a length prefix <len>.
 *    Confirmed field ids under this opcode:
 *      - 0x06 AMP model: 1 value byte, len=2 (1 for fieldId + 1 for the value — this is the
 *        general case, see buildBlockTypeSysEx). Confirmed with 4 isolated single-value captures
 *        across different models, cross-checked against `data/blocks/amp.ts`'s AMP model list —
 *        the value is the *same* 0-29 index already used there (and by the non-working typeCC).
 *      - 0x07 CAB model: same shape, confirmed with 3 isolated single-value captures against
 *        `data/blocks/cab.ts`'s CAB model list.
 *      - 0x05 effect chain order: value = [0x08, 0x00, <8 block-id bytes>] (10 bytes), with
 *        len=10 — i.e. NOT the "1 + value bytes" pattern the scalar fields above follow.
 *        Reproduced byte-for-byte from 4 captured examples (one isolated single-block drag, plus
 *        3 more from a longer session). The block-id numbering below (CHAIN_ORDER_BLOCK_IDS) had
 *        DEL and MOD swapped until 2026-09-08 — a live comparison against the official
 *        ToneCommand app's own (screen-confirmed working) reorder found the real ordering is
 *        del=4/mod=5, not mod=4/del=5 as originally guessed; see docs/MIDI_MAPPING_NOTES.md for
 *        the capture that pinned this down. Still only understood empirically though:
 *        why the leading 0x08/0x00 pair and the different len convention exist isn't known, just
 *        that reproducing them verbatim works. See docs/MIDI_MAPPING_NOTES.md.
 */

import { pack7BitSafe } from './safePacking';

const MANUFACTURER_ID = 0x7d;
const DEVICE_TAG = [0x4e, 0x43]; // "NC"
const DIR_HOST_TO_DEVICE = 0x70;
const CONNECTION_TAG = 0x00;
const SET_FIELD_OPCODE = 0x6d;
const READ_PRESET_OPCODE = 0x41;
/** Reads the active AMP's profile data — read on every real connection sequence (ToneCommand
 * sends it unconditionally). Its response also carries a chain-order-shaped footer; see
 * `buildAmpProfileReadSysEx`/`isAmpProfileResponse` and `midi/presetReader.ts`'s
 * `parseChainOrderFromAmpProfile`. */
const AMP_PROFILE_OPCODE = 0x63;
/** Unsolicited device->host push (`dir=0x72`), never requested — the device sends this the moment
 * the *active preset slot itself* changes, i.e. the user pressed a footswitch/panel button to
 * recall a different preset. Confirmed 2026-09-08 (`Polling_2.mmon`): changing preset pushed
 * `<0x01> 0x00 0x29` (41), switching back pushed `<0x01> 0x00 0x28` (40) — the same slot numbering
 * `buildReadPresetSysEx` uses. This is the actual mechanism for detecting a local patch change;
 * see `isActiveSlotChangedPush`/`parseActiveSlotChangedPush`. (An earlier same-day capture with a
 * stale/dead capture port wrongly suggested the device never pushes anything — see
 * docs/MIDI_MAPPING_NOTES.md and the nanocore-patch-change-detection memory.) */
const ACTIVE_SLOT_CHANGED_OPCODE = 0x01;
/** Unsolicited device->host push (`dir=0x72`), never requested — sent whenever one block's on/off
 * state changes, from ANY source (footswitch, panel, or another connected app's own MIDI). Format
 * `<0x02> 0x00 <blockId> <onOff>`, `blockId` using `CHAIN_ORDER_BLOCK_IDS`' numbering. Confirmed
 * 2026-09-08 (`Polling_2.mmon`): activating MOD pushed `<0x02> 0x00 0x05 0x01`, deactivating FX1
 * pushed `<0x02> 0x00 0x00 0x00` — both exactly matching what was toggled. See
 * `isBlockOnOffChangedPush` here and `midi/presetReader.ts`'s `parseBlockOnOffChangedPush`. */
const BLOCK_ON_OFF_CHANGED_OPCODE = 0x02;
/** Unsolicited device->host push (`dir=0x72`), never requested — sent whenever one block
 * parameter's value changes from a **physical knob turn on the device panel** (confirmed
 * 2026-09-11: sending the same CC via MIDI produces zero `0x06` echoes). Discovered 2026-09-09
 * (`MODtype.mmon`): turning MOD's type encoder fired 13 of these in a burst (one per parameter
 * reset as the encoder scrolled through candidate types) — format `<0x06> 0x00 <blockId>
 * <paramIndex> <x> <value: 4-byte float32, little-endian>`, `blockId` using
 * `CHAIN_ORDER_BLOCK_IDS`' numbering, `value` a clean 0.0-1.0 normalized float every time.
 *
 * **`paramIndex` fully decoded 2026-09-13** via two isolated FX1 Compressor knob sweeps (a
 * from-scratch standalone connection, keepalive-pinged with `buildPingSysEx()` every 3s — see
 * that function's doc comment for why the ping turned out to matter): turning ONLY Threshold
 * held `paramIndex` constant at `0`, turning ONLY Ratio held it constant at `1` — exactly each
 * one's real position in `data/blocks/fx1.ts`'s Compressor `params` array. The 2026-09-11 session
 * had mistaken this correct, expected constancy (only one param moving per sweep) for a sign the
 * byte was useless. `x` (between `paramIndex` and the value) still doesn't decode: the same
 * `value` recurs under different `x`, and the same `x` recurs under different `value`s — almost
 * certainly an internal buffer/message-slot tag with no per-parameter meaning, safe to ignore. See
 * `isParamValueChangedPush` here, `midi/presetReader.ts`'s `parseParamValueChangedPush`, and
 * `store/patchStore.ts`'s `startLivePushListener`, which now applies these to `PatchState.params`
 * live (via `findParamSpecBySysexIndex` + `normalizedToReal`). **Confirmed working end-to-end
 * through the deployed editor itself** (not just raw capture bytes) the same day: with a factory
 * preset active, turning a physical knob moved the matching slider live in the real browser UI. */
const PARAM_VALUE_CHANGED_OPCODE = 0x06;
/** "Are you there" heartbeat ToneCommand sends every ~3s for the whole time it's connected —
 * request is `<0x68> 0x00 0x00 0x00`, reply is a fixed, content-free `<0x68> 0x00 0x00 0x04 0x08
 * 0x00 0x02 0x01 0x08 0x13` (identical every time, confirmed across many captures). **Confirmed
 * 2026-09-13** to be what the device uses to decide a connection is "active" enough to receive
 * unsolicited pushes at all: a from-scratch standalone connection sending nothing got zero
 * spontaneous traffic (not even this heartbeat's reply) across three separate physical-knob
 * sweeps, while replicating this exact ping every 3s immediately unblocked `0x06` param-change
 * pushes on the same connection. See `store/patchStore.ts`'s ping interval,
 * `PARAM_VALUE_CHANGED_OPCODE`'s doc comment, and the nanocore-patch-change-detection memory. */
const PING_OPCODE = 0x68;
/** Save the currently-active/edited patch state to a preset slot — request is `<0x46> 0x00 0x01
 * 0x00 0x00 <slot>`, reply echoes it back with one extra leading `0x00` (`<0x46> 0x00 0x00 0x01
 * 0x00 0x00 <slot>`). Confirmed 2026-09-12 (`Save.mmon`, a real bidirectional MIDI Monitor capture
 * of the official ToneCommand app saving to slot `0x29`/41): a 16-byte request immediately followed
 * by a 17-byte reply, both round-tripped against real hardware from this editor's own connection —
 * reading the target slot afterward returned a byte-exact structural match to a known-real prior
 * save. An earlier attempt (device-output-only captures, which structurally can't see host->device
 * traffic) had mistaken the *reply* shape for the request — sending that back as a command was
 * naturally rejected as a malformed payload every time. See docs/MIDI_MAPPING_NOTES.md. */
const SAVE_PRESET_OPCODE = 0x46;
/** `buildSetParamValueSysEx` sets ONE block parameter's live value directly by index — reuses
 * `SET_FIELD_OPCODE` (`0x6d`) but with a distinct shape from `buildSetFieldSysEx`'s: `<0x6d> 0x00
 * 0x07 0x00 <7-bit-safe-packed [0x01, blockId, paramIndex, ...float32LE bytes]>` (`blockId` per
 * `CHAIN_ORDER_BLOCK_IDS`, `paramIndex` = position in that block type's own `params` array,
 * `0x01` a constant whose meaning isn't otherwise decoded — possibly a "kind" discriminant for
 * this sub-family of `0x6d` messages). The value itself is the SAME 0.0-1.0 normalized float
 * `decodePresetParamValues` reads back (`midi/scaling.ts`'s `realToNormalized`/`normalizedToReal`),
 * not a 0-127 CC.
 *
 * Found 2026-09-12 in a real capture of the official app dragging one knob (REV Decay) — a
 * continuous stream of these, one per UI tick, each carrying the slider's current value. This is
 * almost certainly the app's general live-parameter-set mechanism (the write-side counterpart of
 * the already-known `0x06` read-side push), used for EVERY parameter its own UI exposes —
 * including the handful with no working CC at all (this is how those get fixed; see
 * docs/MIDI_MAPPING_NOTES.md). Confirmed to generalize beyond the one captured example: sending
 * it for a block/paramIndex that has no CC at all (FX1 Gate's 2nd parameter — undocumented, no
 * CC — same day, different test) and reading the slot back afterward showed the new value landed
 * exactly, growing that block's decoded parameter count from 1 to 2. */
/** Default/fallback active preset slot — one past the 40 factory presets (0-39). This was
 * originally believed to be a fixed "always the live one" sentinel, decoupled from whichever of
 * the 40 factory presets was actually recalled. `Polling_2.mmon` (2026-09-08) showed that's not
 * quite right: switching presets on the device pushes `isActiveSlotChangedPush` with a *different*
 * slot number (`0x29`/41), and reading THAT slot (not `0x28`) is what returns the newly-active
 * patch. So this constant is really just "the slot to assume before we've been told otherwise" —
 * callers that track the real current slot (via the push) should pass it explicitly to
 * `buildReadPresetSysEx`/`isReadPresetResponse` instead of relying on this default. See
 * `midi/presetReader.ts` for the response format. */
export const ACTIVE_PRESET_SLOT = 0x28;

/** Polls the device's global/device-level settings (Wireless, Loopback, Input Gain, USB/BT
 * Volume, MIDI Channel — the ones `GlobalSettingsPanel.tsx` used to treat as a local-only
 * reference scratchpad with no CC or SysEx at all). Request is `<0x65> 0x00 0x00 0x00`, no
 * value/length wrapper — sent every ~3s by the official app while its Global Settings screen is
 * open, same cadence as the `0x68` ping. Response shares its payload layout with
 * `GLOBAL_SETTINGS_SET_OPCODE`'s own response — see `parseGlobalSettingsResponse`. Found
 * 2026-09-12 (`Global.mmon`, a real bidirectional capture of every field on that screen being
 * changed once each). Language is NOT in this blob — captured toggling it Chinese->English and
 * no traffic at all corresponds to it, confirming it's a ToneCommand UI-only setting, not a
 * device one. */
const GLOBAL_SETTINGS_POLL_OPCODE = 0x65;
/** Sets ONE global/device-level setting — same `<opcode> 0x00 <len> 0x00 0x00 <fieldId> <value>`
 * shape as `buildSetFieldSysEx`, just a different opcode and field-id space (`GLOBAL_SETTING_FIELD`,
 * bit-flag-shaped: 1/2/4/8/16/32 — unlike `SYSEX_FIELD`'s small sequential ids). Response echoes
 * the request's opcode with the whole current settings blob (same shape
 * `GLOBAL_SETTINGS_POLL_OPCODE`'s response has), not just the one field that changed — see
 * `parseGlobalSettingsResponse`. See `GLOBAL_SETTINGS_POLL_OPCODE`'s doc comment for how this was
 * found; `buildGlobalSettingSysEx`'s value encoding notes per field (Input Gain is signed, in
 * 7-bit two's complement — 0x7b = -5, confirmed from a real capture, not derived). */
const GLOBAL_SETTINGS_SET_OPCODE = 0x66;
/** Unsolicited device->host push (`dir=0x72`, like `ACTIVE_SLOT_CHANGED_OPCODE` and friends) —
 * fires whenever any global setting changes, from ANY source (this editor, ToneCommand, or the
 * device's own panel). Different, SHORTER payload shape than the poll/set response — see
 * `parseGlobalSettingsPush`. Not yet wired into `store/patchStore.ts`'s live push listener. */
const GLOBAL_SETTINGS_PUSH_OPCODE = 0x07;

/** Field ids for `buildGlobalSettingSysEx` — bit-flag-shaped (1/2/4/8/16/32), confirmed
 * exhaustively against a real capture changing each one in turn (`Global.mmon`). `INPUT_GAIN`'s
 * value is signed (7-bit two's complement: 0-63 = 0..63, 64-127 = -64..-1 — e.g. 0x7b/123 = -5).
 * The others are plain values: 0/1 for the two booleans, 0-100 for the two volumes, and for
 * `MIDI_CHANNEL` the same "0 = Omni, else the channel number 1-16" convention as everywhere else
 * in this protocol. */
export const GLOBAL_SETTING_FIELD = {
  WIRELESS: 1,
  LOOPBACK: 2,
  INPUT_GAIN: 4,
  USB_VOLUME: 8,
  BT_VOLUME: 16,
  MIDI_CHANNEL: 32,
} as const;

export const SYSEX_FIELD = {
  CHAIN_ORDER_PRIME: 0x00,
  CHAIN_ORDER: 0x05,
  AMP_MODEL: 0x06,
  CAB_MODEL: 0x07,
  PRESET_NAME: 0x08,
} as const;

/** Block-id numbering for the chain-order array, matching `nanocoreSpec.blocks`' declaration
 * order (index 0-7 = FX1,FX2,AMP,CAB,DEL,MOD,REV,EQ), confirmed 2026-09-08 to be the numbering
 * the wire protocol itself uses, unmodified (no permutation/lookup table). Two same-day hardware
 * tests briefly looked like they contradicted this numbering — resolved same day as two real
 * encoding bugs (missing priming message, wrong padding-byte position) in the chain-order SysEx
 * builders, not a mapping problem; see docs/MIDI_MAPPING_NOTES.md's chain-order section and
 * [[nanocore-chain-order-broken]] for the full incident writeup. */
export const CHAIN_ORDER_BLOCK_IDS: Record<string, number> = {
  fx1: 0,
  fx2: 1,
  amp: 2,
  cab: 3,
  del: 4,
  mod: 5,
  rev: 6,
  eq: 7,
};

let seq = 0;

/** Exposed for tests that need deterministic sequence numbers; not part of the public API. */
export function resetSysExSequence(): void {
  seq = 0;
}

/** Wraps at 0x7F, not 0xFF: `seqLo`/`seqHi` are inserted into the SysEx frame as raw data bytes
 * (unlike every other builder's value bytes here, they're never `& 0x7f`-masked at the call site),
 * and a MIDI SysEx message can't contain any byte >= 0x80 except the leading `F0`/trailing `F7`.
 * The Web MIDI API enforces this and throws `TypeError: ... contains a status byte at index N` —
 * found 2026-09-08 when the module-level `seq` counter (shared across the whole session, never
 * reset except in tests) finally exceeded 127 after enough sends, silently breaking every
 * subsequent send with no visible error in the app itself (the exception surfaces only in the
 * browser console, not the UI or MIDI Monitor — nothing reaches the wire at all once this
 * triggers). */
function nextSeq(): [number, number] {
  seq = (seq + 1) & 0x7f;
  return [seq, 0x00];
}

/** `len` defaults to the "scalar field" convention (1 for fieldId + the value bytes) — pass it
 * explicitly for fields that don't follow that convention (see buildChainOrderSysEx). */
function buildSetFieldSysEx(fieldId: number, valueBytes: number[], len = 1 + valueBytes.length): number[] {
  const [seqLo, seqHi] = nextSeq();
  return [
    0xf0,
    MANUFACTURER_ID,
    ...DEVICE_TAG,
    DIR_HOST_TO_DEVICE,
    CONNECTION_TAG,
    0x02,
    seqLo,
    seqHi,
    SET_FIELD_OPCODE,
    0x00,
    len,
    0x00,
    0x00,
    fieldId & 0x7f,
    ...valueBytes.map((b) => b & 0x7f),
    0xf7,
  ];
}

/** `modelIndex` is the same 0-29 index as `data/blocks/amp.ts`'s AMP model list. */
export function buildAmpModelSysEx(modelIndex: number): number[] {
  return buildSetFieldSysEx(SYSEX_FIELD.AMP_MODEL, [modelIndex]);
}

/** `modelIndex` is the same 0-29 index as `data/blocks/cab.ts`'s CAB model list. */
export function buildCabModelSysEx(modelIndex: number): number[] {
  return buildSetFieldSysEx(SYSEX_FIELD.CAB_MODEL, [modelIndex]);
}

/** Generic form of the two above, for any block with a `sysexTypeField` (see `data/types.ts`) —
 * `typeId` is sent verbatim as the single value byte, same index a working typeCC would use. */
export function buildBlockTypeSysEx(fieldId: number, typeId: number): number[] {
  return buildSetFieldSysEx(fieldId, [typeId]);
}

/** Renames the currently-active/edited patch — a LIVE edit like any other (confirmed 2026-09-13:
 * the official app follows it with a `buildSavePresetSysEx` to persist, and it's lost on a slot
 * change if not saved, exactly like an unsaved parameter tweak). `name` is truncated to the
 * device's real 8-character cap — confirmed by a real capture at exactly 8 chars ("LongName");
 * `parsePresetName`'s own "up to 12" was this editor's earlier, looser estimate from the read
 * side alone, not an independently confirmed write-side limit.
 *
 * Value shape, from 3 real captures (2/7/8-char names — `Rename.mmon`): `[nameLength,
 * ...charCodes]`, with a single `0x00` separator inserted after the 6th byte of that logical
 * sequence whenever a 7th exists (never needed for names of 5 chars or fewer, since `1 +
 * nameLength <= 6` then). This mirrors `unpack7BitSafe`'s general "insert a marker byte" shape,
 * but at a fixed field-specific offset rather than the usual every-7-bytes cadence — not
 * generalized into `pack7BitSafe` itself since a single separator is all this 8-char-capped field
 * can ever need. `len` (the field's own length byte, distinct from `nameLength`) counts the
 * logical sequence — `1 + nameLength` — not the wire byte count, so it does NOT include the
 * separator; pass it explicitly since it diverges from `buildSetFieldSysEx`'s default formula
 * whenever a separator is inserted. */
export function buildRenamePresetSysEx(name: string): number[] {
  const chars = Array.from(name)
    .slice(0, 8)
    .map((c) => c.charCodeAt(0) & 0x7f);
  const logical = [chars.length, ...chars];
  const value = logical.length <= 6 ? logical : [...logical.slice(0, 6), 0x00, ...logical.slice(6)];
  return buildSetFieldSysEx(SYSEX_FIELD.PRESET_NAME, value, 1 + logical.length);
}

/** Sent immediately before `buildChainOrderSysEx` in every real capture of the official
 * ToneCommand app reordering a chain (see docs/MIDI_MAPPING_NOTES.md,
 * `DELafterREV.mmon` capture) — fieldId `0x00`, no value bytes (`len=1`, just the fieldId).
 * Never independently confirmed as necessary (we'd only know by testing without it, which
 * against real hardware this session showed a real, reproducible discrepancy from ToneCommand's
 * behavior), but it's the one host->device message ToneCommand always sends right before its own
 * (screen-confirmed working) chain-order set that our own code was never sending at all. */
export function buildChainOrderPrimeSysEx(): number[] {
  return buildSetFieldSysEx(SYSEX_FIELD.CHAIN_ORDER_PRIME, []);
}

/** `order` = 8 block-ids (see CHAIN_ORDER_BLOCK_IDS) in the new chain position order.
 *
 * The wire layout is `[0x08, order[0], order[1], order[2], order[3], order[4], 0x00, order[5],
 * order[6], order[7]]` — a fixed `0x00` padding byte sits AFTER the 5th order element, not before
 * the whole array as every earlier version of this function assumed. That earlier (wrong)
 * `[0x08, 0x00, ...order]` shape is why chain reordering looked "almost right" against real
 * hardware all session: it only ever corrupted order[4] onward. The real layout was pinned down
 * 2026-09-08 from `MoveFX1.mmon` — a capture of the official ToneCommand app dragging FX1 one
 * step right, seven times in a row (seven independent host->device messages, each diffed against
 * the exact known resulting chain from that single adjacent swap) — see
 * docs/MIDI_MAPPING_NOTES.md. Still unconfirmed: *why* the padding sits mid-array (maybe two
 * historically-separate 5+3 sub-fields), and what the constant `0x08` itself means. */
export function buildChainOrderSysEx(order: number[]): number[] {
  const valueBytes = [0x08, ...order.slice(0, 5), 0x00, ...order.slice(5, 8)];
  return buildSetFieldSysEx(SYSEX_FIELD.CHAIN_ORDER, valueBytes, valueBytes.length);
}

/** Value bytes for opcode `0x41`'s two-page read of the active preset slot. Confirmed byte-exact
 * against a fresh MIDI Monitor capture (spying both directions) of the official ToneCommand
 * app's own connection sequence — see docs/MIDI_MAPPING_NOTES.md. An earlier version of this
 * file guessed at this shape from response captures alone (this session's own capture setup only
 * observes device→host traffic) and got it wrong in two ways: it used `<conn> = 0x40` (copied
 * from what *responses* echo back, not what the request itself carries — real requests use the
 * same `0x00` every other builder here does) and wrapped `value` in a `SET_FIELD_OPCODE`-style
 * `<fieldId-esque-len> 0x00 0x00` prefix that doesn't exist for this opcode — the real frame is
 * just `<opcode> 0x00 <value...>`, no extra length/padding bytes at all. Both mistakes together
 * produced a malformed frame the device silently ignored (no reply, not even an error) — a good
 * reminder that a byte-guess needs re-confirming the same way everything else in this file was,
 * not just "it round-trips against my own parser". */
/** `slot`-parametrized — was hardcoded to `ACTIVE_PRESET_SLOT` until 2026-09-08, when
 * `Polling_2.mmon` showed the official app requesting page 1 with `0x29` (41) right after an
 * `isActiveSlotChangedPush` told it the active slot had changed from `0x28` (40) — i.e. `0x28`
 * isn't a fixed "always the live one" sentinel, it's just whatever slot number happens to be
 * active, and reads must target *that*, not a hardcoded constant, once the user has switched
 * presets on the device. See `midi/patchStore.ts` for tracking the current slot via the push. */
function readPage1Value(slot: number): number[] {
  return [0x04, 0x00, 0x08, slot, 0x00, 0x00, 0x48];
}
function readPage2Value(slot: number): number[] {
  return [0x04, 0x00, 0x0a, slot, 0x48, 0x00, 0x48];
}

/** True for any NanoCore SysEx message that's a reply to `buildReadPresetSysEx` for `slot` (either
 * page) — use this to pick the right incoming messages out of `MidiTransport.onSysExReceived`'s
 * stream, which also carries unrelated device chatter. Checking the opcode alone is NOT enough:
 * opcode `0x41` is overloaded — real hardware was found to also send frequent short (16-byte)
 * `0x41` messages unrelated to a preset read (some other status ping, not investigated), and
 * matching on opcode alone grabbed one of *those* instead of the real ~250-byte reply, silently
 * feeding `presetReader.ts` garbage. Genuine page-1/page-2 replies echo the requested slot 6
 * bytes after the opcode — check that too, against whatever slot was actually requested (see
 * `readPage1Value`'s doc comment for why this can no longer be hardcoded to `0x28`). Accepts
 * either a full `F0...F7` message or an already-stripped payload. */
export function isReadPresetResponse(bytes: readonly number[], slot: number = ACTIVE_PRESET_SLOT): boolean {
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return bytes[opcodeIndex] === READ_PRESET_OPCODE && bytes[opcodeIndex + 6] === slot;
}

/** Requests page 1 or page 2 of `slot`'s SysEx dump (defaults to `ACTIVE_PRESET_SLOT` — pass the
 * device's actual current slot, tracked from `isActiveSlotChangedPush`, once it's known to differ)
 * — see `presetReader.ts` for how to parse the two responses this triggers. Confirmed byte-exact
 * against a real capture of the official app's own request (see `readPage1Value`'s doc comment)
 * — unlike every other builder in this file, only this one has actually been re-verified this way
 * rather than just inferred from response traffic. */
export function buildReadPresetSysEx(page: 1 | 2, slot: number = ACTIVE_PRESET_SLOT): number[] {
  const [seqLo, seqHi] = nextSeq();
  const value = page === 1 ? readPage1Value(slot) : readPage2Value(slot);
  return [0xf0, MANUFACTURER_ID, ...DEVICE_TAG, DIR_HOST_TO_DEVICE, CONNECTION_TAG, 0x02, seqLo, seqHi, READ_PRESET_OPCODE, 0x00, ...value, 0xf7];
}

/** True for an unsolicited push announcing the active preset slot changed — see
 * `ACTIVE_SLOT_CHANGED_OPCODE`'s doc comment. */
export function isActiveSlotChangedPush(bytes: readonly number[]): boolean {
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return bytes[opcodeIndex] === ACTIVE_SLOT_CHANGED_OPCODE;
}

/** The new active slot number from an `isActiveSlotChangedPush` message, or `null` if `bytes`
 * isn't one. */
export function parseActiveSlotChangedPush(bytes: readonly number[]): number | null {
  if (!isActiveSlotChangedPush(bytes)) return null;
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return bytes[opcodeIndex + 2] ?? null;
}

/** True for an unsolicited push announcing one block's on/off state changed — see
 * `BLOCK_ON_OFF_CHANGED_OPCODE`'s doc comment. Parsing (which needs the block-id-to-name map) is
 * `midi/presetReader.ts`'s `parseBlockOnOffChangedPush`. */
export function isBlockOnOffChangedPush(bytes: readonly number[]): boolean {
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return bytes[opcodeIndex] === BLOCK_ON_OFF_CHANGED_OPCODE;
}

/** True for an unsolicited push announcing one block parameter's live value changed — see
 * `PARAM_VALUE_CHANGED_OPCODE`'s doc comment. Parsing is `midi/presetReader.ts`'s
 * `parseParamValueChangedPush`. */
export function isParamValueChangedPush(bytes: readonly number[]): boolean {
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return bytes[opcodeIndex] === PARAM_VALUE_CHANGED_OPCODE;
}

/** Requests the active AMP's profile (opcode `0x63`) — confirmed byte-exact against real captures
 * of the official ToneCommand app, which sends this unconditionally on every connect. Originally
 * only its chain-order-shaped footer was used (`midi/presetReader.ts`'s
 * `parseChainOrderFromAmpProfile`), but the response turned out to carry the device's full LIVE
 * state — every block's on/off, type/model, and current param values, decoded by
 * `decodeLiveBlockParams` (2026-09-13) and overlaid on the saved-state read in
 * `patchStore.ts#readPresetFromDevice`. Request is just `<opcode> 0x00 0x00 0x00`, no
 * length/value wrapper. */
export function buildAmpProfileReadSysEx(): number[] {
  const [seqLo, seqHi] = nextSeq();
  return [0xf0, MANUFACTURER_ID, ...DEVICE_TAG, DIR_HOST_TO_DEVICE, CONNECTION_TAG, 0x02, seqLo, seqHi, AMP_PROFILE_OPCODE, 0x00, 0x00, 0x00, 0xf7];
}

/** True for a reply to `buildAmpProfileReadSysEx`. Checks the opcode plus a minimum length rather
 * than the opcode alone — a bare opcode match is insufficient (the 13-byte request echoes the
 * same opcode, and opcodes are overloaded elsewhere in this protocol). The floor was `> 190`,
 * calibrated on early ~206-byte captures — but the response length varies a lot with preset
 * content (a preset with few active blocks / simple types is much shorter: slot 12 "Smear" came
 * back at 176), and rejecting those stranded `readPresetFromDevice` on the stale slot. `> 100` is
 * comfortably above the request echo and any short device chatter while accepting every real
 * profile; the parsers that read it each guard their own offsets. */
export function isAmpProfileResponse(bytes: readonly number[]): boolean {
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return bytes[opcodeIndex] === AMP_PROFILE_OPCODE && bytes.length > 100;
}

/** The `0x68` "are you there" heartbeat ToneCommand sends every ~3s — see `PING_OPCODE`'s doc
 * comment. Not confirmed to be necessary for anything on our side; being tried as the missing
 * piece for why the device's unsolicited pushes (opcodes 0x01/0x02) don't seem to reach this
 * editor's own connection, only ToneCommand's. */
export function buildPingSysEx(): number[] {
  const [seqLo, seqHi] = nextSeq();
  return [0xf0, MANUFACTURER_ID, ...DEVICE_TAG, DIR_HOST_TO_DEVICE, CONNECTION_TAG, 0x02, seqLo, seqHi, PING_OPCODE, 0x00, 0x00, 0x00, 0xf7];
}

/** Saves the currently-active/edited patch state to `slot` — see `SAVE_PRESET_OPCODE`'s doc
 * comment. Confirmed byte-exact against a real capture of the official app's own request. */
export function buildSavePresetSysEx(slot: number): number[] {
  const [seqLo, seqHi] = nextSeq();
  return [
    0xf0, MANUFACTURER_ID, ...DEVICE_TAG, DIR_HOST_TO_DEVICE, CONNECTION_TAG, 0x02, seqLo, seqHi,
    SAVE_PRESET_OPCODE, 0x00, 0x01, 0x00, 0x00, slot, 0xf7,
  ];
}

/** True for a reply to `buildSavePresetSysEx` for `slot` — checks the opcode and echoed slot (7
 * bytes after the opcode, one further in than the request since the reply has an extra leading
 * `0x00` — see `SAVE_PRESET_OPCODE`'s doc comment). */
export function isSavePresetResponse(bytes: readonly number[], slot: number): boolean {
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return bytes[opcodeIndex] === SAVE_PRESET_OPCODE && bytes[opcodeIndex + 6] === slot;
}

/** Sets one block parameter's live value directly, bypassing CC — see `SET_FIELD_OPCODE`'s
 * "`buildSetParamValueSysEx`" doc comment above for the format and how it was found. `blockId` is
 * `CHAIN_ORDER_BLOCK_IDS[block.id]`, `paramIndex` the parameter's position in its block type's
 * `params` array, `normalizedValue` the 0.0-1.0 value from `midi/scaling.ts`'s
 * `realToNormalized`. */
export function buildSetParamValueSysEx(blockId: number, paramIndex: number, normalizedValue: number): number[] {
  const [seqLo, seqHi] = nextSeq();
  const floatBuf = new ArrayBuffer(4);
  new DataView(floatBuf).setFloat32(0, normalizedValue, true); // little-endian, matches readFloat32LE
  const floatBytes = Array.from(new Uint8Array(floatBuf));
  const packed = pack7BitSafe([0x01, blockId & 0x7f, paramIndex & 0x7f, ...floatBytes]);
  return [
    0xf0, MANUFACTURER_ID, ...DEVICE_TAG, DIR_HOST_TO_DEVICE, CONNECTION_TAG, 0x02, seqLo, seqHi,
    SET_FIELD_OPCODE, 0x00, 0x07, 0x00, ...packed, 0xf7,
  ];
}

/** True for a reply to `buildSetParamValueSysEx` for `blockId`/`paramIndex` — checks the opcode
 * and echoed blockId/paramIndex (7/8 bytes after the opcode; one further in than the request,
 * same "extra leading 0x00" pattern as `isSavePresetResponse`). Doesn't check the echoed value:
 * real captures show the device can echo back a slightly different value than what was sent
 * (rounding, or a value it had already settled on mid-drag), so this only confirms the device
 * acknowledged something for this parameter, not the exact value. */
export function isSetParamValueResponse(bytes: readonly number[], blockId: number, paramIndex: number): boolean {
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return bytes[opcodeIndex] === SET_FIELD_OPCODE && bytes[opcodeIndex + 7] === blockId && bytes[opcodeIndex + 8] === paramIndex;
}

/** Polls the device's current global settings — see `GLOBAL_SETTINGS_POLL_OPCODE`'s doc comment. */
export function buildGlobalSettingsPollSysEx(): number[] {
  const [seqLo, seqHi] = nextSeq();
  return [0xf0, MANUFACTURER_ID, ...DEVICE_TAG, DIR_HOST_TO_DEVICE, CONNECTION_TAG, 0x02, seqLo, seqHi, GLOBAL_SETTINGS_POLL_OPCODE, 0x00, 0x00, 0x00, 0xf7];
}

/** Encodes a signed dB value (e.g. Input Gain) into the 7-bit two's complement byte
 * `buildGlobalSettingSysEx`/`GLOBAL_SETTING_FIELD.INPUT_GAIN` expects — the inverse of
 * `midi/presetReader.ts`'s (unexported) `signed7Bit`. Clamps to the representable -64..63 range. */
export function encodeSigned7Bit(value: number): number {
  const clamped = Math.round(Math.min(63, Math.max(-64, value)));
  return clamped < 0 ? clamped + 128 : clamped;
}

/** Sets one global setting — `fieldId` from `GLOBAL_SETTING_FIELD`, `value` per that field's own
 * encoding (see `GLOBAL_SETTING_FIELD`'s doc comment — Input Gain is signed 7-bit two's
 * complement, use `encodeSigned7Bit`; everything else is a plain value). See
 * `GLOBAL_SETTINGS_SET_OPCODE`'s doc comment. */
export function buildGlobalSettingSysEx(fieldId: number, value: number): number[] {
  const [seqLo, seqHi] = nextSeq();
  return [
    0xf0, MANUFACTURER_ID, ...DEVICE_TAG, DIR_HOST_TO_DEVICE, CONNECTION_TAG, 0x02, seqLo, seqHi,
    GLOBAL_SETTINGS_SET_OPCODE, 0x00, 0x02, 0x00, 0x00, fieldId & 0x7f, value & 0x7f, 0xf7,
  ];
}

/** True for a reply to either `buildGlobalSettingsPollSysEx` or `buildGlobalSettingSysEx` — both
 * share the same response shape (the full current settings blob, not just whichever one field a
 * `buildGlobalSettingSysEx` call changed). Parsing is `midi/presetReader.ts`'s
 * `parseGlobalSettingsResponse`. */
export function isGlobalSettingsResponse(bytes: readonly number[]): boolean {
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  const opcode = bytes[opcodeIndex];
  return (opcode === GLOBAL_SETTINGS_POLL_OPCODE || opcode === GLOBAL_SETTINGS_SET_OPCODE) && bytes[opcodeIndex + 3] === 0x07;
}

/** True for the unsolicited global-settings-changed push — see `GLOBAL_SETTINGS_PUSH_OPCODE`'s
 * doc comment. Parsing is `midi/presetReader.ts`'s `parseGlobalSettingsPush` (a different, shorter
 * layout than `isGlobalSettingsResponse`'s — see that function's doc comment). */
export function isGlobalSettingsPush(bytes: readonly number[]): boolean {
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return bytes[opcodeIndex] === GLOBAL_SETTINGS_PUSH_OPCODE;
}
