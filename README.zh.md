# oh-my-dsh-slim

**Henry-916 fork · 0.6.1-native.1 · 分支 `feat/dsh-0.2-native`**

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）中适配
[oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) 的角色委派体系：
**orchestrator + 5 个启用的专职角色**，交付为从插件组合包挂载的**声明式原生 agent 预设**，
不是独立应用，也不需要手工复制预设目录。

> **仅实测目标：DSH 0.2.0-rc.2。** 本 fork 不承诺其他宿主版本已验证。
> 单元/契约测试与真实打包宿主的无网络 smoke 是不同验证层。此前 native.1 安装后，用户已通过 CPA
> 实测 explorer/Qwen low、fixer/Gemini medium、oracle/GPT xhigh 的只读委派与完成回报。
> **这不是纠正版的回归验收，也不证明上游实际推理档位或在线 MCP 可用。** 本轮纠正不更新用户安装；
> 日后安装或更新后必须**完整重启 DSH**，仅新建会话不够。

Persona 适配自 oh-my-opencode-slim（MIT © 2025 alvinunreal），保留署名。
见 [LICENSE](./LICENSE)。English version: [README.md](./README.md)。

## 角色与委派

| 角色 | 工具 | 默认模型 | effort | 权限 |
|---|---|---|---|---|
| oracle | subagent_oracle | deepseek-v4-pro | max | 只读 |
| designer | subagent_designer | deepseek-v4-flash | high | 可写 |
| fixer | subagent_fixer | deepseek-v4-flash | high | 可写 |
| explorer | subagent_explorer | deepseek-v4-flash | low | 只读 |
| librarian | subagent_librarian | deepseek-v4-flash | high | 只读 + 角色作用域 MCP |

- oracle 负责架构、复杂排障与评审；designer 负责 UI/UX；fixer 负责有边界的实现；explorer 负责
  代码勘察；librarian 负责外部调研。
- 随包模型走 `deepseek-official`。可改成宿主已导入的其他 provider/model；真实请求需对应凭据。
- 角色继承全局工具，只读角色 deny `edit`/`write`；全部角色 deny 控制类工具（`skill`、`job_kill`、
  `job_list`、`job_output`、`todo_write`、`ask_user_question`），禁止继续委派（`maxDepth: 1`）。
- **observer 预留但强制关闭**：委派提示是纯文本，宿主按主模型视觉能力门控粘贴图片。
  附件转发尚未支持时，请直接使用支持视觉的主模型。

委派默认后台且可续聊。独立任务一起派发，主代理不能重做运行中子任务或把中间回报当成完成。
**reported 不等于 settled**；正式结束通知后再整合。`subagent_result` 只读已结束子代理最终消息，
不唤醒子代理、不消耗额外模型回合。

## 安装本 fork（日后安装，随后重启）

桌面 App 的 `desktop` profile **只能通过桌面插件管理器管理**，不能使用 `dsh plugin --profile desktop`。在插件管理器的安装入口填写：

```text
github:Henry-916/oh-my-dsh-slim#feat/dsh-0.2-native
```

以下 CLI 命令仅适用于非桌面管理的 profile。使用 **fork 的 GitHub 分支**，不要用上游 npm 包或市场条目替代：

```bash
dsh plugin --profile <profile> add github:Henry-916/oh-my-dsh-slim#feat/dsh-0.2-native
```

本地 checkout 也可：

```bash
dsh plugin --profile <profile> add ./oh-my-dsh-slim
```

`dsh plugin` 安装到 `$DSH_HOME/profiles/<profile>/`，并归并进 profile 的 `dsh.profile.bundles`
层列表。执行前请确认 `DSH_HOME` 是目标部署实际使用的 home；桌面 App 可能使用隔离 home 而非 `~/.dsh`。

安装或后续更新后**完整重启 DSH**，然后在原生 **设置 → Agent 预设** 中选择「极简角色委派」新建会话。
插件代码每宿主进程只挂载一次，仅新建会话不会加载更新代码。以上命令是操作说明，不代表本次已修改
正在运行的用户安装。

- **更新**：再次添加同一 fork 分支并重启；不要使用上游 `@latest` 来更新本 fork。
- **卸载**：`dsh plugin --profile <profile> remove oh-my-dsh-slim`，然后重启。
  不会播种预设目录；移除包不承诺删除原生用户设置或保留的旧 JSON。
- 本分支不承诺兼容 DSH 0.1.x；旧上游版本属于历史版本线，不是本分支安装路径。

## 原生预设与设置

组合包补丁声明 `preset-oh-my-dsh-slim`（`@deepseek-ai/dsh-agent-preset` 行）与 profile 平面的
伴生行 `omds-seeder`。预设的 `config.plugins` 就是其插件列表。包内行使用由 `import.meta.url`
构造的绝对 `file:` URL，避免相对路径按声明补丁解析导致的静默失效。
不会创建 `$DSH_HOME/.agent-presets/` 目录。

伴生行声明带 volatile 可编辑字段的宿主原生 `Config` schema，设置服务可描述并将修改持久化到当前
profile。**这不证明桌面 GUI 已自动渲染角色配置表单**；宿主文档说明 autoGenerate 元数据尚无随附客户端
使用。因此恢复的是历史自定义卡片，通过 rc.2 的 configForms/plugins.item 接入，并保留原编辑助手与
revision 防冲突写入。`/omds` 命名配置采用本包专有配置行持久化及原生 registry 重建；隔离真实宿主
已验证创建/保存、防冲突、既有上下文隔离、原生默认选择和重启恢复。浏览器渲染及在线模型/MCP 尚未
针对本纠正版重新验收。默认会话预设通过宿主原生 Agent 预设设置选择。
完整差异见 [兼容审计](./COMPATIBILITY-AUDIT.md)。

命名记录改存于当前 profile 的 patch，不再复制预设目录；卸载本包后不再注册其定义。这不会自动删除
旧 JSON 或旧预设目录，也不会自动导入/改写旧目录。新声明式记录没有旧 persona 重写问题，因此迁移
接口返回未变更结果；它不是旧目录导入器。

### 配置优先级

零配置使用随包默认值。覆盖来源按优先级从高到低：

1. `OH_MY_DSH_SLIM_CONFIG` 指定文件（测试/CI）。
2. 当前命名预设的持久化配置文档（包含空快照），或挂载副本旁存在的旧 `profile.json` 快照。
3. DSH 原生插件设置 `oh-my-dsh-slim`。
4. 无可用原生设置文档时回退到旧 `$DSH_HOME/oh-my-dsh-slim.json`。
5. 随包 defaults 与运行时基础值。

旧 JSON **仅在原生 user layer 为空时导入**，绝不覆盖已有原生用户设置。导入会校验内容及 revision，
失败只警告并跳过。原 JSON 无论成功与否都**不会被修改、改名、归档或删除**。
显式测试文件或旧 profile 快照可优先于原生表单；如期待 GUI 修改为权威值，请先移除这些覆盖。

旧命名配置与紧凑角色配置都接受，例如：

```json
{
  "preset": "my-dsh-normal",
  "roles": {
    "oracle": { "provider": "deepseek-official", "model": "deepseek-v4-pro", "effort": "max" },
    "librarian": { "mcps": ["context7", "gh_grep"] }
  },
  "mcpServers": {
    "context7": { "transport": "streamable-http", "url": "https://mcp.context7.com/mcp" },
    "gh_grep": { "transport": "streamable-http", "url": "https://mcp.grep.app" }
  }
}
```

- 紧凑 `roles` 高于 `presets[<name>]`；`advanced.roles.<roleId>` 最后合并。
  局部覆盖保留随包角色字段；文档选择阶段数组整体替换，角色 deny 合并以保留限制。
- 角色键包括 `enabled`、`provider`、`model`、`effort`、`temperature`、`maxTokens`、`tools`、
  `deny`、`mcps`、`personaAppend`。非空 `tools` 为穷举白名单；空数组表示未配置，不是禁止全部工具。
- effort 只校验 token 形状，不限于随包 `off`/`low`/`high`/`max`。委派时检查模型元数据并报告不匹配。
  修改 effort 时校验；模型元信息查询失败保留原版 fail-open 行为。`none` 保留宿主已解析的 effort。
- 模型、token 与工具组合修改应使用新会话。effort 与 temperature 每次委派请求重读；
  这不意味着插件安装可以实时生效。

## 官方角色作用域 MCP 已恢复

原生角色 MCP 行把宿主自己的 **`@deepseek-ai/dsh-mcp-client`** 挂载到对应角色的准确 Agent context。
每个角色的 `mcps` 从 `mcpServers` 选择连接；默认 librarian 选择 context7 与 gh_grep。
这是实际的作用域原生客户端挂载，**不再只是 persona 提示或配置声明**。官方客户端负责 transport、
工具、资源、prompt 与重连；预设只负责作用域选择、就绪屏障及释放。

MCP 启动语义按原版保留：仅可续聊后台子代理挂载，首次提示组装最多等待 20 秒，连接失败不阻断
首个模型请求；刷新首次工具快照，后续轮次不重复等待。8 项 scope 生命周期回归通过，覆盖快照刷新、
失败开放、超时及清理。**在线远程 MCP 连通性与 provider/MCP E2E 仍未验证**。
MCP 服务可用性、鉴权与定价不是本包保证。

**MCP 信任边界**：Agent 本层注册的 MCP 工具不受继承 `toolFilter` 限制。
只读角色策略限制的是继承的内置工具，**不会自动把任意配置的 MCP 服务器变成只读**。
当前批准的默认 context7/gh_grep 是调研工具。添加具备写入/修改能力的 MCP 前需信任服务器并检查工具，
不要把角色的「只读」标签当成防止远程副作用的通用保证。

## 验证与边界

```bash
npm test
```

运行仓库的 `node --test test/*.test.mjs` **单元/契约测试**，涉及包结构、原生设置与导入安全、角色路由、
请求/结果处理、生命周期及 MCP 作用域。mock 宿主、provider 与 MCP 的测试不是真实 provider 验收。

另行完成的**真实打包 DSH 0.2.0-rc.2 无网络 smoke 已通过**：使用已安装 ASAR 的 Electron 44 / Node 24，
隔离 `DSH_HOME`，启动 dsh-base、原生预设 registry、伴生行与预设；角色 roster 及完整组合
`registry.resolve` 健康、无 broken 行。没有修改桌面用户安装，也没有 LLM、provider 或 MCP 网络请求。
这只证明打包加载与原生宿主组合接入，不等于真实 provider E2E，也不证明 context7/gh_grep 远程工具可用。
后续 E2E 需要凭据、网络及明确安装并重启过的目标 profile。

其他边界：

- `sandbox-strip` 剥离固定权限子代理中的无效升级字段；合法顶层升级仍受宿主审批控制。
  这是预设 workaround，不是上游权限模型修复。
- `early-close-context` 提供 running/reported/settled 事实与提醒，但不能强制模型等待或保证遵守。
- `web_search` 使用宿主搜索服务，可能产生独立辅助模型费用。
- 宿主模块从 loader 自身 base 与模块实例导入，涵盖打包桌面解析。
  研究过 Lyrissonare 的 discovery workaround，但本 fork **不依赖该 fork 或其包**。

## 署名与历史

- [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)（MIT © 2025 alvinunreal）：
  角色体系与 persona 来源。
- [ninipa/oh-my-dsh-slim](https://github.com/ninipa/oh-my-dsh-slim)：上游 DSH 移植。
- [E2E-AK-OI/oh-my-dsh-slim](https://github.com/E2E-AK-OI/oh-my-dsh-slim)：通过 cherry-pick 引入的
  native foundation，保留原作者署名。此为来源说明，不代表本 fork 完成了 E2E 验证。
- [Lyrissonare/oh-my-dsh-slim](https://github.com/Lyrissonare/oh-my-dsh-slim)：研究 discovery workaround，
  未引入运行时或包依赖。
- [Henry-916/oh-my-dsh-slim](https://github.com/Henry-916/oh-my-dsh-slim)：当前原生 fork。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：宿主平台。

当前 fork 变更与明确标记的上游历史记录见 [CHANGELOG.md](./CHANGELOG.md)。许可证：[MIT](./LICENSE)。
