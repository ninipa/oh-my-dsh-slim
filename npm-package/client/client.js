// oh-my-dsh-slim settings card — the browser half of the npm package.
//
// A hand-written ModuleLoader bundle (PLAN-CONFIG-CARD.md §2): no build chain,
// no JSX. React and the UI primitives are host-provided platform seeds; the
// settings namespace is registered by the host half (lib/index.js) with the
// shipped defaults.json as its BASE layer, so the bundled profile is edited as
// the USER layer only — a field written back equal to the base value is unset
// (inherits) rather than stored.
//
// Multi-preset profiles: the card exposes a roster of native agent presets
// (bundled "极简角色委派" + the user's custom profiles) behind the /omds RPC.
// The dropdown only picks WHICH configuration is being edited; which preset a
// new session actually runs is DSH's own agent-preset picker + default
// setting. The bundled profile writes through the settings namespace (hot,
// conflict-fenced); custom profiles write their config snapshot (profile.json
// beside the native preset directory) through profile-save with a revision
// fence, and creating one first copies the bundled preset under a generated
// stable id (display name only — no id field, no pinyin/translation deps).
window.__ModuleLoader__.load({
  id: 'oh-my-dsh-slim',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const ui = require('@deepseek-ai/dsh-client-ui-primitives');

    const NS = 'oh-my-dsh-slim';
    const ROLE_IDS = ['oracle', 'designer', 'fixer', 'explorer', 'librarian', 'observer'];
    const EFFORTS = ['none', 'off', 'low', 'medium', 'high', 'max'];
    // Fields the card manages on the preset layer (inherit-or-override vs the
    // base) and on the advanced layer (user-only; no shipped default).
    const PRESET_FIELDS = ['enabled', 'provider', 'model', 'effort'];
    const ADVANCED_FIELDS = ['maxTokens', 'temperature'];

    // Profile management lives behind the /omds RPC (registered by the seeder
    // host half on the same loopback channel as provider-status). The card
    // never writes a native preset directory itself — no id field, no path,
    // just the display name the user types.
    const BUNDLED_PROFILE_ID = 'oh-my-dsh-slim';
    const BUNDLED_PROFILE_NAME = '极简角色委派';
    const NEW_PROFILE_SENTINEL = '__new__';
    const PROFILE_RPC_PATH = '/omds';
    const PROFILE_RPC_METHODS = Object.freeze({
      list: 'profile-list',
      create: 'profile-create',
      save: 'profile-save',
      setDefault: 'profile-set-default',
    });

    const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Modal', 'Toast', 'IconCheckOutline16', 'IconWarningOutline16'];
    // Stable fallbacks for the settings snapshot fields: each render must NOT
    // mint a new object for values used in effect dependencies (a fresh {}
    // per render would refire the roster-load effect forever).
    const EMPTY_BASE = Object.freeze({});
    const EMPTY_EFFECTIVE = Object.freeze({});
    const EMPTY_USER = Object.freeze({});

    function missingPrimitives(mod, required = REQUIRED_PRIMITIVES) {
      return required.filter((name) => mod[name] === undefined);
    }

    // ---------------------------------------------------------------- locale
    const zh = {
      desc: '专家角色Subagent委派预设和设置。',
      orchestratorNote: 'orchestrator 即当前会话主模型：在对话输入框的模型选择器中更换，默认模型在 设置-模型 维护。',
      webFetch: 'web_fetch 工具',
      webFetchBenefit: '开启后模型可直接抓取目标网页原文，减少反复搜索拼凑片段。',
      webFetchRestart: '变更需重启 DSH 生效。',
      webFetchRisk: 'SSRF 风险：provider 无内网防护，勿在可触达敏感内网的部署开启。',
      webFetchProviderMissing: '未检测到 provider：需安装 web-fetch-http（README「进阶配置」）后重启。',
      webFetchProviderUnknown: '无法检测 provider 状态，开启前请确认已安装 provider。',
      enabled: '启用',
      model: '模型',
      effort: '思考强度',
      effortNoneHint: '不向模型传递 reasoningEffort 参数，适用于不支持思考强度的模型。',
      advanced: '高级',
      advancedWarn: '非必要不要修改默认值，可能改变插件行为。',
      maxTokens: 'token 上限',
      temperature: '温度',
      observerLocked: '本版本锁定：待上游支持委派附件转发（deepseek-harness #4297）后重新评估。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      dirty: '有未保存更改',
      reset: '恢复默认',
      resetConfirm: '确认恢复默认？',
      resetDone: '已恢复默认',
      effectiveHint: '思考强度与温度对当前会话立即生效；模型、token 上限与角色启停从新会话开始生效。',
      readOnly: '当前连接只读，无法在此修改配置。',
      modelsLoading: '模型目录加载中…',
      modelsEmpty: '未发现可用模型：请先在 设置-模型 导入 provider。',
      modelsError: '模型目录加载失败，重开设置页可重试。',
      currentValueTag: '当前值',
      invalidMaxTokens: '需为正整数',
      invalidTemperature: '需在 0–2 之间',
      roleOracle: '架构 / 攻坚 / 代码审查（只读）',
      roleDesigner: 'UI/UX 与视觉实现（可写）',
      roleFixer: '代码实现、修复与重构（可写）',
      roleExplorer: '代码库扫描与调研（只读）',
      roleLibrarian: '外部文档检索（context7 / gh_grep）',
      roleObserver: '视觉分析（本版锁定）',
      profile: '委派配置',
      bundledProfile: '极简角色委派',
      newProfile: '新建配置',
      newProfileHint: '点击后直接下方修改，记得保存',
      draft: '草稿',
      newSessionDefault: '新会话默认',
      setNewSessionDefault: '设为新会话默认',
      selectionHint: '这里只编辑配置，不会切换当前会话；实际用哪个预设由 Agent 预设选择器决定。',
      draftNote: '正在编辑新配置草稿，保存时命名',
      nameTitle: '命名配置',
      nameDescription: '仅填写显示名称，配置 ID 将自动生成且不再改变。',
      displayName: '显示名称',
      nameRequired: '请输入显示名称。',
      nameTooLong: '显示名称不能超过 64 个字符。',
      nameConflict: '该显示名称已存在，请换一个。',
      create: '创建并保存',
      cancel: '取消',
      discard: '放弃更改',
      saveAndSwitch: '保存后切换',
      switchTitle: '有未保存更改',
      switchDescription: '切换配置会离开当前编辑内容。要先保存吗？',
      profileUnavailable: '当前宿主未提供配置列表接口，自定义配置暂不可保存。',
      profileListFailed: '配置列表读取失败。',
      profileSaveFailed: '配置保存失败，请检查后重试；当前编辑内容已保留。',
      profileConflict: '配置已被其他窗口修改，请重新加载后再保存。',
      profileDefaultFailed: '新会话默认设置失败，请重试。',
      defaultSet: '已设为新会话默认',
    };
    const en = {
      desc: 'Expert-role subagent delegation preset and settings.',
      orchestratorNote: 'The orchestrator is the session\u2019s main model: change it in the composer\u2019s model picker; defaults live in Settings \u2192 Models.',
      webFetch: 'web_fetch tool',
      webFetchBenefit: 'When enabled, the model can fetch the target page text directly instead of repeatedly searching and stitching snippets.',
      webFetchRestart: 'Takes effect after restarting DSH.',
      webFetchRisk: 'SSRF risk: the provider has no private-network protection; do not enable in deployments that can reach sensitive internal targets.',
      webFetchProviderMissing: 'No provider detected: install web-fetch-http (README \u201cAdvanced configuration\u201d) and restart.',
      webFetchProviderUnknown: 'Provider status unavailable; confirm a provider is installed before enabling.',
      enabled: 'Enabled',
      model: 'Model',
      effort: 'Reasoning effort',
      effortNoneHint: 'Does not send reasoningEffort; use this for models that do not support effort control.',
      advanced: 'Advanced',
      advancedWarn: 'Avoid changing these defaults; they can alter plugin behavior.',
      maxTokens: 'Max tokens',
      temperature: 'Temperature',
      observerLocked: 'Locked in this version: re-evaluate once upstream forwards attachments into delegated subagents (deepseek-harness #4297).',
      save: 'Save',
      saving: 'Saving\u2026',
      saved: 'Saved',
      dirty: 'Unsaved changes',
      reset: 'Reset to defaults',
      resetConfirm: 'Reset to defaults?',
      resetDone: 'Reset to defaults',
      effectiveHint: 'Effort and temperature apply to the current session immediately; model, token budget and role toggles apply to new sessions.',
      readOnly: 'This connection is read-only; configuration cannot be edited here.',
      modelsLoading: 'Loading model catalog\u2026',
      modelsEmpty: 'No models found: import a provider under Settings \u2192 Models first.',
      modelsError: 'Failed to load the model catalog; reopen settings to retry.',
      currentValueTag: 'Current',
      invalidMaxTokens: 'Must be a positive integer',
      invalidTemperature: 'Must be between 0 and 2',
      roleOracle: 'Architecture / hard problems / code review (read-only)',
      roleDesigner: 'UI/UX and visual implementation (writable)',
      roleFixer: 'Code implementation, fixes, and refactoring (writable)',
      roleExplorer: 'Codebase scan and research (read-only)',
      roleLibrarian: 'External docs (context7 / gh_grep)',
      roleObserver: 'Vision analysis (locked this release)',
      profile: 'Delegation configuration',
      bundledProfile: 'Minimal Role Delegation',
      newProfile: 'New configuration',
      newProfileHint: 'edit right below, then save',
      draft: 'Draft',
      newSessionDefault: 'Default for new sessions',
      setNewSessionDefault: 'Set as default for new sessions',
      selectionHint: 'This only edits a configuration; it does not switch the current session. Which preset a new session uses is the Agent preset picker\u2019s decision.',
      draftNote: 'Editing an unsaved new profile; it is named on save',
      nameTitle: 'Name configuration',
      nameDescription: 'Enter a display name only. The configuration ID is generated automatically and never changes.',
      displayName: 'Display name',
      nameRequired: 'Enter a display name.',
      nameTooLong: 'Display name must be 64 characters or fewer.',
      nameConflict: 'That display name already exists. Choose another.',
      create: 'Create and save',
      cancel: 'Cancel',
      discard: 'Discard changes',
      saveAndSwitch: 'Save and switch',
      switchTitle: 'Unsaved changes',
      switchDescription: 'Switching configurations will leave the current edits. Save them first?',
      profileUnavailable: 'This host does not provide the profile API; custom configurations cannot be saved yet.',
      profileListFailed: 'Failed to read the configuration list.',
      profileSaveFailed: 'Could not save the configuration. Your edits are still here.',
      profileConflict: 'This configuration changed in another window. Reload it before saving again.',
      profileDefaultFailed: 'Could not change the new-session default. Try again.',
      defaultSet: 'Default for new sessions set',
    };

    // ------------------------------------------------------------- utilities
    function getPath(obj, path) {
      let cursor = obj;
      for (const key of path) {
        if (cursor === undefined || cursor === null || typeof cursor !== 'object') return undefined;
        cursor = cursor[key];
      }
      return cursor;
    }

    function deepEqualJson(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    function cloneJson(value) {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function parseAdvancedNumber(raw, kind) {
      if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
      const n = Number(raw);
      if (kind === 'maxTokens') return Number.isSafeInteger(n) && n >= 1 ? n : null; // null = invalid
      return Number.isFinite(n) && n >= 0 && n <= 2 ? n : null;
    }

    /** Effective role face the card edits, from the resolved namespace value. */
    function buildDraft(value, advanced) {
      const presetName = value?.preset ?? 'my-dsh-slim-default';
      const roles = {};
      for (const roleId of ROLE_IDS) {
        const presetRole = value?.presets?.[presetName]?.[roleId] ?? {};
        const adv = advanced?.roles?.[roleId] ?? {};
        roles[roleId] = {
          enabled: presetRole.enabled ?? true,
          provider: presetRole.provider,
          model: presetRole.model,
          effort: presetRole.effort,
          maxTokens: adv.maxTokens,
          temperature: adv.temperature,
        };
      }
      return { preset: presetName, webFetch: value?.webFetch === true, roles };
    }

    /**
     * Minimal user-layer write plan moving `user` toward `draft`, treating any
     * field equal to the base (shipped default) as inherit (unset). Advanced
     * fields have no base default: absent draft value means unset. Exported
     * for unit tests; pure.
     * @returns ops shaped like the settings mutate contract.
     */
    function planUserOps(base, user, draft) {
      const ops = [];
      const presetName = draft.preset;
      // webFetch: top-level namespace field, no bundled base — an explicit
      // `true` is stored; `false` (the default) is unset (inherit).
      {
        const path = ['webFetch'];
        const uv = getPath(user, path);
        if (draft.webFetch === true) {
          if (uv !== true) ops.push({ op: 'set', path, value: true });
        } else if (uv !== undefined) {
          ops.push({ op: 'unset', path });
        }
      }
      for (const roleId of ROLE_IDS) {
        const d = draft.roles?.[roleId] ?? {};
        for (const field of PRESET_FIELDS) {
          const path = ['presets', presetName, roleId, field];
          const dv = d[field];
          const bv = getPath(base, path);
          const uv = getPath(user, path);
          if (dv === undefined || deepEqualJson(dv, bv)) {
            if (uv !== undefined) ops.push({ op: 'unset', path });
          } else if (!deepEqualJson(uv, dv)) {
            ops.push({ op: 'set', path, value: dv });
          }
        }
        for (const field of ADVANCED_FIELDS) {
          const path = ['advanced', 'roles', roleId, field];
          const dv = d[field];
          const uv = getPath(user, path);
          if (dv === undefined) {
            if (uv !== undefined) ops.push({ op: 'unset', path });
          } else if (!deepEqualJson(uv, dv)) {
            ops.push({ op: 'set', path, value: dv });
          }
        }
      }
      return ops;
    }

    // ----------------------------------------------------- profile helpers
    /** Extract a raw profile config document from a roster payload entry. */
    function profileConfig(value) {
      if (!value || typeof value !== 'object') return {};
      return cloneJson(value.config ?? value.value ?? value);
    }

    /** The roster shape before the host answers (bundled profile only). */
    function initialProfileRoster(base) {
      return {
        profiles: [{
          id: BUNDLED_PROFILE_ID,
          displayName: BUNDLED_PROFILE_NAME,
          kind: 'bundled',
          isDefaultForNewSessions: true,
          revision: undefined,
          config: undefined,
        }],
        defaultProfileId: BUNDLED_PROFILE_ID,
      };
    }

    /**
     * Normalize the roster payload from profile-list. Always keeps the
     * bundled profile first (it carries the bundled defaults and must remain
     * present even when the host lists nothing), then appends every custom
     * profile. The host is authoritative for names, defaults and revisions.
     */
    function normalizeProfileRoster(base, payload) {
      const initial = initialProfileRoster(base);
      const incoming = Array.isArray(payload) ? payload : payload?.profiles;
      if (!Array.isArray(incoming)) return initial;
      const profiles = [...initial.profiles];
      for (const item of incoming) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id === NEW_PROFILE_SENTINEL) continue;
        // Defense in depth: only ids this package owns can be edited here; the
        // host filters its roster too, but showing a foreign native preset that
        // the save RPC would refuse would be misleading.
        if (item.id !== BUNDLED_PROFILE_ID && !item.id.startsWith('profile-')) continue;
        const next = {
          id: item.id,
          displayName: typeof item.displayName === 'string' && item.displayName.trim() !== ''
            ? item.displayName.trim()
            : item.id,
          kind: item.id === BUNDLED_PROFILE_ID ? 'bundled' : 'custom',
          isDefaultForNewSessions: item.isDefaultForNewSessions === true,
          revision: item.revision,
          config: item.config === undefined ? undefined : profileConfig(item.config),
        };
        const index = profiles.findIndex((profile) => profile.id === next.id);
        if (index >= 0) {
          profiles[index] = {
            ...profiles[index],
            ...next,
            config: next.config !== undefined ? next.config : profiles[index].config,
          };
        } else {
          profiles.push(next);
        }
      }
      const defaultProfileId = typeof payload?.defaultProfileId === 'string'
        ? payload.defaultProfileId
        : profiles.find((profile) => profile.isDefaultForNewSessions)?.id ?? BUNDLED_PROFILE_ID;
      return {
        profiles: profiles.map((profile) => ({
          ...profile,
          isDefaultForNewSessions: profile.id === defaultProfileId,
        })),
        defaultProfileId,
      };
    }

    /**
     * Resolve a profile config document against the bundled base, yielding the
     * effective configuration (same shape the settings snapshot has) that the
     * editor renders for a custom profile. Accepts both the legacy document
     * (overrides under `presets[<preset>]`) and the compact one (`roles`).
     */
    function mergeProfileConfig(base, doc) {
      const config = profileConfig(doc);
      const presetName = typeof config.preset === 'string'
        ? config.preset
        : typeof base?.preset === 'string'
          ? base.preset
          : 'my-dsh-slim-default';
      const basePreset = base?.presets?.[presetName] ?? {};
      // Role-level merge: an override document supplies ONE field per role and
      // must not shadow the rest of the base role it inherits.
      const inherited = config.presets?.[presetName] ?? {};
      const compact = config.roles ?? {};
      const mergedRoles = {};
      for (const roleId of ROLE_IDS) {
        mergedRoles[roleId] = {
          ...(basePreset[roleId] ?? {}),
          ...(inherited[roleId] ?? {}),
          ...(compact[roleId] ?? {}),
        };
      }
      return {
        preset: presetName,
        webFetch: config.webFetch === true,
        mcpServers: { ...(base?.mcpServers ?? {}), ...(config.mcpServers ?? {}) },
        presets: {
          ...(base?.presets ?? {}),
          [presetName]: {
            ...basePreset,
            ...inherited,
            ...compact,
            ...mergedRoles,
          },
        },
        advanced: {
          ...(base?.advanced ?? {}),
          roles: {
            ...(base?.advanced?.roles ?? {}),
            ...Object.fromEntries(ROLE_IDS.map((roleId) => [roleId, {
              ...(base?.advanced?.roles?.[roleId] ?? {}),
              ...(config.advanced?.roles?.[roleId] ?? {}),
            }])),
          },
        },
      };
    }

    /** The draft profile object opened by the "new configuration" item. */
    function createNewProfileDraft(sourceEffective) {
      return {
        id: NEW_PROFILE_SENTINEL,
        displayName: '',
        kind: 'draft',
        isDefaultForNewSessions: false,
        revision: undefined,
        sourceConfig: cloneJson(sourceEffective ?? {}),
      };
    }

    /** Display-name validation shared with the host's own rules (≤64, unique). */
    function validateProfileName(raw, profiles = [], currentId) {
      const displayName = String(raw ?? '').trim();
      if (displayName.length === 0) return { valid: false, reason: 'required', value: displayName };
      if (displayName.length > 64) return { valid: false, reason: 'too-long', value: displayName };
      const duplicate = (profiles ?? []).some((profile) => profile.id !== currentId
        && String(profile.displayName ?? '').trim().toLocaleLowerCase() === displayName.toLocaleLowerCase());
      if (duplicate) return { valid: false, reason: 'conflict', value: displayName };
      return { valid: true, value: displayName };
    }

    /**
     * Whether the "set as default for new sessions" action exists for a
     * profile: any non-default profile — bundled included, so the default can
     * always be switched back — but never the in-place new-profile draft.
     */
    function canSetDefault(profile) {
      return Boolean(profile)
        && profile.kind !== 'draft'
        && profile.isDefaultForNewSessions !== true;
    }

    /**
     * The dropdown selection once the roster is known: the new-session
     * default, unless the user already picked a profile manually (anything
     * other than the still-untouched bundled initial value).
     */
    function resolveInitialSelection(current, roster) {
      const wanted = roster?.defaultProfileId ?? BUNDLED_PROFILE_ID;
      return current === BUNDLED_PROFILE_ID && wanted !== BUNDLED_PROFILE_ID ? wanted : current;
    }

    /**
     * Serialize one draft into the profile configuration document the host
     * persists as profile.json. Only fields differing from the referenced
     * baseline are written (unset = inherit the bundled defaults), so resetting
     * a profile to defaults saves an empty document.
     */
    function draftToConfig(draft, original, baseline) {
      const config = profileConfig(original);
      const preset = typeof draft?.preset === 'string' ? draft.preset : (config.preset ?? 'my-dsh-slim-default');
      const effective = baseline ?? config;
      // Compare against the editor's own view of the baseline: a draft built
      // from buildDraft(effective) yields exact equality for untouched fields,
      // so only genuine overrides are persisted (unset = inherit defaults).
      const baselineDraft = buildDraft(effective, effective?.advanced);
      const out = {
        preset,
        webFetch: draft?.webFetch === true,
        mcpServers: config.mcpServers ?? {},
        presets: {},
        advanced: { roles: {} },
      };
      for (const roleId of ROLE_IDS) {
        const role = draft?.roles?.[roleId] ?? {};
        const baseRole = baselineDraft.roles[roleId] ?? {};
        const record = {};
        for (const field of PRESET_FIELDS) {
          const value = role[field];
          if (value === undefined || deepEqualJson(value, baseRole[field])) continue;
          record[field] = value;
        }
        if (Object.keys(record).length > 0) out.presets[preset] = { ...(out.presets[preset] ?? {}), [roleId]: record };
        const advanced = {};
        for (const field of ADVANCED_FIELDS) {
          const value = role[field];
          if (value === undefined || value === '' || deepEqualJson(value, baseRole[field])) continue;
          advanced[field] = parseAdvancedNumber(value, field);
        }
        if (Object.keys(advanced).length > 0) out.advanced.roles[roleId] = advanced;
      }
      return out;
    }

    function createProfileRequest(displayName, draft, original, baseline) {
      return { displayName: String(displayName).trim(), config: draftToConfig(draft, original, baseline) };
    }

    function unwrapProfileRpc(response) {
      if (response?.ok === true) return response.value;
      if (response?.result?.ok === true) return response.result.value;
      if (response && response.profiles) return response;
      return undefined;
    }

    /** Thin adapter over the loopback RPC; undefined when the host has none. */
    function createProfileAdapter(connection) {
      const rpc = connection?.rpc;
      if (!rpc || typeof rpc.call !== 'function') return undefined;
      const call = (method, payload) => rpc.call(PROFILE_RPC_PATH, method, payload).then((response) => {
        const value = unwrapProfileRpc(response);
        if (value === undefined) {
          const error = new Error(response?.error?.message ?? `profile API ${method} failed`);
          error.code = response?.error?.code;
          throw error;
        }
        return value;
      });
      return {
        list: () => call(PROFILE_RPC_METHODS.list, {}),
        create: (payload) => call(PROFILE_RPC_METHODS.create, payload),
        save: (payload) => call(PROFILE_RPC_METHODS.save, payload),
        setDefault: (profileId) => call(PROFILE_RPC_METHODS.setDefault, { profileId }),
      };
    }

    function profileErrorKey(error) {
      const code = String(error?.code ?? error?.status ?? '').toLowerCase();
      const message = String(error?.message ?? '').toLowerCase();
      if (code.includes('conflict') || code === '409' || message.includes('conflict') || message.includes('already exists')) return 'conflict';
      return 'save';
    }

    // ------------------------------------------------------------ components
    const color = {
      text: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      tertiary: 'var(--dsw-alias-label-tertiary)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      border: 'var(--dsw-alias-border-l3)',
      menuBg: 'var(--dsw-specific-menu)',
      warn: 'var(--dsw-alias-state-warn-label)',
      warnBg: 'var(--dsw-alias-bg-module-platform)',
    };

    function Switch({ checked, disabled, onChange, label }) {
      const track = {
        width: 34, height: 20, borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${color.border}`, background: checked ? 'var(--dsw-alias-label-primary)' : color.hover,
        opacity: disabled ? 0.4 : 1, position: 'relative', flex: 'none', transition: 'background .12s',
      };
      const knob = {
        position: 'absolute', top: 2, left: checked ? 16 : 2, width: 14, height: 14, borderRadius: 7,
        background: checked ? 'var(--dsw-specific-menu)' : color.tertiary, transition: 'left .12s',
      };
      return React.createElement('button', {
        type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
        disabled, onClick: disabled ? undefined : onChange, style: { ...track, border: 'none', padding: 0 },
      }, React.createElement('span', { style: knob }));
    }

    function Field({ label, children, hint }) {
      return React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 160px' } },
        React.createElement('span', { style: { fontSize: 12, lineHeight: '18px', color: color.secondary } }, label),
        children,
        hint ? React.createElement('span', { style: { fontSize: 11, lineHeight: '16px', color: color.tertiary } }, hint) : null,
      );
    }

    const controlStyle = {
      height: 30, fontSize: 13, color: color.text, background: 'transparent',
      border: `1px solid ${color.border}`, borderRadius: 8, padding: '0 8px', minWidth: 0, width: '100%',
    };

    function ModelSelect({ groups, status, provider, model, onChange, disabled, t }) {
      const known = groups.some((g) => g.id === provider && g.models.some((m) => m.id === model));
      // Select values are the synthetic "<provider>/<modelId>" — the current
      // value must use the SAME form or the browser falls back to the first
      // option (found in GUI acceptance: oracle showed Flash instead of Pro).
      const synthetic = known || (provider !== undefined && model !== undefined)
        ? `${provider}/${model}`
        : '';
      const options = [];
      if (!known && model !== undefined) {
        options.push(React.createElement('option', { key: 'current', value: synthetic }, `${t('currentValueTag')}: ${synthetic}`));
      }
      for (const group of groups) {
        options.push(React.createElement('optgroup', { key: group.id, label: group.name },
          group.models.map((m) => React.createElement('option', { key: m.id, value: `${group.id}/${m.id}` }, m.name || m.id))));
      }
      return React.createElement('select', {
        value: synthetic, disabled,
        onChange: (e) => {
          if (!known && e.target.value === synthetic) return;
          const next = e.target.value;
          const slash = next.indexOf('/');
          onChange(next.slice(0, slash), next.slice(slash + 1));
        }, style: { ...controlStyle, appearance: 'auto' },
      },
        synthetic === '' ? React.createElement('option', { value: '' }, status === 'loading' ? t('modelsLoading') : status === 'error' ? t('modelsError') : t('modelsEmpty')) : null,
        options,
      );
    }

    /** The roster dropdown: existing profiles (default marker on the selected
     * one) then the always-present "new configuration" sentinel. */
    function ProfileSelect({ profiles, selectedId, onChange, disabled, t }) {
      return React.createElement('select', {
        value: selectedId,
        disabled,
        'aria-label': t('profile'),
        onChange: (event) => onChange(event.target.value),
        style: { ...controlStyle, width: 'min(100%, 320px)', flex: '1 1 220px', fontWeight: 600 },
      },
        profiles.map((profile) => React.createElement('option', { key: profile.id, value: profile.id },
          `${profile.displayName}${profile.isDefaultForNewSessions ? ` · ${t('newSessionDefault')}` : ''}`)),
        React.createElement('option', { key: '__sep__', value: '__sep__', disabled: true }, '────────────'),
        React.createElement('option', { key: NEW_PROFILE_SENTINEL, value: NEW_PROFILE_SENTINEL }, `+ ${t('newProfile')}（${t('newProfileHint')}）`),
      );
    }

    function RoleRow({ roleId, draft, groups, modelsStatus, advOpen, onAdvancedToggle, onChange, t }) {
      const role = draft.roles[roleId];
      const locked = roleId === 'observer';
      const descKey = `role${roleId[0].toUpperCase()}${roleId.slice(1)}`;
      const invalid = {
        maxTokens: role.maxTokens !== undefined && role.maxTokens !== '' && parseAdvancedNumber(role.maxTokens, 'maxTokens') === null,
        temperature: role.temperature !== undefined && role.temperature !== '' && parseAdvancedNumber(role.temperature, 'temperature') === null,
      };
      // Two-line layout (GUI acceptance): line 1 = switch + name + description;
      // line 2 = model select (grows, full model names visible) + effort +
      // advanced toggle — controls align across roles regardless of name length.
      return React.createElement('div', { style: { border: `1px solid ${color.border}`, borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
          React.createElement(Switch, {
            checked: role.enabled !== false, disabled: locked,
            onChange: () => onChange(roleId, { enabled: !(role.enabled !== false) }), label: `${roleId} ${t('enabled')}`,
          }),
          React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: color.text, flex: 'none' } }, roleId),
          React.createElement('span', {
            style: { fontSize: 11, color: color.tertiary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }, t(descKey)),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
          React.createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            React.createElement(ModelSelect, {
              groups, status: modelsStatus, provider: role.provider, model: role.model, disabled: locked,
              onChange: (provider, model) => onChange(roleId, { provider, model }), t,
            }),
          ),
          React.createElement('select', {
            value: role.effort ?? '', disabled: locked, 'aria-label': t('effort'),
            onChange: (e) => onChange(roleId, { effort: e.target.value === '' ? undefined : e.target.value }),
            style: { ...controlStyle, width: 120, flex: 'none' },
          },
            EFFORTS.map((level) => React.createElement('option', { key: level, value: level }, level)),
          ),
          React.createElement('button', {
            type: 'button', 'aria-label': t('advanced'), 'aria-expanded': advOpen,
            onClick: onAdvancedToggle,
            style: { background: 'none', border: 'none', cursor: 'pointer', color: color.tertiary, padding: 4, flex: 'none' },
          }, React.createElement(ui.IconChevronDownOutline14, { size: 14, style: { transform: advOpen ? 'rotate(180deg)' : 'none', transition: 'transform .12s' } })),
        ),
        role.effort === 'none' ? React.createElement('div', { style: { fontSize: 11, lineHeight: '16px', color: color.tertiary } }, t('effortNoneHint')) : null,
        locked ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, color: color.warn, fontSize: 12 } },
          React.createElement(ui.IconWarningOutline16, { size: 14 }), t('observerLocked')) : null,
        advOpen ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${color.border}`, paddingTop: 8 } },
          React.createElement('div', { style: { display: 'flex', gap: 12 } },
            React.createElement(Field, { label: t('maxTokens') },
              React.createElement(ui.Input, {
                value: role.maxTokens ?? '', placeholder: ' ', inputMode: 'numeric', disabled: locked,
                onChange: (e) => onChange(roleId, { maxTokens: e.target.value }), style: controlStyle,
              })),
            React.createElement(Field, { label: t('temperature') },
              React.createElement(ui.Input, {
                value: role.temperature ?? '', placeholder: ' ', inputMode: 'decimal', disabled: locked,
                onChange: (e) => onChange(roleId, { temperature: e.target.value }), style: controlStyle,
              })),
          ),
          (invalid.maxTokens || invalid.temperature) ? React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } },
            invalid.maxTokens ? t('invalidMaxTokens') : t('invalidTemperature')) : null,
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, color: color.warn, fontSize: 12, background: color.warnBg, borderRadius: 8, padding: '6px 8px' } },
            React.createElement(ui.IconWarningOutline16, { size: 14 }), t('advancedWarn')),
        ) : null,
      );
    }

    // -------------------------------------------------------------- card
    function SettingsCard({ scope, connection, t }) {
      const [snap, setSnap] = React.useState(scope.getSnapshot());
      React.useEffect(() => scope.subscribe(() => setSnap(scope.getSnapshot())), [scope]);
      // draft === undefined → clean (mirror the snapshot / profile config);
      // object → staged edits.
      const [draft, setDraft] = React.useState(undefined);
      const [roster, setRoster] = React.useState(() => initialProfileRoster({}));
      const [selectedId, setSelectedId] = React.useState(BUNDLED_PROFILE_ID);
      // The in-place draft profile opened by the "new configuration" item.
      const [newDraft, setNewDraft] = React.useState(undefined);
      // Pending selection while the user decides the dirty-guard prompt.
      const [pendingSwitch, setPendingSwitch] = React.useState(undefined);
      // Naming dialog: {open, input, error}.
      const [nameModal, setNameModal] = React.useState({ open: false, input: '', error: undefined });
      const [profileError, setProfileError] = React.useState(undefined);
      const profileAdapter = React.useMemo(() => createProfileAdapter(connection), [connection]);
      // advOpen per role id: the advanced sub-section visibility.
      const [expanded, setExpanded] = React.useState(() => Object.fromEntries(ROLE_IDS.map((id) => [id, false])));
      const [saving, setSaving] = React.useState(false);
      const [confirmReset, setConfirmReset] = React.useState(false);
      const [toast, setToast] = React.useState(null);
      const [models, setModels] = React.useState({ status: 'loading', groups: [] });
      const loadModels = React.useCallback(() => {
        connection.api.llm.models({}).then((response) => {
          setModels(response.result.ok
            ? { status: 'ready', groups: response.result.value.groups }
            : { status: 'error', groups: [] });
        }).catch(() => setModels({ status: 'error', groups: [] }));
      }, [connection]);
      React.useEffect(() => { loadModels(); }, [loadModels]);

      const writable = snap.writable === true;
      const effective = snap.value ?? EMPTY_EFFECTIVE;
      const base = snap.base ?? EMPTY_BASE;
      const user = snap.user ?? EMPTY_USER;

      const refreshRoster = React.useCallback(() => {
        if (!profileAdapter) return Promise.resolve();
        return profileAdapter.list().then((payload) => {
          setRoster(normalizeProfileRoster(base, payload));
          setProfileError(undefined);
        }).catch(() => {
          setRoster(initialProfileRoster(base));
          setProfileError(t('profileListFailed'));
        });
      }, [profileAdapter, base]);
      React.useEffect(() => {
        if (!profileAdapter) return undefined;
        let alive = true;
        profileAdapter.list().then((payload) => {
          if (!alive) return;
          const next = normalizeProfileRoster(base, payload);
          setRoster(next);
          // Open the card on the NEW-SESSION DEFAULT (not hard-coded on the
          // bundled profile). Only while the user has not picked anything yet
          // (still on the bundled initial value); a later manual selection is
          // never overridden.
          setSelectedId((current) => resolveInitialSelection(current, next));
        }).catch(() => {
          if (!alive) return;
          setRoster(initialProfileRoster(base));
          setProfileError(t('profileListFailed'));
        });
        return () => { alive = false; };
      }, [profileAdapter, base]);

      // The profile object currently edited: roster entry, or the sentinel draft.
      const selectedProfile = selectedId === NEW_PROFILE_SENTINEL
        ? newDraft
        : roster.profiles.find((profile) => profile.id === selectedId) ?? roster.profiles[0];
      const isBundled = selectedId === BUNDLED_PROFILE_ID && selectedProfile?.kind === 'bundled';
      // The RESOLVED configuration the editor renders: settings snapshot for
      // the bundled profile, base ⊕ profile.json for custom profiles, and the
      // frozen copy-of-current for the new-profile draft.
      const editEffective = isBundled
        ? effective
        : selectedId === NEW_PROFILE_SENTINEL
          ? (newDraft?.sourceConfig ?? base)
          : mergeProfileConfig(base, selectedProfile?.config ?? {});
      const current = draft ?? buildDraft(editEffective, editEffective?.advanced);
      const baseline = buildDraft(editEffective, editEffective?.advanced);
      const ops = isBundled && draft !== undefined ? planUserOps(base, user, draft) : [];
      const dirty = isBundled
        ? ops.length > 0
        : draft !== undefined && !deepEqualJson(draft, baseline);
      const invalid = ROLE_IDS.some((roleId) => {
        const role = current.roles[roleId];
        return parseAdvancedNumber(role.maxTokens, 'maxTokens') === null
          || parseAdvancedNumber(role.temperature, 'temperature') === null;
      });

      const changeRole = (roleId, patch) => {
        setDraft((previous) => {
          const next = previous ?? buildDraft(editEffective, editEffective?.advanced);
          return { ...next, roles: { ...next.roles, [roleId]: { ...next.roles[roleId], ...patch } } };
        });
      };
      const toggleAdvanced = (roleId) => {
        setExpanded((previous) => ({ ...previous, [roleId]: !previous[roleId] }));
      };
      const run = async (writeOps, doneText) => {
        setSaving(true);
        try {
          for (const op of writeOps) await scope.write(op);
          setDraft(undefined);
          setToast({ text: doneText, icon: React.createElement(ui.IconCheckOutline16, { size: 14 }) });
        } finally {
          setSaving(false);
        }
      };

      // Persist a CUSTOM profile: an atomic whole-document snapshot write with
      // a revision fence (the host refuses stale writers).
      const saveCustom = async (profile, config) => {
        if (!profileAdapter) {
          setProfileError(t('profileUnavailable'));
          return false;
        }
        setSaving(true);
        setProfileError(undefined);
        try {
          const response = await profileAdapter.save({
            id: profile.id,
            config,
            expectedRevision: profile.revision,
          });
          const saved = response?.profile ?? response;
          const revision = typeof saved?.revision === 'string' ? saved.revision : profile.revision;
          setRoster((previous) => ({
            ...previous,
            profiles: previous.profiles.map((entry) => (
              entry.id === profile.id ? { ...entry, ...saved, revision } : entry
            )),
          }));
          setDraft(undefined);
          setToast({ text: t('saved'), icon: React.createElement(ui.IconCheckOutline16, { size: 14 }) });
          return true;
        } catch (error) {
          setProfileError(profileErrorKey(error) === 'conflict' ? t('profileConflict') : t('profileSaveFailed'));
          if (profileErrorKey(error) === 'conflict') void refreshRoster();
          return false;
        } finally {
          setSaving(false);
        }
      };

      // The bundled profile saves through the settings namespace (hot, fenced
      // by the host per op). Saving a new-profile draft opens the naming
      // dialog; the create RPC itself is confirmed from the dialog.
      const save = () => {
        if (!dirty || invalid || saving) return;
        if (isBundled) { void run(ops, t('saved')); return; }
        if (selectedId === NEW_PROFILE_SENTINEL) {
          setNameModal({ open: true, input: '', error: undefined });
          return;
        }
        if (!selectedProfile || !selectedProfile.revision) {
          setProfileError(t('profileSaveFailed'));
          return;
        }
        void saveCustom(selectedProfile, draftToConfig(draft, selectedProfile.config, editEffective));
      };

      const confirmCreate = async () => {
        const validation = validateProfileName(nameModal.input, roster.profiles);
        if (!validation.valid) {
          setNameModal({
            open: true,
            input: nameModal.input,
            error: t(validation.reason === 'conflict' ? 'nameConflict' : validation.reason === 'too-long' ? 'nameTooLong' : 'nameRequired'),
          });
          return;
        }
        if (!profileAdapter) {
          setNameModal({ open: false, input: '', error: undefined });
          setProfileError(t('profileUnavailable'));
          return;
        }
        setSaving(true);
        setProfileError(undefined);
        try {
          // The new profile stores a SNAPSHOT of the draft against the
          // bundled defaults — the merge baseline a fresh profile resolves
          // against. Comparing against the source profile's effective values
          // instead would drop every field inherited from it (a profile
          // created from the GPT series would silently become the defaults
          // plus the one edited field): the draft's differences vs the
          // source are NOT the draft's differences vs the new profile's own
          // base.
          const defaultsEffective = mergeProfileConfig(base, {});
          const snapshot = draftToConfig(draft, newDraft?.sourceConfig, defaultsEffective);
          const response = await profileAdapter.create(createProfileRequest(validation.value, draft, newDraft?.sourceConfig, defaultsEffective));
          const saved = response?.profile ?? response;
          const profile = {
            id: saved?.id,
            displayName: saved?.displayName ?? validation.value,
            kind: 'custom',
            isDefaultForNewSessions: false,
            revision: saved?.revision,
            config: snapshot,
          };
          setRoster((previous) => normalizeProfileRoster(base, {
            defaultProfileId: previous.defaultProfileId,
            profiles: [...previous.profiles.filter((entry) => entry.id !== profile.id), profile],
          }));
          setNewDraft(undefined);
          setSelectedId(profile.id);
          setDraft(undefined);
          setNameModal({ open: false, input: '', error: undefined });
          setToast({ text: t('saved'), icon: React.createElement(ui.IconCheckOutline16, { size: 14 }) });
          if (pendingSwitch) {
            commitSelect(pendingSwitch);
            setPendingSwitch(undefined);
          }
        } catch (error) {
          setProfileError(profileErrorKey(error) === 'conflict' ? t('profileConflict') : t('profileSaveFailed'));
        } finally {
          setSaving(false);
        }
      };

      const makeDefault = async (profileId) => {
        if (!profileAdapter) {
          setProfileError(t('profileUnavailable'));
          return;
        }
        setSaving(true);
        setProfileError(undefined);
        try {
          await profileAdapter.setDefault(profileId);
          await refreshRoster();
          setToast({ text: t('defaultSet'), icon: React.createElement(ui.IconCheckOutline16, { size: 14 }) });
        } catch {
          setProfileError(t('profileDefaultFailed'));
        } finally {
          setSaving(false);
        }
      };

      const commitSelect = (nextId) => {
        setDraft(undefined);
        setProfileError(undefined);
        if (nextId === NEW_PROFILE_SENTINEL) {
          setNewDraft(createNewProfileDraft(editEffective));
          setSelectedId(NEW_PROFILE_SENTINEL);
        } else {
          setNewDraft(undefined);
          setSelectedId(nextId);
        }
      };
      const requestSelect = (nextId) => {
        if (nextId === selectedId || saving) return;
        if (dirty) {
          setPendingSwitch(nextId);
          return;
        }
        commitSelect(nextId);
      };
      // Dirty-guard dialog decision: save-and-switch, discard, or cancel.
      // While the naming dialog is open (sentinel save-and-switch), the guard
      // hides — both would stack on screen otherwise.
      const guard = pendingSwitch !== undefined && !nameModal.open;
      const confirmGuardSave = async () => {
        if (isBundled) {
          await run(ops, t('saved'));
        } else if (selectedId === NEW_PROFILE_SENTINEL) {
          setNameModal({ open: true, input: '', error: undefined });
          return; // confirmCreate performs the switch
        } else if (selectedProfile) {
          const ok = await saveCustom(selectedProfile, draftToConfig(draft, selectedProfile.config, editEffective));
          if (!ok) return;
        }
        const next = pendingSwitch;
        setPendingSwitch(undefined);
        commitSelect(next);
      };
      const confirmGuardDiscard = () => {
        const next = pendingSwitch;
        setPendingSwitch(undefined);
        commitSelect(next);
      };

      const reset = async () => {
        setConfirmReset(false);
        if (isBundled) {
          const resetDraft = buildDraft(base, base?.advanced);
          const resetOps = planUserOps(base, user, resetDraft);
          if (resetOps.length === 0) { setDraft(undefined); return; }
          await run(resetOps, t('resetDone'));
          return;
        }
        // Custom profiles: restore the LOCAL edit to the bundled defaults;
        // nothing is persisted until the user saves (spec: reset only touches
        // what is being edited).
        const defaultsDraft = buildDraft(base, base?.advanced);
        if (!deepEqualJson(defaultsDraft, baseline)) setDraft(defaultsDraft);
      };
      // Collapsed by default (GUI acceptance): the tab lays out bare slot
      // cards with no host chrome — unlike built-in cards there is no
      // host-provided disclosure wrapper, so the card draws its own.
      const [cardOpen, setCardOpen] = React.useState(false);

      // Fetch-provider availability from the seeder's /omds RPC (loopback).
      // 'ready' | 'missing' | 'unknown' — unknown keeps the toggle enabled
      // with a hint (no RPC channel, e.g. headless or older hosts).
      const [provider, setProvider] = React.useState({ status: 'unknown', ids: [] });
      React.useEffect(() => {
        let alive = true;
        connection.rpc?.call?.('/omds', 'provider-status', {}).then((response) => {
          if (!alive) return;
          const value = response?.ok === true ? response.value : undefined;
          setProvider(value !== undefined
            ? { status: value.installed === true ? 'ready' : 'missing', ids: value.providerIds ?? [] }
            : { status: 'unknown', ids: [] });
        }).catch(() => { if (alive) setProvider({ status: 'unknown', ids: [] }); });
        return () => { alive = false; };
      }, [connection]);

      const changeWebFetch = (enabled) => {
        setDraft((previous) => {
          const next = previous ?? buildDraft(editEffective, editEffective?.advanced);
          return { ...next, webFetch: enabled };
        });
      };

      const headerButton = React.createElement('button', {
        type: 'button',
        onClick: () => setCardOpen((o) => !o),
        'aria-expanded': cardOpen,
        // Match the host built-in cards' header chrome (dsh-client-ui-settings-plugins):
        // one flex row — text block (title + description stacked, flex:1) then chevron.
        style: {
          appearance: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
          background: 'none', border: 'none', color: color.text,
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12,
        },
      },
        React.createElement('span', { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 } },
          React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            React.createElement('span', { style: { fontSize: 15, fontWeight: 600, lineHeight: '1.4', color: color.text } }, 'oh-my-dsh-slim'),
            !cardOpen && dirty ? React.createElement(ui.IconWarningOutline16, { size: 14 }) : null,
          ),
          React.createElement('span', { style: { fontSize: 13, lineHeight: '1.5', color: color.tertiary } }, t('desc')),
        ),
        React.createElement(ui.IconChevronDownOutline14, {
          size: 14,
          style: { transform: cardOpen ? 'rotate(180deg)' : 'none', transition: 'transform .12s', color: color.tertiary, flex: 'none' },
        }),
      );

      const roleRows = ROLE_IDS.map((roleId) => React.createElement(RoleRow, {
        key: roleId, roleId, draft: current, groups: models.groups, modelsStatus: models.status,
        advOpen: expanded[roleId] === true,
        onAdvancedToggle: () => toggleAdvanced(roleId), onChange: changeRole, t,
      }));

      // The profile strip lives at the top of the expanded card: choosing a
      // profile only changes WHAT is edited; the session is untouched.
      const profileStrip = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
          React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: color.text, flex: 'none' } }, t('profile')),
          React.createElement('div', { style: { flex: '1 1 260px', minWidth: 0 } },
            React.createElement(ProfileSelect, {
              profiles: roster.profiles, selectedId,
              onChange: requestSelect, disabled: saving, t,
            }),
          ),
          // The dropdown already shows the selected profile's name, so no
          // badge repeats it on the right. The "set as default" action is
          // available for EVERY non-default profile — including the bundled
          // one, so the default can always be switched back — but never for
          // the in-place new-profile draft (nothing exists to point at yet).
          canSetDefault(selectedProfile)
            ? React.createElement(ui.Button, {
              variant: 'outline', size: 'sm', disabled: saving || !writable,
              onClick: () => void makeDefault(selectedProfile.id),
            }, t('setNewSessionDefault'))
            : null,
        ),
        React.createElement('span', { style: { fontSize: 11, color: color.tertiary, lineHeight: '16px' } }, t('selectionHint')),
        selectedId === NEW_PROFILE_SENTINEL
          ? React.createElement('span', { style: { fontSize: 11, color: color.warn, lineHeight: '16px' } }, t('draftNote'))
          : null,
        profileError
          ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, lineHeight: '16px' } },
            React.createElement(ui.IconWarningOutline16, { size: 14 }), profileError)
          : null,
      );

      // The action row sits at the top of the editable area (next to the
      // profile strip and webFetch toggle) so both save and reset are always
      // reachable without scrolling; dirty only switches the "unsaved" note
      // and the save button's availability.
      const actions = React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' } },
        dirty ? React.createElement('span', { style: { fontSize: 12, color: color.warn, marginRight: 'auto' } }, t('dirty')) : null,
        confirmReset
          ? React.createElement(React.Fragment, null,
            React.createElement('span', { style: { fontSize: 12, color: color.warn } }, t('resetConfirm')),
            React.createElement(ui.Button, { variant: 'outline', size: 'sm', disabled: saving, onClick: () => void reset() }, t('reset')),
            React.createElement(ui.Button, { variant: 'outline', size: 'sm', disabled: saving, onClick: () => setConfirmReset(false) }, '×'),
          )
          : React.createElement(ui.Button, { variant: 'outline', size: 'sm', disabled: saving || !writable, onClick: () => setConfirmReset(true) }, t('reset')),
        React.createElement(ui.Button, {
          variant: 'outline', size: 'sm', disabled: saving || !writable || !dirty || invalid, onClick: save,
        }, saving ? t('saving') : t('save')),
      );

      const nameModalNode = nameModal.open ? React.createElement(ui.Modal, {
        open: true,
        onClose: () => {
          setNameModal({ open: false, input: '', error: undefined });
          // Cancel the naming dialog ends a pending guard switch too: the user
          // stays on the current (still dirty) edit.
          if (pendingSwitch !== undefined) setPendingSwitch(undefined);
        },
        closeLabel: t('cancel'),
        title: t('nameTitle'),
        description: t('nameDescription'),
        footer: React.createElement(React.Fragment, null,
          React.createElement(ui.Button, { variant: 'outline', size: 'sm', disabled: saving, onClick: () => {
            setNameModal({ open: false, input: '', error: undefined });
            if (pendingSwitch !== undefined) setPendingSwitch(undefined);
          } }, t('cancel')),
          React.createElement(ui.Button, { variant: 'primary', size: 'sm', disabled: saving, onClick: () => void confirmCreate() }, t('create')),
        ),
      },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          React.createElement(Field, { label: t('displayName') },
            React.createElement(ui.Input, {
              value: nameModal.input,
              disabled: saving,
              placeholder: ' ',
              onChange: (e) => setNameModal((previous) => ({ ...previous, input: e.target.value, error: undefined })),
              style: controlStyle,
            })),
          nameModal.error
            ? React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', lineHeight: '16px' } }, nameModal.error)
            : null,
        ),
      ) : null;

      const guardModalNode = guard ? React.createElement(ui.Modal, {
        open: true,
        onClose: () => setPendingSwitch(undefined),
        closeLabel: t('cancel'),
        title: t('switchTitle'),
        description: t('switchDescription'),
        footer: React.createElement(React.Fragment, null,
          React.createElement(ui.Button, { variant: 'outline', size: 'sm', disabled: saving, onClick: () => setPendingSwitch(undefined) }, t('cancel')),
          React.createElement(ui.Button, { variant: 'outline', size: 'sm', disabled: saving, onClick: confirmGuardDiscard }, t('discard')),
          React.createElement(ui.Button, { variant: 'primary', size: 'sm', disabled: saving, onClick: () => void confirmGuardSave() }, t('saveAndSwitch')),
        ),
      }, null) : null;

      // Collapsed cards render only the header row; every editable surface
      // (profile strip, roles, actions, hints, toast mount point) lives
      // behind cardOpen.
      const body = cardOpen ? React.createElement(React.Fragment, null,
        React.createElement('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10, color: color.text } },
        profileStrip,
        actions,
        React.createElement('div', { style: { display: 'flex', gap: 6, fontSize: 12, color: color.secondary, background: color.hover, borderRadius: 8, padding: '6px 8px' } },
          t('orchestratorNote')),
        React.createElement('div', { style: { border: `1px solid ${color.border}`, borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 10, minWidth: 0 } },
            React.createElement(Switch, {
              checked: current.webFetch === true,
              disabled: provider.status === 'missing',
              onChange: () => changeWebFetch(!(current.webFetch === true)), label: t('webFetch'),
            }),
            React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: color.text, flex: 'none' } }, t('webFetch')),
          ),
          React.createElement('span', { style: { fontSize: 11, color: color.tertiary, lineHeight: '16px' } }, t('webFetchBenefit')),
          provider.status === 'missing'
            ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, color: color.warn, fontSize: 12, background: color.warnBg, borderRadius: 8, padding: '6px 8px' } },
              React.createElement(ui.IconWarningOutline16, { size: 14 }), t('webFetchProviderMissing'))
            : provider.status === 'unknown'
              ? React.createElement('span', { style: { fontSize: 11, color: color.tertiary, lineHeight: '16px' } }, t('webFetchProviderUnknown'))
              : React.createElement('span', { style: { fontSize: 11, color: color.tertiary, lineHeight: '16px' } }, t('webFetchRestart')),
          React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', lineHeight: '16px' } }, t('webFetchRisk')),
        ),
        roleRows,
        !writable ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, color: color.warn, fontSize: 12 } },
          React.createElement(ui.IconWarningOutline16, { size: 14 }), t('readOnly')) : null,
        React.createElement('span', { style: { fontSize: 11, color: color.tertiary } }, t('effectiveHint')),
        toast ? React.createElement(ui.Toast, { text: toast.text, icon: toast.icon, onDone: () => setToast(null) }) : null,
        ),
      ) : null;

      return React.createElement('div', {
        style: {
          border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
          background: 'var(--dsw-alias-bg-layer-3)',
          display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden',
        },
      }, headerButton, body, nameModalNode, guardModalNode);
    }

    // ----------------------------------------------------------------- apply
    const name = NS;
    const inject = ['slots', 'locale', 'connection'];

    function apply(ctx) {
      const gaps = missingPrimitives(ui);
      if (gaps.length > 0) {
        console.warn('[oh-my-dsh-slim] host ui-primitives missing ' + gaps.join(', ') + ' — settings card disabled');
        return;
      }
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'oh-my-dsh-slim: dictionaries');
      const t = ctx.locale.bind(NS);
      ctx.inject(['settingsScope'], (scoped) => {
        const scope = scoped.settingsScope.bind({ namespace: NS });
        scoped.slots.inject('settings.plugin.item', () => scoped.slots.register({
          name: 'settings.plugin.item',
          key: NS,
          // Sort AFTER the built-in cards and other third-party cards (keyed
          // slots order by ascending priority; everything else ships 0).
          priority: 1,
          locale: NS,
          inject: () => ({ t }),
        }, () => React.createElement(SettingsCard, { t, scope, connection: ctx.connection })));
      });
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    exports.REQUIRED_PRIMITIVES = REQUIRED_PRIMITIVES;
    exports.missingPrimitives = missingPrimitives;
    exports.planUserOps = planUserOps;
    exports.buildDraft = buildDraft;
    exports.initialProfileRoster = initialProfileRoster;
    exports.normalizeProfileRoster = normalizeProfileRoster;
    exports.mergeProfileConfig = mergeProfileConfig;
    exports.validateProfileName = validateProfileName;
    exports.draftToConfig = draftToConfig;
    exports.createProfileAdapter = createProfileAdapter;
    exports.unwrapProfileRpc = unwrapProfileRpc;
    exports.ProfileSelect = ProfileSelect;
    exports.canSetDefault = canSetDefault;
    exports.resolveInitialSelection = resolveInitialSelection;
    return module.exports;
  },
});
