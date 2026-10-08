import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../npm-package/preset/subagent-roles.js';

test('request listeners reject foreign preset composition scopes including bundled listener', async () => {
 const handlers = [];
 const scope = { scopeOf: ctx => ctx?.composition, scopeChainOf: composition => composition === undefined ? [] : [composition] };
 const profiles = { a: { roles: { oracle: { temperature: 0.2, effort: 'none' } } }, b: { roles: { oracle: { temperature: 0.8, effort: 'none' } } } };
 const make = (composition, profileId) => ({
  composition,
  loader: { config: { bareModuleBaseUrl: new URL('../npm-package/', import.meta.url).href }, internal: { import: async () => scope } },
  get: key => key === 'omdsProfiles' ? { read: id => profiles[id] } : undefined,
  effect: factory => factory(), on: (event, handler) => { handlers.push(handler); return () => {}; },
 });
 apply(make('bundled'), {}); apply(make('a', 'a'), { profileId: 'a' }); apply(make('b', 'b'), { profileId: 'b' });
 const agent = composition => ({ ctx: { composition }, session: { header: { origin: 'subagent', delegationDepth: 1 }, ownEvents: () => [{ type: 'subagent/descriptor', data: { persona: 'Internal role id: oh-my-dsh-slim-role:oracle.', mode: 'continuable' } }] } });
 const run = payload => handlers.reduceRight((next, handler) => () => handler(payload, next), async () => ({ temperature: 0.4, reasoningEffort: 'high' }))();
 const [a, b] = await Promise.all([run({ agent: agent('a') }), run({ agent: agent('b') })]);
 assert.equal(a.temperature, 0.2); assert.equal(b.temperature, 0.8);
 assert.equal(a.reasoningEffort, 'high'); assert.equal(b.reasoningEffort, 'high');
});
