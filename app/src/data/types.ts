/**
 * Shared type definitions for the NanoCore device specification.
 *
 * This model is a direct encoding of two source documents:
 *  - NANOCORE-User-Manual.pdf        (effect descriptions, parameter names & real-world ranges)
 *  - NANOCORE-MIDI-Control-User-Guide.pdf  (CC numbers, on/off & type-select value rules)
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
  /** MIDI CC number that carries this parameter (per MIDI Control User Guide). */
  cc: number;
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
  /** Suggested default (editor convention — device factory defaults are not documented). */
  default?: number;
}

/** A discrete parameter with named options (e.g. LFO waveform shape). */
export interface EnumParam extends BaseParam {
  kind: 'enum';
  options: string[];
  default?: number;
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
  /** CC that turns the block on/off. 0-63 = OFF, 64-127 = ON. */
  onOffCC: number;
  /** CC that selects the effect type. Value sent is the exact EffectType.id, not scaled. */
  typeCC: number;
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
  globalControls: GlobalControl[];
  meta: {
    firmware: string;
    presetSlots: number;
    factoryPresets: number;
    maxEffectModules: string;
    reservedBlockSlots: string;
  };
}
