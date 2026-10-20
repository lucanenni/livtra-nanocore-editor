import { crc32 } from './crc32';
import {
  buildProfileApplySysEx,
  buildProfileBeginSysEx,
  buildProfileCatalogReadSysEx,
  buildProfileChunkSysEx,
  buildIrCatalogReadSysEx,
  buildProfileReadSysEx,
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
/** CAB IR slots: one per `data/blocks/cab.ts` model (slot = model id), read with `0x56`. */
export const IR_SLOT_COUNT = 30;

/** Catalog slot holding effect type `typeId` of `blockId` — a profile slot for AMP models and FX2
 * drives/boosts, an IR slot for CAB models — or `null` for a type with no slot. */
export function catalogSlotFor(blockId: string, typeId: number): number | null {
  if (!Number.isInteger(typeId) || typeId < 0) return null;
  if (blockId === 'amp' && typeId < PROFILE_FIRST_FX2_SLOT) return typeId;
  if (blockId === 'fx2' && typeId < PROFILE_SLOT_COUNT - PROFILE_FIRST_FX2_SLOT) return PROFILE_FIRST_FX2_SLOT + typeId;
  if (blockId === 'cab' && typeId < IR_SLOT_COUNT) return typeId;
  return null;
}

/** The name a user-loaded file (NAM capture, IR…) gave the slot behind `typeId`, or `null` while
 * that slot still holds the factory model `factoryName` — the device reports factory slots under
 * the same names as the spec (Pey51501, Bog412A…), so any other name is a custom one. `catalog` is
 * the one `blockId` lives in: the IR catalog for CAB, the profile catalog otherwise. */
export function customProfileName(
  catalog: readonly ProfileCatalogRecord[] | null | undefined,
  blockId: string,
  typeId: number,
  factoryName: string,
): string | null {
  const slot = catalogSlotFor(blockId, typeId);
  if (slot === null || !catalog) return null;
  const record = catalog.find((r) => r.slot === slot);
  const name = record?.present ? record.name.trim() : '';
  return name && name.toLowerCase() !== factoryName.trim().toLowerCase() ? name : null;
}

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

/** Reads every slot's catalog record (read-only). Slots whose read fails are skipped; no reply
 * at all to the first slot means nothing is answering, so the rest aren't tried. */
export function readProfileCatalog(transact: CommandTransact): Promise<ProfileCatalogRecord[]> {
  return readCatalog(transact, PROFILE_SLOT_COUNT, buildProfileCatalogReadSysEx, 'Read profile catalog');
}

/** Same as `readProfileCatalog`, for the 30 CAB IR slots. */
export function readIrCatalog(transact: CommandTransact): Promise<ProfileCatalogRecord[]> {
  return readCatalog(transact, IR_SLOT_COUNT, buildIrCatalogReadSysEx, 'Read IR catalog');
}

export type ProfileReadResult =
  | { ok: true; record: ProfileCatalogRecord; body: Uint8Array; crc: number; crcMatches: boolean; attempts: number }
  | { ok: false; reason: 'no-catalog' | 'empty-slot' | 'no-response' | 'device-status' | 'bad-reply'; status?: number; offset?: number };

/** Largest slice ToneCommand asks for per read; the device may answer with less. */
const PROFILE_READ_CHUNK = 200;

/** Reads the stored body of a profile slot (or of a CAB IR slot with `ir`) and checks it against
 * the catalog record's CRC-32. Read-only. The body is what the device keeps after decrypting the
 * uploaded `.ead` — useful to verify or compare slots, not to upload again.
 *
 * A read now and then comes back with a few wrong bytes (about 1 in 50 over USB, cause not found)
 * while the very next read of the same slot is clean, so a mismatch is re-read up to `attempts`
 * times: only a slot that never matches is reported as `crcMatches: false`. */
export async function readProfileData(transact: CommandTransact, slot: number, ir = false, attempts = 3): Promise<ProfileReadResult> {
  let result: ProfileReadResult = { ok: false, reason: 'no-catalog' };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await readProfileDataOnce(transact, slot, ir, attempt);
    if (!result.ok || result.crcMatches) return result;
  }
  return result;
}

async function readProfileDataOnce(transact: CommandTransact, slot: number, ir: boolean, attempt: number): Promise<ProfileReadResult> {
  const label = ir ? 'IR' : 'profile';
  const info = await transact(() => (ir ? buildIrCatalogReadSysEx(slot) : buildProfileCatalogReadSysEx(slot)), `Read ${label} catalog: slot ${slot + 1}`);
  const record = info && info.status === 0 ? parseProfileCatalogRecord(info.payload) : null;
  if (!record) return { ok: false, reason: 'no-catalog', ...(info ? { status: info.status ?? undefined } : {}) };
  if (!record.present || record.bodyBytes === 0) return { ok: false, reason: 'empty-slot' };

  const body = new Uint8Array(record.bodyBytes);
  let offset = 0;
  while (offset < record.bodyBytes) {
    const at = offset;
    const length = Math.min(PROFILE_READ_CHUNK, record.bodyBytes - at);
    const reply = await transact(() => buildProfileReadSysEx(slot, at, length, ir), `Read ${label} data: slot ${slot + 1} @${at}`);
    if (!reply) return { ok: false, reason: 'no-response', offset: at };
    if (reply.status !== 0) return { ok: false, reason: 'device-status', status: reply.status ?? undefined, offset: at };
    const p = reply.payload;
    const data = p.slice(5, 5 + (record.bodyBytes - at));
    if (p[0] !== slot || (p[1] | (p[2] << 8)) !== at || data.length === 0) return { ok: false, reason: 'bad-reply', offset: at };
    body.set(data, at);
    offset += data.length;
  }
  const crc = crc32(body);
  return { ok: true, record, body, crc, crcMatches: crc === record.checksum, attempts: attempt };
}

async function readCatalog(
  transact: CommandTransact,
  slotCount: number,
  build: (slot: number) => number[],
  label: string,
): Promise<ProfileCatalogRecord[]> {
  const records: ProfileCatalogRecord[] = [];
  for (let slot = 0; slot < slotCount; slot += 1) {
    const reply = await transact(() => build(slot), `${label}: slot ${slot + 1}`);
    if (!reply && slot === 0) return records;
    if (reply && reply.status === 0) {
      const record = parseProfileCatalogRecord(reply.payload);
      if (record) records.push(record);
    }
  }
  return records;
}
