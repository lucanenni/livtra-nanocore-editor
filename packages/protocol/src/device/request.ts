import type { MidiTransport } from '../midi/types';

/** How long to wait for each reply of a read exchange before giving up (e.g. an older firmware
 * that doesn't answer opcode 0x41, or the Simulator, which never replies at all). */
export const READ_TIMEOUT_MS = 3000;
/** Per-command reply timeout for the profile-upload family (acks normally take a few ms over USB). */
export const PROFILE_COMMAND_TIMEOUT_MS = 1500;

/** Sends one SysEx request and resolves with the first reply matching `isResponse`, or `null` on
 * timeout. Every read here is a simple request/one-matching-reply exchange over
 * `MidiTransport.onSysExReceived`'s stream, which also carries unrelated device chatter (hence
 * needing `isResponse` rather than taking the next message unconditionally). */
export function requestSysExResponse(
  transport: MidiTransport,
  outputId: string,
  request: number[],
  isResponse: (bytes: readonly number[]) => boolean,
  label: string,
  timeoutMs: number = READ_TIMEOUT_MS,
): Promise<number[] | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: number[] | null) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(result);
    };
    const unsubscribe = transport.onSysExReceived(outputId, (bytes) => {
      if (isResponse(bytes)) finish(bytes);
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    transport.sendSysEx(outputId, request, label);
  });
}
