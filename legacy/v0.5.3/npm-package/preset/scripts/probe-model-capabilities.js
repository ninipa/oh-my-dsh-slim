// probe-model-capabilities — zero-cost model modality probe. Boots the
// composed tree, then lists every registered provider's models with their
// declared inputModalities, plus exact resolveModelInfo for key routes.
// Never sends a model request. Answers: does mimo-v2.5 (observer's model)
// declare "image" input on this host? Which main-model candidates would pass
// the api-proxy attachment gate?
export const name = 'probe-model-capabilities';
export const inject = [];

export function apply(ctx) {
  const exit = ctx.get('appExit');
  if (exit === void 0) throw new Error('probe-model-capabilities: appExit missing');
  run(ctx).then(
    (code) => exit(code),
    (error) => {
      process.stderr.write(`probe-model-capabilities failed: ${error?.stack ?? String(error)}\n`);
      exit(1);
    },
  );
}

async function run(ctx) {
  await ctx.get('loader')?.await();
  const llm = ctx.get('llm');
  if (llm === void 0) {
    process.stderr.write('llm service not mounted\n');
    return 1;
  }
  const report = { providers: {} };
  const providerInfos = await llm.listProviders?.() ?? [];
  const providers = providerInfos.map((p) => p?.id ?? p);
  for (const provider of providers) {
    try {
      const models = await llm.listModels(provider);
      report.providers[provider] = models.map((m) => ({
        id: m.id,
        input: m.inputModalities,
        image: Array.isArray(m.inputModalities) && m.inputModalities.includes('image'),
      }));
    } catch (error) {
      report.providers[provider] = { error: String(error.message).slice(0, 160) };
    }
  }
  // Exact-route spot checks for the two decision-critical models.
  for (const [provider, model] of [['opencode-go', 'mimo-v2.5'], ['deepseek-official', 'deepseek-v4-flash']]) {
    try {
      const info = await llm.resolveModelInfo(provider, model);
      report[`${provider}/${model}`] = {
        inputModalities: info.inputModalities,
        imageCapable: Array.isArray(info.inputModalities) && info.inputModalities.includes('image'),
      };
    } catch (error) {
      report[`${provider}/${model}`] = { error: String(error.message).slice(0, 160) };
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}
