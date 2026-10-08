import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PROFILE_NAME_MAX, PROFILE_SLOT_COUNT } from '@nanocore/protocol';
import type { UploadResult } from '@nanocore/protocol';
import { z } from 'zod';
import { blockOverview, describeBlockSpec, describePatch, resolveBlock } from './format';
import { MAX_SAVE_SLOT, NanoCoreSession } from './session';
import type { SettingName } from './session';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (err: unknown): ToolResult => ({ content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true });

/** Wraps a handler so a thrown error becomes a tool error the assistant can read and react to. */
function guarded<A>(fn: (args: A) => Promise<unknown> | unknown): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return fail(err);
    }
  };
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const OVERWRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

const BLOCK_ARG = z.string().describe('Block id: fx1, fx2, amp, cab, mod, del, rev or eq.');

const UPLOAD_PHASE_TEXT: Record<string, string> = {
  info: 'querying storage',
  begin: 'starting the transfer',
  writing: 'writing the file',
  finalize: 'finalizing',
  naming: 'setting the name',
  applying: 'applying',
};

function uploadFailure(result: Extract<UploadResult, { ok: false }>): string {
  const where = UPLOAD_PHASE_TEXT[result.phase] ?? result.phase;
  if (result.reason === 'no-response') return `The upload failed while ${where}: the NanoCore stopped answering.`;
  if (result.reason === 'slot-out-of-range') return `The NanoCore rejected the slot while ${where}.`;
  return `The upload failed while ${where}: the NanoCore returned status ${result.status}.`;
}

export function registerTools(server: McpServer, session: NanoCoreSession): void {
  server.registerTool(
    'list_midi_ports',
    {
      title: 'List MIDI ports',
      description: 'Lists the MIDI output ports on this computer. The NanoCore appears as "Nanocore" when plugged in over USB.',
      annotations: READ,
    },
    guarded(async () => ({ ports: await session.listPorts() })),
  );

  server.registerTool(
    'connect',
    {
      title: 'Connect to the NanoCore',
      description:
        'Connects to the pedal (the port named like "Nanocore" unless `port` is given) and reads its current patch. ' +
        'Call this first. Close the official ToneCommand app before connecting: only one app can use the pedal at a time.',
      inputSchema: {
        port: z.string().optional().describe('Port name or part of it. Defaults to the NanoCore.'),
        midi_channel: z.number().int().min(1).max(16).optional().describe("MIDI channel for CC/program changes (1-16, default 1). Must match the pedal's MIDI Channel setting unless that is Omni."),
      },
      annotations: EDIT,
    },
    guarded(async ({ port, midi_channel }: { port?: string; midi_channel?: number }) => {
      const { port: connected } = await session.connect(port, midi_channel ?? 1);
      return {
        connected,
        preset: { number: session.activeSlot + 1, name: session.presetName },
        ...(session.lastReadError ? { warning: session.lastReadError } : {}),
      };
    }),
  );

  server.registerTool(
    'disconnect',
    { title: 'Disconnect', description: 'Stops talking to the pedal and frees it for other apps.', annotations: EDIT },
    guarded(() => {
      session.disconnect();
      return 'Disconnected.';
    }),
  );

  server.registerTool(
    'get_patch',
    {
      title: 'Read the current patch',
      description:
        "Reads what the pedal is playing right now (live edits included, saved or not): the preset number and name, the effect chain order, and for each of the 8 blocks whether it is on, its effect type and every parameter in real units. " +
        'Caveat: the pedal cannot report an AMP or CAB model, or an effect chain order, that was changed but not yet saved, so right after a preset recall or reconnect those show the saved values.',
      annotations: READ,
    },
    guarded(async () => {
      await session.refresh();
      return { preset: { number: session.activeSlot + 1, name: session.presetName }, ...describePatch(session.patch, session.chainOrder) };
    }),
  );

  server.registerTool(
    'describe_block',
    {
      title: 'List a block\'s effects and parameters',
      description: 'Lists every effect type of a block with its parameters, units, ranges and options — what set_block and set_param accept. Without `block`, gives an overview of all 8 blocks.',
      inputSchema: { block: BLOCK_ARG.optional() },
      annotations: READ,
    },
    guarded(({ block }: { block?: string }) => (block ? describeBlockSpec(resolveBlock(block)) : { blocks: blockOverview() })),
  );

  server.registerTool(
    'set_block',
    {
      title: 'Switch a block on/off or change its effect type',
      description:
        'Turns a block on or off and/or selects its effect type (by name, e.g. "Hall"). The change is live; it is lost on the next preset change unless saved with save_to_slot. ' +
        'Choosing an AMP or CAB model is sent as a SysEx command (the only way the pedal accepts it).',
      inputSchema: {
        block: BLOCK_ARG,
        on: z.boolean().optional().describe('true = on, false = off.'),
        type: z.union([z.string(), z.number()]).optional().describe('Effect type name, slug or id (see describe_block).'),
      },
      annotations: EDIT,
    },
    guarded(({ block, on, type }: { block: string; on?: boolean; type?: string | number }) => {
      session.setBlock(block, { on, type });
      return describePatch(session.patch, session.chainOrder).blocks[resolveBlock(block).id];
    }),
  );

  server.registerTool(
    'set_param',
    {
      title: 'Set an effect parameter',
      description:
        "Sets one parameter of a block's current effect type, by its label (e.g. \"Threshold\", \"Mix\"). Range parameters take a number in real units (dB, ms, %, Hz...), enum parameters an option name. Live only; save_to_slot persists it. Use describe_block for valid names and ranges.",
      inputSchema: {
        block: BLOCK_ARG,
        param: z.string().describe('Parameter label or id, as get_patch / describe_block show it.'),
        value: z.union([z.number(), z.string()]).describe('A number in the parameter\'s unit, or an option name for enum parameters.'),
      },
      annotations: EDIT,
    },
    guarded(({ block, param, value }: { block: string; param: string; value: number | string }) => {
      const set = session.setParam(block, param, value);
      return { block: resolveBlock(block).id, param: set.label, value: set.value };
    }),
  );

  server.registerTool(
    'set_chain_order',
    {
      title: 'Reorder the effect chain',
      description: 'Sets the signal order of the 8 blocks: list every block id exactly once, first to last (e.g. ["fx1","eq","mod","fx2","amp","cab","del","rev"]). Live only.',
      inputSchema: { order: z.array(z.string()).length(8).describe('All 8 block ids in signal order.') },
      annotations: EDIT,
    },
    guarded(({ order }: { order: string[] }) => {
      session.setChainOrder(order);
      return { chainOrder: session.chainOrder };
    }),
  );

  server.registerTool(
    'rename_patch',
    {
      title: 'Rename the current patch',
      description: 'Renames the patch the pedal has loaded (max 8 characters; longer names are cut). Live only: call save_to_slot to keep it.',
      inputSchema: { name: z.string().min(1).describe('New name, up to 8 characters.') },
      annotations: EDIT,
    },
    guarded(({ name }: { name: string }) => ({ name: session.rename(name) })),
  );

  server.registerTool(
    'recall_preset',
    {
      title: 'Recall a preset',
      description: `Loads preset \`number\` (1-128, as the pedal's display shows it) and returns the resulting patch. Any unsaved live edits are discarded.`,
      inputSchema: { number: z.number().int().min(1).max(128) },
      annotations: EDIT,
    },
    guarded(async ({ number }: { number: number }) => {
      await session.recall(number);
      return { preset: { number: session.activeSlot + 1, name: session.presetName }, ...describePatch(session.patch, session.chainOrder) };
    }),
  );

  server.registerTool(
    'save_to_slot',
    {
      title: 'Save the live patch into a preset slot',
      description:
        `Writes what the pedal currently has loaded (the recalled preset plus every live edit) into preset slot \`number\` (1-${MAX_SAVE_SLOT}, as the pedal's display shows it), replacing whatever is stored there. ` +
        'Set `confirm` to true only after the user has agreed to overwrite that slot.',
      inputSchema: {
        number: z.number().int().min(1).max(MAX_SAVE_SLOT),
        confirm: z.literal(true).describe('Must be true: the user agreed to overwrite this slot.'),
      },
      annotations: OVERWRITE,
    },
    guarded(async ({ number }: { number: number; confirm: true }) => {
      const saved = await session.saveToSlot(number);
      if (!saved) throw new Error('The NanoCore did not acknowledge the save.');
      return `Saved to preset ${number}.`;
    }),
  );

  server.registerTool(
    'get_global_settings',
    {
      title: 'Read the global settings',
      description: 'Reads the device-wide settings: wireless, loopback, input gain (dB), USB and Bluetooth volume, MIDI channel (0 = Omni).',
      annotations: READ,
    },
    guarded(() => session.globalSettings()),
  );

  server.registerTool(
    'set_global_setting',
    {
      title: 'Change a global setting',
      description: 'Changes one device-wide setting and returns all of them. wireless/loopback take true/false; input_gain_db -64..63; usb_volume/bt_volume 0-100; midi_channel 0 (Omni) or 1-16.',
      inputSchema: {
        setting: z.enum(['wireless', 'loopback', 'input_gain_db', 'usb_volume', 'bt_volume', 'midi_channel']),
        value: z.union([z.number(), z.boolean()]),
      },
      annotations: EDIT,
    },
    guarded(({ setting, value }: { setting: SettingName; value: number | boolean }) => session.setGlobalSetting(setting, value)),
  );

  server.registerTool(
    'list_profiles',
    {
      title: 'List the AMP/FX2 profile slots',
      description:
        `Lists the ${PROFILE_SLOT_COUNT} profile slots (1-30 are AMP models, 31-38 FX2 drives) with the name stored in each and the factory name for comparison. Read-only.`,
      annotations: READ,
    },
    guarded(async () => ({
      slots: (await session.profileCatalog()).map((r) => ({
        slot: r.slot + 1,
        kind: r.kind,
        name: r.name,
        factoryName: r.factoryName,
        ...(r.lastWritten ? { lastWritten: true } : {}),
      })),
    })),
  );

  server.registerTool(
    'upload_profile',
    {
      title: 'Load a .ead profile into a profile slot',
      description:
        `Uploads a local ToneCommand profile file (.ead) into AMP/FX2 profile slot \`slot\` (1-${PROFILE_SLOT_COUNT}), replacing what is there; ` +
        'the only way back to the factory profile is the official app\'s "Restore Factory Content". Takes a few seconds. ' +
        'Set `confirm` to true only after the user has agreed to overwrite that slot.',
      inputSchema: {
        slot: z.number().int().min(1).max(PROFILE_SLOT_COUNT),
        file_path: z.string().describe('Absolute path of a .ead file on this computer.'),
        name: z.string().max(PROFILE_NAME_MAX).optional().describe(`Name shown for the slot (max ${PROFILE_NAME_MAX} characters). Defaults to the file name.`),
        confirm: z.literal(true).describe('Must be true: the user agreed to overwrite this slot.'),
      },
      annotations: OVERWRITE,
    },
    guarded(async ({ slot, file_path, name }: { slot: number; file_path: string; name?: string; confirm: true }) => {
      if (extname(file_path).toLowerCase() !== '.ead') throw new Error('Only .ead profile files can be uploaded.');
      const data = new Uint8Array(await readFile(file_path));
      const result = await session.uploadProfile(slot, data, name ?? basename(file_path));
      if (!result.ok) throw new Error(uploadFailure(result));
      return `Uploaded ${basename(file_path)} to profile slot ${slot}.`;
    }),
  );
}
