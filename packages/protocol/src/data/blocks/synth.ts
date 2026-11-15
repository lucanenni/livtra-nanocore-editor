import type { BlockSpec } from '../types';
import { enumSysexOnly, rangeSysexOnly } from '../paramHelpers';

/** Synth Mode — a firmware 1.2+ feature (official release note: "Turn your guitar into a synth
 * with 10 voices, including Analog Synth, Strings, Pad, Flute, and Bass. Enable Synth Mode in
 * Settings. Each preset saves your selected voice and its controls."), toggleable from the
 * pedal's own Settings menu AND from ToneCommand.
 *
 * Reverse-engineered 2026-11-15 from real ToneCommand traffic (Frida-instrumented capture of the
 * official app, not a decompiled binary — wire-traffic-sourced, same standing as everything else
 * in this file) while building Synth Mode patches for a user request: reuses every mechanism
 * already implemented for the 8 chain blocks, with zero new protocol machinery needed.
 * - **Enable/disable**: `sysexOnOffField` `0x0a` (`midi/sysex.ts`'s `buildBlockEnableSysEx`) — no
 *   CC exists for this at all, unlike every other block's on/off.
 * - **Voice select**: the existing `buildSetBlockTypeSysEx` mechanism, `blockId` 10
 *   (`CHAIN_ORDER_BLOCK_IDS.synth`) — same as every non-AMP/CAB block's type-select.
 * - **Per-voice params**: the existing `buildSetParamValueSysEx` mechanism, same `blockId`.
 *
 * **All 10 voices mapped** (ids 0-9, confirmed fully consecutive) — Analog Synth, Strings, Pad,
 * Choir, Brass, Organ, Flute, Lead, Bass, Pluck. Choir, Organ, Lead and Pluck weren't even named
 * in the official release note (it only calls out "10 voices, including Analog Synth, Strings,
 * Pad, Flute, and Bass"). Every voice's param values were read directly off the pedal's own
 * screen and cross-checked against a live `0x63` read of the same voice — not guessed. Confirmed
 * on real hardware, byte-exact down to a live/saved preset copy-between-slots that initially went
 * wrong from a misaligned read offset and was re-verified correct against the pedal's screen (see
 * `midi/presetReader.ts`'s `decodeLiveBlockParams` doc comment for that offset).
 *
 * Every voice's Attack (where it has one) shares the SAME `curve: 'quad'`, `min=2, max=400`
 * shape — confirmed by 7 independent real readings across 7 different voices, all fitting
 * `2 + 398 * t ** 2` to within rounding (see `midi/scaling.ts`'s doc comment). Pad/Lead/Pluck have
 * no Attack at all (just Tone/Decay/Mix) — a genuinely simpler 3-param voice shape, not a gap. */
export const synth: BlockSpec = {
  id: 'synth',
  name: 'Synth',
  sysexOnOffField: 0x0a,
  types: [
    {
      id: 0,
      slug: 'analog_synth',
      name: 'Analog Synth',
      description: 'Synth Mode voice. A classic analog-style synth oscillator.',
      params: [
        enumSysexOnly('wave', 0, ['Sine', 'Saw', 'Square', 'Triangle', 'Pulse'], { default: 1 }),
        // Every voice's Attack is 2-400ms with this SAME 'quad' curve — confirmed 2026-11-15 by 4
        // independent real readings across 4 different voices (this one, Strings, Choir, Brass)
        // all fitting `2 + 398 * t**2` to within rounding — not a single-sample guess. See
        // `midi/scaling.ts`'s doc comment for the fit.
        rangeSysexOnly('attack', 1, 2, 400, { unit: 'ms', curve: 'quad', default: 5 }),
        rangeSysexOnly('release', 2, 0, 100, { default: 50 }),
        rangeSysexOnly('detune', 3, 0, 20, { unit: 'ct', decimals: 1, default: 5 }),
        rangeSysexOnly('tone', 4, 0, 100, { default: 68 }),
        rangeSysexOnly('mix', 5, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 1,
      slug: 'strings',
      name: 'Strings',
      description: 'Synth Mode voice. A string-ensemble patch.',
      params: [
        rangeSysexOnly('attack', 0, 2, 400, { unit: 'ms', curve: 'quad', default: 83 }), // see analog_synth's attack
        rangeSysexOnly('release', 1, 0, 100, { default: 72 }),
        rangeSysexOnly('ensemble', 2, 0, 100, { default: 50 }),
        rangeSysexOnly('tone', 3, 0, 100, { default: 55 }),
        rangeSysexOnly('mix', 4, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 2,
      slug: 'pad',
      name: 'Pad',
      description: 'Synth Mode voice. A sustained ambient pad patch.',
      params: [
        rangeSysexOnly('tone', 0, 0, 100, { default: 100 }),
        rangeSysexOnly('decay', 1, 0, 100, { default: 50 }),
        rangeSysexOnly('mix', 2, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 3,
      slug: 'choir',
      name: 'Choir',
      description: 'Synth Mode voice. A vocal-choir patch.',
      params: [
        rangeSysexOnly('attack', 0, 2, 400, { unit: 'ms', curve: 'quad', default: 122 }), // see analog_synth's attack
        rangeSysexOnly('release', 1, 0, 100, { default: 70 }),
        rangeSysexOnly('vowel', 2, 0, 100, { default: 20 }),
        rangeSysexOnly('tone', 3, 0, 100, { default: 60 }),
        rangeSysexOnly('mix', 4, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 4,
      slug: 'brass',
      name: 'Brass',
      description: 'Synth Mode voice. Based on a brass-section patch.',
      params: [
        rangeSysexOnly('attack', 0, 2, 400, { unit: 'ms', curve: 'quad', default: 25 }), // see analog_synth's attack
        rangeSysexOnly('release', 1, 0, 100, { default: 50 }),
        rangeSysexOnly('bite', 2, 0, 100, { default: 60 }),
        rangeSysexOnly('tone', 3, 0, 100, { default: 70 }),
        rangeSysexOnly('mix', 4, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 5,
      slug: 'organ',
      name: 'Organ',
      description: 'Synth Mode voice. An organ-style patch.',
      params: [
        rangeSysexOnly('attack', 0, 2, 400, { unit: 'ms', curve: 'quad', default: 3 }), // see analog_synth's attack
        rangeSysexOnly('release', 1, 0, 100, { default: 25 }),
        rangeSysexOnly('harmonics', 2, 0, 100, { default: 60 }),
        rangeSysexOnly('tone', 3, 0, 100, { default: 85 }),
        rangeSysexOnly('mix', 4, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 6,
      slug: 'flute',
      name: 'Flute',
      description: 'Synth Mode voice. Based on a flute patch.',
      params: [
        rangeSysexOnly('attack', 0, 2, 400, { unit: 'ms', curve: 'quad', default: 40 }), // see analog_synth's attack
        rangeSysexOnly('release', 1, 0, 100, { default: 45 }),
        rangeSysexOnly('breath', 2, 0, 100, { default: 35 }),
        rangeSysexOnly('tone', 3, 0, 100, { default: 70 }),
        rangeSysexOnly('mix', 4, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 7,
      slug: 'lead',
      name: 'Lead',
      description: 'Synth Mode voice. A lead-synth patch.',
      params: [
        rangeSysexOnly('tone', 0, 0, 100, { default: 100 }),
        rangeSysexOnly('decay', 1, 0, 100, { default: 50 }),
        rangeSysexOnly('mix', 2, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 8,
      slug: 'bass',
      name: 'Bass',
      description: 'Synth Mode voice. A synth-bass patch.',
      params: [
        rangeSysexOnly('attack', 0, 2, 400, { unit: 'ms', curve: 'quad', default: 2 }), // see analog_synth's attack
        rangeSysexOnly('release', 1, 0, 100, { default: 30 }),
        rangeSysexOnly('sub_level', 2, 0, 100, { default: 70 }), // titleize() -> "Sub Level"
        rangeSysexOnly('tone', 3, 0, 100, { default: 40 }),
        rangeSysexOnly('mix', 4, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 9,
      slug: 'pluck',
      name: 'Pluck',
      description: 'Synth Mode voice. A plucked-string patch.',
      params: [
        rangeSysexOnly('tone', 0, 0, 100, { default: 100 }),
        rangeSysexOnly('decay', 1, 0, 100, { default: 50 }),
        rangeSysexOnly('mix', 2, 0, 100, { default: 100 }),
      ],
    },
  ],
};
