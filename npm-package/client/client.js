// oh-my-dsh-slim settings card — the browser half of the npm package.
//
// A hand-written ModuleLoader bundle (PLAN-CONFIG-CARD.md §2): no build chain,
// no JSX. React and the UI primitives are host-provided platform seeds; the
// settings namespace is registered by the host half (lib/index.js) with the
// shipped defaults.json as its BASE layer, so this card edits the USER layer
// only — a field written back equal to the base value is unset (inherits)
// rather than stored.
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

    const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Toast', 'IconCheckOutline16', 'IconWarningOutline16'];

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

    function SettingsCard({ scope, connection, t }) {
      const [snap, setSnap] = React.useState(scope.getSnapshot());
      React.useEffect(() => scope.subscribe(() => setSnap(scope.getSnapshot())), [scope]);
      // draft === undefined → clean (mirror the snapshot); object → staged edits.
      const [draft, setDraft] = React.useState(undefined);
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
      const effective = snap.value ?? {};
      const base = snap.base ?? {};
      const user = snap.user ?? {};
      const current = draft ?? buildDraft(effective);
      const ops = draft === undefined ? [] : planUserOps(base, user, draft);
      const dirty = ops.length > 0;
      const invalid = ROLE_IDS.some((roleId) => {
        const role = current.roles[roleId];
        return parseAdvancedNumber(role.maxTokens, 'maxTokens') === null
          || parseAdvancedNumber(role.temperature, 'temperature') === null;
      });

      const changeRole = (roleId, patch) => {
        setDraft((previous) => {
          const next = previous ?? buildDraft(effective);
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
      const save = () => { if (!dirty || invalid || saving) return; void run(ops, t('saved')); };
      const reset = async () => {
        setConfirmReset(false);
        const resetDraft = buildDraft(base);
        const resetOps = planUserOps(base, user, resetDraft);
        if (resetOps.length === 0) { setDraft(undefined); return; }
        await run(resetOps, t('resetDone'));
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
          const next = previous ?? buildDraft(effective);
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

      // The action row lives at the TOP of the expanded card (next to the
      // webFetch toggle and role rows) so both save and reset are always
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

      // Collapsed cards render only the header row; every editable surface
      // (roles, actions, hints, toast mount point) lives behind cardOpen.
      const body = cardOpen ? React.createElement(React.Fragment, null,
        React.createElement('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10, color: color.text } },
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
      }, headerButton, body);
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
    return module.exports;
  },
});
