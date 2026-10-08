# Parameter range verification

The min/max/unit/decimals below are what the editor's data model currently uses, taken from
Livtra's MIDI Control User Guide + User Manual. The manual is not always precise about firmware
behaviour (e.g. it prints Compressor Ratio as 1.1:1 but the device starts at 1:1). Fill in
**Dev min** / **Dev max** by reading the device screen with the encoder at each extreme; add a
middle reading for dB / time / Hz params — some turned out non-linear, see below.

Blank cell = not checked. `=` = matches the model. Note anything odd (non-linear taper,
different unit, extra/missing param, wrong enum order). This supersedes
[HARDWARE_VERIFICATION.md](HARDWARE_VERIFICATION.md) §2 (its taper-only spot check still
stands for whether a unit is linear at all; this file is the per-param range follow-up).

## Resolved: 5 Hz-range params are exponential, not linear

Rows marked "Non linear" below (CAB Low/High Cut, FX2 Envelope Wah/Wah Freq, MOD Velvet
Vibrato Rate) were confirmed with a guided 9-point CC sweep 2026-09-11
(`.scratch/sweep_nonlinear.py`: sends CC 0/16/32/48/64/80/96/112/127, you type in what the
device screen shows). `value = min * (max/min) ** (cc/127)` fit every one to within ~1% (mean
error); the old linear model was off by up to ~1000% mid-range (worst case: FX2 Envelope Wah's
Freq read 461 Hz at CC64 where linear predicted ~10084 Hz). Implemented as
`RangeParam.curve: 'exp'` in `data/types.ts` / `midi/scaling.ts`, applied to those 5 params —
see each one's code comment in `data/blocks/*.ts`. FX2 Envelope Wah's `env` (CC69, same
0-20000 Hz range as its `freq`) very likely shares the taper but hasn't been measured — still
linear until it is.

## Resolved: `level` on MOD/DEL/REV/some FX2 types was dead, removed

The pattern below (device read carries one fewer value than the model's param list) turned
out to be exactly what it looked like: **every MOD, DEL and REV type's trailing `level`
parameter, plus FX2 Pitch's and Wah's, is not shown on the device screen or in ToneCommand —
not a real control.** Confirmed by the full hardware check above and removed from the data
model (same treatment as the already-known CAB Level and FX2 Envelope Wah Level). FX1
(Compressor's `makeup`) and FX2's basic drive types (Scream/Klone/OCD/DS2/PIFUZZ/Range/XAC/
Fiman) keep their last param — those are real.

This was originally noticed from the `0x41` read stream, which carries one normalized value
per *stored* parameter — a type missing a control also skips storing it:

| Type | Model params (before the fix) | Values in a real read |
|---|---|---|
| FX2 Wah (id 10) | 6 | 5 |
| DEL BBD (id 0) | 5 | 4 |
| MOD Chorus (id 0) | 3 | 2 |
| REV Plate (id 1) | 6 | 5 |
| EQ 3-band (id 0) | 3 | 4 (one EXTRA — see below) |

**EQ is the opposite case, resolved 2026-09-12**: every EQ type's read carries one extra
trailing value beyond its band gains, always 0.5 in the factory presets. The hardware check
above found EQ's own screen *does* have a real extra "Level" control, range confirmed
-12~+12 dB — no CC exists for it (not in the MIDI guide's EQ block), but it's now wired in
via the SysEx per-parameter mechanism found the same day (see MIDI_MAPPING_NOTES.md's
"Live SysEx parameter edits" section and `data/blocks/eq.ts`'s `level`).


## FX1  (on/off CC20, type CC40)

**Gate — id 0**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Threshold | 50  | dB   | 1   | -100      | 0         | -100.0  | 0.0     | -50.0   | [x]   |       |
| Release   |     | ms   | 1   |           |           | 5.0     | 100.0   | 52.5    | [x]   |       |

**Auto Gate — id 1**

| Param       | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Sensitivity |     | dB   | 1   |           |           | -6.0    | 60      | 0.0     | [x]   |       |
| Release     |     | ms   | 1   |           |           | 20.0    | 300.0   | 160.0   | [x]   |       |
**Gate + Compressor (NC-Com) — id 2**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Gate      | 50  | dB   | 1   | -100      | 0         | -100.0  | 0.0     | -50.0   | [x]   |       |
| Threshold | 51  | dB   | 1   | -60       | 0         | -60.0   | 0.0     | -30.0   | [x]   |       |
| Ratio     | 52  | :1   | 1   | 1         | 20        | 1.0     | 20.0    | 10.5    | [x]   |       |
| Knee      | 53  | dB   | 1   | 0         | 24        | 0.0     | 24.0    | 12.0    | [x]   |       |
| Attack    | 54  | ms   | 1   | 0         | 200       | 0.0     | 200.0   | 100.0   | [x]   |       |
| Release   | 55  | ms   | 1   | 0         | 1000      | 0.0     | 1000.0  | 500.0   | [x]   |       |
| Makeup    | 56  | dB   | 1   | -24       | 24        | -24.0   | 24.0    | 0.0     | [x]   |       |

**Compressor — id 3**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Threshold | 51  | dB   | 1   | -60       | 0         | -60.0   | 0.0     | -30.0   | [x]   |       |
| Ratio     | 52  | :1   | 1   | 1         | 20        | 1.0     | 20.0    | 10.5    | [x]   |       |
| Knee      | 53  | dB   | 1   | 0         | 24        | 0.0     | 24.0    | 12.0    | [x]   |       |
| Attack    | 54  | ms   | 1   | 0         | 200       | 0.0     | 200.0   | 100.0   | [x]   |       |
| Release   | 55  | ms   | 1   | 0         | 1000      | 0.0     | 1000.0  | 500.0   | [x]   |       |
| Makeup    | 56  | dB   | 0   | -24       | 24        | -24.0   | 24.0    | 0.0     | [x]   |       |

## FX2  (on/off CC21, type CC41)

**Scream — id 0**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Gain  | 57  |      | 1   | 0         | 1         | 0.0     | 1.0     | 0.5     | [x]   |       |
| Tone  | 58  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |
| Level | 59  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |

**Klone — id 1**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Gain  | 57  |      | 1   | 0         | 1         | 0.0     | 1.0     | 0.5     | [x]   |       |
| Tone  | 58  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |
| Level | 59  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |

**OCD — id 2**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Gain  | 57  |      | 1   | 0         | 1         | 0.0     | 1.0     | 0.5     | [x]   |       |
| Tone  | 58  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |
| Level | 59  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |

**DS2 — id 3**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Gain  | 57  |      | 1   | 0         | 1         | 0.0     | 1.0     | 0.5     | [x]   |       |
| Tone  | 58  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |
| Level | 59  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |

**PiFUZZ v.2 — id 4**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Gain  | 57  |      | 1   | 0         | 1         | 0.0     | 1.0     | 0.5     | [x]   |       |
| Tone  | 58  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |
| Level | 59  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |

**Range — id 5**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Boost | 57  |      | 1   | 0         | 1         | 0.0     | 1.0     | 0.5     | [x]   |       |

**AC — id 6**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Boost | 57  |      | 1   | 0         | 1         | 0.0     | 1.0     | 0.5     | [x]   |       |

**Fiman — id 7**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Boost | 57  |      | 1   | 0         | 1         | 0.0     | 1.0     | 0.5     | [x]   |       |

**Pitch — id 8**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Pitch | 68  | st   | 1   | -12       | 12        | -12.0   | 12.0    | 0.0     | [x]   |                                    |
| Fine  | 69  |      | 2   | -1        | 1         | -1.00   | 1.00    | 0.00    | [x]   |                                    |
| Mix   | 70  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level | 71  |      | 1   | 0         | 100       | 0.0     | 100.0   | 50.0    | [ ]   | Not shown on device or ToneCommand |

**Env. Wah — id 9**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                                                                          |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ------------------------------------------------------------------------------ |
| Freq  | 68  | Hz   | var | 10        | 20000     | 10.0    | 20k     | 427     | [x]   | Non linear<br><100: 1 decimal shown<br>>1000: k with 1 decimal shown           |
| Env   | 69  | Hz   | var | 0         | 20000     | 0.00    | 20k     | 10k     | [x]   | <1: 2 decimals shown<br><100: 1 decimal shown<br>>1000: k with 1 decimal shown |
| Q     | 70  |      | 1   | 0.1       | 20        | 0.1     | 20.0    | 10.1    | [x]   |                                                                                |
| Mix   | 71  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                                                                |

**Auto Wah — id 10**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                                       |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ------------------------------------------- |
| Freq  | 68  | Hz   | 0   | 163       | 3500      | 163.0   | 3.5k    | 742     | [x]   | Non linear<br>>1000: k with 1 decimal shown |
| Sweep | 69  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                             |
| Rate  | 70  | Hz   | 2   | 0         | 8         | 0.00    | 8.00    | 4.00    | [x]   |                                             |
| Shape | 71  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                             |
| Mix   | 72  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                             |
| Level | 73  |      | 1   | 0         | 100       | 0.0     | 100.0   | 50.0    | [ ]   | Not shown on device or ToneCommand          |

**Motion Wah — id 11**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Rate  | 68  | Hz   | 2   | 0         | 15        | 0.00    | 15.00   | 7.50    | [x]   |       |
| Voice | 69  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |
| Sweep |     |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |
| Mix   |     |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |

## AMP  (on/off CC23, type CC43)

**Common — all types**

| Param  | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ------ | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Gain   | 60  |      | 1   | 0         | 1         | 0.0     | 1.0     | 0.5     | [x]   |       |
| Bass   | 61  | dB   | 1   | -10       | 10        | -10.0   | 10.0    | 0.0     | [x]   |       |
| Mid    | 62  | dB   | 1   | -10       | 10        | -10.0   | 10.0    | 0.0     | [x]   |       |
| Treble | 63  | dB   | 1   | -10       | 10        | -10.0   | 10.0    | 0.0     | [x]   |       |
| Level  | 64  |      | 0   | -10       | 10        | 0       | 100     | 50      | [x]   |       |

**BogXTC1 — id 0**: no parameters.

**BogXTC2 — id 1**: no parameters.

**ENGP1 — id 2**: no parameters.

**ENGP2 — id 3**: no parameters.

**Fd59Bm — id 4**: no parameters.

**Fd65Dk — id 5**: no parameters.

**Hiw103 — id 6**: no parameters.

**MarDSL1 — id 7**: no parameters.

**MarDSL2 — id 8**: no parameters.

**Mar8001 — id 9**: no parameters.

**Mar8002 — id 10**: no parameters.

**MesR1 — id 11**: no parameters.

**MesR2 — id 12**: no parameters.

**MesR3 — id 13**: no parameters.

**OgG120 — id 14**: no parameters.

**Pey51501 — id 15**: no parameters.

**Pey51502 — id 16**: no parameters.

**Pey6505 — id 17**: no parameters.

**RanT21 — id 18**: no parameters.

**RanT22 — id 19**: no parameters.

**RoJC120 — id 20**: no parameters.

**SLO1001 — id 21**: no parameters.

**SLO1002 — id 22**: no parameters.

**SLO1003 — id 23**: no parameters.

**VXAC30 — id 24**: no parameters.

**ApSVTVR — id 25**: no parameters.

**ApSVTCL — id 26**: no parameters.

**Adn900 — id 27**: no parameters.

**Hiw320 — id 28**: no parameters.

**MarSup — id 29**: no parameters.

## CAB  (on/off CC24, type CC44)

**Common — all types**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                                |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ------------------------------------ |
| Low_cut  | 65  | Hz   | 1   | 20        | 500       | 20.0    | 500     | 100     | [x]   | Non linear<br><100: 1 decimal shown  |
| High_cut | 66  | Hz   | 0   | 2000      | 20000     | 2k      | 20k     | 6.3k    | [x]   | Non linear<br>k with 1 decimal shown |

**Bog412A — id 0**: no parameters.

**Bog412B — id 1**: no parameters.

**Eng412A — id 2**: no parameters.

**Eng412B — id 3**: no parameters.

**FdTR212 — id 4**: no parameters.

**Fd59BM410 — id 5**: no parameters.

**Hiw412 — id 6**: no parameters.

**Mar412A — id 7**: no parameters.

**Mar412B — id 8**: no parameters.

**Mar96412A — id 9**: no parameters.

**Mar96412B — id 10**: no parameters.

**Mes412A — id 11**: no parameters.

**Mes412B — id 12**: no parameters.

**Mes412C — id 13**: no parameters.

**Og412 — id 14**: no parameters.

**pey412A — id 15**: no parameters.

**pey412B — id 16**: no parameters.

**peyVk412 — id 17**: no parameters.

**Ran112A — id 18**: no parameters.

**Ran112B — id 19**: no parameters.

**Ran112C — id 20**: no parameters.

**SLO412A — id 21**: no parameters.

**SLO412B — id 22**: no parameters.

**SLO412C — id 23**: no parameters.

**AC30212 — id 24**: no parameters.

**AP810 — id 25**: no parameters.

**Ap410 — id 26**: no parameters.

**Adn410 — id 27**: no parameters.

**HiwB410 — id 28**: no parameters.

**Mar412 — id 29**: no parameters.

## MOD  (on/off CC25, type CC45)

**Chorus — id 0**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Rate  | 68  | Hz   | 2   | 0.1       | 3.74      | 0.10    | 3.74    | 1.92    | [x]   |                                    |
| Depth | 69  | ms   | 2   | 0         | 1         | 0.00    | 1.00    | 0.50    | [x]   |                                    |
| Level | 70  |      | 1   | 0         | 100       | 0.0     | 100.0   | 50.0    | [ ]   | Not shown on device or ToneCommand |

**Phaser — id 1**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Rate     | 68  | Hz   | 2   | 0.05      | 5         | 0.05    | 5.00    | 2.52    | [x]   |                                    |
| Feedback | 69  |      | 0   | -95       | 95        | -95     | 95      | 0       | [x]   |                                    |
| Mix      | 70  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level    | 71  |      | 1   | 0         | 100       | 0.0     | 100.0   | 50.0    | [ ]   | Not shown on device or ToneCommand |

**Flanger — id 2**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Rate     | 68  | Hz   | 2   | 0.05      | 5         | 0.05    | 5.00    | 2.52    | [x]   |                                    |
| Feedback | 69  |      | 0   | -95       | 95        | -95     | 95      | 0       | [x]   |                                    |
| Mix      | 70  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level    | 71  |      | 1   | 0         | 100       | 0.0     | 100.0   | 50.0    | [ ]   | Not shown on device or ToneCommand |

**Tremolo — id 3**

| Param  | CC  | Unit | Dec | Model min                       | Model max | Dev min | Dev max | Dev mid | Check | Notes                                          |
| ------ | --- | ---- | --- | ------------------------------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------------------- |
| Rate   | 68  | Hz   | 2   | 0.01                            | 20        | 0.01    | 20.0    | 10.0    | [x]   |                                                |
| Depth  | 69  |      | 0   | 0                               | 100       | 0       | 100     | 50      | [x]   |                                                |
| Wave   | 70  | enum | —   | `[Sine, Triangle, Square, Saw]` |           |         |         |         | [x]   |                                                |
| Smooth | 71  | Hz   | 2   | 0                               | 40        | 0.00    | 40.0    | 20.0    | [x]   | <10: 2 decimals shown<br>>=10: 1 decimal shown |
| Mix    | 72  |      | 0   | 0                               | 100       | 0       | 100     | 50      | [x]   |                                                |
| Level  | 73  |      | 1   | 0                               | 100       | 0.0     | 100.0   | 50.0    | [ ]   | Not shown on device or ToneCommand             |

**Vibrato — id 4**

| Param | CC  | Unit | Dec | Model min                       | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| ----- | --- | ---- | --- | ------------------------------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Rate  | 68  | Hz   | 1   | 0.01                            | 20        | 0.01    | 20.0    | 10.0    | [x]   |                                    |
| Depth | 69  | ms   | 1   | 0                               | 20        | 0.0     | 20.0    | 10.0    | [x]   |                                    |
| Wave  | 70  | enum | —   | `[Sine, Triangle, Square, Saw]` |           |         |         |         | [x]   |                                    |
| Mix   | 71  |      | 0   | 0                               | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level | 72  |      | 1   | 0                               | 100       | 0.0     | 100.0   | 50.0    | [ ]   | Not shown on device or ToneCommand |

**Velvet Vibrato — id 10**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes      |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------- |
| Rate  | 68  | Hz   | 2   | 0.45      | 10        | 0.5     | 10.0    | 2.12    | [x]   | Non linear |
| Wave  | 69  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |            |
| Voice | 70  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |            |
| Depth | 71  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |            |
| Mix   | 72  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |            |

**Chorus II — id 11**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Rate     | 68  |      | 2   | 0         | 1         | 0.00    | 1.00    | 0.50    | [x]   |       |
| Amount   | 69  |      | 2   | 0         | 1         | 0.00    | 1.00    | 0.50    | [x]   |       |
| Feedback | 70  |      | 2   | 0         | 1         | 0.00    | 1.00    | 0.50    | [x]   |       |
| Mix      | 71  |      | 2   | 0         | 1         | 0.00    | 1.00    | 0.50    | [x]   |       |

**Phaser II — id 12** — CC columns above are as documented, but confirmed 2026-09-13 that NONE
of them actually respond to CC on real hardware; all 4 are SysEx-only in the shipped code now
(`rangeSysexOnly`, opcode `0x6d`) using exactly these ranges. See `docs/MIDI_MAPPING_NOTES.md`.

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Depth    |     |      | 0   |           |           | 0       | 100     | 50      | [x]   |       |
| Rate     | 68  | Hz   | 2   | 0.05      | 5         | 0.05    | 5.00    | 2.52    | [x]   |       |
| Feedback | 69  |      | 0   | -95       | 95        | 0       | 100     | 50      | [x]   |       |
| Mix      | 70  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |       |

**Jet Flanger — id 17** — Rate/Depth's CC68/69 above are confirmed real and shipped as-is;
Feedback/Phase/Mix have no working CC (confirmed on real hardware) and are SysEx-only in the
shipped code (`rangeSysexOnly`, opcode `0x6d`) using exactly these ranges. See
`docs/MIDI_MAPPING_NOTES.md`.

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Rate     | 68  | Hz   | 2   | 0.05      | 5         | 0.05    | 5.00    | 2.52    | [x]   |       |
| Depth    | 69  |      | 0   |           |           | 0       | 100     | 50      | [x]   |       |
| Feedback |     |      | 0   |           |           | -95     | 95      | 0       | [x]   |       |
| Phase    |     | °    | 0   |           |           | 0       | 360     | 180     | [x]   |       |
| Mix      |     |      | 0   |           |           | 0       | 100     | 50      | [x]   |       |

## DEL  (on/off CC26, type CC46)

**BBD — id 0**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Delay    | 74  | ms   | 0   | 1         | 2000      | 1       | 2000    | 1001    | [x]   |                                    |
| Feedback | 75  |      | 0   | 0         | 95        | 0       | 95      | 48      | [x]   |                                    |
| Age      | 76  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mix      | 77  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level    | 78  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Digital — id 1**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Time     | 74  | ms   | 1   | 0.1       | 3000      | 0.1     | 3000    | 1500    | [x]   |                                    |
| Feedback | 75  |      | 0   | 0         | 95        | 0       | 95      | 48      | [x]   |                                    |
| Mix      | 76  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level    | 77  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Duck — id 2**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Time     | 74  | ms   | 1   | 0.1       | 3000      | 0.1     | 3000    | 1500    | [x]   |                                    |
| Feedback | 75  |      | 0   | 0         | 95        | 0       | 95      | 48      | [x]   |                                    |
| Filter   | 76  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mix      | 77  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level    | 78  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Ice — id 3**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Time     | 74  | ms   | 1   | 0.1       | 3000      | 0.1     | 3000    | 1500    | [x]   |                                    |
| Feedback | 75  |      | 0   | 0         | 95        | 0       | 95      | 48      | [x]   |                                    |
| Interval | 76  | st   | 0   | -12       | 12        | -12     | 12      | 0       | [x]   |                                    |
| Mix      | 77  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level    | 78  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Reverse — id 4**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Time     | 74  | ms   | 1   | 0.1       | 3000      | 0.1     | 3000    | 1500    | [x]   |                                    |
| Feedback | 75  |      | 0   | 0         | 95        | 0       | 95      | 48      | [x]   |                                    |
| Mix      | 76  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level    | 77  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**LoFi — id 5**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Time      | 74  | ms   | 1   | 2         | 3000      | 2.0     | 3000    | 1501    | [x]   |                                    |
| Feedback  | 75  |      | 0   | 0         | 95        | 0       | 95      | 48      | [x]   |                                    |
| Bit Depth | 76  | bit  | 0   | 4         | 16        | 4       | 16      | 10      | [x]   |                                    |
| LoFi Mix  | 77  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mix       | 78  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level     | 79  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Smear — id 6**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Time     | 74  | ms   | 1   | 0.1       | 3000      | 0.1     | 3000    | 1500    | [x]   |                                    |
| Feedback | 75  |      | 0   | 0         | 95        | 0       | 95      | 48      | [x]   |                                    |
| Smear    | 76  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Filter   | 77  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mix      | 78  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level    | 79  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Mod Delay — id 7**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Time      | 74  | ms   | 1   | 0.1       | 3000      | 0.1     | 3000    | 1500    | [x]   |                                    |
| Feedback  | 75  |      | 0   | 0         | 95        | 0       | 95      | 48      | [x]   |                                    |
| Mod Depth | 76  | ms   | 1   | 0         | 20        | 0.0     | 20.0    | 10.0    | [x]   |                                    |
| Mod Rate  | 77  | Hz   | 2   | 0.05      | 5         | 0.05    | 5.00    | 2.52    | [x]   |                                    |
| Mix       | 78  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level     | 79  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

## REV  (on/off CC27, type CC47)

**Room — id 0**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Decay     | 85  | s    | 1   | 0.5       | 12        | 0.5     | 12.0    | 6.3     | [x]   |                                    |
| Pre Delay | 86  | ms   | 1   | 0         | 80        | 0.0     | 80.0    | 40.0    | [x]   |                                    |
| Tone      | 87  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mod       | 88  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mix       | 89  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level     | 90  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Plate — id 1**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Decay     | 85  | s    | 1   | 0.5       | 12        | 0.5     | 12.0    | 6.3     | [x]   |                                    |
| Pre Delay | 86  | ms   | 1   | 0         | 80        | 0.0     | 80.0    | 40.0    | [x]   |                                    |
| Tone      | 87  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mod       | 88  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mix       | 89  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level     | 90  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Hall — id 2**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Decay     | 85  | s    | 1   | 0.5       | 12        | 0.5     | 12.0    | 6.3     | [x]   |                                    |
| Pre Delay | 86  | ms   | 1   | 0         | 80        | 0.0     | 80.0    | 40.0    | [x]   |                                    |
| Tone      | 87  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| LF Damp   | 88  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mix       | 89  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level     | 90  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Concert — id 3**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Decay     | 85  | s    | 1   | 0.5       | 12        | 0.5     | 12.0    | 6.3     | [x]   |                                    |
| Pre Delay | 86  | ms   | 1   | 0         | 80        | 0.0     | 80.0    | 40.0    | [x]   |                                    |
| HF Damp   | 87  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mod       | 88  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mix       | 89  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level     | 90  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Shimmer — id 4**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Decay     | 85  | s    | 1   | 0         | 12        | 0.0     | 12.0    | 6.0     | [x]   |                                    |
| Pre Delay | 86  | ms   | 1   | 5         | 120       | 5.0     | 120.0   | 62.5    | [x]   |                                    |
| Tone      | 87  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Pitch     | 88  | st   | 0   | -24       | 24        | -24     | 24      | 0       | [x]   |                                    |
| Mix       | 89  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level     | 90  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Cloud — id 5**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Decay     | 85  | s    | 1   | 1         | 100       | 1.0     | 100.0   | 50.5    | [x]   |                                    |
| Tone      | 86  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mod Depth | 87  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mod Rate  | 88  | Hz   | 2   | 0.02      | 0.25      | 0.02    | 0.25    | 0.14    | [x]   |                                    |
| Mix       | 89  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level     | 90  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

**Spring — id 6**

| Param     | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes                              |
| --------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ---------------------------------- |
| Decay     | 85  | s    | 1   | 0         | 12        | 0.0     | 12.0    | 6.0     | [x]   |                                    |
| Pre Delay | 86  | ms   | 1   | 5         | 80        | 5.0     | 80.0    | 42.5    | [x]   |                                    |
| Crossover | 87  | Hz   | 0   | 800       | 8000      | 800     | 8k      | 4.4k    | [x]   |                                    |
| Mod       | 88  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Mix       | 89  |      | 0   | 0         | 100       | 0       | 100     | 50      | [x]   |                                    |
| Level     | 90  |      | 0   | 0         | 100       | 0       | 100     | 50      | [ ]   | Not shown on device or ToneCommand |

## EQ  (on/off CC28, type CC48)

**3-band EQ — id 0**

| Param | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| ----- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| Low   | 91  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| Mid   | 92  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| High  | 93  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| Level |     | dB   | 1   |           |           | -12.0   | 12.0    | 0.0     | [x]   |       |

**6-band EQ — id 1**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| B2 (120) | 91  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B3 (250) | 92  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B4 (500) | 93  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B5 (1k)  | 94  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B6 (2k)  | 95  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B7 (4k)  | 96  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| Level    |     | dB   | 1   |           |           | -12.0   | 12.0    | 0.0     | [x]   |       |

**8-band EQ — id 2**

| Param    | CC  | Unit | Dec | Model min | Model max | Dev min | Dev max | Dev mid | Check | Notes |
| -------- | --- | ---- | --- | --------- | --------- | ------- | ------- | ------- | ----- | ----- |
| B1 (60)  | 91  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B2 (120) | 92  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B3 (250) | 93  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B4 (500) | 94  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B5 (1k)  | 95  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B6 (2k)  | 96  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B7 (4k)  | 97  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| B8 (8k)  | 33  | dB   | 1   | -15       | 15        | -15.0   | 15.0    | 0.0     | [x]   |       |
| Level    |     | dB   | 1   |           |           | -12.0   | 12.0    | 0.0     | [x]   |       |
