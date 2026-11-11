import type { BlockSpec } from '../types';
import { range, rangeSysexOnly } from '../paramHelpers';

export const fx1: BlockSpec = {
  id: 'fx1',
  name: 'FX1',
  onOffCC: 20,
  typeCC: 40,
  types: [
    {
      id: 0,
      slug: 'gate',
      name: 'Gate',
      description: 'Eliminates low-level noise and purifies the input signal.',
      params: [
        range('threshold', 50, -100, 0, { unit: 'dB', default: -80 }),
        // No CC in the MIDI guide — confirmed present on the device screen (real range
        // 5.0-100.0ms, PARAM_VERIFICATION.md), sent via the SysEx per-parameter mechanism
        // instead (see midi/sysex.ts's SET_FIELD_OPCODE doc comment / RangeParam.sysexParamIndex).
        rangeSysexOnly('release', 1, 5, 100, { unit: 'ms', decimals: 1, default: 50 }),
      ],
    },
    {
      id: 1,
      slug: 'auto_gate',
      name: 'Auto Gate',
      description: 'Adaptive noise gate that automatically adjusts the threshold based on signal level changes.',
      params: [
        // Neither has a CC in the MIDI guide — both confirmed present on the device screen (real
        // ranges from PARAM_VERIFICATION.md), sent via the SysEx per-parameter mechanism instead.
        rangeSysexOnly('sensitivity', 0, -6, 60, { unit: 'dB', decimals: 1, default: 27 }),
        rangeSysexOnly('release', 1, 20, 300, { unit: 'ms', decimals: 1, default: 109.9 }),
      ],
    },
    {
      id: 2,
      slug: 'gate_compressor',
      name: 'Gate + Compressor (NC-Com)',
      description:
        'Noise Gate + Compressor combo; simultaneously optimizes noise floor and dynamic range.',
      params: [
        range('gate_threshold', 50, -100, 0, { unit: 'dB', default: -80, label: 'Gate Threshold' }),
        range('comp_threshold', 51, -60, 0, { unit: 'dB', default: -20, label: 'Compressor Threshold' }),
        range('ratio', 52, 1, 20, { unit: ':1', decimals: 1, default: 4 }),
        range('knee', 53, 0, 24, { unit: 'dB', default: 0 }),
        range('attack', 54, 0, 200, { unit: 'ms', default: 10 }),
        range('release', 55, 0, 1000, { unit: 'ms', default: 100 }),
        range('makeup', 56, -24, 24, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 3,
      slug: 'compressor',
      name: 'Compressor',
      description: 'Smooths volume fluctuations and stabilizes tone quality.',
      params: [
        range('comp_threshold', 51, -60, 0, { unit: 'dB', default: -20, label: 'Threshold' }),
        range('ratio', 52, 1, 20, { unit: ':1', decimals: 1, default: 4 }),
        range('knee', 53, 0, 24, { unit: 'dB', default: 0 }),
        range('attack', 54, 0, 200, { unit: 'ms', default: 10 }),
        range('release', 55, 0, 1000, { unit: 'ms', default: 100 }),
        range('makeup', 56, -24, 24, { unit: 'dB', default: 0 }),
      ],
    },
    // Firmware 1.3.5 added 8 more FX1 types (ids 4-11), none in the MIDI Control User Guide and
    // none reachable over typeCC (confirmed dead — see buildSetBlockTypeSysEx's doc comment for
    // why: the real app never used CC for type-select at all, for any block). Names and ids
    // confirmed 2026-11-12 the reliable way, after an earlier screen-read-while-cycling-typeCC
    // attempt turned out WRONG for ids 4-8 (that method assumed typeCC's scroll order matches
    // the real wire id, which doesn't hold once you leave the already-known low ids — see the
    // now-superseded id assignment this replaced in git history): a live Frida/CoreMIDI capture
    // of the official ToneCommand app itself (hooking `MIDISend`, same rig as the original
    // `buildSetBlockTypeSysEx` discovery) sending each of these types in turn, cross-checked
    // against the device's own screen for each one. Three of these (ids 4-6) are the exact same
    // effects FX2 already had (Envelope Wah/Wah/Motion Wah — FX2's own "Wah" shows as plain
    // "Wah" on the device screen too, confirmed 2026-11-12, despite ToneCommand's own type list
    // labelling it "Auto Wah") — see each one's own comment for why their params mirror FX2's
    // definitions structurally while still going through `placeholderParams`-style positional
    // SysEx addressing rather than assuming FX2's own CC numbers apply here too (unconfirmed for
    // FX1 specifically). The remaining five (Peak Comp, Parallel Comp, Classic Wah, Retro Wah,
    // Bass Wah) are genuinely new to the whole device, shared with FX2's own copies at ids
    // 16-20. Peak Comp and Parallel Comp's own parameter names and live-capture default floats
    // are confirmed the same way (real ToneCommand traffic + a screen read of each default's
    // real-world value); Classic/Retro/Bass Wah still only have their names and param counts
    // confirmed — see placeholderParams' own doc comment.
    {
      id: 4,
      slug: 'env_wah',
      name: 'Env Wah',
      description: 'Auto-triggered filter sweep based on playing dynamics. New in firmware 1.3.5 — the same effect FX2 already had as Envelope Wah.',
      note: 'Same effect as FX2\'s Envelope Wah (same 4-param layout: Freq/Env/Q/Mix), but FX1\'s own CC assignment (if any) for these isn\'t confirmed, so they\'re sent via SysEx per-index instead of guessing FX2\'s CC68-71.',
      params: [
        rangeSysexOnly('freq', 0, 10, 20000, { unit: 'Hz', format: 'freq', default: 400, curve: 'exp' }),
        rangeSysexOnly('env', 1, 0, 20000, { unit: 'Hz', format: 'freq', default: 1000 }),
        rangeSysexOnly('q', 2, 0.1, 20, { decimals: 1, default: 8 }),
        rangeSysexOnly('mix', 3, 0, 100, { default: 80 }),
      ],
    },
    {
      id: 5,
      slug: 'wah',
      name: 'Wah',
      description: 'Cyclic sweep filter with a set waveform. New in firmware 1.3.5 — the same effect FX2 already had.',
      note: 'Same effect as FX2\'s Wah (same 5-param layout: Freq/Sweep/Rate/Shape/Mix), sent via SysEx per-index — see Env Wah\'s own note above for why.',
      params: [
        rangeSysexOnly('freq', 0, 163, 3500, { unit: 'Hz', format: 'freq', default: 800, curve: 'exp' }),
        rangeSysexOnly('sweep', 1, 0, 100, { default: 50 }),
        rangeSysexOnly('rate', 2, 0, 8, { unit: 'Hz', decimals: 2, default: 1.5 }),
        rangeSysexOnly('shape', 3, 0, 100, { default: 0 }),
        rangeSysexOnly('mix', 4, 0, 100, { default: 80 }),
      ],
    },
    {
      id: 6,
      slug: 'motion_wah',
      name: 'Motion Wah',
      description: 'Cyclic wah filter. New in firmware 1.3.5 — the same effect FX2 already had.',
      note: 'Same effect as FX2\'s Motion Wah, including its always-zero reserved param slot at index 2 (hence the gap between index 1 and 3 below) — see fx2.ts\'s Motion Wah comment for how that was found.',
      params: [
        rangeSysexOnly('rate', 0, 0, 15, { unit: 'Hz', decimals: 1, default: 2 }),
        rangeSysexOnly('voice', 1, 0, 100, { default: 50 }),
        rangeSysexOnly('sweep', 3, 0, 100, { default: 55 }),
        rangeSysexOnly('mix', 4, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 7,
      slug: 'peak_comp',
      name: 'Peak Comp',
      description: 'New in firmware 1.3.5. A faster-responding compressor variant — no Knee control, and noticeably quicker Attack/Release ranges than the plain Compressor.',
      // Threshold/Ratio/Makeup ranges confirmed exact matches to the existing Compressor type's
      // own ranges, both from a live capture of ToneCommand setting this type (-6dB/2.0:1/0dB
      // normalize EXACTLY onto Compressor's -60..0dB/1..20:1/-24..24dB) and independently from a
      // device-screen read of the same default values. Attack/Release do NOT share Compressor's
      // ranges (144ms/231ms would read on Compressor's 0-200/0-1000ms scale, not the real
      // 22.9ms/23.1ms the screen showed) — their own 0-32ms/0-56ms ranges were solved from the
      // normalized capture float matching the screen value exactly once narrowed to those
      // ranges specifically.
      params: [
        rangeSysexOnly('threshold', 0, -60, 0, { unit: 'dB', default: -6 }),
        rangeSysexOnly('ratio', 1, 1, 20, { unit: ':1', decimals: 1, default: 2 }),
        rangeSysexOnly('attack', 2, 0, 32, { unit: 'ms', decimals: 1, default: 22.9 }),
        rangeSysexOnly('release', 3, 0, 56, { unit: 'ms', decimals: 1, default: 23.1 }),
        rangeSysexOnly('makeup', 4, -24, 24, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 8,
      slug: 'parallel_comp',
      name: 'Parallel Comp',
      description: 'New in firmware 1.3.5. Blends a heavily compressed signal with the dry input instead of a Ratio/Makeup pair.',
      // Parameter NAMES, real-world RANGES and default VALUES all confirmed by direct device
      // screen reads 2026-11-12. Threshold/Mix/Level's normalized-default capture floats land
      // exactly on these ranges under plain linear scaling (Threshold -12dB on -60..0, Mix 200
      // at the top of 0..200, Level 0dB at the midpoint of -24..24) — high confidence. Attack and
      // Release's own capture floats (0.2065, 0.4171) do NOT reconcile cleanly with their
      // confirmed ranges under either linear or this codebase's existing 'exp' curve formula; the
      // range/default below are still the real, screen-confirmed values, but the curve is left as
      // the 'linear' default rather than guessed — dragging their sliders may not track the
      // device's own internal taper correctly until that's resolved.
      params: [
        rangeSysexOnly('threshold', 0, -60, 0, { unit: 'dB', default: -12 }),
        rangeSysexOnly('attack', 1, 0.01, 250, { unit: 'ms', decimals: 2, default: 2.2, note: 'Range/default confirmed on real hardware; curve (linear here) is not — see this type\'s own comment.' }),
        rangeSysexOnly('release', 2, 10, 2500, { unit: 'ms', decimals: 1, default: 216, note: 'Range/default confirmed on real hardware; curve (linear here) is not — see this type\'s own comment.' }),
        rangeSysexOnly('mix', 3, 0, 200, { default: 200 }),
        rangeSysexOnly('level', 4, -24, 24, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 9,
      slug: 'classic_wah',
      name: 'Classic Wah',
      description: 'New in firmware 1.3.5. A fixed-band wah with separate Low/High cutoff controls instead of a cyclic sweep.',
      // Names, ranges and defaults all confirmed 2026-11-12 by device screen read, and every one
      // of the 5 normalized capture floats lands EXACTLY on its real-world default under plain
      // linear scaling (Position 0/0-100, Low Freq 455Hz/20-500Hz, High Freq 2155Hz/500-5000Hz,
      // Mix 100/0-100, Level 0dB/-60..6dB) — high confidence, unlike Parallel Comp's Attack/Release.
      params: [
        rangeSysexOnly('position', 0, 0, 100, { default: 0 }),
        rangeSysexOnly('low_freq', 1, 20, 500, { unit: 'Hz', format: 'freq', default: 455, label: 'Low Freq' }),
        rangeSysexOnly('high_freq', 2, 500, 5000, { unit: 'Hz', format: 'freq', default: 2155, label: 'High Freq' }),
        rangeSysexOnly('mix', 3, 0, 100, { default: 100 }),
        rangeSysexOnly('level', 4, -60, 6, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 10,
      slug: 'retro_wah',
      name: 'Retro Wah',
      description: 'New in firmware 1.3.5. A fixed-band wah with separate Low/High cutoff controls instead of a cyclic sweep.',
      // Same layout as Classic Wah (same param names, same ranges) — only the Low/High Freq
      // defaults differ. Confirmed the same way: every capture float lands exactly on its
      // real-world default under linear scaling (Low Freq 435Hz/20-500Hz, High Freq
      // 1901Hz/500-5000Hz; Position/Mix/Level share Classic Wah's own defaults).
      params: [
        rangeSysexOnly('position', 0, 0, 100, { default: 0 }),
        rangeSysexOnly('low_freq', 1, 20, 500, { unit: 'Hz', format: 'freq', default: 435, label: 'Low Freq' }),
        rangeSysexOnly('high_freq', 2, 500, 5000, { unit: 'Hz', format: 'freq', default: 1901, label: 'High Freq' }),
        rangeSysexOnly('mix', 3, 0, 100, { default: 100 }),
        rangeSysexOnly('level', 4, -60, 6, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 11,
      slug: 'bass_wah',
      name: 'Bass Wah',
      description: 'New in firmware 1.3.5. A fixed-band wah voiced for bass, with Q/Volume trim controls instead of Classic/Retro Wah\'s Low/High Freq pair.',
      // Names, ranges and defaults all confirmed 2026-11-12 by device screen read, same method
      // as Classic/Retro Wah — every capture float lands exactly on its real-world default under
      // plain linear scaling (Position 0, Q Trim 100, Volume Trim 70, Mix 100, all 0-100; Level
      // 0dB on -60..6dB, same range as Classic/Retro Wah's own Level). "Volume Trim" as read off
      // the screen ("Volume Trime") — treated as a typo, not a real third word.
      params: [
        rangeSysexOnly('position', 0, 0, 100, { default: 0 }),
        rangeSysexOnly('q_trim', 1, 0, 100, { default: 100, label: 'Q Trim' }),
        rangeSysexOnly('volume_trim', 2, 0, 100, { default: 70, label: 'Volume Trim' }),
        rangeSysexOnly('mix', 3, 0, 100, { default: 100 }),
        rangeSysexOnly('level', 4, -60, 6, { unit: 'dB', default: 0 }),
      ],
    },
  ],
};
