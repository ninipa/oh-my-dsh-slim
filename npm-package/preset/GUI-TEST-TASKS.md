# GUI 验收任务清单（非显式派发场景）

> 用法：新建会话选预设「极简角色委派」，逐条复制提示词发送。
> 所有提示词均为**中性措辞**——不点名角色、不提前台后台，核对的是模型自主路由与调度。
> 模型自己干了没委派也是有效数据，照实记录即可。

## 每条任务通用观察点

- [ ] 是否委派（自干 = 记录"未委派"，本身就是数据）
- [ ] 委派给了哪个角色（路由是否合理）
- [ ] 调度方式：后台（省略参数/true）还是前台（显式 false）
- [ ] 派发后 orchestrator 是否结束回合等待完成通知
- [ ] 通知到达后是否被唤醒并整合结果
- [ ] 是否使用了 `subagent_result`（只读取回，不唤醒子代理）
- [ ] （librarian）MCP 工具是否首轮可见；用了 context7/gh_grep 还是 web_search

---

## T1 广域结构扫描 → 预期路由 explorer

```text
帮我梳理一下当前这个项目的整体结构：有哪些模块、入口在哪、配置文件都有什么。
```

预期：委派 explorer 后台执行；orchestrator 结束回合等通知后汇总。
（历史基线：扫描类自动委派稳定触发）

## T2 外部调研 → 预期路由 librarian + MCP

```text
zod 这个库最近的大版本改动有哪些需要注意的？给我一份带来源的要点。
```

预期：路由 librarian **后台**运行（前台无 MCP）；工具列表首轮即含 `mcp__context7__*` / `mcp__gh_grep__*` 并实际调用。
成本护栏（可选追加，不影响调度中立性）：`最多搜索 3 次。`
⚠️ 若它全程只用 web_search 且次数失控，直接打断——那是需要记录的异常。

## T3 有界实现 → 预期路由 fixer（已验证触发：规格完备度是决定变量）

> 关键发现（2026-08-22）："多文件"本身不触发委派；**规格由用户完全写死**才会——否则模型判定
> "转述规格的成本 > 自己写"而自干（omo 侧同规则同行为）。以下为验证过的触发任务。
> 先准备基线项目（本仓库 `examples/omo-probe-baseline/` 的副本，输出 `5 12` / `2`），例如：
> `cp -R examples/omo-probe-baseline /tmp/omo-probe`，然后：

```text
对 /tmp/omo-probe 项目做有界实现，改动范围仅限下列文件，不要重构其他任何代码。

## 改动范围
- lib/string.js（新建）
- lib/array.js（新建）
- lib/obj.js（新建）
- lib/date.js（新建）
- test.js（新建）
- main.js（仅追加调用和打印）

## 需求规格
全部函数按 CommonJS 导出（module.exports = { ... }），严格按下列边界行为实现，不得自行发挥：

lib/string.js：
- capitalize(s)：首字母大写其余原样；空串返回空串
- truncate(s, n)：超过 n 字符截断并追加 '...'（共 n+3 字符）；n<=0 返回 ''
- toCamelCase(s)：'foo bar'、'foo-bar'、'foo_bar' 均转为 'fooBar'
- countOccurrences(s, sub)：sub 为空返回 0；大小写敏感

lib/array.js：
- chunk(arr, size)：按 size 分块；size<=0 或空数组返回 []
- unique(arr)：去重（严格相等），保持首次出现顺序
- groupBy(arr, keyFn)：返回对象，键为 keyFn(item)，值为对应元素数组
- flatten(arr)：只展开一层嵌套

lib/obj.js：
- pick(obj, keys)：只保留 keys 中的键；不存在的键忽略
- omit(obj, keys)：删除 keys 中的键；不得修改原对象
- deepClone(obj)：深拷贝对象/数组/嵌套；函数与 Date 引用原值即可

lib/date.js：
- formatDate(d)：Date 转 'YYYY-MM-DD'（月日补零）
- daysBetween(a, b)：返回 b-a 的天数绝对值（整数，忽略时分秒）

main.js：在现有输出后追加，依次调用上述每个函数至少一次并 console.log 结果。
test.js：对上述全部函数写断言（node 内置 assert 或手写 throw），每函数至少 2 个用例含边界用例；
全部通过打印 'ALL TESTS PASSED'，任一失败退出码非 0。

## 验收标准
- node test.js 输出 ALL TESTS PASSED 且退出码 0
- 每个函数的边界行为与规格逐条一致
- main.js 原有输出（5 12 / 2）保持不变

## 验证命令
node main.js && node test.js

完成后报告：每个文件的新增/修改摘要 + 验证输出原文。
```

预期：路由 fixer 后台执行（fix-N 标签、end-turn 等通知）；完成后核对产物与验收标准。

## T4 图片分析 → 本版本不适用（observer 已软禁用）

> observer 在本版本默认关闭且锁定：rc.2 发送门控按主模型视觉能力拦截图片附件，粘贴图只能
> 到达 vision 主模型本人；委派提示词是纯文本，图片无法交接给子代理。等上游支持附件转发后再开放。
> 当前可用替代：vision-capable 主模型（如 deepseek-v4-flash-vision-exp）直接粘贴分析（已实测）。

<details><summary>原始 T4 任务（observer 重新启用后恢复使用）</summary>

粘贴任意一张截图/图片后发送：

```text
分析一下这张图里的内容。
```

预期：路由 observer（read_image）；返回结构化观察而非把原图塞进主上下文。

</details>

## T5 UI 评审 → 预期路由 designer

先把下面的内容存成 `/tmp/gui-design-lab/index.html`：

```html
<!doctype html><html><head><style>
body{font-family:sans-serif;margin:0}
header{background:#123;color:#fff;padding:24px;text-align:center}
main{display:flex;gap:16px;padding:16px}
.card{flex:1;border:1px solid #ddd;border-radius:8px;padding:16px}
button{padding:8px 16px;border-radius:4px}
</style></head><body>
<header><h1>Sample Landing</h1></header>
<main><div class="card"><h2>Feature A</h2><p>Text</p><button>Try</button></div>
<div class="card"><h2>Feature B</h2><p>Text</p><button>Buy</button></div></main>
</body></html>
```

然后发送：

```text
看看 /tmp/gui-design-lab/index.html 这个页面的视觉和排版有什么可以改进的。
```

预期：路由 designer（可写角色），给出具体 UI 建议。

## T6 架构咨询 → 预期路由 oracle

```text
我们这个项目以后可能要拆微服务，帮我从架构角度评估一下利弊和风险。
```

预期：路由 oracle（只读顾问），输出带权衡的分析。

## T7 并行双通道 → explorer + librarian 同时派出

```text
我想引入一个新的状态管理库。一边看看这个项目里现在状态是怎么管理的，
一边查查目前主流方案的对比和社区口碑，最后一起给我个建议。
```

预期：**同一条消息里并行派出两个子代理**（explorer + librarian），orchestrator 结束回合；
两条完成通知先后到达后被唤醒整合。核对：是否真并行、两个通知是否都送达、最终是否综合了两路结果。

---

## 结果记录表

| # | 任务 | 委派? | 角色 | 后台? | 结束回合等通知? | subagent_result? | 异常 |
|---|------|-------|------|-------|-----------------|------------------|------|
| T1 | | | | | | | |
| T2 | | | | | | | |
| T3 | | | | | | | |
| T4 | | | | | | | |
| T5 | | | | | | | |
| T6 | | | | | | | |
| T7 | | | | | | | |

测完把表格发回工作区会话，我来对照基线出结论。
