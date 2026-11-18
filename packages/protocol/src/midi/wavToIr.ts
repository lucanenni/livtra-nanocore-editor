/** Converts a `.wav` file into the raw float32 mono buffer a CAB IR slot stores — mono, 48 kHz, at
 * most 1024 samples, peak normalised to 1.0. This project's own convention (the device itself
 * normalises nothing and has no documented sample-rate field — see `docs/MIDI_MAPPING_NOTES.md`,
 * "CAB IR slot write" — and `nanocore-controller` independently reached the same convention for
 * its own WAV importer). `runIrUpload` sends the result unchanged. */

const IR_SAMPLE_RATE = 48000;
/** The device's default IR byte limit (`runIrUpload` checks the real, live one) is 4096 B =
 * 1024 float32 samples — truncate here rather than let a long WAV fail the upload outright. */
const IR_MAX_SAMPLES = 1024;

export type WavConversionProblem = 'not-wav' | 'no-fmt-chunk' | 'no-data-chunk' | 'unsupported-format' | 'empty';

export interface WavConversionResult {
  /** Raw little-endian float32 mono samples, ready for `runIrUpload`/`validateIrFile`. */
  data: Uint8Array;
  sampleCount: number;
  sourceSampleRate: number;
  resampled: boolean;
  truncated: boolean;
}

interface RiffChunk {
  id: string;
  start: number;
  length: number;
}

function readChunks(view: DataView, from: number): RiffChunk[] {
  const chunks: RiffChunk[] = [];
  let offset = from;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    chunks.push({ id, start, length });
    offset = start + length + (length % 2); // chunks are word-aligned
  }
  return chunks;
}

/** Reads one sample at `byteOffset` as -1..1, for `bitsPerSample`/`floatFormat` (3 = IEEE float,
 * everything else assumed signed PCM). 8-bit PCM is the one unsigned exception (WAV convention). */
function readSample(view: DataView, byteOffset: number, bitsPerSample: number, floatFormat: boolean): number {
  if (floatFormat) return bitsPerSample === 64 ? view.getFloat64(byteOffset, true) : view.getFloat32(byteOffset, true);
  switch (bitsPerSample) {
    case 8:
      return (view.getUint8(byteOffset) - 128) / 128;
    case 16:
      return view.getInt16(byteOffset, true) / 32768;
    case 24: {
      const b0 = view.getUint8(byteOffset);
      const b1 = view.getUint8(byteOffset + 1);
      const b2 = view.getUint8(byteOffset + 2);
      let v = b0 | (b1 << 8) | (b2 << 16);
      if (v & 0x800000) v -= 0x1000000;
      return v / 0x800000;
    }
    case 32:
      return view.getInt32(byteOffset, true) / 2147483648;
    default:
      return 0;
  }
}

/** Parses a `.wav` file and converts it to the device's IR convention. Supports PCM (8/16/24/32-bit)
 * and IEEE float (32/64-bit) source data, any channel count (downmixed by averaging) and any sample
 * rate (linearly resampled to 48 kHz). */
export function wavToIr(bytes: Uint8Array): { ok: true; result: WavConversionResult } | { ok: false; problem: WavConversionProblem } {
  if (bytes.length < 44) return { ok: false, problem: 'not-wav' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (riff !== 'RIFF' || wave !== 'WAVE') return { ok: false, problem: 'not-wav' };

  const chunks = readChunks(view, 12);
  const fmtChunk = chunks.find((c) => c.id === 'fmt ');
  if (!fmtChunk || fmtChunk.length < 16) return { ok: false, problem: 'no-fmt-chunk' };
  const dataChunk = chunks.find((c) => c.id === 'data');
  if (!dataChunk || dataChunk.length === 0) return { ok: false, problem: 'no-data-chunk' };

  const audioFormat = view.getUint16(fmtChunk.start, true);
  const numChannels = view.getUint16(fmtChunk.start + 2, true);
  const sampleRate = view.getUint32(fmtChunk.start + 4, true);
  const bitsPerSample = view.getUint16(fmtChunk.start + 14, true);
  // 1 = PCM, 3 = IEEE float, 0xfffe = WAVE_FORMAT_EXTENSIBLE (the sub-format at offset 24 decides,
  // same two cases in practice for anything this project expects to see).
  const floatFormat = audioFormat === 3 || (audioFormat === 0xfffe && bitsPerSample >= 32 && fmtChunk.length >= 24 && view.getUint16(fmtChunk.start + 24, true) === 3);
  if (numChannels < 1 || ![8, 16, 24, 32, 64].includes(bitsPerSample) || (audioFormat !== 1 && audioFormat !== 3 && audioFormat !== 0xfffe)) {
    return { ok: false, problem: 'unsupported-format' };
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameBytes = bytesPerSample * numChannels;
  const frameCount = Math.floor(dataChunk.length / frameBytes);
  if (frameCount === 0) return { ok: false, problem: 'empty' };

  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch += 1) {
      sum += readSample(view, dataChunk.start + frame * frameBytes + ch * bytesPerSample, bitsPerSample, floatFormat);
    }
    mono[frame] = sum / numChannels;
  }

  const resampled = sampleRate !== IR_SAMPLE_RATE;
  const resampledMono = resampled ? resampleLinear(mono, sampleRate, IR_SAMPLE_RATE) : mono;

  const truncated = resampledMono.length > IR_MAX_SAMPLES;
  const finalSamples = truncated ? resampledMono.subarray(0, IR_MAX_SAMPLES) : resampledMono;

  let peak = 0;
  for (const s of finalSamples) peak = Math.max(peak, Math.abs(s));
  const scale = peak > 0 ? 1 / peak : 1;

  const out = new Uint8Array(finalSamples.length * 4);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < finalSamples.length; i += 1) outView.setFloat32(i * 4, finalSamples[i] * scale, true);

  return {
    ok: true,
    result: { data: out, sampleCount: finalSamples.length, sourceSampleRate: sampleRate, resampled, truncated },
  };
}

/** Linear-interpolation resample — adequate for a short cabinet IR, no external DSP dependency. */
function resampleLinear(source: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (source.length === 0 || fromRate === toRate) return source;
  const outLength = Math.max(1, Math.round((source.length * toRate) / fromRate));
  const out = new Float32Array(outLength);
  const ratio = (source.length - 1) / Math.max(1, outLength - 1);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(source.length - 1, lo + 1);
    const frac = pos - lo;
    out[i] = source[lo] * (1 - frac) + source[hi] * frac;
  }
  return out;
}
