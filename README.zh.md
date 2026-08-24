# oh-my-dsh-slim

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）中复刻
[oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) 的 subagent 角色委派体系：
**orchestrator + 5 个专职角色**，每个角色有独立 persona、模型、工具权限（toolFilter）、思考强度
（reasoningEffort）与 MCP 访问。交付物是一个可共享的 **DSH agent 预设**（含随预设分发的配置插件），
不是独立应用。

> Persona 文本适配自 oh-my-opencode-slim（MIT © 2025 alvinunreal），保留署名——详见
> [LICENSE](./LICENSE)。English version: [README.md](./README.md)。

## 它解决什么问题

DSH 的默认编排是“一个模型包打天下”。本预设把工作拆成专职车道，orchestrator 只负责规划、派发与整合：

- **oracle**（战略顾问）：架构决策、复杂排障、代码评审——只读
- **designer**（前端设计）：UI/UX 与视觉打磨——可写
- **fixer**（快速实现）：规格明确的机械实现——可写
- **explorer**（代码检索）：快速结构勘察——只读
- **librarian**（外部调研）：官方文档/GitHub 检索（context7 + gh_grep MCP）——只读

派发默认走**后台**（continuable）：orchestrator 派完即结束回合，子代理完成时由运行时通知唤醒整合；
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

需要 DSH ≥ 0.1.1-rc.2 与 DeepSeek API key（默认模型走 deepseek-official）。

**方式 A——插件市场（一条命令）：**

```bash
dsh plugin --profile web add oh-my-dsh-slim
```

也可在 DSH 插件市场 GUI 与
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 目录中找到。
包内自带播种器，会自动把预设物化到
`$DSH_HOME/.agent-presets/oh-my-dsh-slim`（升级随插件版本走，旧目录自动备份）。

**方式 B——git clone：**

```bash
git clone https://github.com/ninipa/oh-my-dsh-slim "$DSH_HOME/.agent-presets/oh-my-dsh-slim"
```

装完即生效：新建会话时在 **设置 → Agent 预设** 里选择「极简角色委派」。

- **更新**：`cd "$DSH_HOME/.agent-presets/oh-my-dsh-slim" && git pull`
- **回滚**：`git checkout <旧 tag>` 或直接删目录。预设按会话创建时锁定，运行中会话不受影响。

## 配置

零配置即可使用（内置默认值随预设分发）。定制时创建 `$DSH_HOME/oh-my-dsh-slim.json`
（schema 见 [oh-my-dsh-slim.schema.json](./oh-my-dsh-slim.schema.json)）：

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
- **模型名校验**：委派时按你在「设置-模型」导入的 provider 目录实时校验——填了不存在的模型，
  第一次委派即报错并列出全部可用模型（含 vision-capable 子集），不会静默失败
- **observer 锁定**：`observer.enabled: true` 会被忽略并警告（原因见上）
- 修改后**新会话生效**，运行中会话不受影响

**对话式配置**（无需手编 JSON）：在会话里直接说，例如"帮我把 fixer 的模型换成 kimi-k3"或
"关闭 oracle 角色"——主模型会按 schema 修改上述 JSON。

## 即将发布（Roadmap）

- **GUI 配置界面**——角色开关、按角色选择模型（从你导入的 provider 中选）与思考强度，
  将直接在 DSH GUI 设置中完成（宿主原生插件配置表单），不再需要编辑 JSON

## 自检与测试（全部零费用）

```bash
# 静态校验（结构/键位/persona 死引用/软禁用断言）
node scripts/t0-validate.mjs .

# 单元测试（配置合并/effort 注入/角色委派契约/subagent_result）
node scripts/test-config-loader.mjs && node scripts/test-effort-plugin.mjs
node scripts/test-role-subagent.mjs && node scripts/test-subagent-result.mjs

# DSH 升级后的两个探针（先探针、后 GUI）
# ① 模型能力全景：各 provider 模型的 inputModalities
# ② 预设兼容：真实组合启动 + 角色 filter 校验 + sessionQuery 读写
#    （运行前把 patch 文件里的 REPLACE_WITH_REPO_ABS_PATH 替换为本仓库绝对路径）
DSH_HOME=<临时目录> dsh --profile headless --patch scripts/probe-capabilities-patch.headless.yml probe
DSH_HOME=<临时目录> dsh --profile headless --patch scripts/probe-patch.headless.yml probe
```

## 验收任务清单

[GUI-TEST-TASKS.md](./GUI-TEST-TASKS.md) 提供 7 个非显式派发场景的验收任务（含提示词与预期行为），
可用于新环境部署后的行为核对。T3 依赖 [examples/omo-probe-baseline](./examples/omo-probe-baseline)
基线项目。

## 已知边界

- **非 vision 主模型无法接收粘贴图片**：rc.2 在发送时按主模型能力硬拦
  （`MODEL_DOES_NOT_SUPPORT_IMAGES`）。需要图片分析请换 vision 主模型（如
  deepseek-v4-flash-vision-exp）直读，或等上游支持附件转发
- **web_search 走独立计费**：librarian 优先使用 MCP（免费通道）；web_search 由宿主搜索服务承担，
  每次调用产生一次独立的辅助模型请求，开放式调研任务建议在提示词中给出搜索预算

## 致谢

- [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)（MIT © 2025
  alvinunreal）——角色体系与 persona 来源
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)——宿主平台

## License

[MIT](./LICENSE)