# oh-my-dsh-slim

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）中复刻
[oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) 的 subagent 角色委派体系：
**orchestrator + 5 个专职角色**，每个角色有独立 persona、模型、工具权限（toolFilter）、思考强度
（reasoningEffort）与 MCP 访问。交付物是一个可共享的 **DSH agent 预设**（含随预设分发的配置插件），
不是独立应用。

> Persona 文本适配自 oh-my-opencode-slim（MIT © 2025 alvinunreal），保留署名——详见
> [LICENSE](./LICENSE)。English version: [README.md](./README.md)。

> **⚠️ DSH 版本要求（0.5.0）**：本版本面向 **DSH 0.1.2-rc.1（最新）**。DSH 在 0.1.2 有重大更新，
> **oh-my-dsh-slim 0.5.0 不兼容更早的 DSH 版本**——DSH 0.1.1 及以下请继续使用 oh-my-dsh-slim
> **0.4.0**。若在老宿主上误升级也无妨：插件会检测出版本不符，**完全不动你现有的预设目录**（照常
> 可用），并在 **设置 → 插件 → oh-my-dsh-slim-compat** 显示提示页。另请注意：**升级后需要重启
> DSH**（插件代码每进程只挂载一次，仅开新会话不会加载新代码）。

## 它解决什么问题

DSH 的默认编排是“一个模型包打天下”。本预设把工作拆成专职车道，orchestrator 只负责规划、派发与整合：

- **oracle**（战略顾问）：架构决策、复杂排障、代码评审——只读
- **designer**（前端设计）：UI/UX 与视觉打磨——可写
- **fixer**（快速实现）：规格明确的机械实现——可写
- **explorer**（代码检索）：快速结构勘察——只读
- **librarian**（外部调研）：官方文档/GitHub 检索（context7 + gh_grep MCP）——只读

派发默认走**后台**（continuable）：orchestrator 派完即结束回合，子代理完成时由运行时通知唤醒整合。
orchestrator 遵循严格的委派纪律——派发完独立车道后以简短状态说明结束回合（不轮询、不在同一回合
重做运行中车道的 scope 内工作），把车道的中间回报视为「尚未结算」，只在 finish 通知后收口；
`subagent_result` 工具可只读取回已结束子代理的最终消息（不唤醒、零额外模型轮次）。

## 角色矩阵

| 角色 | 工具名 | 默认模型 | 默认 effort | 权限 |
|---|---|---|---|---|
| oracle | subagent_oracle | deepseek-v4-pro | max | 只读 |
| designer | subagent_designer | deepseek-v4-flash | high | 可写 |
| fixer | subagent_fixer | deepseek-v4-flash | high | 可写 |
| explorer | subagent_explorer | deepseek-v4-flash | low | 只读 |
| librarian | subagent_librarian | deepseek-v4-flash | high | 只读 + MCP |

- 所有角色继承全局工具，只读角色 deny `edit/write`，全部角色 deny 控制类工具（OMO 风格 deny-only）
- 角色禁止再委派（maxDepth: 1）；librarian 在自己的 child scope 中独享 context7/gh_grep
- **observer（视觉分析）本版本预留但默认关闭**：DSH 的发送门控按主模型视觉能力拦截图片附件，
  且委派提示词是纯文本，粘贴图无法交接给子代理。等上游支持"消息附件转发进子代理"后开放。

## 安装

需要 **DSH 0.1.2-rc.1 或更新版本**与 DeepSeek API key（默认模型走 deepseek-official）。
0.5.0 **不支持更早的 DSH 版本**——DSH 0.1.1 及以下请使用 oh-my-dsh-slim 0.4.0（见顶部版本说明）。

**方式 A——插件市场 GUI（推荐）：** 在 DSH web GUI 打开 **设置 → 插件**，在市场里搜索
`oh-my-dsh-slim` 并安装。也可在
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 目录中找到。

**方式 B——CLI 命令：**

```bash
dsh plugin --profile web add oh-my-dsh-slim
```

包内自带播种器，会自动把预设物化到
`$DSH_HOME/.agent-presets/oh-my-dsh-slim`（升级随插件版本走，旧目录自动备份）。

> ℹ️ 默认部署（home 为 `~/.dsh`）直接执行即可。若你的部署使用了自定义 home
> （如桌面 App 的隔离环境），请先设置 `DSH_HOME` 再执行——方式 A 的市场 GUI 会自动解析。

**方式 C——git clone：**

```bash
git clone https://github.com/ninipa/oh-my-dsh-slim "$DSH_HOME/.agent-presets/oh-my-dsh-slim"
```

装完即生效：新建会话时在 **设置 → Agent 预设** 里选择「极简角色委派」。

- **更新**：`cd "$DSH_HOME/.agent-presets/oh-my-dsh-slim" && git pull`（或升级插件），然后
  **重启 DSH**——插件代码（工具 schema、注入提醒）每进程只挂载一次，仅开新会话不会加载新代码
- **回滚**：`git checkout <旧 tag>` 或直接删目录。预设按会话创建时锁定，运行中会话不受影响。

## 配置

零配置即可使用（内置默认值随预设分发）。用户配置按以下优先级读取：

1. `OH_MY_DSH_SLIM_CONFIG` 环境变量指向的文件（测试/CI 通道）
2. **宿主设置命名空间 `oh-my-dsh-slim`**（推荐）：随 npm 包安装的播种器会注册该命名空间，
   配置写在宿主 `settings.yaml` 的 `oh-my-dsh-slim:` 段；effort/temperature 每次委派实时读取
   （改动即时生效），模型/maxTokens 对新会话生效
3. 旧版 `$DSH_HOME/oh-my-dsh-slim.json` 文件（无 settings 服务的宿主的回退通道）。安装了
   npm 包的宿主首次启动时会把它自动导入 settings 命名空间并归档为
   `oh-my-dsh-slim.json.imported-<时间戳>`

三种通道共用同一份文档结构（schema 见
[oh-my-dsh-slim.schema.json](./oh-my-dsh-slim.schema.json)）：

```json
{
  "preset": "my-dsh-normal",
  "presets": {
    "my-dsh-normal": {
      "fixer": { "model": "kimi-k3", "effort": "high" },
      "librarian": { "mcps": ["context7", "gh_grep"] }
    }
  }
}
```

- 可按角色覆盖 `enabled`/`model`/`effort`/`deny`/`mcps`；`temperature`/`maxTokens` 属高级键
  （`advanced.roles.<roleId>`）
- **思考强度取值**：`none` = 完全不发送 `reasoningEffort` 参数（适用于不支持思考强度的模型，
  如本地 LLM）；`off` = 发送 `reasoningEffort: "off"` 明确关闭推理（模型需支持该参数）。
  其余档位（`low`/`medium`/`high`/`max` …）**按所选模型收敛**：适配器只接受该模型声明支持的
  档位（例如 DeepSeek 适配器接受 `off/low/high/max`、拒绝 `medium`），不支持的档位在请求时
  显式报错。GUI 卡片的 effort 下拉即按各模型声明集合生成，越界值行内警告并阻止保存
- **模型名校验**：委派时按你在「设置-模型」导入的 provider 目录实时校验——填了不存在的模型，
  第一次委派即报错并列出全部可用模型（含 vision-capable 子集），不会静默失败
- **observer 锁定**：`observer.enabled: true` 会被忽略并警告（原因见上）
- 修改后**新会话生效**，运行中会话不受影响

**GUI 配置卡片**（随 npm 包分发）：安装后「设置 → 插件 → 插件配置」出现卡片——每个角色的
启用/模型/思考强度可直接编辑，高级子区含 token 上限与温度（带默认值告警），模型下拉与对话输入框
选择器同源。**effort 下拉按所选模型声明的思考档位收敛**（不支持档位自动隐藏；显式越界会行内
警告并阻止保存）。orchestrator 仅展示说明：它是当前会话主模型，在对话输入框的选择器中更换
（默认模型在 设置-模型 维护）。保存后会提示生效语义（思考强度/温度立即生效；模型/token/启停
新会话生效）。

**对话式配置**（无需手编 JSON）：在会话里直接说，例如"帮我把 fixer 的模型换成 kimi-k3"或
"关闭 oracle 角色"——主模型会按 schema 修改上述 JSON。

**多命名配置（multi-preset）**：设置卡片顶部新增「**委派配置**」下拉（安装播种器后出现，roster
由它的 `/omds` RPC 提供），用于管理多套命名配置——每套配置对应一个**原生 Agent 预设**：

- 下拉恒有「极简角色委派」（内置 profile，未改动前就是新会话默认）与「＋ 新建配置」。
  选择「＋ 新建配置」会**原地编辑一份草稿**（复制当前正在编辑的配置），点保存前**不写任何
  数据**；首次点保存时才要求输入**显示名称**（内部 ID 由名称自动生成、之后不再改变）。
- 「恢复默认」只恢复**当前正在编辑的内容**，不删除任何配置、不清空 roster。
- 下拉选择只表示"正在编辑哪个配置"，**不会切换当前会话**；新会话实际用哪个配置由原生
  **Agent 预设**选择器及其默认值决定——卡片上的「设为新会话默认」按钮写入的就是那个原生
  设置（与点击 Agent 预设页卡片是同一处写入），两侧永远一致。
- 保存后的配置会变成真实 agent 预设：`$DSH_HOME/.agent-presets/profile-<前缀>-<hash>/`
  目录，可在 Agent 预设选择器中像任意预设一样选用。各配置的角色设置存于**自己的快照**
  （组合文件旁的 `profile.json`），因此多套配置互不串扰。

## web_fetch（跟随宿主）

宿主 DSH ≥ 0.1.2 默认内置 `web_fetch`（自带 SSRF 防护），预设会话与委派子代理直接继承宿主
默认。本预设不再自带 fetch provider 接线，也不再提供 `webFetch` 开关：旧版的
「进阶配置：启用 web_fetch」与 `web-fetch-gate` 插件已退役。`web_search` 仍由 host web
service 提供。

## 即将发布（Roadmap）

- **observer 重新启用**——等上游 DSH 支持「消息附件转发进子代理」（见角色矩阵中的说明）。

## 自检与测试（全部零费用）

```bash
# 静态校验（结构/键位/persona 死引用/软禁用断言）
node scripts/t0-validate.mjs .

# 单元测试（配置合并/effort 注入/角色委派契约/subagent_result/settings schema/
# sandbox 剥离/提前收口账本/播种器/profile RPC/GUI 卡）
node scripts/test-config-loader.mjs && node scripts/test-effort-plugin.mjs
node scripts/test-role-subagent.mjs && node scripts/test-subagent-result.mjs
node scripts/test-settings-schema.mjs && node scripts/test-sandbox-strip.mjs
node scripts/test-early-close-context.mjs && node scripts/test-preset-seeder.mjs
node scripts/test-profile-rpc.mjs && node scripts/test-client-card.mjs

# 宿主契约探针电池（8 探针 / 9 阶段，零模型）——每次 DSH 升级后必跑。
# 自动搭建临时 DSH_HOME（无需凭据）；详见 scripts/TEST-INVENTORY.md
node scripts/run-host-probes.mjs          # --list / --only <name> / --keep 见 --help
```

## 验收任务清单

[GUI-TEST-TASKS.md](./GUI-TEST-TASKS.md) 提供 7 个非显式派发场景的验收任务（含提示词与预期行为），
可用于新环境部署后的行为核对。T3 依赖 [examples/omo-probe-baseline](./examples/omo-probe-baseline)
基线项目。

## 已知边界

- **升级后需要重启 DSH**：agent-plane 组合**每宿主进程只挂载一次**——配置行（persona 文本、
  模型路由）每会话重新解析，但插件代码（工具 schema、工具描述、注入提醒字符串）冻结在进程内。
  升级插件/预设后必须重启 DSH；仅开新会话跑的仍是旧代码
- **非 vision 主模型无法接收粘贴图片**：DSH 在发送时按主模型能力硬拦
  （`MODEL_DOES_NOT_SUPPORT_IMAGES`）。需要图片分析请换 vision 主模型（如
  deepseek-v4-flash-vision-exp）直读，或等上游支持附件转发。若你的模型实际支持图像但
  仍被拦截，检查 provider 配置中该模型是否声明了图像输入能力
  （`input: ["text", "image"]`）——第三方 GPT 类模型常见此缺漏
- **web_search 走独立计费**：librarian 优先使用 MCP（免费通道）；web_search 由宿主搜索服务承担，
  每次调用产生一次独立的辅助模型请求，开放式调研任务建议在提示词中给出搜索预算
- **委派子代理无法升级沙箱权限——预设会剥离多余升级字段（`sandbox-strip` 插件，属 workaround）**：
  DSH 在启动时固定了子代理的文件策略与审批状态，但 `bash`/`edit`/`write` 工具 schema 仍暴露可选的
  `sandbox_permissions`/`justification` 字段；部分模型会无意识地填上这些字段，而子代理本就无法升级，
  多余参数只会触发参数校验错误（`invalid justification`、`not strictly wider`）。随预设分发的
  `sandbox-strip` 插件会在 `tools/pre-execute` 阶段移除角色子代理调用中的这两个字段，并在结果末尾
  附加 `[sandbox: stripped ...]` 提示让模型看到修正。在本预设自己的**顶层会话**中，它还会剥离
  那些在任何审批前都必然被拒的形态（空 justification、单字段配对、非更宽模式——用宿主同一张
  `WIDER_MODES` 表判定）；**合法升级请求（更宽模式 + 非空理由）保留，照常请求批准**。不使用本
  预设的会话不会加载该插件，行为零变化。这是预设层的临时缓解而非根治：真正修复在上游——DSH
  不应向权限已固定的子代理暴露升级字段
- **后台子代理与「提前收口」（`early-close-context` 插件）**：DSH 是回合制——模型要么输出要么
  结束回合，机制层面无法强制等待后台子代理；部分模型会在子代理仍在运行时输出最终结论（谎称
  "已完成"而未整合子代理结果）。随预设分发的 `early-close-context` 插件用**事实供给**缓解：
   system prompt 每回合注入"当前运行中的后台子代理"块（与宿主 `sandbox:policy` 同一动态机制）、
   每次派发成功的结果附加 "Decision point" 提醒、persona 增加"子代理未 settle 前不得声称完成"
   条款。账本三态（running → reported → settled）：子代理的中间回报（宿主句式
   "Agent <id> sent a message:"）被明确标注为
   "已回报内容，等待正式完成通知（reported ≠ 完成）"，只有 finish 通知才算结算。模型仍可能在
   子代理完成前结束回合（无强制等待），但不再谎报完成——settle 通知会唤醒主模型整合结果
- **自定义配置预设保留创建时的插件版本**：每个配置是创建时对内置预设目录的完整复制；升级 npm
  包只会重播种内置预设，旧配置目录会保留当时的插件拷贝——重建或重新复制该配置才会获得新插件
  （配置快照本身不受影响，只是插件会"变旧"）

## 致谢

- [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)（MIT © 2025
  alvinunreal）——角色体系与 persona 来源
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)——宿主平台

## License

[MIT](./LICENSE)