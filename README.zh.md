# oh-my-dsh-slim

**oh-my-dsh-slim · 0.6.1 · DSH 0.2 兼容版本线**

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）中适配
[oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) 的角色委派体系：
**orchestrator + 5 个启用的专职角色**，交付为从插件组合包挂载的**声明式原生 agent 预设**，
不是独立应用，也不需要手工复制预设目录。

> **宿主范围：`>=0.2.0-rc.2 <0.3.0-0`；实测宿主：DSH 0.2.0-rc.2。**
> 门禁按 npm 范围语义执行：0.2.0 的后续预发布（rc.3）与 0.2.x 稳定版允许安装但不宣称实测；
> 更高补丁版本的预发布（例如当前宿主 `alpha` 标签的 `0.2.1-alpha.2`）会被拒绝，直到有版本明确允许。
> 升级策略：所需 API 不变时维持 0.2 版本线兼容，验证新宿主后才宣称实测支持；0.3 版本线另行审查。
> **DSH ≤0.1.5 请继续使用 `oh-my-dsh-slim@0.5.3`。** 中间版本需要升级 DSH。
> 0.6.1 已通过 101 项自动测试、六项隔离已安装宿主基础组合 smoke，以及 web 组合传输层五项哨兵
> （web smoke 已在普通 npm/CLI 宿主上独立复现）。用户接受中文待办网页的桌面委派复测为成功；
> 尚未完成完整工具轨迹审计、浏览器渲染或在线 MCP 验收。安装或更新后必须**完整重启 DSH**。

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

## 安装已发布版本（随后重启）

桌面 App 的 `desktop` profile **只能通过桌面插件管理器管理**，不能使用 `dsh plugin --profile desktop`。在管理器的安装入口填写固定版本：

```text
oh-my-dsh-slim@0.6.1
```

请按发布说明中的明确版本安装，不要依赖浮动 tag，也不要替换为持续变动的开发分支。
0.6.1 属于 DSH 0.2 版本线；DSH ≤0.1.5 用户继续留在 0.5.3。官方源码与发布标签见
[ninipa/oh-my-dsh-slim](https://github.com/ninipa/oh-my-dsh-slim/releases)。

以下 CLI 命令仅适用于非桌面管理的 profile：

```bash
dsh plugin --profile <profile> add oh-my-dsh-slim@0.6.1
```

本地 checkout 也可——安装仓库根目录即可，其 export map 提供与发布包相同的模块：

```bash
dsh plugin --profile <profile> add /path/to/oh-my-dsh-slim
```

`dsh plugin` 安装到 `$DSH_HOME/profiles/<profile>/`，并归并进 profile 的 `dsh.profile.bundles`
层列表。执行前请确认 `DSH_HOME` 是目标部署实际使用的 home；桌面 App 可能使用隔离 home 而非 `~/.dsh`。

安装或后续更新后**完整重启 DSH**，然后在原生 **设置 → Agent 预设** 中选择「极简角色委派」新建会话。
插件代码每宿主进程只挂载一次，仅新建会话不会加载更新代码。以上命令是操作说明，不代表本次已修改
正在运行的用户安装。

- **更新**：从官方发布说明选择已发布的明确版本。rc.2 桌面管理器可能要求先卸载再安装；
  请先备份设置，卸载时保留配置，完成后重启 DSH。
- **卸载**：`dsh plugin --profile <profile> remove oh-my-dsh-slim`，然后重启。
  不会播种预设目录；移除包不承诺删除原生用户设置或保留的旧 JSON。
- **DSH ≤0.1.5：** 使用 `oh-my-dsh-slim@0.5.3`，按该历史版本的说明安装。
  本 0.6.x 版本线要求 DSH ≥0.2.0-rc.2；0.1.6/0.1.7 用户需要升级宿主。

## 仓库结构

- 仓库根：本地 checkout 安装时使用的包清单，其 export map 提供与发布包相同的模块；
- `npm-package/`：发布包内容（npm 实际收到的就是这个目录）；
- `test/`：单元/契约测试，以及两套可选的已安装宿主 smoke；
- `legacy/v0.5.3/`：历史目录式预设线，保留用于对比基线。

## 原生预设与设置

组合包补丁声明 `preset-oh-my-dsh-slim`（`@deepseek-ai/dsh-agent-preset` 行）与 profile 平面的
伴生行 `omds-seeder`。预设的 `config.plugins` 就是其插件列表。各行以包的导出子路径命名
（`oh-my-dsh-slim/preset`、`oh-my-dsh-slim/profile-registry`、`oh-my-dsh-slim`），由宿主的
export map 解析；只有包根入口贡献浏览器客户端模块。
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
历史对比基线随仓库收录于 `test/fixtures/upstream-v0.5.3/`，以固定原始 Git blob 哈希核验；
测试不依赖 `.git` 或完整克隆历史。需要已安装宿主参照物的集成用例在参照物缺失时显示明确跳过原因。
`semver` 固定为开发依赖，版本范围交叉校验不再依赖 npm 自带副本。

基础 smoke 直接调用 profile 后端，**不验证 `/omds` 的 HTTP 路由注册**。
传输层验收可单独运行 `test/web-host-smoke.cjs`：将 `DSH_HOST_ANCHOR` 设为已安装 DSH 的绝对 JS 入口，
使用该宿主 Node 运行时；打包 Electron 需 `ELECTRON_RUN_AS_NODE=1` 和 `--expose-internals`。
它组合真实 `dsh-web-app`，使用隔离 home/profile 与回环临时端口，不替换当前 GUI。
已安装 rc.2 的 web smoke 五项哨兵全通过：鉴权与 Host/Origin 栅栏、五个 profile RPC 方法及冲突处理、
无效协议 envelope、完整重启后的持久化，以及路由卸载；两次启动均断言所有启用的宿主行处于 active 状态。
测试使用实际发布包 patch；非客户端导出子入口避免重复客户端模块所有权。
尚未验收浏览器视觉渲染、真实浏览器客户端执行或进行中的 HTTP 取消。

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
  研究过 Lyrissonare 的 discovery workaround，但本包 **不依赖该 fork 或其包**。

## 署名与历史

- [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)（MIT © 2025 alvinunreal）：
  角色体系与 persona 来源。
- [ninipa/oh-my-dsh-slim](https://github.com/ninipa/oh-my-dsh-slim)：上游 DSH 移植（本仓库）。
- [E2E-AK-OI/oh-my-dsh-slim](https://github.com/E2E-AK-OI/oh-my-dsh-slim)：通过 cherry-pick 引入的
  native foundation，保留原作者署名。此为来源说明，不代表本次兼容性更新完成了 E2E 验证。
- [Lyrissonare/oh-my-dsh-slim](https://github.com/Lyrissonare/oh-my-dsh-slim)：研究 discovery workaround，
  未引入运行时或包依赖。
- [Henry-916/oh-my-dsh-slim](https://github.com/Henry-916/oh-my-dsh-slim)：0.6.x 原生兼容性更新的贡献者（已作为 PR #3 合并）。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：宿主平台。

当前兼容性变更与明确标记的上游历史记录见 [CHANGELOG.md](./CHANGELOG.md)。许可证：[MIT](./LICENSE)。
