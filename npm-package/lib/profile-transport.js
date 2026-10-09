import { hostImport } from '../preset/bridge.js';

/**
 * Register the unchanged /omds RPC protocol with the caller's injected context.
 * rc.2's rpc.handle captures the connection provider's context, which cannot
 * read its sibling webServer. The exported host register method accepts an
 * explicit owner instead: use our child so both route registration and cleanup
 * belong to the fiber that actually injected webServer. Keep all transport
 * details (admit, OperatorPeer, schemas, envelopes, abort bridge) in host code.
 */
export async function registerProfileTransport(child, handler, importHost = hostImport) {
  let active = true;
  child.effect(() => () => { active = false; }, 'oh-my-dsh-slim: transport import lifetime');
  const { HostConnectionService } = await importHost(child, '@deepseek-ai/dsh-client-connection');
  if (!active) return;
  const register = HostConnectionService?.prototype?.register;
  if (typeof register !== 'function') {
    throw new Error('oh-my-dsh-slim: host connection does not expose its native RPC registration method');
  }
  return register.call(child.connection, child, '/omds', handler);
}
