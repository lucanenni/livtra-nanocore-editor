import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NanoCoreSession } from './session';
import { registerTools } from './tools';

const INSTRUCTIONS =
  'Controls a Livtra NanoCore guitar multi-effect pedal over USB MIDI. Call connect first, then get_patch to see the current sound. ' +
  'Edits (set_block, set_param, set_chain_order, rename_patch) are live and are lost on the next preset change; save_to_slot keeps them. ' +
  'The official ToneCommand app must be closed while this is connected.';

async function main(): Promise<void> {
  const session = new NanoCoreSession();
  const server = new McpServer({ name: 'nanocore', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, session);

  const shutdown = () => {
    session.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  // stdout carries the protocol; diagnostics go to stderr.
  console.error(err);
  process.exit(1);
});
