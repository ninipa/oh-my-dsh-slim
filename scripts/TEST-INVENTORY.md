# 测试资产清单（TEST-INVENTORY）

> 分层语义见 AGENTS.md「测试分层与回归定位」：**L0 自洽**（桩/静态，每次改动必跑）、
> **L1 真宿主契约**（真宿主 0.1.5-rc.2 + 真预设挂载、零模型、防"插件假设 vs 宿主现实"错位）、
> **L2 真模型**（抽样/按需，需 key、烧调用、时序敏感，不作常驻 regression）。

## L0 自洽套件（零成本，常驻）

| 测试 | 覆盖 |
|---|---|
| `node scripts/t0-validate.mjs .` | 静态守卫：组合 YAML 形状/6 角色/运行参数不进 YAML、defaults 语义、插件源码特征（web_fetch 禁用、zsh 超时、observer 软禁用等）、persona 词表、三份组合同步 |
| `node scripts/test-config-loader.mjs` | 用户配置按 roleId 合并 + 隐藏运行期默认值 + **effort token 形状校验**（接受 xhigh/minimal 等目录档位、拒绝空串/空格/非法字符/超长/非字符串） |
| `node scripts/test-effort-plugin.mjs` | effort 矩阵/fallback/顶层 temperature 规则（桩 agent/request）+ **档位按模型声明校验**（resolveModel 桩：声明内注入、判决缓存、越界报错含档位清单、三类 fail-open、未判定的键不被粘性缓存） |
| `node scripts/test-role-subagent.mjs` | 角色工具注册契约、JSON 驱动参数、toolFilter、scoped MCP、前台透明 note |
| `node scripts/test-sandbox-strip.mjs` | sandbox-strip 纯 helper（识别/剥离/必然被拒判定） |
| `node scripts/test-subagent-result.mjs` | subagent_result 注册/提取/授权/错误映射（桩） |
| `node scripts/test-early-close-context.mjs` | ECC 分类/账本状态机/渲染/live 时序用例（桩） |
| `node scripts/test-settings-schema.mjs` | settings ns schema（真 schemastery）+ 值域 + defaults 互检 + **effort 形状**（xhigh 通过、畸形值拒绝） |
| `node scripts/test-client-card.mjs` | GUI 卡 client bundle（mock window/react）注册契约/degrade/write-planner + **model-scoped effort（flash+medium 回归：选项按 catalog、none 置顶、mismatch 拦截）** + **交叉断言：catalog 给出的每个档位都能过 `validateConfigDocument`（UI 与写入侧的不变量）** |
| `node scripts/test-preset-seeder.mjs` | npm seeder 状态机全分支（真 temp dir） |
| `node scripts/test-profile-rpc.mjs` | /omds profile 端点全路径（mock roster + 真 temp dir） |
| `node scripts/test-omds-rpc.mjs` | /**omds 传输层**契约（真 webServer 桩）：注册形态（`/omds` 前缀路由）、信任栅栏、连接信封（rpcId 回显 / ok-value / 错误码 + `details` 记录）。回归目标：2026-09-10 的 `connection.rpc.handle` 静默失效 |

## L1 真宿主契约电池（零模型）

统一入口：`node scripts/run-host-probes.mjs`（--list 查看；--only name 选择；--home/--preset/
--keep 定制；scratch home 自动搭建：headless profile 骨架 + 预设副本 + sessions；**无需凭据**，
--creds 仅供真模型探针且本电池从不使用）。overlay 以 `__WORKSPACE__` token 路径参数化，
runner 运行时替换（直接拷贝 overlay 单跑前必须自行替换 token）。

| 探针（阶段） | overlay | 判定 | 钉住的宿主事实 |
|---|---|---|---|
| `session-query [api]` | probe-patch.headless.yml | verdict 行 | sessionQuery/subagents API、冷/热读、listChildren、角色 toolFilter 对真实 registry |
| `spawn-child [join]` | probe-spawn-child-patch.headless.yml | verdict 行 | 子代理组合 materialize 路径、child 可见工具注册 |
| `ecc-sync [contract]` | probe-ecc-sync.headless.yml | verdict 行 | `agent/inbox/inserted` 事件/payload/agent.id==session.id/source 往返/零 listener 异常 |
| `sandbox-parity [parity]` | probe-sandbox-parity.headless.yml | verdict 行 | 真实 sandboxPolicy mode、dsh-sandbox WIDER_MODES 表加载与边、装订插件解析同一包、doomed 矩阵、bash schema 暴露前提（fact） |
| `subagent-result [query]` | probe-subagent-result.headless.yml | verdict 行 | 真实注册工具经 agent scope 可见、execute() 走真实 sessionQuery：live/cold/无消息/foreign/未知 id |
| `effort-real [default]` | probe-effort-real.headless.yml | verdict 行 | 真实 agent/request waterfall：顶层 temp 默认、role child effort/temp 注入、幂等、resumed 路径（best-effort） |
| `effort-real [none]` | 同上 | verdict 行 | 用户配置 effort:'none' → 不注入 reasoningEffort（env 隔离单进程） |
| `profile-snapshots [seeder]` | probe-seeder-load.headless.yml | exit-code | seeder 真实 cordis inject 布线 + 组合快照/配置隔离（多预设需自备 preset 目录时用 probe-profile-patch） |
| `model-capabilities [modality]` | probe-capabilities-patch.headless.yml | exit-code | 各 provider 模型 modality 声明（探针为信息型，exit 0） |

单跑示例（迭代期）：`node scripts/run-host-probes.mjs --only sandbox-parity,effort-real --keep`
宿主升级后纪律：全电池必跑（`--keep` 保留 scratch 便于查日志，默认自动清理）。

## L1 手动探针（不入电池，按需）

| 资产 | 用途 | 运行约束 |
|---|---|---|
| `probe-profile-patch.headless.yml` + `probe-profile-snapshots.js` | 多预设快照隔离（含自定义 profile 副本） | 需 scratch home 含多个 preset 目录，手动跑 |
| `probe-omds-web.mjs` | **web 模式 /omds 传输层**（真实 web 宿主：注册 405→401、token 换 cookie 后 200 + roster、错误信封）；`--dsh <安装目录>` 可指向任意宿主版本做跨版本核验 | 自建隔离 web home（**无凭据、零模型**、自动清理）；对端版本安装示例见脚本头注释。2026-09-10 实测 0.1.2-rc.1 与 0.1.5-rc.1 均 PASS；2026-09-18 在 0.1.5-rc.2 上 14/14 PASS（含 persona 迁移 6 项）。**headless 电池看不到这条缝**（headless 无 webServer） |
| `probe-spawn-child-webmode-patch.headless.yml` | headless 复刻 web 行状态后的 child join | 与 web 行状态同步维护，手动跑 |
| `probe-spawn-child-real-home.web.yml` / `probe-spawn-child-webmode*.web.yml` / `probe-resume-child-patch.web.yml` | 生产 home / web profile 只读探针（resume 跨进程两阶段） | **针对真实 home**，零模型只读，按各文件头说明手动执行，严禁自动化 |
| **安装一致性核查**（手动，三条命令，无脚本） | 宿主升级后确认"运行树版本 = 全树一致、无半升级"：① `<dsh>/node_modules/@deepseek-ai/*/package.json` 的 `version` 做直方图（应全为同一宿主版本，第三方包除外）；② `ls -l $DSH_HOME/profiles/node_modules/@deepseek-ai/` 全是符号链接且指向运行树；③ `ps -A -o pid=,ppid=,etime=,command=` 读宿主进程启动时间是否晚于安装 mtime（否则 GUI 面仍跑旧代码） | 零模型只读；针对**版本号批量变更**型发布（0.1.5-rc.2 一次改了 272 个包版本号） |

## L2 真模型验收（按需，需凭据）

| 资产 | 用途 | 说明 |
|---|---|---|
| `scripts/run-ecc-real.js` + `run-ecc-real.headless.yml` + `analyze-ecc-real.mjs` | ECC settle 时序端到端 | scratch home 需 `.credentials.yaml`（runner 的 --creds）；`ECC_DEBUG=1`；分析器判定**单调收敛**语义；两轮 PASS 记录（2026-09-04，out/ecc-probe-2026-09-04/） |
| `scripts/run-real-models.mjs` | **一键真模型验收**：自建 scratch home（settings 默认模型 + 六个角色全部指向同一模型/effort）→ 跑隔离冒烟（逐条断言 `agent/request` 的 provider/model/effort）+ ECC 探针 + 分析器 | 模型是**参数**：`--provider/--model/--effort`（或 `OMDS_REAL_*` 环境变量），默认 `opencode-ds-v41-flash/deepseek-flash @ low`；provider 的 baseURL/api/compat/headers 从源 home 的 settings 原样搬运（含网关要求的 `x-opencode-session`）。需源 home 的 `settings.yaml` + `.credentials.yaml`。2026-09-10 实测两套模型（新 provider@low、`deepseek-official/deepseek-v4-flash`@high）均 PASS；2026-09-18 在 0.1.5-rc.2 上 `opencode-ds-v41-flash/deepseek-flash @ low` 全绿 |
| GUI-TEST-TASKS.md + 各期 GUI 人工记录 | GUI 面（client 卡、真实路由/委派/整合） | 结构性空档：web 宿主无法 headless，靠人工 T3 |

## 历史资产（保留供追溯，勿当回归网）

- `reproduce-patch.headless.yml` + `runner-judge.js`：0.3.2 era 提前收口真模型复现（依赖 scratch
  内 runner-judge 副本），**已被 run-ecc-real 取代**（语义：诚实性判定 vs 时序断言）。
- `test-patch.headless.yml`：runner-with-preset era 的自测 overlay（无 verdict），同被取代。
- `runner-with-preset.js`：**仍在使用**——README「自测」的隔离冒烟配方依赖它，勿删。

## 修订记录

- 2026-09-18（C）：**验证"已部署产物"的配方**（本地部署后、发布前）：① `probe-omds-web.mjs
  --preset-pkg <已安装包目录>` 用真实宿主验证该包能挂载并服务 `/omds`；② `run-host-probes.mjs
  --preset <生产预设目录>` 验证某个具体配置目录（含自定义配置）的挂载与 effort 注入链。两者都是
  零模型、scratch home 自清理，可直接用于过渡包/生产目录的部署后核验。
- 2026-09-18（B）：**档位词汇改为"目录权威 / 写入只校验形状 / 运行时按模型判定"**（详见 HANDOFF
  §4B.3h）。L0 四处扩测：`test-client-card` 增交叉断言（卡片给出的档位必须可写，负向验证过）、
  `test-config-loader` 增形状用例、`test-settings-schema` 改值域用例、`test-effort-plugin` 增
  8 项运行时段位用例。无新脚本、无新探针。
- 2026-09-18：0.1.5-rc.2 复核轮，全层复跑通过（T0 ×3、L0 12/12、L1 电池 9/9、web 探针 14/14、
  L2 真模型一套全绿）；L1 手动探针表新增**安装一致性核查**（版本号批量变更型发布的混合版本风险）；
  探针电池与 web 探针的实测记录更新到 rc.2。无脚本改动（本轮零代码改动）。
- 2026-09-04：统一 runner `scripts/run-host-probes.mjs`（清单驱动、路径 token 化、scratch
  自举、verdict/exit-code 双约定）；新增三个 L1 探针（sandbox-parity / effort-real×2 /
  subagent-result），补上矩阵缺口（sandbox 宿主事实、effort 真事件链、subagent-result 真查询）。
  全电池 9/9 PASS（本机 0.1.2-rc.1 + 生产预设副本）。
