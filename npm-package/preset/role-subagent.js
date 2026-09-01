// role-subagent.js — oh-my-dsh-slim preset companion plugin.
//
// A copy of @deepseek-ai/dsh-tool-subagent with one addition: a configurable
// `description` per role tool. The stock plugin renders the same generic
// description for every instance, so all six role tools look identical to the
// orchestrator model — the omo-slim equivalent (each agent carrying its own
// "Fast implementation specialist..." description) cannot be reproduced with
// the stock row. This plugin lets each role row advertise its lane, which is
// what the model actually reads while deciding whether to delegate.
//
// Dependency resolution: a preset directory lives under the user home where
// Node cannot reach the harness's node_modules, and bare `@deepseek-ai/*`
// imports would fail to load. The plugin therefore resolves them from the
// global DSH install via `npm root -g` (the same install the `dsh` CLI runs).
//
// All other behavior is identical to dsh-tool-subagent: provider lifecycle
// registration, foreground/continuable routing, agentOptions/persona/
// toolFilter/maxDepth forwarding.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from './config-loader.js';

function resolveDshPackage() {
  const roots = [];
  if (process.env.DSH_HOME) {
    roots.push(join(process.env.DSH_HOME, 'profiles', 'node_modules'));
    roots.push(join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules'));
  }
  const probeOptions = { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] };
  for (const command of ['npm root -g', 'zsh -lic "npm root -g"']) {
    // zsh -lic sources the user's login+interactive shell config, which can hang
    // (reported on Linux); every probe is bounded and silent on stderr.
    try {
      roots.push(execSync(command, probeOptions).trim());
      break; // first reachable npm root wins; the zsh fallback only runs when plain sh lacks npm
    } catch {}
  }
  try {
    const dshBin = realpathSync(execSync('command -v dsh', probeOptions).trim());
    const packageDir = dirname(dirname(dshBin));
    roots.push(dirname(dirname(packageDir)));
  } catch {}
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const root = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!root) throw new Error('role-subagent: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return join(root, '@deepseek-ai/dsh/package.json');
}

const require = createRequire(resolveDshPackage());
const z = require('@deepseek-ai/schemastery');
const { defineTool } = require('@deepseek-ai/dsh-tools');
const { assertSubagentMaxDepth, settleRun } = require('@deepseek-ai/dsh-subagent');
const mcpClient = require('@deepseek-ai/dsh-mcp-client');

const name = 'role-subagent';
// settings: role configuration is read from the host settings namespace
// (registered by the npm seeder); declared here because cordis blocks
// undeclared service access. On hosts without the service the accessor is
// undefined and config-loader falls back to the legacy JSON file.
const inject = ['tools', 'subagents', 'systemPrompt', 'settings'];

/**
 * Names the calling agent may legally put in a toolFilter, i.e. exactly what
 * DSH's tools.restrict() validates against (the agent scope's visible
 * registry — host-plane globals plus preset agent-plane rows like the
 * subagent_* tools). Returns undefined when the host offers no enumeration
 * (older versions): callers then pass filters through untouched.
 */
export function knownToolNames(agent) {
  try {
    const defs = agent?.ctx?.tools?.schemas?.(agent);
    if (Array.isArray(defs)) return new Set(defs.map((definition) => definition.name));
  } catch {}
  return undefined;
}

/**
 * Drop allow/deny entries the running deployment does not register. DSH
 * 0.1.1-rc.2 tools.restrict() throws on unknown names (earlier versions
 * tolerated them) and registries differ per deployment, so the configured
 * OMO-baseline intent is expressed only through tools that actually exist
 * here. With no known set the lists pass through untouched.
 */
export function fitFilterToKnown(knownNames, toolAllow, toolDenyRaw) {
  const fit = (names) => knownNames instanceof Set ? names.filter((name) => knownNames.has(name)) : names;
  const allow = toolAllow === undefined ? undefined : fit(toolAllow);
  // Foot-gun guard: an allow list whose EVERY entry is unregistered would fit
  // to `allow: []`, which hides ALL tools from the child. Fail loud with both
  // sides of the mismatch instead of silently blinding the role.
  if (Array.isArray(allow) && allow.length === 0 && Array.isArray(toolAllow) && toolAllow.length > 0) {
    const knownHint = knownNames instanceof Set ? [...knownNames].sort().join(', ') : '(unknown on this host)';
    throw new Error(
      `none of the configured tools (${toolAllow.join(', ')}) are registered on this deployment.`
      + ` Available tools: ${knownHint}. Fix the role's tools allowlist in oh-my-dsh-slim.json.`,
    );
  }
  const deny = fit(toolDenyRaw);
  return {
    ...(allow === undefined ? {} : { allow }),
    ...(deny.length === 0 ? {} : { deny }),
  };
}

/** Prompt order after bounded delegation policy and before child reporting. */
const SUBAGENT_SECTION_ORDER = 116.5;

const Config = z.object({
  roleId: z.string().required(),
  provider: z.string().required(),
  toolName: z.string().default('subagent'),
  // Role-specific model-facing description (omo-slim agent description).
  // Falls back to the stock generic wording when omitted.
  description: z.string().default(void 0),
  enableRunInBackground: z.boolean().default(true),
  backgroundMode: z.union(['one-shot', 'continuable']).default('one-shot'),
  agentOptions: z.object({
    provider: z.string(),
    model: z.string(),
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  }).default(void 0),
  persona: z.string(),
  toolFilter: z.object({
    allow: z.array(z.string()).default(void 0),
    deny: z.array(z.string()).default(void 0),
  }).default(void 0),
  maxDepth: z.union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const('provider-managed')]).default(3),
  // Orchestrator-facing routing blurb for this role, injected as a dynamic
  // system-prompt section ONLY while the role's tool is mounted. Roles that
  // are soft-disabled (enabled=false) therefore also lose their advertisement,
  // so the persona never advertises an unmounted tool.
  advertisement: z.string().default(void 0),
});

/** Render text blocks from the canonical JSON block array without trusting arbitrary values. */
function outputValueText(values) {
  return values
    .filter((value) => typeof value === 'object' && value !== null && !Array.isArray(value) && value.type === 'text' && typeof value.text === 'string')
    .map((value) => value.text)
    .join('');
}

/** Settle pending startup without rejecting the task producer contract. */
async function settleStart(start, signal) {
  try {
    return await settleRun(await start);
  } catch (error) {
    return signal.aborted && !(error instanceof AggregateError)
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) };
  }
}

/** A non-`completed` stop reason means the child did not finish cleanly. */
function stopReasonError(result) {
  switch (result.stopReason) {
    case 'completed': return;
    case 'aborted': return 'subagent run was cancelled';
    case 'error': return 'subagent run failed';
    case 'max-tokens': return 'subagent run hit its token limit before finishing';
    case 'refusal': return 'subagent declined the task';
    default: return `subagent run ended abnormally (${String(result.stopReason)})`;
  }
}

/** Append the child's preserved partial answer to a stop-reason error. */
function withPartialText(error, output) {
  const text = output.filter((block) => block.type === 'text').map((block) => block.text).join('');
  return text.length === 0 ? error : `${error}\nPartial output before the run ended:\n${text}`;
}

/** Collect and release one foreground run without letting disposal replace an independent result failure. */
async function settleForegroundRun(run) {
  const [execution] = await Promise.allSettled([run.result.then((result) => {
    const error = stopReasonError(result);
    if (error !== void 0) throw new Error(withPartialText(error, result.output));
    return { kind: 'foreground', runId: run.id, output: result.output };
  })]);
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())]);
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError([execution.reason, disposal.reason], `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`);
    }
    throw execution.reason;
  }
  if (disposal.status === 'rejected') throw disposal.reason;
  return execution.value;
}

/** Model-facing wording from the provider's conversation-history descriptor. */
function providerWording(inheritsConversation) {
  if (inheritsConversation) {
    return {
      description: 'Delegate a task to a subagent that inherits this conversation: a child agent seeded with all completed turns so far (it does not see the current in-flight turn). Use this when the subtask builds on this conversation\'s context — a follow-up analysis, a review, a continuation — without consuming this conversation\'s context for the work itself. You receive its result, not its intermediate steps.',
      promptDescription: 'The task for the subagent. It already sees this conversation\'s completed turns, so build on them freely and state only what is new.',
    };
  }
  return {
    description: 'Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work — research, a scoped implementation, an analysis — so it does not consume this conversation\'s context. The subagent returns its result, not its intermediate steps. Give it a complete, standalone prompt: it does not see this conversation.',
    promptDescription: 'The complete, self-contained task for the subagent. It does not share this conversation\'s context, so include everything it needs.',
  };
}

/** Resolve the model's optional scheduling request into one execution route. */
function resolveDelegationRun(request, options) {
  if (!options.backgroundEnabled) {
    if (request.run_in_background === true) throw new Error('run_in_background is disabled for this tool instance (enableRunInBackground: false)');
    return { runInBackground: false };
  }
  return { runInBackground: request.run_in_background ?? options.continuable };
}

function roleMarker(roleId) {
  return `oh-my-dsh-slim-role:${roleId}`;
}

function childHasRole(childCtx, roleId) {
  if (childCtx.agent?.options?.dshRoleId === roleId) return true;
  const events = childCtx.agent?.session?.events ?? [];
  return events.some((event) => event.type === 'subagent/descriptor'
    && typeof event.data?.persona === 'string'
    && event.data.persona.includes(roleMarker(roleId)));
}

function installScopedMcp(childCtx, roleId, roleConfig, servers) {
  if (!childHasRole(childCtx, roleId)) return () => {};
  const fibers = [];
  for (const serverName of roleConfig.mcps ?? []) {
    const server = servers[serverName];
    if (server === undefined) continue;
    fibers.push(childCtx.plugin(mcpClient, { ...server, serverName }));
  }
  // PLAN-BACKGROUND-DELEGATION 方案2: MCP client activation is async (connect +
  // tools/list over HTTP). The first request's tool snapshot is taken inside
  // systemPrompt.assemble() BEFORE agent/pre-step fires, so waiting on pre-step
  // cannot surface mcp__* in round one. system-prompt/assemble is a waterfall
  // AFTER the snapshot: wait for the clients there (bounded by a timeout) and
  // inject the freshly registered mcp__* schemas into assembly.tools. On
  // timeout the round proceeds without MCP and web_search covers it.
  if (fibers.length > 0) {
    const mcpWaitTimeoutMs = 10000;
    let waited = false;
    childCtx.on('system-prompt/assemble', async (assembly, context, next) => {
      if (!waited) {
        waited = true;
        await Promise.allSettled(fibers.map((fiber) => Promise.race([
          Promise.resolve(fiber),
          new Promise((resolve) => setTimeout(resolve, mcpWaitTimeoutMs)),
        ])));
        const agent = context.agent;
        if (agent?.ctx?.tools?.schemas) {
          for (const tool of agent.ctx.tools.schemas(agent)) {
            if (tool.name.startsWith('mcp__') && !assembly.tools.some((existing) => existing.name === tool.name)) {
              assembly.tools.push(tool);
            }
          }
        }
      }
      return next();
    });
  }
  // Plugins are owned by childCtx and are disposed with the child scope. The
  // returned disposer only documents ownership for setup-registry teardown.
  return () => { void fibers; };
}

function apply(ctx, config) {
  if (config.maxDepth !== 'provider-managed') assertSubagentMaxDepth(config.maxDepth);
  const loaded = loadConfig(ctx);
  const roleConfig = loaded.roles[config.roleId];
  if (roleConfig === undefined) throw new Error(`role-subagent: unknown roleId "${config.roleId}"`);
  const providerName = config.provider;
  const configuredAgentOptions = {
    provider: roleConfig.provider ?? config.agentOptions?.provider,
    model: roleConfig.model ?? config.agentOptions?.model,
    maxTokens: roleConfig.maxTokens ?? config.agentOptions?.maxTokens,
    dshRoleId: config.roleId,
  };
  if (!configuredAgentOptions.provider || !configuredAgentOptions.model || !configuredAgentOptions.maxTokens) {
    throw new Error(`role-subagent: role "${config.roleId}" has incomplete model configuration`);
  }
  const toolAllow = roleConfig.tools ?? config.toolFilter?.allow;
  const toolDeny = [...new Set([
    ...(config.toolFilter?.deny ?? []),
    ...(roleConfig.deny ?? []),
  ])];
  // DSH 0.1.1-rc.2 tools.restrict() throws when a filter names a tool that is
  // not registered (earlier versions tolerated it). Which global tools exist
  // varies per deployment (e.g. current base compositions register no `skill`
  // tool), so intersect the configured filter with the host registry at mount
  // time. The configured intent stays authoritative whenever the tool does
  // exist; on hosts without tools.view() the lists pass through untouched.
  // Raw configured filter: fitted per-execution against the live registry
  // (fitFilterToKnown) because the validating view is per-agent scope.
  const effectiveToolFilter = {
    ...(toolAllow === undefined ? {} : { allow: toolAllow }),
    ...(toolDeny.length === 0 ? {} : { deny: toolDeny }),
  };
  if (effectiveToolFilter !== undefined && effectiveToolFilter.allow === undefined && effectiveToolFilter.deny === undefined) {
    throw new Error('role-subagent: toolFilter must declare allow or deny');
  }
  const childPersona = [
    `Internal role id: ${roleMarker(config.roleId)}.`,
    config.persona,
    roleConfig.personaAppend,
  ].filter((text) => typeof text === 'string' && text.length > 0).join('\n\n');
  const effectiveRoleConfig = {
    ...roleConfig,
    agentOptions: configuredAgentOptions,
    toolFilter: effectiveToolFilter,
    persona: childPersona,
  };
  // Soft-disable gate (config-loader force-locks observer to false): a role
  // with enabled=false never mounts — no tool, no MCP setup, no prompt
  // section, no advertisement. Re-enable via the user JSON at any time.
  if (effectiveRoleConfig.enabled === false) {
    ctx.logger.warn(`role-subagent: role "${config.roleId}" is disabled by configuration; tool "${config.toolName ?? 'subagent'}" not mounted`);
    return;
  }
  const backgroundEnabled = config.enableRunInBackground !== false;
  const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable';
  // PLAN-BACKGROUND-DELEGATION 方案3: one-shot children never mount MCP (the
  // host only applies continuable setups), so a foreground call on an MCP role
  // silently loses its research tools. Do not intercept — make the cost
  // visible in the tool description and in the foreground result itself.
  // Only roles that would otherwise run continuable get the hint; an explicit
  // `backgroundMode: one-shot` configuration is the user's choice and stays
  // unannotated.
  const mcpServerNames = effectiveRoleConfig.mcps ?? [];
  const mcpToolList = mcpServerNames.map((serverName) => `mcp__${serverName}__*`).join('/');
  const foregroundMcpNote = backgroundEnabled && continuable && mcpServerNames.length > 0
    ? {
      description: ` Foreground runs (\`run_in_background: false\`) do not mount this role's MCP tools (${mcpToolList}); when the task needs MCP research, keep the run in the background and follow up with \`send_message\`.`,
      result: `(foreground run: this role's MCP tools (${mcpToolList}) were not mounted; prefer background + send_message when you need MCP research)`,
    }
    : undefined;
  const toolName = config.toolName ?? 'subagent';
  let disposeTool;
  // Runtime model validation against the user's imported provider catalog
  // (llm.listModels). Checked lazily on first delegation and cached: a model id
  // the provider does not offer fails LOUD here — naming every imported model
  // plus the vision-capable subset — instead of dying later inside the
  // provider adapter with an opaque error. A missing llm service or catalog is
  // not fatal; the downstream provider error speaks for itself.
  let validatedModel;
  const ensureModelOffered = async () => {
    validatedModel ??= await (async () => {
      try {
        const llm = ctx.get('llm');
        if (llm === void 0 || typeof llm.listModels !== 'function') return null;
        const models = await llm.listModels(configuredAgentOptions.provider);
        const ids = models.map((entry) => entry.id);
        if (ids.includes(configuredAgentOptions.model)) return null;
        const visionCapable = models
          .filter((entry) => Array.isArray(entry.inputModalities) && entry.inputModalities.includes('image'))
          .map((entry) => entry.id)
          .sort();
        return new Error(
          `model "${configuredAgentOptions.model}" is not offered by provider "${configuredAgentOptions.provider}".`
          + ` Imported models: ${ids.sort().join(', ') || '(none)'}.`
          + ` Vision-capable: ${visionCapable.join(', ') || 'none'}.`,
        );
      } catch {
        return null;
      }
    })();
    if (validatedModel instanceof Error) throw validatedModel;
  };
  const mount = (provider) => {
    if (typeof config.maxDepth === 'number' && !provider.capabilities.depthLimit) {
      throw new Error(`role-subagent: provider "${provider.name}" cannot enforce maxDepth (no depthLimit capability) — set maxDepth: 'provider-managed' to leave the recursion budget to the provider`);
    }
    const wording = providerWording(provider.inheritsParentContext);
    if (continuable && provider.prepareContinuable === void 0) {
      throw new Error(`role-subagent: provider "${provider.name}" does not support \`backgroundMode: continuable\``);
    }
    // The role description and the provider's delegation contract are
    // separate model-facing layers. Keep both: replacing the stock wording
    // hides the context-offloading benefit that helps the model route work.
    const description = [
      wording.description,
      config.description,
    ].filter((text) => typeof text === 'string' && text.length > 0).join(' Role profile: ')
      + (backgroundEnabled
        ? continuable
          ? ' This tool runs in the background by default, immediately returns a durable subagent id, and keeps the child conversation available for later turns. When that run settles, the runtime sends the parent a notice containing its outcome and any final assistant message; `send_message` starts a later turn in the same child conversation. Set `run_in_background: false` only when your next action depends on receiving the result.'
          : ' This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.'
        : ' This call waits for the subagent and returns its result.')
      + (foregroundMcpNote?.description ?? '');
    disposeTool = ctx.tools.register(defineTool({
      name: toolName,
      description,
      parameters: {
        description: {
          type: 'string',
          required: true,
          description: 'A short (3-5 word) description of the delegated task, for display.',
        },
        prompt: {
          type: 'string',
          required: true,
          description: wording.promptDescription,
        },
        ...(backgroundEnabled ? { run_in_background: {
          type: 'boolean',
          description: continuable
            ? 'Whether to run in the background and return a durable subagent id immediately. Defaults to true. Set false to wait for the result when your next action depends on it.'
            : 'Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill.',
        } } : {}),
      },
      output: {
        schema: { oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'background' },
              jobId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'continuable' },
              subagentId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              runId: { type: 'string', required: true },
              output: { type: 'array', required: true, items: { type: 'json' } },
            },
          },
        ] },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background subagent job ${value.jobId}`
          : value.kind === 'continuable'
            ? `started subagent ${value.subagentId}`
            : outputValueText(value.output) + (foregroundMcpNote ? `\n${foregroundMcpNote.result}` : ''),
      }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const parent = exec.agent;
        if (!parent) throw new Error('subagent tool requires a calling agent (exec.agent was undefined)');
        await ensureModelOffered();
        const maxDepth = typeof config.maxDepth === 'number' ? config.maxDepth : void 0;
        const request = {
          label: args.description,
          prompt: [{ type: 'text', text: args.prompt }],
          parent,
          agentOptions: effectiveRoleConfig.agentOptions,
          persona: effectiveRoleConfig.persona,
          ...(effectiveRoleConfig.toolFilter !== void 0
            ? { toolFilter: fitFilterToKnown(knownToolNames(parent), effectiveRoleConfig.toolFilter.allow, effectiveRoleConfig.toolFilter.deny) }
            : {}),
          ...(maxDepth !== void 0 ? { maxDepth } : {}),
        };
        if (resolveDelegationRun(args, { backgroundEnabled, continuable }).runInBackground) {
          if (continuable) {
            return {
              kind: 'continuable',
              subagentId: (await ctx.subagents.startContinuable({
                provider: config.provider,
                label: args.description,
                request,
                signal: exec.signal,
              })).childId,
            };
          }
          const jobs = ctx.get('jobs');
          if (jobs === void 0) throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs');
          return {
            kind: 'background',
            jobId: jobs.start({
              kind: 'subagent',
              label: args.description,
              owner: parent,
              run: () => {
                const controller = new AbortController();
                return {
                  cancel: (reason) => { controller.abort(reason ?? 'background subagent task killed'); },
                  done: settleStart(ctx.subagents.start(config.provider, { ...request, signal: controller.signal }), controller.signal),
                };
              },
            }),
          };
        }
        return settleForegroundRun(await ctx.subagents.start(config.provider, { ...request, signal: exec.signal }));
      },
    }));
  };
  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === config.provider && disposeTool === void 0) mount(provider);
  });
  ctx.on('subagent/provider-removed', (name) => {
    if (name !== config.provider || disposeTool === void 0) return;
    disposeTool();
    disposeTool = void 0;
  });
  const present = ctx.subagents.getProvider(config.provider);
  if (present !== void 0) mount(present);
  else ctx.logger.info(`subagent provider "${config.provider}" not registered yet; the "${config.toolName ?? 'subagent'}" tool will register when it appears`);
  if (effectiveRoleConfig.mcps?.length > 0) {
    const register = ctx.subagents?.registerContinuableSetup;
    if (typeof register !== 'function') {
      throw new Error('role-subagent: DSH does not expose registerContinuableSetup; cannot provide scoped MCP access safely');
    }
    register.call(ctx.subagents, (childCtx) => installScopedMcp(childCtx, config.roleId, effectiveRoleConfig, loaded.servers));
  }
  if (backgroundEnabled && continuable) {
    ctx.systemPrompt.section({
      name: `tool:${toolName}`,
      order: SUBAGENT_SECTION_ORDER,
      text: (context) => disposeTool === void 0 || ctx.tools.get(toolName, context.scope) === void 0
        ? ''
        : `Use ${toolName} in the background by default. Start independent delegations together in one assistant message and continue useful work while they run. After launching background lanes, end your turn with a brief status note — do not poll their state with repeated tool calls; when a run settles, the runtime sends you a notice containing its outcome, which wakes you to reconcile it. Set \`run_in_background: false\` only when your next action depends on that subagent's result. For MCP-backed roles (subagent_librarian), foreground runs do not mount the context7/gh_grep MCP tools — keep them in the background and follow up with send_message.`,
    });
  }
  if (config.advertisement) {
    ctx.systemPrompt.section({
      name: `ad:${toolName}`,
      order: SUBAGENT_SECTION_ORDER - 0.05,
      text: (context) => disposeTool === void 0 || ctx.tools.get(toolName, context.scope) === void 0
        ? ''
        : config.advertisement,
    });
  }
}

export { Config, apply, inject, name };
