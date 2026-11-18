import { describe, expect, it } from 'vitest';
import { wavToIr } from '../wavToIr';

/** Builds a minimal canonical WAV file (RIFF/WAVE, one `fmt `, one `data`) from raw PCM/float
 * sample bytes already encoded by the caller. */
function buildWav(opts: { audioFormat: number; numChannels: number; sampleRate: number; bitsPerSample: number; dataBytes: Uint8Array }): Uint8Array {
  const { audioFormat, numChannels, sampleRate, bitsPerSample, dataBytes } = opts;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const buf = new Uint8Array(44 + dataBytes.length);
  const view = new DataView(buf.buffer);
  const str = (offset: number, s: string) => Array.from(s).forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes.length, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  str(36, 'data');
  view.setUint32(40, dataBytes.length, true);
  buf.set(dataBytes, 44);
  return buf;
}

function int16Samples(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 2);
  const view = new DataView(buf.buffer);
  values.forEach((v, i) => view.setInt16(i * 2, v, true));
  return buf;
}

function float32Samples(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 4);
  const view = new DataView(buf.buffer);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return buf;
}

describe('wavToIr', () => {
  it('passes 16-bit mono 48kHz through unresampled, peak-normalised to 1.0', () => {
    // Peaks at 16384 (0.5 of full scale) — normalisation should double every sample.
    const wav = buildWav({ audioFormat: 1, numChannels: 1, sampleRate: 48000, bitsPerSample: 16, dataBytes: int16Samples([0, 16384, -16384, 8192]) });
    const res = wavToIr(wav);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.resampled).toBe(false);
    expect(res.result.truncated).toBe(false);
    expect(res.result.sampleCount).toBe(4);
    const view = new DataView(res.result.data.buffer);
    expect(view.getFloat32(0, true)).toBeCloseTo(0, 5);
    expect(view.getFloat32(4, true)).toBeCloseTo(1.0, 4);
    expect(view.getFloat32(8, true)).toBeCloseTo(-1.0, 4);
    expect(view.getFloat32(12, true)).toBeCloseTo(0.5, 4);
  });

  it('downmixes stereo to mono by averaging channels', () => {
    // L=full positive, R=silent -> mono average = half, which then gets peak-normalised back to 1.0.
    const wav = buildWav({ audioFormat: 1, numChannels: 2, sampleRate: 48000, bitsPerSample: 16, dataBytes: int16Samples([32767, 0]) });
    const res = wavToIr(wav);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.sampleCount).toBe(1);
    expect(new DataView(res.result.data.buffer).getFloat32(0, true)).toBeCloseTo(1.0, 3);
  });

  it('resamples a non-48kHz source and reports it', () => {
    const samples = Array.from({ length: 100 }, (_, i) => Math.round(10000 * Math.sin((i / 100) * Math.PI * 2)));
    const wav = buildWav({ audioFormat: 1, numChannels: 1, sampleRate: 24000, bitsPerSample: 16, dataBytes: int16Samples(samples) });
    const res = wavToIr(wav);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.resampled).toBe(true);
    expect(res.result.sourceSampleRate).toBe(24000);
    // Upsampling 24kHz -> 48kHz roughly doubles the sample count.
    expect(res.result.sampleCount).toBeGreaterThan(150);
    expect(res.result.sampleCount).toBeLessThan(250);
  });

  it('truncates to the device IR cap (1024 samples) rather than failing', () => {
    const samples = Array.from({ length: 2000 }, () => 1000);
    const wav = buildWav({ audioFormat: 1, numChannels: 1, sampleRate: 48000, bitsPerSample: 16, dataBytes: int16Samples(samples) });
    const res = wavToIr(wav);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.truncated).toBe(true);
    expect(res.result.sampleCount).toBe(1024);
    expect(res.result.data.length).toBe(1024 * 4);
  });

  it('decodes 32-bit IEEE float source data directly', () => {
    const wav = buildWav({ audioFormat: 3, numChannels: 1, sampleRate: 48000, bitsPerSample: 32, dataBytes: float32Samples([0.25, -0.5, 0.1]) });
    const res = wavToIr(wav);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Peak 0.5 -> normalised x2.
    expect(new DataView(res.result.data.buffer).getFloat32(4, true)).toBeCloseTo(-1.0, 4);
  });

  it('rejects a file that is not RIFF/WAVE', () => {
    expect(wavToIr(new Uint8Array(100))).toEqual({ ok: false, problem: 'not-wav' });
  });

  it('rejects a WAV with no data chunk', () => {
    const buf = new Uint8Array(44);
    const view = new DataView(buf.buffer);
    const str = (offset: number, s: string) => Array.from(s).forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    view.setUint32(4, 36, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 48000, true);
    view.setUint16(34, 16, true);
    expect(wavToIr(buf)).toEqual({ ok: false, problem: 'no-data-chunk' });
  });
});
