// preset/roles.js — one role-bound delegation tool per specialist role.
//
// History. In DSH 0.1.x this preset shipped its own fork of
// @deepseek-ai/dsh-tool-subagent ("role-subagent.js") for exactly one reason: the
// stock plugin renders the same generic description for every instance, so the
// six role tools were indistinguishable to the orchestrator model. DSH 0.2.0
// makes that fork unnecessary and harmful:
//
//   * the tool description is still assembled inside the stock plugin (no
//     config hook for it), but the stock plugin is now an ordinary importable
//     module exporting \`{ name, inject, apply, Config }\`, and
//   * its config keys are ignored unless it knows them, while a plugin object
//     WITHOUT a \`Config\` schema receives its raw YAML config untouched
//     (cordis resolveConfig: "the validated config, or config unchanged if the
//     runtime has no schema").
//
// So this row is a thin wrapper: it reads the role facts from \`config.definition\`,
// composes the role persona (with the machine-readable role marker the rest of
// the preset keys on), and then calls the HOST's own \`apply\` with a stock-shaped
// config. Because the wrapper declares no schema, the extra \`definition\` key
// reaches us instead of being dropped, and no behavior is duplicated: provider
// lifecycle checks, continuable routing, toolFilter forwarding, and the
// \`subagent/provider-added\` wait all remain the host's implementation.
//
// The one thing that must be replaced is the registered description. The stock
// plugin registers through \`runtimeCtx.tools.register(...)\`, so while applying
// we hand it a context whose \`tools\` property resolves to a proxy of the real
// ToolRuntime, intercepting only \`register\` for the single tool name this role
// owns. Service identity is preserved by forwarding ordinary property reads to
// the real runtime instance (so \`this\` inside the called method is the real one).

import { AsyncLocalStorage } from 'node:async_hooks';
import { hostImport } from './bridge.js';
import { patchRoleTool, patchRoleSection } from './role-wording.js';
import { loadConfig, roleDefaults, bindProfileContext } from './config.js';

/** Cordis plugin name. */
export const name = 'omds-role-subagent';
/** \`loader\` is the only host handle this wrapper needs; the rest of the official
 * inject list is declared by the official plugin the wrapper delegates to. */
/**
 * Services this wrapper needs. `loader` is ours (host module resolution);
 * the other three belong to the stock implementation we delegate to — the
 * stock `apply` reads `ctx.tools`, `ctx.subagents`, `ctx.systemPrompt`, and
 * `ctx.sessionProjections` through the context we hand it, and Cordis refuses
 * those reads unless this fiber injects them.
 */
export const inject = ['loader', 'tools', 'subagents', 'systemPrompt', 'sessionProjections'];

/** Prefix of the machine-readable role marker carried inside every role persona. */
export const ROLE_MARKER_PREFIX = 'oh-my-dsh-slim-role:';

/** Stock background note, so a wrapped tool advertises the same lifecycle. */
// Lifecycle, route-selection and provider wording are retained from the host
// definition below rather than duplicated here.

/** The role table: the preset's product surface, one entry per delegation tool. */
export const ROLE_TABLE = Object.freeze({
  oracle: Object.freeze({
    roleId: 'oracle',
    toolName: 'subagent_oracle',
    title: 'oracle',
    description: "Strategic technical advisor. Use for architecture decisions, complex debugging, code review, simplification, and engineering guidance.",
  }),
  designer: Object.freeze({
    roleId: 'designer',
    toolName: 'subagent_designer',
    title: 'designer',
    description: "UI/UX design, review, and implementation. Use for styling, responsive design, component architecture and visual polish.",
  }),
  fixer: Object.freeze({
    roleId: 'fixer',
    toolName: 'subagent_fixer',
    title: 'fixer',
    description: "Fast implementation specialist. Receives complete context and task spec, executes code changes efficiently.",
  }),
  explorer: Object.freeze({
    roleId: 'explorer',
    toolName: 'subagent_explorer',
    title: 'explorer',
    description: "Fast codebase search and pattern matching. Use for finding files, locating code patterns, and answering 'where is X?' questions.",
  }),
  librarian: Object.freeze({
    roleId: 'librarian',
    toolName: 'subagent_librarian',
    title: 'librarian',
    description: "External documentation and library research. Use for official docs lookup, GitHub examples, and understanding library internals.",
  }),
  observer: Object.freeze({
    roleId: 'observer',
    toolName: 'subagent_observer',
    title: 'observer',
    description: "Visual analysis. Use for interpreting images, screenshots, and diagrams - extracts structured observations without loading raw files into main context. Requires a vision-capable model.",
  }),
});

/** Every role id, in table order. */
/**
 * One line per mounted role, used by the startup notice and the settings report.
 * @param config - a resolved role, or a raw row config.
 */
export function advertisedRoles() {
  return roleIds().map((roleId) => {
    const row = ROLE_TABLE[roleId];
    let resolved;
    try {
      resolved = loadConfig().roles[roleId] ?? {};
    } catch {
      resolved = {};
    }
    const flag = resolved.enabled === false ? ' (disabled)' : '';
    return row.toolName + ' <- ' + row.title + flag;
  }).join('; ');
}

export function roleIds() {
  return Object.keys(ROLE_TABLE);
}

function text(value) {
  return typeof value === 'string' && value.length > 0;
}

function joinSections(parts) {
  return parts.filter((part) => text(part)).join('\n\n');
}

/**
 * Whether the plugin shape is a constructor-based Cordis plugin (class).
 * @param value - a resolved plugin export.
 */
function isClass(value) {
  return typeof value === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

/** Human line for one role, used in diagnostics and the settings report. */
export function describeRole(row, roleConfig) {
  const model = roleConfig?.model ?? 'inherited';
  const effort = roleConfig?.effort ?? 'adapter default';
  return row.title + ' -> ' + row.toolName + ' [' + model + ' / ' + effort + ']';
}

/**
 * Whether this role is switched on: the preset default (\`definition.enabled\`)
 * unless the user configuration decides it.
 * @param config - the raw row config.
 * @param roleConfig - the user's per-role entry, when present.
 * @param roleDefaultsEntry - the shipped per-role default.
 */
export function roleEnabled(config, roleConfig, roleDefaultsEntry) {
  const definition = config.definition ?? {};
  if (typeof definition.enabled === 'boolean') return definition.enabled;
  if (typeof roleConfig?.enabled === 'boolean') return roleConfig.enabled;
  if (typeof roleDefaultsEntry?.enabled === 'boolean') return roleDefaultsEntry.enabled;
  return true;
}

/**
 * Compose the child persona: the role marker first (so it survives any later
 * truncation), then the role body, then the user's append and the row persona.
 */
export function composeRolePersona(roleId, body, personaAppend, rowPersona) {
  return joinSections([
    'Internal role id: ' + ROLE_MARKER_PREFIX + roleId + '.',
    body,
    personaAppend,
    rowPersona,
  ]);
}

/**
 * Read a \`subagent/descriptor\` event out of a session event list and return the
 * role id embedded in its persona, or undefined.
 * @param events - a session event array.
 */
export function roleIdFromEvents(events) {
  if (!Array.isArray(events)) return undefined;
  for (const event of events) {
    if (!event || event.type !== 'subagent/descriptor') continue;
    const persona = event.data?.persona;
    if (!text(persona)) continue;
    const at = persona.indexOf(ROLE_MARKER_PREFIX);
    if (at < 0) continue;
    const tail = persona.slice(at + ROLE_MARKER_PREFIX.length);
    const match = /^[a-z][a-z0-9_-]*/.exec(tail);
    if (match !== null) return match[0];
  }
  return undefined;
}

/**
 * The role a running session belongs to, or undefined for the orchestrator.
 *
 * Two signals, cheapest first: the live agent options (kept for hosts that
 * still carry a plugin-private role field), then the persona marker the child
 * descriptor persists — that path also covers cold-resumed children, whose
 * runtime options no longer carry anything role-specific.
 * @param agent - a live agent (\`payload.agent\` in the agent/request waterfall).
 */
export function roleIdForAgent(agent) {
  const options = agent?.options;
  if (options !== null && options !== undefined && typeof options === 'object') {
    const declared = options.dshRoleId;
    if (text(declared) && ROLE_TABLE[declared] !== undefined) return declared;
  }
  const session = agent?.session;
  // Forks include their parent's descriptor in the inherited prefix. Only the
  // child's own descriptor identifies its role (including on cold resume).
  const events = typeof session?.ownEvents === 'function' ? session.ownEvents()
    : typeof session?.snapshotEvents === 'function' ? session.snapshotEvents(session.inheritedEventCount ?? 0)
    : session?.events;
  return roleIdFromEvents(events);
}

/**
 * True when a live agent is a delegated child rather than the orchestrator.
 *
 * DSH 0.2.0 marks the child session header with `origin: 'subagent'` and a
 * `delegationDepth`; the two option fields are kept for hosts that still
 * carry the 0.1.x shape.
 * @param agent - a live agent.
 */
export function isSubagent(agent) {
  const header = agent?.session?.header;
  if (header !== null && header !== undefined) {
    if (header.origin === 'subagent') return true;
    if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return true;
  }
  const options = agent?.options;
  if (options !== null && options !== undefined && typeof options === 'object') {
    if (typeof options.subagentDepth === 'number') return true;
    if (typeof options.dshRoleId === 'string') return true;
  }
  return false;
}

/**
 * Build the stock-shaped config handed to the host's own tool-subagent \`apply\`.
 *
 * Everything the host understands is preserved from the row config; only the
 * keys it does not know are dropped, and the per-role facts are added on top.
 * @returns the config for the host implementation.
 */
export function stockConfig(config, context) {
  const { definition, ...rest } = config ?? {};
  const agentOptions = Object.keys(context.agentOptions).length > 0 ? context.agentOptions : rest.agentOptions;
  return {
    ...rest,
    // The tool name is the whole point of a role row: without it the stock
    // implementation registers its default `subagent` tool and the role name
    // never reaches the model.
    toolName: context.toolName,
    ...(agentOptions === undefined ? {} : { agentOptions }),
    persona: context.persona,
    ...(context.toolFilter === undefined ? {} : { toolFilter: context.toolFilter }),
  };
}

/**
 * The resolved per-role request shape, derived from the row config, the user
 * configuration, and the shipped defaults.
 * @param config - the raw row config (id/name/config from the preset).
 */
export function resolveRole(config, ctx) {
  if (config === null || config === undefined || typeof config !== 'object') {
    throw new Error('oh-my-dsh-slim: a role row needs a config object with a \`definition\`');
  }
  const definition = config.definition ?? {};
  const row = ROLE_TABLE[definition.roleId];
  if (row === undefined) {
    throw new Error('oh-my-dsh-slim: unknown role "' + String(definition.roleId) + '"; known roles: ' + roleIds().join(', '));
  }
  const preset = loadConfig(ctx);
  const roleConfig = preset.roles[row.roleId] ?? {};
  const shipped = roleConfig;
  const agentOptions = {};
  const model = roleConfig.model ?? config.agentOptions?.model;
  if (text(model)) agentOptions.model = model;
  const provider = roleConfig.provider ?? config.agentOptions?.provider;
  if (text(provider)) agentOptions.provider = provider;
  // The host's agentOptions.reasoningEffort is where a child route takes its
  // effort: the shipped per-role effort in defaults.json is dead weight unless
  // it is forwarded here, and `effort` is deliberately passed through as an
  // adapter-owned token rather than checked against a baked-in vocabulary.
  const effort = roleConfig.effort ?? shipped.effort ?? config.agentOptions?.reasoningEffort;
  if (text(effort) && effort !== 'none') agentOptions.reasoningEffort = effort;
  else if (text(config.agentOptions?.reasoningEffort)) agentOptions.reasoningEffort = config.agentOptions.reasoningEffort;
  const maxTokens = roleConfig.maxTokens ?? config.agentOptions?.maxTokens;
  if (typeof maxTokens === 'number') agentOptions.maxTokens = maxTokens;
  const persona = composeRolePersona(row.roleId, definition.persona, roleConfig.personaAppend, config.persona);
  const allow = Array.isArray(roleConfig.tools) && roleConfig.tools.length > 0 ? roleConfig.tools : definition.allow;
  const deny = [...new Set([
    ...(Array.isArray(definition.deny) ? definition.deny : []),
    ...(Array.isArray(roleConfig.deny) ? roleConfig.deny : []),
  ])];
  const toolFilter = allow === undefined && deny.length === 0 ? undefined : { ...(allow === undefined ? {} : { allow }), ...(deny.length === 0 ? {} : { deny }) };
  const toolName = text(definition.toolName) ? definition.toolName : row.toolName;
  return {
    row,
    roleId: row.roleId,
    toolName,
    description: text(definition.description) ? definition.description : row.description,
    enabled: roleEnabled(config, roleConfig, shipped),
    persona,
    agentOptions,
    toolFilter,
    mcps: roleConfig.mcps ?? [],
    stock: stockConfig(config, { agentOptions, persona, toolFilter, toolName }),
    config,
  };
}

/**
 * Intercept the single tool registration this role owns and give it the role's
 * own model-facing description. Ordinary property reads fall through to the
 * real ToolRuntime, so \`this\` inside the called methods stays bound correctly.
 */
export function fitFilterToKnown(filter, known) {
  if (filter === undefined || known === undefined) return filter;
  const names = new Set(known);
  return { ...(filter.allow === undefined ? {} : { allow: filter.allow.filter(name => names.has(name)) }), ...(filter.deny === undefined ? {} : { deny: filter.deny.filter(name => names.has(name)) }) };
}
export function patchedContext(ctx, seen, wanted, agents = new WeakMap(), execution = new AsyncLocalStorage(), scopeOf = () => undefined) {
  const wrapAgent = (agent) => {
    if (!agent || typeof agent !== 'object') return agent;
    if (!agents.has(agent)) agents.set(agent, new Proxy(agent, {
      get(target, property, receiver) {
        return property === 'ctx' ? patchedContext(target.ctx, seen, wanted, agents, execution, scopeOf) : Reflect.get(target, property, receiver);
      },
    }));
    return agents.get(agent);
  };
  const runtime = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools;
  if (runtime === undefined || runtime === null) return ctx;
  const wordingOptions = () => {
    const config = wanted.stock ?? wanted.config ?? {};
    const subagents = config.provider === undefined ? undefined : (typeof ctx.get === 'function' ? ctx.get('subagents') : ctx.subagents);
    return { ...config, toolName: wanted.toolName, description: wanted.description,
      mcps: wanted.mcps ?? [],
      inheritsParentContext: subagents?.getProvider?.(config.provider)?.inheritsParentContext === true,
    };
  };
  const promptProxy = service => !service || typeof service !== 'object' ? service : new Proxy(service, {
    get(target, property) {
      if (property === 'section') return section => target.section(patchRoleSection(section, wordingOptions()));
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const wrapper = {
    get(target, property, receiver) {
      if (property !== 'register') {
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (definition) => {
        const tool = definition;
        if (tool === null || tool === undefined || typeof tool !== 'object' || tool.name !== wanted.toolName) {
          return Reflect.apply(target.register, target, [definition]);
        }
        seen.patched = true;
        const patched = patchRoleTool(tool, wordingOptions());
        return Reflect.apply(target.register, target, [{ ...patched,
          execute: (args, exec) => execution.run(exec?.agent, () => tool.execute(args, exec)),
        }]);
      };
    },
  };
  return new Proxy(ctx, {
    get(target, property, receiver) {
      if (property === 'tools') return new Proxy(runtime, wrapper);
      if (property === 'systemPrompt') return promptProxy(target.get?.('systemPrompt') ?? target.systemPrompt);
      if (property === 'subagents') {
        const service = target.get?.('subagents') ?? target.subagents;
        if (!service || typeof service !== 'object') return service;
        return new Proxy(service, { get(registry, key) {
          const value = Reflect.get(registry, key);
          if (key !== 'start' && key !== 'startContinuable') return typeof value === 'function' ? value.bind(registry) : value;
          return (...args) => {
            const parent = execution.getStore();
            const tools = parent?.ctx?.get?.('tools') ?? parent?.ctx?.tools;
            const known = tools?.view?.(scopeOf(parent?.ctx))?.restrictableNames;
            return Reflect.apply(value, registry, args.map(arg => {
              if (!arg || typeof arg !== 'object') return arg;
              // start(provider, request) uses the direct filter; startContinuable
              // uses spec.request.toolFilter. Never mutate the stock request.
              if (key === 'startContinuable' && arg.request?.toolFilter !== undefined) {
                return { ...arg, request: { ...arg.request, toolFilter: fitFilterToKnown(arg.request.toolFilter, known) } };
              }
              return arg.toolFilter === undefined ? arg : { ...arg, toolFilter: fitFilterToKnown(arg.toolFilter, known) };
            }));
          };
        } });
      }
      if (property === 'inject') return (dependencies, callback) => target.inject(dependencies,
        (scope, config) => callback(patchedContext(scope, seen, wanted, agents, execution, scopeOf), config));
      if (property === 'get') return (serviceName, ...args) => {
        const service = target.get(serviceName, ...args);
        if (serviceName === 'systemPrompt') return promptProxy(service);
        if (serviceName === 'tools') return !service || typeof service !== 'object' ? service : new Proxy(service, wrapper);
        if (serviceName !== 'agents' || !service) return service;
        return new Proxy(service, {
          get(registry, key) {
            if (key === 'list') return (...listArgs) => registry.list(...listArgs).map(wrapAgent);
            const value = Reflect.get(registry, key);
            return typeof value === 'function' ? value.bind(registry) : value;
          },
        });
      };
      if (property === 'on') return (event, callback, ...args) => target.on(event,
        event === 'agent/created' || event === 'agent/disposed'
          ? function (payload, ...rest) { return callback.call(this, { ...payload, agent: wrapAgent(payload.agent) }, ...rest); }
          : callback, ...args);
      try {
        return Reflect.get(target, property, receiver);
      } catch (error) {
        // The stock implementation reads services this wrapper has no reason to
        // declare (llm, sessions, agents, subagentModelSelection). `ctx.get(name)`
        // resolves a provided service without the inject requirement, which is
        // exactly the freedom a delegating wrapper needs; anything else rethrows.
        const service = typeof target.get === 'function' ? target.get(property) : undefined;
        if (service !== undefined) return service;
        throw error;
      }
    },
  });
}

/** Import the host's own tool-subagent implementation through the host loader. */
async function loadStock(ctx) {
  const host = await hostImport(ctx, '@deepseek-ai/dsh-tool-subagent');
  if (host === null || host === undefined || typeof host.apply !== 'function') {
    throw new Error('oh-my-dsh-slim: the host does not expose @deepseek-ai/dsh-tool-subagent/apply; this DSH build is not supported by preset roles');
  }
  return host;
}

/**
 * The Cordis plugin returned by this module for one role row.
 *
 * Exported (rather than only reachable through the default \`apply\`) so a
 * companion row can bind a role tool without going through the file row.
 */
export function createRolePlugin(rawConfig) {
  return {
    name,
    inject,
    async apply(ctx) {
      bindProfileContext(ctx, rawConfig.profileId);
      const role = resolveRole(rawConfig, ctx);
      if (!role.enabled) {
        ctx.logger?.info?.('oh-my-dsh-slim: role "' + role.roleId + '" is disabled by configuration; its tool is not mounted');
        return;
      }
      const stock = await loadStock(ctx);
      const { scopeOf } = await hostImport(ctx, '@deepseek-ai/dsh-scope');
      const seen = { patched: false };
      // Mount through Cordis so host registrations/listeners share the stock
      // fiber's lifetime and declared dependencies, including scoped installs.
      await ctx.plugin({
        name: stock.name,
        inject: stock.inject,
        apply(stockCtx) {
          const scoped = patchedContext(stockCtx, seen, role, undefined, undefined, scopeOf);
          if (isClass(stock)) return new stock(scoped, role.stock);
          return stock.apply(scoped, role.stock, undefined);
        },
      });
      if (text(rawConfig.definition?.advertisement)) {
        ctx.systemPrompt.section({
          name: 'ad:' + role.toolName,
          order: 116.45,
          text: context => !seen.patched || ctx.tools.get(role.toolName, context.scope) === undefined
            ? '' : rawConfig.definition.advertisement,
        });
      }
      if (!seen.patched) {
        ctx.logger?.warn?.('oh-my-dsh-slim: the host did not register "' + role.toolName + '"; the role tool keeps the host description');
      }
    },
  };
}

/** Cordis entry point: the plugin object for this row's config. */
export function apply(ctx, config) {
  const plugin = createRolePlugin(config);
  return ctx.plugin(plugin, config);
}
