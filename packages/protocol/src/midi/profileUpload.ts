import { crc32 } from './crc32';
import {
  buildProfileApplySysEx,
  buildProfileBeginSysEx,
  buildProfileCatalogReadSysEx,
  buildProfileChunkSysEx,
  buildProfileFinalizeSysEx,
  buildProfileNameSysEx,
  buildStorageInfoSysEx,
  parseProfileCatalogRecord,
  parseStorageInfo,
  type CommandMessage,
  type ProfileCatalogRecord,
} from './sysex';

/** AMP/FX2 profile slots on the device: 0-29 are the 30 AMP models (slot = `data/blocks/amp.ts`
 * model id), 30-37 the FX2 drive/boost models (slot = 30 + `data/blocks/fx2.ts` type id). Captured
 * 2026-09-30 — see docs/MIDI_MAPPING_NOTES.md, "AMP/FX2 profile upload". */
export const PROFILE_SLOT_COUNT = 38;
export const PROFILE_FIRST_FX2_SLOT = 30;

/** ToneCommand sends 64 data bytes per write over USB and waits for each acknowledgement. */
export const PROFILE_CHUNK_SIZE = 64;
/** Sanity cap, well above any profile seen (12302 B factory, ~16.7 kB in the online library). */
export const PROFILE_MAX_FILE_BYTES = 256 * 1024;
/** Longest slot name the catalog record holds. */
export const PROFILE_NAME_MAX = 16;
const SAPF_HEADER_BYTES = 60;

export type ProfileFileProblem = 'too-short' | 'bad-magic' | 'bad-version' | 'length-mismatch' | 'too-large';

/** Checks that `data` looks like the `.ead` container ToneCommand uploads: `"SAPF"` magic, version
 * 1, and a total length equal to the 60-byte header plus the body length stored at offset 24 (all
 * observed on the real files; the rest of the header is not interpreted here). */
export function validateProfileFile(data: Uint8Array): { ok: true; bodyBytes: number } | { ok: false; problem: ProfileFileProblem } {
  if (data.length > PROFILE_MAX_FILE_BYTES) return { ok: false, problem: 'too-large' };
  if (data.length < SAPF_HEADER_BYTES) return { ok: false, problem: 'too-short' };
  if (data[0] !== 0x53 || data[1] !== 0x41 || data[2] !== 0x50 || data[3] !== 0x46) return { ok: false, problem: 'bad-magic' };
  if (data[4] !== 0x01) return { ok: false, problem: 'bad-version' };
  const bodyBytes = (data[24] | (data[25] << 8) | (data[26] << 16) | (data[27] << 24)) >>> 0;
  if (data.length !== bodyBytes + SAPF_HEADER_BYTES) return { ok: false, problem: 'length-mismatch' };
  return { ok: true, bodyBytes };
}

/** What `runProfileUpload` needs from the outside world: send a freshly built frame (a new
 * sequence number per call, so a retry is a clean resend) and resolve with the device's decoded
 * reply, or `null` on timeout. */
export type CommandTransact = (build: () => number[], label: string) => Promise<CommandMessage | null>;

export type UploadPhase = 'info' | 'begin' | 'writing' | 'finalize' | 'naming' | 'applying';

export type UploadResult =
  | { ok: true }
  | { ok: false; phase: UploadPhase; reason: 'no-response' | 'device-status' | 'slot-out-of-range'; status?: number; offset?: number };

export interface RunProfileUploadOptions {
  transact: CommandTransact;
  slot: number;
  data: Uint8Array;
  /** Shown as the slot's name (sanitised to printable ASCII, at most `PROFILE_NAME_MAX`). */
  name: string;
  onProgress?: (phase: UploadPhase, sentBytes: number, totalBytes: number) => void;
  /** Extra attempts per chunk after a timeout (writes are offset-addressed, so resending is safe). */
  chunkRetries?: number;
}

/** The exact sequence ToneCommand uses over USB (captured 2026-09-30): storage-info → begin →
 * 64-byte chunks, each acknowledged → finalize with the file's CRC-32 → name → storage-info →
 * apply → storage-info. Stops at the first reply with a non-zero status or no reply at all. */
export async function runProfileUpload(opts: RunProfileUploadOptions): Promise<UploadResult> {
  const { transact, slot, data, onProgress } = opts;
  const retries = opts.chunkRetries ?? 2;
  const total = data.length;
  const bytes = Array.from(data);

  const fail = (phase: UploadPhase, reply: CommandMessage | null, offset?: number): UploadResult =>
    reply === null
      ? { ok: false, phase, reason: 'no-response', offset }
      : { ok: false, phase, reason: 'device-status', status: reply.status ?? undefined, offset };

  onProgress?.('info', 0, total);
  const info = await transact(buildStorageInfoSysEx, 'Profile upload: storage info');
  if (!info || info.status !== 0) return fail('info', info);
  const parsed = parseStorageInfo(info.payload);
  const slotCount = parsed?.slotCount ?? PROFILE_SLOT_COUNT;
  if (slot < 0 || slot >= slotCount) return { ok: false, phase: 'info', reason: 'slot-out-of-range' };

  onProgress?.('begin', 0, total);
  const begin = await transact(() => buildProfileBeginSysEx(slot, total), `Profile upload: begin slot ${slot + 1}`);
  if (!begin || begin.status !== 0) return fail('begin', begin);

  for (let offset = 0; offset < total; offset += PROFILE_CHUNK_SIZE) {
    const chunk = bytes.slice(offset, offset + PROFILE_CHUNK_SIZE);
    let reply: CommandMessage | null = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      reply = await transact(() => buildProfileChunkSysEx(slot, offset, chunk), `Profile upload: bytes ${offset}-${offset + chunk.length}`);
      if (reply) break;
    }
    if (!reply || reply.status !== 0) return fail('writing', reply, offset);
    onProgress?.('writing', offset + chunk.length, total);
  }

  onProgress?.('finalize', total, total);
  const crc = crc32(data);
  const finalize = await transact(() => buildProfileFinalizeSysEx(slot, total, crc), 'Profile upload: finalize');
  if (!finalize || finalize.status !== 0) return fail('finalize', finalize);

  onProgress?.('naming', total, total);
  const name = sanitizeProfileName(opts.name);
  const named = await transact(() => buildProfileNameSysEx(slot, name), `Profile upload: name "${name}"`);
  if (!named || named.status !== 0) return fail('naming', named);

  onProgress?.('applying', total, total);
  for (const [build, label] of [
    [buildStorageInfoSysEx, 'Profile upload: storage info'],
    [() => buildProfileApplySysEx(slot), 'Profile upload: apply'],
    [buildStorageInfoSysEx, 'Profile upload: storage info'],
  ] as const) {
    const reply = await transact(build, label);
    if (!reply || reply.status !== 0) return fail('applying', reply);
  }
  return { ok: true };
}

/** Printable ASCII only, trimmed, at most `PROFILE_NAME_MAX` characters; never empty. */
export function sanitizeProfileName(name: string): string {
  const cleaned = Array.from(name, (ch) => (ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) < 0x7f ? ch : '?'))
    .join('')
    .trim()
    .slice(0, PROFILE_NAME_MAX);
  return cleaned || 'profile';
}

/** Reads every slot's catalog record (read-only). Slots whose read fails are skipped. */
export async function readProfileCatalog(transact: CommandTransact): Promise<ProfileCatalogRecord[]> {
  const records: ProfileCatalogRecord[] = [];
  for (let slot = 0; slot < PROFILE_SLOT_COUNT; slot += 1) {
    const reply = await transact(() => buildProfileCatalogReadSysEx(slot), `Read profile catalog: slot ${slot + 1}`);
    if (reply && reply.status === 0) {
      const record = parseProfileCatalogRecord(reply.payload);
      if (record) records.push(record);
    }
  }
  return records;
}
