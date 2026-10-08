// Model-facing wording from upstream 0.5.3; native execution remains untouched.
export function providerWording(inheritsConversation) {
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

function lifecycle(options) {
  const backgroundEnabled = options.enableRunInBackground !== false;
  const continuable = (options.backgroundMode ?? 'one-shot') === 'continuable';
  const mcpServerNames = options.mcps ?? [];
  const mcpToolList = mcpServerNames.map((serverName) => `mcp__${serverName}__*`).join('/');
  const foregroundMcpNote = backgroundEnabled && continuable && mcpServerNames.length > 0
    ? {
      description: ` Foreground runs (\`run_in_background: false\`) do not mount this role's MCP tools (${mcpToolList}); when the task needs MCP research, keep the run in the background and follow up with \`send_message\`.`,
      result: `(foreground run: this role's MCP tools (${mcpToolList}) were not mounted; prefer background + send_message when you need MCP research)`,
    }
    : undefined;
  return { backgroundEnabled, continuable, foregroundMcpNote };
}

export function roleDescription(options) {
  const wording = providerWording(options.inheritsParentContext === true);
  const { backgroundEnabled, continuable, foregroundMcpNote } = lifecycle(options);
  return [wording.description, options.description]
    .filter((text) => typeof text === 'string' && text.length > 0).join(' Role profile: ')
    + (backgroundEnabled
      ? continuable
        ? ' This tool runs in the background by default, immediately returns a durable subagent id, and keeps the child conversation available for later turns. When that run settles, the runtime sends the parent a notice containing its outcome and any final assistant message; `send_message` starts a later turn in the same child conversation. Set `run_in_background: false` only when the user explicitly asked to wait in place — a foreground run locks this conversation until the child returns and makes the child one-shot (no send_message follow-up, no carried context).'
        : ' This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.'
      : ' This call waits for the subagent and returns its result.')
    + (foregroundMcpNote?.description ?? '');
}

export function schedulingDescription(continuable) {
  return continuable
    ? 'Whether to run in the background and return a durable subagent id immediately. Defaults to true. Set false only when the user explicitly asked to wait in place — a foreground run locks this conversation until the child returns and makes the child one-shot (no send_message follow-up).'
    : 'Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill.';
}

export function backgroundSection(toolName) {
  return `Use ${toolName} in the background by default. Start independent delegations together in one assistant message and continue useful work while they run. After launching background lanes, end your turn with a brief status note — do not poll their state with repeated tool calls; when a run settles, the runtime sends you a notice containing its outcome, which wakes you to reconcile it. Set \`run_in_background: false\` only when the user explicitly asked to wait in place — a foreground run locks this conversation until the child returns and makes the child one-shot (no send_message follow-up, no carried context). For MCP-backed roles (subagent_librarian), foreground runs do not mount the context7/gh_grep MCP tools — keep them in the background and follow up with send_message.`;
}

/** Patch only one role definition, preserving the native executable contract. */
export function patchRoleTool(tool, options) {
  if (!tool || tool.name !== options.toolName) return tool;
  const parameters = { ...tool.parameters };
  if (parameters.prompt) parameters.prompt = { ...parameters.prompt, description: providerWording(options.inheritsParentContext === true).promptDescription };
  if (parameters.run_in_background) parameters.run_in_background = { ...parameters.run_in_background, description: schedulingDescription((options.backgroundMode ?? 'one-shot') === 'continuable') };
  // New rc.2 route fields remain native; retain their corresponding description
  // only when those fields actually exist on this tool.
  const routeStart = tool.description?.indexOf(' Child LLM selection is optional.');
  const routeNote = parameters.provider && parameters.model && routeStart >= 0 ? tool.description.slice(routeStart) : '';
  const patched = { ...tool, parameters, description: roleDescription(options) + routeNote };
  const { foregroundMcpNote } = lifecycle(options);
  if (foregroundMcpNote && tool.output?.render) {
    patched.output = { ...tool.output, render(args, value) {
      const rendered = tool.output.render.call(tool.output, args, value);
      if (value.kind !== 'foreground') return rendered;
      const append = blocks => {
        const result = blocks.slice();
        const last = result.findLastIndex(block => block.type === 'text');
        if (last >= 0) result[last] = { ...result[last], text: result[last].text + '\n' + foregroundMcpNote.result };
        else result.push({ type: 'text', text: foregroundMcpNote.result });
        return result;
      };
      return rendered instanceof Promise ? rendered.then(append) : append(rendered);
    } };
  }
  return patched;
}

/** Preserve native mounted/tool-visible guards; replace only this role's text. */
export function patchRoleSection(section, options) {
  if (!section || section.name !== 'tool:' + options.toolName) return section;
  const { backgroundEnabled, continuable } = lifecycle(options);
  if (!backgroundEnabled || !continuable) return section;
  return { ...section, text(context) {
    const visible = typeof section.text === 'function' ? section.text(context) : section.text;
    return visible ? backgroundSection(options.toolName) : '';
  } };
}
