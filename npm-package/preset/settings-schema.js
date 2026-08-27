// Settings-namespace schema for oh-my-dsh-slim.
//
// defaults.json stays the single source of truth: role ids, effort levels and
// tool names come from config-loader.js, so this schema cannot drift from what
// the loader actually merges. It validates the USER-INTENT document — the same
// shape as the legacy oh-my-dsh-slim.json; semantic merging (deny union,
// hidden runtime defaults, force-locked roles) remains in config-loader.js.
// Schemastery permits extra keys, which keeps the namespace forward-compatible
// with future fields.

import { EFFORT_LEVELS, ROLE_IDS, SETTINGS_NS, TOOL_NAMES } from './config-loader.js';

const MCP_TRANSPORTS = ['stdio', 'streamable-http'];

export { SETTINGS_NS };

export function buildSettingsSchema(z) {
  const roleShape = () =>
    z.object({
      enabled: z.boolean().description('Mount the delegation tool for this role'),
      provider: z.string().description('Provider for delegated children'),
      model: z.string().description('Model id for delegated children'),
      effort: z.union([...EFFORT_LEVELS]).description('Reasoning effort for delegated children'),
      temperature: z.number().description('Sampling temperature; the per-role runtime default applies when omitted'),
      maxTokens: z.number().description('Response token budget; the per-role runtime default applies when omitted'),
      tools: z.array(z.union([...TOOL_NAMES])).description('Explicit global-tool allow list (deny-only semantics is the default)'),
      deny: z.array(z.union([...TOOL_NAMES])).description('Global tools this role must never use'),
      mcps: z.array(z.string()).description('MCP servers this role may connect to'),
      personaAppend: z.string().description('Extra persona text appended for this role'),
    });
  const presetShape = () =>
    z.object({
      orchestrator: z.object({
        effort: z.union([...EFFORT_LEVELS]).description('Reasoning effort for the orchestrator'),
        mcps: z.array(z.string()).description('MCP servers for the orchestrator'),
      }),
      ...Object.fromEntries(ROLE_IDS.map((roleId) => [roleId, roleShape()])),
    });
  return z.object({
    preset: z.string().description('Which named preset in `presets` to use'),
    webFetch: z.boolean().description('Register the web_fetch tool for preset sessions (requires the web-fetch-http provider; see README "进阶配置")'),
    presets: z.dict(presetShape()).description('Role overrides keyed by preset name'),
    mcpServers: z.dict(
      z.object({
        transport: z.union([...MCP_TRANSPORTS]).description('MCP transport type'),
        url: z.string().description('streamable-http endpoint url'),
        command: z.string().description('stdio launch command'),
        args: z.array(z.string()).description('stdio launch arguments'),
        env: z.dict(z.string()).description('stdio environment variables'),
      }),
    ).description('MCP server definitions merged over the bundled defaults'),
    advanced: z.object({
      roles: z.dict(roleShape()).description('Per-role overrides applied on top of the preset layer; hidden runtime parameters live here'),
    }),
  });
}
