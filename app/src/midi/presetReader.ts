/**
 * Parser for the NanoCore's SysEx "read current patch" response (opcode `0x41`) — reverse-
 * engineered from live MIDI traffic captured between the official ToneCommand app and a real
 * NanoCore (direct CoreMIDI capture, one change+save+reconnect at a time — see
 * docs/MIDI_MAPPING_NOTES.md for the full write-up and the captured examples this is derived
 * from). Decodes each block's *type* and, for MOD (confirmed) and by extension the other blocks
 * sharing its tag shape (extrapolated, not independently confirmed for each), its on/off state.
 * Parameter values are NOT decoded by this function — see `decodePresetParamValues` below, which
 * walks the same tag stream for that (kept separate since it was solved later and has its own
 * shape quirks per block).
 *
 * ## Response shape
 * The device replies to a read request with two SysEx messages ("page 1" and "page 2" — a
 * transport-level split, not a semantic one: logically it's one continuous byte stream, just
 * chunked because it's too long for a single message). Concatenating their payloads (the bytes
 * between `F0`/`F7`, both included here) gives one buffer to parse.
 *
 * After a small fixed preamble (manufacturer/dir/seq/opcode/slot bytes, the preset name — see
 * `parsePresetName` — and a fixed permutation-looking table — none of that is needed to get each
 * block's type), the buffer contains exactly 8 back-to-back tags, ALWAYS in this fixed order regardless
 * of the preset's own effect-chain routing (confirmed empirically, never varied across many
 * captures this session):
 *
 *   FX1, FX2, AMP, CAB, DEL, MOD, REV, EQ
 *
 * Each tag is `0x10 <LEN> <X> <content...>`, encoded in one of two forms distinguished by
 * whether `<LEN>` is zero:
 *   - **Normal form** (`LEN != 0`): content is exactly `LEN` bytes, `<X>` is not needed to find
 *     the boundary (its value was observed to repeat across unrelated blocks — not a reliable
 *     per-block identifier, hence tags are matched by *position* in the fixed order above, not
 *     by this byte).
 *   - **"Escape" form** (`LEN == 0`): content is actually `<X> + 3` bytes — confirmed by a
 *     dedicated test (toggling MOD off/on with its type held fixed: the content this rule
 *     produces landed *exactly* on the next tag's `0x10` every time, and contains MOD's known
 *     type-id one position later than the normal form — see below). Both forms are back-to-back
 *     with NO separator once the length is computed this way — no delimiter-skipping needed.
 * A stray `0x10` can still appear *inside* a block's own content, so tags must be walked by
 * computed length, never found by scanning for `0x10` bytes once you're inside one.
 *
 * AMP and CAB's tags exist in this sequence but their *content* does NOT carry the model
 * selection — that was confirmed to live in page 2's trailing footer instead (see
 * `extractAmpCabModelIndices` below). Their tags are walked over and otherwise ignored here.
 *
 * Per-block type-id byte position within its tag's content, in the *normal* form — add 1 for
 * the *escape* form:
 *
 * On/off: this `parseReadPresetResponse` path only pins it down reliably for AMP/CAB/EQ (their
 * `ampOn`/`cabOn`/`eqOn` fields, from the tag content), and even those corrupt for EQ once its
 * tag runs past the page-1/page-2 boundary. The whole preset's on/off state is now taken instead
 * from `decodePresetParamValues` (content byte 3 of each block's *unpacked* tag — byte-exact for
 * all 8 blocks, all 40 factory presets); this response's `fx1On`/`delOn`/`modOn`/`revOn` are kept
 * only as a historical curiosity and never applied. Live changes made on the device come through
 * the `0x02` push (`parseBlockOnOffChangedPush`).
 *
 *   FX1: content[2]              (gate=0, auto gate=1, compressor=3) — only ever seen in normal
 *                                 form
 *   FX2: content[2]              (scream=0, klone=1, ocd=2, ...) — only ever seen in escape
 *                                 form, but lands at the *same* position 2 as the normal-form
 *                                 blocks below would at position 1 + the escape shift — i.e. FX2
 *                                 behaves as if its "base" position were 1, same family as MOD
 *   MOD: content[1] (normal) / content[2] (escape)   — matches `data/blocks/mod.ts`'s
 *                                 EffectType.id directly, no correction needed.
 *   DEL: content[1] (normal) / content[2] (escape)   — matches `data/blocks/del.ts` directly
 *   REV: content[1] (normal) / content[2] (escape), MINUS ONE  (shimmer→5, spring→7 over the
 *                                 wire, but `data/blocks/rev.ts` has shimmer=4/spring=6 — a
 *                                 consistent +1 offset seen on both samples tested; only 2 data
 *                                 points, flag if a 3rd contradicts)
 *   EQ:  no type-id byte at all — see below.
 *
 * EQ has no dedicated type: it's page 2's structure directly, and its "type" (`eq3`/`eq6`/`eq8`
 * in `data/blocks/eq.ts`) is implicit in how many band-gain entries follow a small header —
 * confirmed `eq3 → 4 entries` (1 master + 3 bands) and `eq8 → 9 entries` (1 master + 8 bands).
 * `bandCount = entryCount - 1`; `data/blocks/eq.ts`'s type order is `[3, 6, 8]` bands.
 *
 * AMP and CAB, per the discovery above, are read from a small fixed-shape footer near the very
 * end of page 2: `... 0x21 0x01 <CAB_INDEX> 0x24 0x01 ...` with `<AMP_INDEX>` immediately
 * *before* the `0x21`. Both are the model's plain 0-indexed position in its factory list —
 * exactly the same index `buildAmpModelSysEx`/`buildCabModelSysEx` already send, no lookup
 * table needed. Confirmed twice on real hardware (Hiw103=6th→index 6 / MesR1=12th→index 11,
 * then FdTR212=5th→index 4 / Bog412A=1st→index 0).
 */

import {
  CHAIN_ORDER_BLOCK_IDS,
  isBlockOnOffChangedPush,
  isGlobalSettingsPush,
  isGlobalSettingsResponse,
  isParamValueChangedPush,
} from './sysex';
import { unpack7BitSafe } from './safePacking';

/** One decoded tag's content, plus which form produced it (needed to pick the right type-id
 * offset — see the file header). `x` (the escape form's length-minus-3, or the normal form's
 * otherwise-unused third tag byte) is kept only for debugging. */
export interface RawTag {
  isEscapeForm: boolean;
  x: number;
  content: number[];
}

/** Where the fixed preamble (manufacturer/dir/seq bytes, slot, preset name, permutation table)
 * ends and the first block tag (FX1) begins, in the concatenated page-1+page-2 buffer. Confirmed
 * stable across every capture this session regardless of preset content. */
const FIRST_TAG_SEARCH_START = 40;

/** Fixed tag order, confirmed never to vary with the preset's own effect-chain routing. */
const TAG_COUNT = 8;

/** MOD is tag index 5 (0-based) in the fixed FX1/FX2/AMP/CAB/DEL/MOD/REV/EQ order. */
const MOD_TAG_INDEX = 5;

/**
 * Bug found 2026-09-09 (`MODtype.mmon`): the escape form's `content = x + 3` rule (confirmed
 * correct for MOD at `x = 20`, e.g. flanger — content lands exactly on the next tag's `0x10` with
 * zero gap) OVERSHOOTS by one byte for MOD at `x = 15` (chorus) — the real next tag (REV) starts
 * ONE byte before where `x + 3` says MOD's content ends. Confirmed by finding REV's own marker
 * independently (its `x = 6`, matching every other capture) sitting at that position, then
 * counting backward. Because `skipToNextTagMarker` only searches FORWARD, an overshoot like this
 * is unrecoverable — it skips past the true marker and resyncs on a later, unrelated `0x10`,
 * corrupting every tag read after MOD (REV, EQ) and the page-2-footer AMP/CAB model lookup
 * (confirmed: this exact corruption was silently present in every real capture this session where
 * MOD's type was chorus — `FX2off.mmon`/`MODoff.mmon`/`REVoff.mmon`/`DELoff.mmon`/`MODtype.mmon`,
 * all producing a nonsensical `revTypeId` around 124-125 that was noted as "seems off" without
 * being tracked down until now).
 *
 * Root cause not fully understood — likely the "content" isn't a fixed function of `x` at all but
 * of the actual number/size of parameter entries encoded for that specific type (chorus has 3
 * params vs flanger's 4 in `data/blocks/mod.ts`, matching well with a real ~6-byte size
 * difference between their two confirmed content lengths of 17 vs 23), and `x + 3` merely happens
 * to be exactly right for flanger's shape. Only 2 real data points exist (x=15→17, x=20→23) — not
 * enough to derive the general rule, so this is special-cased for the one confirmed-wrong value
 * rather than guessed at broadly. Revisit if a 3rd MOD type contradicts either number. */
const MOD_ESCAPE_X_WITH_OFF_BY_ONE_CONTENT_LENGTH = 15;

function walkTags(buf: readonly number[], from: number, count: number): RawTag[] {
  const tags: RawTag[] = [];
  let i = from;
  const skipToNextTagMarker = () => {
    while (i < buf.length && buf[i] !== 0x10) i += 1;
  };
  skipToNextTagMarker();
  for (let n = 0; n < count; n += 1) {
    if (i + 2 >= buf.length || buf[i] !== 0x10) break;
    const lenByte = buf[i + 1];
    const x = buf[i + 2];
    const isEscapeForm = lenByte === 0;
    let realLength = isEscapeForm ? x + 3 : lenByte;
    if (isEscapeForm && n === MOD_TAG_INDEX && x === MOD_ESCAPE_X_WITH_OFF_BY_ONE_CONTENT_LENGTH) {
      realLength -= 1; // see MOD_ESCAPE_X_WITH_OFF_BY_ONE_CONTENT_LENGTH's doc comment
    }
    const content = buf.slice(i + 3, i + 3 + realLength);
    tags.push({ isEscapeForm, x, content });
    i += 3 + realLength;
    // Tags are NOT always back-to-back — gaps of a few filler bytes (1 after FX1, up to 3 seen
    // elsewhere, e.g. AMP->CAB/CAB->DEL/DEL->MOD) are normal and harmless here since this scans
    // forward for the real next `0x10` regardless of gap size. What's NOT recoverable is an
    // OVERSHOOT (computed length too long, landing past the true next marker) — the scan can only
    // go forward, so it resyncs on a later, unrelated `0x10` instead — see
    // MOD_ESCAPE_X_WITH_OFF_BY_ONE_CONTENT_LENGTH's doc comment for a confirmed real case.
    skipToNextTagMarker();
  }
  return tags;
}

/** `content[basePosition + (escape form ? 1 : 0)]`, or `null` if the tag is missing/too short. */
function typeIdAt(tag: RawTag | undefined, basePosition: number): number | null {
  if (!tag) return null;
  const position = basePosition + (tag.isEscapeForm ? 1 : 0);
  return tag.content.length > position ? tag.content[position] : null;
}

/** The byte right after the type-id, per the confirmed MOD on/off finding — see file header. */
function onOffAt(tag: RawTag | undefined, basePosition: number): boolean | null {
  const value = typeIdAt(tag, basePosition + 1);
  return value === null ? null : value !== 0;
}

/** Confirmed EQ band-type ordering in `data/blocks/eq.ts`: index 0/1/2 = 3/6/8 bands. */
const EQ_BAND_COUNTS = [3, 6, 8];

function eqTypeIdFromEntryCount(entryCount: number | null): number | null {
  if (entryCount === null) return null;
  const bandCount = entryCount - 1;
  const index = EQ_BAND_COUNTS.indexOf(bandCount);
  return index === -1 ? null : index;
}

/** Finds the `0x21 0x01 <CAB> 0x24 0x01` footer anchor and reads AMP (byte immediately before
 * the `0x21`) and CAB (the byte between the two markers) from around it. Searches from the end
 * of the buffer since this footer is always near the tail of page 2. Returns `null` for a value
 * whose anchor wasn't found (e.g. an older/different firmware not confirmed against). */
function extractAmpCabModelIndices(buf: readonly number[]): { ampIndex: number | null; cabIndex: number | null } {
  for (let i = buf.length - 5; i >= 1; i -= 1) {
    if (buf[i] === 0x21 && buf[i + 1] === 0x01 && buf[i + 3] === 0x24 && buf[i + 4] === 0x01) {
      return { ampIndex: buf[i - 1], cabIndex: buf[i + 2] };
    }
  }
  return { ampIndex: null, cabIndex: null };
}

export interface ParsedPresetTypes {
  /** `EffectType.id` values from the corresponding `data/blocks/*.ts` file, or `null` when not
   * decodable from this response (tag missing/too short). */
  fx1TypeId: number | null;
  fx2TypeId: number | null;
  modTypeId: number | null;
  delTypeId: number | null;
  revTypeId: number | null;
  eqTypeId: number | null;
  /** DISPROVEN 2026-09-09 as a real on/off signal — kept only because computing it is harmless
   * and it may be useful for future debugging, but `store/patchStore.ts`'s `readPresetFromDevice`
   * deliberately does NOT apply this to `patch.mod.on` anymore. Originally "confirmed" via a
   * dedicated off/on-with-type-held-fixed test (see file header), but a later, independent
   * two-state real-hardware comparison found this same byte position also changes between two
   * captures where MOD was ON in BOTH — i.e. it tracks some other parameter, and the original
   * test's flip was coincidental/confounded, not a genuine on/off signal. Live on/off sync for
   * MOD now comes entirely from the `0x02` unsolicited push (see `parseBlockOnOffChangedPush`
   * and `store/patchStore.ts`'s `startLivePushListener`) — this read-based decode is not a
   * fallback for it. */
  modOn: boolean | null;
  /** DISPROVEN 2026-09-09, more conclusively than `modOn`: a byte-for-byte diff of two real
   * opcode-`0x41` reads, hours apart, with DEL toggled AND SAVED in between, found DEL's entire
   * tag content byte-for-byte IDENTICAL — this field's on/off byte doesn't just fail to change
   * reliably, it doesn't encode on/off *anywhere in the tag* at all. Not applied in
   * `store/patchStore.ts` — see `modOn`'s doc comment, same situation. */
  delOn: boolean | null;
  /** DISPROVEN 2026-09-09 the same way and by the same evidence as `delOn` — REV's tag content
   * was also found byte-for-byte identical between two real on/off states. Not applied in
   * `store/patchStore.ts`. */
  revOn: boolean | null;
  /** DISPROVEN 2026-09-09 as living in THIS response's FX1 tag: a byte-for-byte diff of two real
   * reads with FX1 toggled AND SAVED in between (hours apart) found FX1's entire tag content
   * byte-for-byte identical — this position is a constant, not an on/off signal. FX1's real on/off
   * (like every block's) comes from `decodePresetParamValues` (content byte 3). This field stays
   * disproven/unused; kept only for debugging. */
  fx1On: boolean | null;
  /** Re-derived from an *earlier* investigation (before this session found the tag structure),
   * which pinned AMP's on/off to a clean, dedicated single-variable capture at the time (a file
   * literally named "AMP OFF" read `0`, every other capture including toggle-back-on read `1`)
   * — a real, confirmed test, just expressed as an absolute page-1 byte offset that only held for
   * that one investigation's specific preset. Re-expressed here as position 2 within AMP's own
   * tag content, which is what that absolute offset maps to — not independently re-captured this
   * session, but backed by a real dedicated test rather than a same-family-shape guess. */
  ampOn: boolean | null;
  /** Same provenance as `ampOn` (an earlier dedicated single-variable capture, re-expressed as a
   * tag-relative position instead of an absolute offset) — CAB's on/off is one position later,
   * at position 3 within its own tag content. */
  cabOn: boolean | null;
  /** Confirmed 2026-09-08 with a dedicated off/on capture (type held fixed at eq8) — position 2
   * within EQ's own tag content, the byte right before the band-entry-count byte used for
   * `eqTypeId` (content[3]). Same shape as the other confirmed on/off bytes: one position before
   * the "next" piece of tag data. */
  eqOn: boolean | null;
  /** Plain 0-indexed position in `data/blocks/amp.ts` / `cab.ts`'s model list. */
  ampModelIndex: number | null;
  cabModelIndex: number | null;
}

/** Strips the `F0`/manufacturer/tag framing shared by every NanoCore SysEx message, if present
 * (accepts either the full `F0...F7` message or an already-stripped payload, for convenience). */
function stripFrame(bytes: readonly number[]): number[] {
  const arr = bytes[0] === 0xf0 ? bytes.slice(1) : bytes.slice();
  return arr[arr.length - 1] === 0xf7 ? arr.slice(0, -1) : arr;
}

/** Debug/investigation helper (see docs/MIDI_MAPPING_NOTES.md's "Parameter values" gap) — exposes
 * each of the 8 tags' raw form/x/content exactly as `walkTags` sees them, for correlating against
 * known-good preset data (e.g. the official app's bundled `factory_presets.json`) while reverse
 * engineering the per-parameter compact value encoding. Not used by `parseReadPresetResponse`
 * itself; kept around rather than inlined ad hoc since this kind of investigation recurs. */
export function debugWalkPresetTags(page1Bytes: readonly number[], page2Bytes: readonly number[]): RawTag[] {
  const combined = [...stripFrame(page1Bytes), ...stripFrame(page2Bytes)];
  return walkTags(combined, FIRST_TAG_SEARCH_START, TAG_COUNT);
}

/**
 * Decodes the two SysEx responses to a preset read request (see `buildReadPresetSysEx`) into
 * each block's type (and, where confirmed, on/off state). `page1Bytes`/`page2Bytes` may be the
 * full `F0...F7` messages or their payloads — see `stripFrame`. Does NOT decode parameter values
 * itself — use `decodePresetParamValues` for those.
 */
export function parseReadPresetResponse(page1Bytes: readonly number[], page2Bytes: readonly number[]): ParsedPresetTypes {
  const combined = [...stripFrame(page1Bytes), ...stripFrame(page2Bytes)];
  const [fx1, fx2, amp, cab, del, mod, rev, eq] = walkTags(combined, FIRST_TAG_SEARCH_START, TAG_COUNT);

  const rawRevTypeId = typeIdAt(rev, 1);
  const { ampIndex, cabIndex } = extractAmpCabModelIndices(combined);

  return {
    fx1TypeId: typeIdAt(fx1, 2),
    fx2TypeId: typeIdAt(fx2, 1),
    modTypeId: typeIdAt(mod, 1),
    delTypeId: typeIdAt(del, 1),
    // -1 correction: see the file header ("REV" bullet) — only 2 data points confirmed.
    revTypeId: rawRevTypeId === null ? null : rawRevTypeId - 1,
    eqTypeId: eqTypeIdFromEntryCount(typeIdAt(eq, 3)),
    modOn: onOffAt(mod, 1),
    delOn: onOffAt(del, 1),
    revOn: onOffAt(rev, 1),
    fx1On: onOffAt(fx1, 2),
    ampOn: onOffAt(amp, 1),
    cabOn: onOffAt(cab, 2),
    eqOn: onOffAt(eq, 1),
    ampModelIndex: ampIndex,
    cabModelIndex: cabIndex,
  };
}

/** The 5 bytes that immediately precede the preset-name field in an opcode-`0x41` page-1 payload:
 * `0x02 0x07 0x00 0x02 0x10`, ending on the `0x10` field marker. Constant across all 40 factory
 * slots read from real hardware (the sequence-number bytes earlier in the preamble DO vary between
 * reads, so this isn't just re-confirming one frozen capture). Anchoring on this rather than a
 * hardcoded offset keeps the decode working if the preamble length ever shifts. */
const PRESET_NAME_ANCHOR = [0x02, 0x07, 0x00, 0x02, 0x10];

/** Longest preset name the name field can hold: it runs from just after the anchor up to a fixed
 * `0x60 0x13 0x03` / `0x6f 0x3e 0x2d`-style 3-byte marker 14 bytes later, minus the two
 * `unpack7BitSafe` header bytes that fall inside it (see `parsePresetName`). */
const PRESET_NAME_MAX_LEN = 12;

/**
 * Decodes the active/read preset's name from an opcode-`0x41` "read preset" response (either page;
 * the name is in page 1). Returns `null` if the anchor isn't found or the field doesn't look like
 * a name.
 *
 * The name sits right after `PRESET_NAME_ANCHOR`, stored the same quirky way as the `"preset"`
 * ASCII literal elsewhere in this protocol's serialization: the first two characters raw, then a
 * `0x00`, then the rest. That `0x00` is an `unpack7BitSafe` packing header (every name byte is
 * ASCII < 0x80, so the header is always `0x00` and unpacking is a no-op) — which also means a
 * second header byte falls 8 positions later, after the 7th post-anchor byte, and must be skipped
 * too for names long enough to reach it. Decoded byte-exact against all 40 factory preset names
 * read from real hardware (longest tested: 8 chars — the second skip is inferred from the packing
 * scheme, not yet exercised by a real long name).
 */
export function parsePresetName(bytes: readonly number[]): string | null {
  const arr = stripFrame(bytes);

  let anchorEnd = -1;
  for (let i = 0; i + PRESET_NAME_ANCHOR.length <= arr.length; i += 1) {
    if (PRESET_NAME_ANCHOR.every((b, j) => arr[i + j] === b)) {
      anchorEnd = i + PRESET_NAME_ANCHOR.length; // first name byte
      break;
    }
  }
  if (anchorEnd === -1) return null;

  // First two chars are raw; then skip the packing header at +2; then read the rest, skipping the
  // next packing header 8 bytes on (+2 header, +7 data, +1 header).
  const nameCodes: number[] = [];
  for (let read = 0; read < PRESET_NAME_MAX_LEN + 2; read += 1) {
    if (read === 2 || read === 10) continue; // packing header positions
    const code = arr[anchorEnd + read];
    if (code === undefined || code === 0) break;
    if (code < 0x20 || code > 0x7e) return null; // not printable ASCII — not a name
    nameCodes.push(code);
    if (nameCodes.length >= PRESET_NAME_MAX_LEN) break;
  }
  return nameCodes.length > 0 ? String.fromCharCode(...nameCodes) : null;
}

/** Inverse of `CHAIN_ORDER_BLOCK_IDS` — numeric id (0-7) back to block-id string. */
const BLOCK_ID_BY_CHAIN_ORDER_VALUE: Record<number, string> = Object.fromEntries(
  Object.entries(CHAIN_ORDER_BLOCK_IDS).map(([id, value]) => [value, id]),
);

/**
 * Decodes the chain-order footer from an opcode-`0x63` "AMP profile" response (see
 * `midi/sysex.ts`'s `buildAmpProfileReadSysEx`/`isAmpProfileResponse`) into an ordered array of
 * block ids (`chainOrder`-shaped, position 0 = first in the chain). Returns `null` if the footer
 * isn't found in the expected shape (e.g. an older/different firmware) or doesn't decode to a
 * valid permutation of all 8 blocks.
 *
 * The footer is the last 11 bytes before `F7`: `[0x08, 0x00, order[0], order[1], order[2],
 * order[3], order[4], order[5], order[6], 0x00, order[7]]` — the SAME `0x08` marker as
 * `buildChainOrderSysEx`'s write-side field, but with the `0x00` padding split differently (one
 * right after the marker, one more before the last element) rather than after the 5th order
 * element. Confirmed byte-exact against `MoveFX1.mmon`'s known starting chain
 * (FX1,EQ,MOD,FX2,AMP,CAB,DEL,REV) on 2026-09-08 — see docs/MIDI_MAPPING_NOTES.md. Only verified
 * against that one example (this response reflects saved state, so re-reads without a save in
 * between are byte-identical, not independent confirmations) — treat with somewhat less
 * confidence than the write-side format until a second, differently-ordered capture confirms it.
 */
export function parseChainOrderFromAmpProfile(bytes: readonly number[]): string[] | null {
  const arr = stripFrame(bytes);
  if (arr.length < 11) return null;
  const footer = arr.slice(-11);
  if (footer[0] !== 0x08 || footer[1] !== 0x00 || footer[9] !== 0x00) return null;

  const order = [footer[2], footer[3], footer[4], footer[5], footer[6], footer[7], footer[8], footer[10]];
  const seen = new Set(order);
  if (seen.size !== 8 || order.some((v) => v < 0 || v > 7)) return null; // not a valid permutation

  const chainOrder = order.map((v) => BLOCK_ID_BY_CHAIN_ORDER_VALUE[v]);
  return chainOrder.every((id) => id !== undefined) ? chainOrder : null;
}

/** Offset of the currently-loaded preset slot (0-based) in the F0/F7-stripped opcode-`0x63` "AMP
 * profile" response — the middle byte of the `0x03 <slot> <byte>` that opens the header (early
 * captures, all of slot 0x28, made this look like a fixed `0x03 0x28 0x64`; the `0x28`/`0x64` are
 * just that slot's values). Confirmed against Program-Change recalls of slots 0, 5, 12 and 20 on
 * real hardware. */
const ACTIVE_SLOT_OFFSET_IN_AMP_PROFILE = 15;

/**
 * Reads the currently-loaded preset slot straight out of the (live-state) opcode-`0x63` response —
 * so a read can target whatever's actually on the device even when the `0x01` active-slot-changed
 * push was missed and `PatchStore.activeSlot` is stale (which strands `readPresetFromDevice` on
 * the sentinel scratch slot and makes every `0x41`-derived value belong to the wrong preset).
 * Returns `null` if the buffer is too short or the slot byte is out of the 0-127 range.
 */
export function parseActiveSlotFromAmpProfile(bytes: readonly number[]): number | null {
  const arr = stripFrame(bytes);
  const slot = arr[ACTIVE_SLOT_OFFSET_IN_AMP_PROFILE];
  return slot === undefined || slot > 0x7f ? null : slot;
}

/**
 * Decodes an unsolicited "block on/off changed" push (see `midi/sysex.ts`'s
 * `isBlockOnOffChangedPush`) into which block changed and its new state. Returns `null` if
 * `bytes` isn't one of these pushes, or its block-id byte doesn't map to a known block.
 *
 * Confirmed 2026-09-08 (`Polling_2.mmon`): activating MOD on the device (with no other app's
 * editor touching it) pushed `blockId=5, on=true`; deactivating FX1 pushed `blockId=0, on=false`
 * — both landing exactly on the toggled block, using `CHAIN_ORDER_BLOCK_IDS`' numbering. This is
 * a genuine live-state notification, independent of `parseReadPresetResponse` (which only ever
 * reflects *saved* state) — the right way to keep the UI in sync with on/off changes made directly
 * on the device, whether from the footswitch/panel or another connected app's own MIDI.
 */
export function parseBlockOnOffChangedPush(bytes: readonly number[]): { blockId: string; on: boolean } | null {
  if (!isBlockOnOffChangedPush(bytes)) return null;
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  const value = bytes[opcodeIndex + 2];
  const onByte = bytes[opcodeIndex + 3];
  const blockId = BLOCK_ID_BY_CHAIN_ORDER_VALUE[value];
  return blockId === undefined || onByte === undefined ? null : { blockId, on: onByte !== 0 };
}

/**
 * Decodes an unsolicited "block parameter value changed" push (see `midi/sysex.ts`'s
 * `isParamValueChangedPush`/`PARAM_VALUE_CHANGED_OPCODE`'s doc comment) into which block and
 * parameter-slot changed and its new normalized value. Returns `null` if `bytes` isn't one of
 * these pushes, or its block-id byte doesn't map to a known block.
 *
 * Discovered 2026-09-09 (`MODtype.mmon`): turning MOD's type encoder fired 13 of these in a
 * burst. `value` is a little-endian IEEE-754 float32 — every one of the 13 real examples decoded
 * to a clean number in 0.0-1.0, strong evidence this is a genuine normalized parameter value, not
 * a coincidental read. `paramIndex` decoded 2026-09-13 (see `PARAM_VALUE_CHANGED_OPCODE`'s doc
 * comment) — it's the param's real position in the block-type's own `params` array, same
 * convention as `buildSetParamValueSysEx`'s write side. `x` (the byte between paramIndex and the
 * value) is passed through undecoded and ignored by every caller — it doesn't correlate with
 * either `paramIndex` or `value`. Wired into `store/patchStore.ts`'s `startLivePushListener` via
 * `findParamSpecBySysexIndex` + `normalizedToReal`.
 */
export function parseParamValueChangedPush(
  bytes: readonly number[],
): { blockId: string; paramIndex: number; x: number; value: number } | null {
  if (!isParamValueChangedPush(bytes)) return null;
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  const blockValue = bytes[opcodeIndex + 2];
  const paramIndex = bytes[opcodeIndex + 3];
  const x = bytes[opcodeIndex + 4];
  const valueBytes = bytes.slice(opcodeIndex + 5, opcodeIndex + 9);
  const blockId = BLOCK_ID_BY_CHAIN_ORDER_VALUE[blockValue];
  if (blockId === undefined || paramIndex === undefined || x === undefined || valueBytes.length !== 4) return null;
  const value = new DataView(new Uint8Array(valueBytes).buffer).getFloat32(0, true);
  return { blockId, paramIndex, x, value };
}

export interface GlobalSettings {
  wireless: boolean;
  loopback: boolean;
  /** Signed — decoded from a 7-bit two's complement byte (0-63 = 0..63, 64-127 = -64..-1). */
  inputGainDb: number;
  /** 0-100. */
  usbVolume: number;
  /** 0-100. */
  btVolume: number;
  /** 0 = Omni, else the channel number 1-16 — same convention as `recallProgram`'s Program
   * Change offset and everywhere else in this protocol. */
  midiChannel: number;
}

/** 0-63 stays as-is; 64-127 becomes -64..-1. Used for `GLOBAL_SETTING_FIELD.INPUT_GAIN`, the one
 * signed global setting — confirmed from a real capture (0x7b/123 = -5), not derived. */
function signed7Bit(byte: number): number {
  return byte >= 64 ? byte - 128 : byte;
}

/** Decodes a reply to `midi/sysex.ts`'s `buildGlobalSettingsPollSysEx`/`buildGlobalSettingSysEx`
 * — see that file's `GLOBAL_SETTINGS_POLL_OPCODE` doc comment for the byte layout and how it was
 * found. `null` if `bytes` isn't one (check with `isGlobalSettingsResponse` first, or just use
 * this — it does the same check). */
export function parseGlobalSettingsResponse(bytes: readonly number[]): GlobalSettings | null {
  if (!isGlobalSettingsResponse(bytes)) return null;
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return {
    wireless: bytes[opcodeIndex + 7] !== 0,
    loopback: bytes[opcodeIndex + 8] !== 0,
    inputGainDb: signed7Bit(bytes[opcodeIndex + 9]),
    usbVolume: bytes[opcodeIndex + 10],
    btVolume: bytes[opcodeIndex + 11],
    midiChannel: bytes[opcodeIndex + 13],
  };
}

/** Decodes the unsolicited global-settings-changed push (`isGlobalSettingsPush`) — same fields as
 * `parseGlobalSettingsResponse`, but at different (earlier, no length-marker/reserved-gap bytes)
 * offsets, confirmed from the same real capture. `null` if `bytes` isn't one. */
export function parseGlobalSettingsPush(bytes: readonly number[]): GlobalSettings | null {
  if (!isGlobalSettingsPush(bytes)) return null;
  const opcodeIndex = bytes[0] === 0xf0 ? 9 : 8;
  return {
    wireless: bytes[opcodeIndex + 3] !== 0,
    loopback: bytes[opcodeIndex + 5] !== 0,
    inputGainDb: signed7Bit(bytes[opcodeIndex + 6]),
    usbVolume: bytes[opcodeIndex + 7],
    btVolume: bytes[opcodeIndex + 8],
    midiChannel: bytes[opcodeIndex + 9],
  };
}

/** Re-exported for existing callers/tests — see `midi/safePacking.ts` for the format (shared with
 * `pack7BitSafe`, the write-side counterpart `midi/sysex.ts`'s `buildSetParamValueSysEx` uses). */
export { unpack7BitSafe };

function readFloat32LE(bytes: readonly number[], offset: number): number {
  return new DataView(new Uint8Array(bytes.slice(offset, offset + 4)).buffer).getFloat32(0, true);
}

/** Start of the continuously-packed parameter stream in a F0/F7-stripped opcode-`0x41` *page 1*
 * payload — right after the preset-name field's trailing `0x60 0x13 0x03 0x40` marker. Confirmed
 * unique (offsets 38-51 all tried; only this one yields valid floats) across all 40 factory slots
 * read from real hardware. */
const PRESET_PARAM_STREAM_START = 44;

/** Where page 2's own payload begins in its F0/F7-stripped buffer — its transport mini-header
 * (`7D 4E 43 71 <dir> 02 <seqLo> <seqHi> 41 00 00 <A> <B> 00 <slot> 48 00 <?>`) is 19 bytes, and
 * the byte AT offset 19 is a single raw data byte that completes the value page 1's packed stream
 * was cut off mid-way through; the fresh `unpack7BitSafe` stream resumes at offset 20. Confirmed
 * byte-exact for REV (whose params routinely straddle the page boundary) across all 40 factory
 * slots. */
const PRESET_PARAM_PAGE2_SPLICE = 19;

/** opcode-`0x41` tag `effectId` (the byte at content offset 1 in the unpacked stream) → block id.
 * NOT the same as `CHAIN_ORDER_BLOCK_IDS`' 0-7 numbering — this is a separate internal id the
 * factory-preset serialization uses. Derived by matching decoded param values against the official
 * app's bundled `factory_presets.json` (whose `slots` array is in FX1,FX2,AMP,CAB,DEL,MOD,REV,EQ
 * order). */
const BLOCK_ID_BY_PRESET_EFFECT_ID: Record<number, string> = {
  7: 'fx1',
  8: 'fx2',
  1: 'amp',
  2: 'cab',
  5: 'del',
  4: 'mod',
  3: 'rev',
  6: 'eq',
};

export interface DecodedBlockParams {
  /** Block id (`fx1`/`fx2`/`amp`/`cab`/`del`/`mod`/`rev`/`eq`). */
  blockId: string;
  /** The block's on/off state — content byte 3 in the unpacked tag. Byte-exact for all 8 blocks
   * across all 40 factory presets; the whole preset's on/off state comes from here. */
  on: boolean;
  /** The block's currently-selected type/variant id, as the serialization stores it. */
  variant: number;
  /** Normalized 0.0-1.0 values in the device's own parameter order. May be shorter than the
   * block's full parameter list when a trailing parameter isn't stored (some FX2 types — Pitch,
   * Envelope Wah, Wah — pin their last parameter and omit it); callers should leave any parameter
   * past `values.length` at its existing value. */
  values: number[];
}

/**
 * Decodes on/off, type/variant and normalized (0.0-1.0) parameter values for all 8 blocks from an
 * opcode-`0x41` "read preset" response — the single reliable source for the whole preset state.
 * Returns one entry per block found, in stream order; `[]` if the param stream can't be located.
 * `page2Bytes` is optional — without it, REV/EQ (and any block whose params spill past the page
 * boundary) come back truncated or missing rather than wrong.
 *
 * The parameter payload is a single `unpack7BitSafe` stream — NOT a per-tag restart (an earlier
 * per-tag decoder only ever reached 5 of Compressor's 6 params before this was understood).
 * It starts at `PRESET_PARAM_STREAM_START` in page 1 and continues into page 2: page 1 ends
 * mid-value, page 2's byte at `PRESET_PARAM_PAGE2_SPLICE` is the one raw byte that completes it,
 * and a fresh packed stream resumes right after. Unpacked, the stream carries `[0x10][LEN]
 * [content]` tags whose content is `[X][effectId][variant][on/off][paramCount][marker0][float0 LE]
 * [marker1][float1 LE]…` — each parameter a 4-byte float32 at content offset `6 + 5*i`. Decoded
 * byte-exact against all 40 factory presets (`factory_presets.json`): on/off and type/variant
 * 40/40 for every block; parameter values 40/40 too, except FX2 37/40 whose 3 higher variants
 * (Pitch/Envelope Wah/Wah) pin and omit their last parameter — handled by returning only the
 * parameters actually stored.
 */
export function decodePresetParamValues(
  page1Bytes: readonly number[],
  page2Bytes?: readonly number[],
): DecodedBlockParams[] {
  let stream = unpack7BitSafe(stripFrame(page1Bytes), PRESET_PARAM_STREAM_START);
  if (page2Bytes) {
    const page2 = stripFrame(page2Bytes);
    if (page2.length > PRESET_PARAM_PAGE2_SPLICE) {
      stream = [
        ...stream,
        page2[PRESET_PARAM_PAGE2_SPLICE],
        ...unpack7BitSafe(page2, PRESET_PARAM_PAGE2_SPLICE + 1),
      ];
    }
  }

  let pos = stream.indexOf(0x10);
  if (pos === -1) return [];

  const out: DecodedBlockParams[] = [];
  while (pos + 1 < stream.length && stream[pos] === 0x10 && out.length < 8) {
    const len = stream[pos + 1];
    const content = stream.slice(pos + 2, pos + 2 + len);
    pos += 2 + len;

    const blockId = BLOCK_ID_BY_PRESET_EFFECT_ID[content[1]];
    if (blockId !== undefined && content.length >= 5) {
      // content: [X][effectId][variant][on/off][paramCount][marker0][float0]…
      const values: number[] = [];
      for (let i = 0; i < content[4] && 6 + 5 * i + 4 <= content.length; i += 1) {
        values.push(readFloat32LE(content, 6 + 5 * i));
      }
      out.push({ blockId, on: content[3] !== 0, variant: content[2], values });
    }
  }
  return out;
}

/** Fixed block order within an opcode-`0x63` "AMP profile" response's per-block records —
 * position-based, unlike `BLOCK_ID_BY_PRESET_EFFECT_ID`'s explicit-id scheme (`0x63` has no
 * effectId byte at all). FX1 is handled separately by `decodeLiveBlockParams` (see its doc
 * comment) since it lacks the `[on][type][count]` header the other 7 share. */
const LIVE_BLOCK_ORDER_AFTER_FX1 = ['fx2', 'amp', 'cab', 'del', 'mod', 'rev', 'eq'] as const;

/**
 * Decodes on/off, type/variant and normalized (0.0-1.0) LIVE parameter values for all 8 blocks
 * from an opcode-`0x63` "AMP profile" response — the one response that reflects the device's
 * actual current state, unlike opcode `0x41`'s read (which only ever reflects the last **saved**
 * state; see the "reading a never-saved slot" note in docs/MIDI_MAPPING_NOTES.md for what that
 * distinction looks like in practice). Returns `[]` if the response is too short to contain a
 * usable payload.
 *
 * Found 2026-09-13, while investigating a user report that the editor's connect-time sync didn't
 * match the device's live screen: the SAME `unpack7BitSafe` stream `decodePresetParamValues` uses
 * for `0x41` also carries `0x63`'s payload, just starting at a different fixed offset (`20` in
 * the F0/F7-stripped buffer, vs `0x41`'s `44`) and with a flatter, non-tag-wrapped per-block
 * layout: **FX1 first, with no header of its own** — its `[on][type][paramCount]` header instead
 * sits in the raw (still-packed) preamble at stripped offsets **17/18/19** (17 already confirmed
 * as FX1's on/off byte back on 2026-09-09; 18/19 newly identified here) — followed immediately by
 * `paramCount` floats with no marker bytes in between. Then the remaining 7 blocks, each as
 * `[on][type/model id][paramCount]` (3 raw bytes, part of the same packed stream) followed by
 * `paramCount` floats, always in `LIVE_BLOCK_ORDER_AFTER_FX1` order. The whole thing is
 * immediately followed by the already-known chain-order footer (`0x08` + 8 order bytes — see
 * `parseChainOrderFromAmpProfile`).
 *
 * Confirmed against 3 independent real captures, cross-varying different fields each time: (1) a
 * baseline with FX1=Compressor (6 params) and two different known Threshold/Ratio values set live
 * via `buildSetParamValueSysEx` — both landed exactly (to the ~3-decimal rounding the device
 * itself applies) at FX1's first two float slots, matching `data/blocks/fx1.ts`'s Compressor
 * `params` array order; (2) FX2's type switched live via CC to id `7` — the SAME id showed up
 * verbatim as FX2's header's type byte, with its param count changing accordingly; (3) FX1
 * switched to Gate (2 params, not 6) — the float count before FX2's header shrank to exactly 2,
 * confirming FX1's param count really does come from its own type (via `stripped[19]`), not a
 * fixed 6. REV's raw storage still needs the same `-1` shift as `decodePresetParamValues` (not
 * independently re-confirmed here, carried over from that finding); EQ has no real "type" byte in
 * this scheme either (matching `0x41`'s EQ handling) — its `variant` here is derived from
 * `paramCount` via `eqTypeIdFromEntryCount`, same as `parseReadPresetResponse` already does.
 *
 * Wired into `store/patchStore.ts`'s `readPresetFromDevice`, which overlays this on top of
 * `decodePresetParamValues`'s saved-state read, live winning per block.
 *
 * **AMP/CAB's `variant` here is NOT meaningful — confirmed 2026-09-13, not just unverified.**
 * Direct real-hardware tests (multiple valid model indices set live via `buildSetFieldSysEx`,
 * `SYSEX_FIELD.AMP_MODEL`/`CAB_MODEL`, each independently acked by the device) never moved this
 * byte even once, while on/off and every one of AMP/CAB's own param values (e.g. `gain`) DID
 * track correctly in the very same response — so this isn't a decode-offset mistake, the response
 * genuinely appears not to carry AMP/CAB's live model index anywhere, mirroring how `0x41`'s own
 * tag structure already excludes AMP/CAB and needs a separate footer instead (see
 * `extractAmpCabModelIndices` above). `store/patchStore.ts` deliberately does NOT let this field's
 * `variant` override AMP/CAB's type — it keeps whatever the saved-state decode found instead.
 * **MOD/DEL's `variant` byte, by contrast, IS confirmed live and correct** — same methodology,
 * confirmed by a real before/after type change landing exactly (a "no visible change" first
 * attempt for MOD turned out to be an invalid type id for MOD's own type list, not a decode
 * failure — retried with a valid id and it worked immediately).
 */
export function decodeLiveBlockParams(ampProfileBytes: readonly number[]): DecodedBlockParams[] {
  const stripped = stripFrame(ampProfileBytes);
  if (stripped.length < 20) return [];

  const out: DecodedBlockParams[] = [];
  const stream = unpack7BitSafe(stripped, 20);
  let pos = 0;

  // FX1: header lives in the raw preamble (offsets 17/18/19), not in the packed stream itself.
  const fx1Count = stripped[19];
  if (fx1Count !== undefined && fx1Count <= 8) {
    const values: number[] = [];
    for (let i = 0; i < fx1Count && pos + 4 <= stream.length; i += 1, pos += 4) {
      values.push(readFloat32LE(stream, pos));
    }
    out.push({ blockId: 'fx1', on: stripped[17] !== 0, variant: stripped[18], values });
  }

  for (const blockId of LIVE_BLOCK_ORDER_AFTER_FX1) {
    if (pos + 3 > stream.length) break;
    const on = stream[pos] !== 0;
    const rawVariant = stream[pos + 1];
    const count = stream[pos + 2];
    pos += 3;
    if (count > 8 || pos + count * 4 > stream.length) break;
    const values: number[] = [];
    for (let i = 0; i < count; i += 1, pos += 4) values.push(readFloat32LE(stream, pos));
    const variant =
      blockId === 'rev' && rawVariant >= 5
        ? rawVariant - 1
        : blockId === 'eq'
          ? (eqTypeIdFromEntryCount(count) ?? rawVariant)
          : rawVariant;
    out.push({ blockId, on, variant, values });
  }
  return out;
}

/**
 * Decodes the effect-chain order (a `chainOrder`-shaped array, position 0 = first in the signal
 * path) from the same opcode-`0x41` read `decodePresetParamValues` uses — the 8 bytes right before
 * the first `0x10` tag in the unpacked stream are a permutation of the `CHAIN_ORDER_BLOCK_IDS`
 * values. Byte-exact against all 40 factory presets' `chainOrder` in `factory_presets.json`.
 * Returns `null` if the stream can't be located or those 8 bytes aren't a valid permutation.
 *
 * This replaces `parseChainOrderFromAmpProfile` (the `0x63` footer) as the read-back source — the
 * footer's shape varies enough that it returns `null` for real presets (e.g. slot 25 "Dot8th").
 */
export function parseChainOrderFromPreset(page1Bytes: readonly number[]): string[] | null {
  const stream = unpack7BitSafe(stripFrame(page1Bytes), PRESET_PARAM_STREAM_START);
  const firstTag = stream.indexOf(0x10);
  if (firstTag < 8) return null;

  const order = stream.slice(firstTag - 8, firstTag);
  if (new Set(order).size !== 8 || order.some((v) => v < 0 || v > 7)) return null;
  const chain = order.map((v) => BLOCK_ID_BY_CHAIN_ORDER_VALUE[v]);
  return chain.every((id) => id !== undefined) ? chain : null;
}
