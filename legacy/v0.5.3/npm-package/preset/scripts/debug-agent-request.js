export function apply(ctx) {
  console.error('[dbg-plugin] apply called (debug-agent-request)');
  ctx.on('agent/request', async (payload, next) => {
    const agent = payload.agent;
    const o = agent?.options;
    console.error(`[dbg] agent/request agent=${agent?.id} depth=${o?.subagentDepth} opts=${JSON.stringify({ provider: o?.provider, model: o?.model, maxTokens: o?.maxTokens })}`);
    const resolved = await next();
    console.error(`[dbg]   -> config=${JSON.stringify({ provider: resolved.provider, model: resolved.model, reasoningEffort: resolved.reasoningEffort, maxTokens: resolved.maxTokens })}`);
    return resolved;
  });
}
export const name = 'debug-agent-request';
