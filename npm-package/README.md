# oh-my-dsh-slim

[oh-my-dsh-slim](https://github.com/ninipa/oh-my-dsh-slim) preset packaged as a
**DeepSeek Harness plugin**: installing it seeds the full specialist subagent
delegation preset into your DSH home automatically — no manual directory copy.

**中文说明见下方「中文」部分。**

## What it is

A DeepSeek Harness plugin that materializes the
[oh-my-dsh-slim](https://github.com/ninipa/oh-my-dsh-slim) preset —
**orchestrator + 5 specialist roles** (oracle / designer / fixer / explorer /
librarian), background-first (continuable) delegation with settlement notices,
`subagent_result` read-only retrieval, JSON-driven per-role models / effort /
tool permissions, and librarian-scoped context7 + gh_grep MCP — into
`$DSH_HOME/.agent-presets/oh-my-dsh-slim`.

This package is only the **installer/seeder**. The preset itself is a standard
DSH agent preset directory; see the repo README for the full feature set,
configuration guide, and acceptance checklist.

## Install (English)

```sh
dsh plugin --profile web add oh-my-dsh-slim
```

or one-click from the DSH plugin marketplace. Then create a new session and
pick **极简角色委派** in **Settings → Agent Presets** (restart `dsh web` after
the first install).

## Seed & upgrade semantics

- Target directory absent → seeds the bundled preset, writes a
  `.omds-seed.json` version marker
- Target is git-managed (contains `.git`) → left untouched
- Target exists without a marker (unknown origin) → left untouched, warning logged
- Bundled version is newer than the seeded one → the old directory is backed up
  as `oh-my-dsh-slim.bak-<timestamp>` and the new version is seeded
- Uninstalling this package does **not** remove the seeded preset directory

## Customization

The preset directory is managed content — do not hand-edit it. Customization
goes through the **settings card** (Settings → Plugins → Plugin configuration →
oh-my-dsh-slim: per-role enabled/model/effort, advanced maxTokens/temperature,
and the `webFetch` toggle) or, on hosts without the settings channel, through
`$DSH_HOME/oh-my-dsh-slim.json` — upgrades never touch either. Model, effort
and temperature apply immediately (next delegation); role toggles, `webFetch`
and tool permissions take effect after restarting DSH. See the
[repo README](https://github.com/ninipa/oh-my-dsh-slim#configuration).

### web_fetch (optional, see repo README "Advanced configuration")

`webFetch` (off by default) registers the `web_fetch` tool for preset sessions
when a fetch provider is installed — the card disables the toggle until it
detects `@deepseek-ai/dsh-web-fetch-http` (host-level install, see repo README).
The provider is an SSRF primitive; do not enable in deployments that can reach
sensitive internal targets.

### Known limits: delegated children cannot escalate sandbox permissions

DSH fixes a delegated child's file policy and approval state at startup, but
the `bash`/`edit`/`write` tool schemas still expose optional
`sandbox_permissions` / `justification` fields. Some models fill them
unprompted, triggering parameter-validation errors (`invalid justification`,
`not strictly wider`). The bundled `sandbox-strip` plugin removes the two
fields from role-subagent child calls at the `tools/pre-execute` waterfall and
appends a `[sandbox: stripped ...]` note to the result. In this preset's own
top-level sessions it additionally strips only the shapes DSH would always
reject before any approval prompt (empty justification, single-field pairs,
non-widening modes); legitimate escalation requests (strictly wider mode +
non-empty justification) are kept and still prompt for approval. This is a
preset-level workaround — the real fix is upstream (DSH should not expose
escalation fields to children with a fixed permission scope).

### Known limits: background subagents and "early close"

DSH is turn-based — a model either outputs or ends its turn, so there is no
mechanism-level way to force it to wait for a background subagent. Some models
close with a final conclusion while a delegated child is still running,
claiming "done" without the child's result. The bundled `early-close-context`
plugin mitigates this with facts: a live "currently running background
subagents" block in the system prompt (re-rendered every turn), a "Decision
point" reminder on every successful delegation result, and a persona clause
against claiming completion while a child is unsettled. Since 0.3.3 the ledger
is three-state (`running` → `reported` → `settled`): a child's **report** is
shown as "已回报内容，等待正式完成通知（reported ≠ 完成）" — a report neither
concludes the child's turn nor changes its lifetime, and only the **finish
notice** (unconditional for every established child, incl. failure/cancel/
token-ceiling) settles it, so the model no longer announces "the subagent is
done" before the finish notice arrives. The model may still end its turn
before the child settles (no force-wait), but it no longer misreports
completion — the settle notice wakes it to integrate the result.

---

## 中文

把 [oh-my-dsh-slim](https://github.com/ninipa/oh-my-dsh-slim) 预设打包成
**DeepSeek Harness 插件**：安装后自动把完整的角色委派预设播种到你的 DSH home，
无需手动复制目录。

预设内容：**orchestrator + 5 个专职角色**（oracle / designer / fixer / explorer /
librarian），后台优先派发（continuable）+ 完成通知唤醒，`subagent_result`
只读取回结果，JSON 驱动的按角色模型/effort/工具权限，librarian 独享
context7 + gh_grep MCP。

### 安装

```sh
dsh plugin --profile web add oh-my-dsh-slim
```

或在 DSH 插件市场一键安装。装完重启 `dsh web`，新建会话后在
**设置 → Agent 预设** 选择「极简角色委派」。

### 播种与升级语义

- 目标目录不存在 → 自动播种内置预设，写入版本标记 `.omds-seed.json`
- 目录由 git 管理（含 `.git`）→ 完全不动
- 目录存在但无版本标记（来历不明）→ 完全不动 + 日志警告
- 内置版本更新（插件升级后）→ 旧目录备份为 `oh-my-dsh-slim.bak-<时间戳>` → 铺新版本
- **卸载本插件不会删除已播种的预设目录**

### 自定义

预设目录是托管内容，请勿直接手改——所有自定义走**设置卡片**（设置 → 插件配置 →
oh-my-dsh-slim：角色开关/模型/思考档、高级 maxTokens/temperature、以及 `webFetch`
开关）或旧版 `$DSH_HOME/oh-my-dsh-slim.json`（无设置服务时），升级永不触碰。
模型/思考档/温度改完立即生效（下一次委派）；角色开关、`webFetch` 与工具权限需重启
DSH 生效。完整功能说明、配置指南与验收清单见
[仓库 README](https://github.com/ninipa/oh-my-dsh-slim#readme)。

### 已知边界：委派子代理无法升级沙箱权限

DSH 在启动时固定了子代理的文件策略与审批状态，但 `bash`/`edit`/`write` 工具
schema 仍暴露可选的 `sandbox_permissions`/`justification` 字段；部分模型会无意识
填上，触发参数校验错误（`invalid justification`、`not strictly wider`）。随预设
分发的 `sandbox-strip` 插件会在 `tools/pre-execute` 阶段移除角色子代理调用中的
这两个字段，并在结果末尾附加 `[sandbox: stripped ...]` 提示。在本预设自己的顶层
会话中，它还会剥离那些在任何审批前都必然被拒的形态（空 justification、单字段
配对、非更宽模式）；**合法升级请求（更宽模式 + 非空理由）保留，照常请求批准**。
这是预设层的临时缓解而非根治——真正修复在上游 DSH（不应向权限固定的子代理暴露
升级字段）。

### 已知边界：后台子代理与「提前收口」

DSH 是回合制——模型要么输出要么结束回合，机制层面无法强制它等待后台子代理；
部分模型会在子代理仍在运行时输出最终结论（谎称"已完成"而未整合子代理结果）。
随预设分发的 `early-close-context` 插件用**事实供给**缓解：system prompt 每回合
注入"当前运行中的后台子代理"块（与宿主 `sandbox:policy` 同一动态机制）、每次
派发成功的结果附加 "Decision point" 提醒、persona 增加"子代理未 settle 前不得
声称完成"条款。**0.3.3 起账本三态（running → reported → settled）**：子代理的
**report**（"Background subagent X reported:"）被明确标注为"已回报内容，等待正式
完成通知（reported ≠ 完成）"——report 既不结束子代理回合也不改变其生命周期，
只有 **finish 通知**（对每个已建立子代理无条件发送，含失败/取消/token 上限路径）
才算结算，主模型不再提前数十秒宣布"子代理已完成"。模型仍可能在子代理完成前
结束回合（无强制等待），但**不再谎报完成**——settle 通知会唤醒主模型整合结果。

**`web_fetch`（可选，见仓库 README「进阶配置」）**：`webFetch` 默认关闭，开启后
预设会话可注册 `web_fetch` 工具（需宿主层安装 fetch provider，卡片在检测到
`@deepseek-ai/dsh-web-fetch-http` 前会禁用开关）。该 provider 是 SSRF 原语，
可触达敏感内网的部署请勿开启。

## License

[MIT](https://github.com/ninipa/oh-my-dsh-slim/blob/main/LICENSE)
