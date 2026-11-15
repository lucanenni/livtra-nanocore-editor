/**
 * Shared type definitions for the NanoCore device specification.
 *
 * This model is a direct encoding of Livtra's two official documents (cited by
 * URL in the README, not vendored here):
 *  - NANOCORE User Manual              (effect descriptions, parameter names & real-world ranges)
 *  - NANOCORE MIDI Control User Guide  (CC numbers, on/off & type-select value rules)
 *
 * A few mapping details are NOT explicitly stated in either document and are
 * documented as assumptions in `docs/MIDI_MAPPING_NOTES.md`. Every spot where
 * we had to infer something carries a `note` field pointing at that file.
 */

/** How a raw MIDI CC value (0-127) should be interpreted. */
export type ParamKind = 'range' | 'enum';

export interface BaseParam {
  kind: ParamKind;
  /** Generic slug used to look up a translated label via `param.<id>`, e.g. "rate", "mix". */
  id: string;
  /** MIDI CC number that carries this parameter for an EXTERNAL controller driving the device
   * directly (per the MIDI Control User Guide, or independently confirmed on real hardware for
   * a 1.3.5+ addition) — surfaced on the CC Reference page, not used to edit from this editor
   * itself. This editor always sends every param via SysEx regardless of whether `cc` is set,
   * including `BlockSpec.commonParams` (confirmed 2026-11-12, same mechanism, own index space
   * from `type.params`) — see `NanoCoreDevice.sysexParamIndexFor`'s own comment for the exact
   * indexing, and `BlockSpec.typeCC`'s for the parallel reasoning on type-select. Absent for a
   * handful of params with no known CC at all. */
  cc?: number;
  /** English fallback label (used as i18next defaultValue). */
  label: string;
  /** Set when the exact CC->value mapping is inferred rather than confirmed by the docs. */
  note?: string;
}

/** A continuous (or stepped-but-numeric) parameter that scales linearly across CC 0-127. */
export interface RangeParam extends BaseParam {
  kind: 'range';
  min: number;
  max: number;
  /** Physical unit shown next to the value, e.g. "dB", "ms", "Hz", "st", ":1". */
  unit?: string;
  /** Decimal places to show. Defaults to 0 for integer-ish ranges, 2 for small fractional ones. */
  decimals?: number;
  /** Special display formatting. 'freq' auto-switches Hz/kHz, 'time' auto-switches ms/s. */
  format?: 'freq' | 'time' | 'plain';
  /** CC<->real-value taper. Defaults to 'linear' (the MIDI Control User Guide's documented
   * convention). 'exp' (`value = min * (max/min) ** t`) is confirmed on real hardware for a
   * handful of Hz-range params (filter cutoffs, LFO/sweep rates) — see `midi/scaling.ts` and
   * docs/PARAM_VERIFICATION.md's non-linear section for the measurements. 'quad' (`value = min +
   * (max-min) * t ** 2`) is confirmed for Synth Mode's Attack param, same across every voice. */
  curve?: 'linear' | 'exp' | 'quad';
  /** Suggested default (editor convention — device factory defaults are not documented). */
  default?: number;
  /** Position in this param's block-type's own `params` array (0-indexed) — set INSTEAD of `cc`
   * for a param confirmed to exist on the device screen but with no working CC. Sent via
   * `midi/sysex.ts`'s `buildSetParamValueSysEx` instead of a CC; see that function's doc comment
   * (on `SET_FIELD_OPCODE`) for the mechanism and how it was found. Added via
   * `paramHelpers.ts`'s `rangeSysexOnly`, not `range`. */
  sysexParamIndex?: number;
}

/** A discrete parameter with named options (e.g. LFO waveform shape, Synth Mode's Wave). */
export interface EnumParam extends BaseParam {
  kind: 'enum';
  options: string[];
  default?: number;
  /** Position in this param's block-type's own `params` array (0-indexed) — set INSTEAD of `cc`
   * for a param confirmed on-device with no working CC (first used 2026-11-15 for Synth Mode's
   * Analog Synth voice, which has no CC at all for any of its params). Same mechanism as
   * `RangeParam.sysexParamIndex` — see that field's doc comment. Added via `paramHelpers.ts`'s
   * `enumSysexOnly`, not `enumP`. */
  sysexParamIndex?: number;
}

export type ParamSpec = RangeParam | EnumParam;

export interface EffectType {
  /** Exact type ID transmitted verbatim on the block's Type CC (NOT scaled). */
  id: number;
  /** Stable slug, e.g. "gate", "chorus", "bogxtc1". Used for i18n keys and state keys. */
  slug: string;
  /** English fallback display name. */
  name: string;
  /** English fallback description ("Based on ... modeling"). */
  description?: string;
  /** Parameters specific to this effect type (in addition to the block's commonParams). */
  params: ParamSpec[];
  /** Set when selecting this type repurposes another block's parameter CCs (routing caveat). */
  note?: string;
  /** Set when something about this specific type is confirmed broken/unsupported over MIDI on
   * real hardware — rendered as a prominent warning banner, same as BlockSpec.warning but
   * scoped to just this type instead of the whole block. See docs/MIDI_MAPPING_NOTES.md. */
  warning?: string;
}

export interface BlockSpec {
  /** Stable id, e.g. "fx1". */
  id: string;
  /** English fallback block name shown in the UI, e.g. "FX1". */
  name: string;
  /** CC that turns the block on/off. 0-63 = OFF, 64-127 = ON. Absent for a block with no CC at
   * all (e.g. `synth`'s Synth Mode toggle) — see `sysexOnOffField` for its alternative. */
  onOffCC?: number;
  /** CC that selects the effect type. Value sent is the exact EffectType.id, not scaled.
   * Documented in the MIDI Control User Guide, and a September 2026 firmware update confirmed it
   * now genuinely works on real hardware — but the official ToneCommand app itself was confirmed
   * (2026-11-11, live capture) to NEVER send it for ANY block, type-select included: it always
   * uses SysEx (`buildBlockTypeSysEx` for AMP/CAB, `buildSetBlockTypeSysEx` for everything else —
   * see that function's doc comment). This editor follows suit in `sendBlockType`/`sendFullPatch`
   * for every block; `typeCC` is kept purely as a data field for reference (surfaced in
   * `CCReferencePanel.tsx`'s CC table) and for external CC-only MIDI gear driving the device
   * directly, not through this editor. See docs/MIDI_MAPPING_NOTES.md. */
  typeCC?: number;
  /** Set when this block's type selection doesn't work over the documented typeCC and must be
   * sent as a NanoCore SysEx "set field" command instead (see `midi/sysex.ts` and
   * docs/MIDI_MAPPING_NOTES.md) — the value is this field id, and EffectType.id is sent verbatim
   * as the SysEx value byte (same 0-N index as typeCC would have used). */
  sysexTypeField?: number;
  /** Set when this block's on/off state has no working CC at all and must be sent as a NanoCore
   * SysEx "set field" command instead (`midi/sysex.ts`'s `buildBlockEnableSysEx`) — the value is
   * this field id, 1/0 for on/off. So far only `synth` (Synth Mode's enable toggle, field `0x0a`,
   * confirmed 2026-11-15 from real ToneCommand traffic — no CC was ever found for it, unlike every
   * other block's on/off). */
  sysexOnOffField?: number;
  /** Parameters shared by every type in this block (e.g. Amp Gain/Bass/Mid/Treble/Level). */
  commonParams?: ParamSpec[];
  types: EffectType[];
  /** True when this block's parameter CCs are shared with another block under certain type
   * selections (see routingSharesWith on the affected EffectType, or docs/MIDI_MAPPING_NOTES.md). */
  note?: string;
  /** Set when something about this block is confirmed broken/unsupported over MIDI on real
   * hardware (not just an unverified assumption) — rendered as a prominent warning banner,
   * not the softer informational `note`. See docs/MIDI_MAPPING_NOTES.md. */
  warning?: string;
}

export interface GlobalControl {
  id: string;
  name: string;
  cc?: number;
  /** For Program Change based controls. */
  isProgramChange?: boolean;
  min: number;
  max: number;
  description: string;
}

export interface NanocoreSpec {
  blocks: BlockSpec[];
  /** Synth Mode (firmware 1.2+) — a `BlockSpec`-shaped entity for its enable toggle, voice
   * selection and per-voice parameters, so it reuses every existing block mechanism (`findBlock`,
   * `sendBlockType`/`sendParam`, the MCP block tools). Deliberately NOT a member of `blocks`: it
   * is not part of the reorderable 8-effect signal chain (`CHAIN_ORDER_BLOCK_IDS`'s own 8-slot
   * array, `buildChainOrderSysEx`) — it's a separate, parallel mode, same as the device's own
   * Settings-menu framing. Code that means "all 8 chain blocks" (chain order, `sendFullPatch`,
   * the CC Reference page) should keep iterating `blocks` only; code that means "any block the
   * user can address" (the MCP's `set_block`/`set_param`/`describe_block`) should also check this. */
  synth: BlockSpec;
  globalControls: GlobalControl[];
  meta: {
    firmware: string;
    presetSlots: number;
    factoryPresets: number;
    maxEffectModules: string;
    reservedBlockSlots: string;
  };
}
