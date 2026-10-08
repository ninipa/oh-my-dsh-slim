# 自测任务清单（验证自动委派行为）

> 用法：新建会话选「极简角色委派」预设，逐条复制提示词发送。
> 所有提示词均为中性措辞——不点名角色、不指定前后台，考的是预设的自动路由与调度。
> 模型自己干了没委派也是有效结果，照实记录即可。

## T1 广域结构扫描 → 预期路由 explorer

```text
帮我梳理一下当前这个项目的整体结构：有哪些模块、入口在哪、配置文件都有什么。
```

预期：委派 explorer 后台执行；orchestrator 派发后结束回合，等完成通知再汇总。

## T2 外部调研 → 预期路由 librarian + MCP

```text
zod 这个库最近的大版本改动有哪些需要注意的？给我一份带来源的要点。
```

预期：路由 librarian 后台运行（前台会缺 MCP 工具）；首轮工具列表即含 `mcp__context7__*` / `mcp__gh_grep__*` 并实际调用。
成本护栏（可选追加，不影响调度）：`最多搜索 3 次。`

## T3 有界实现 → 预期路由 fixer

> 触发关键：需求规格由用户完全写死。规格留白的实现任务模型多半自己写。
> 先准备基线项目：把本预设目录附带的 `examples/omo-probe-baseline/` 复制为 `/tmp/omo-probe`
> （含 lib/math.js、lib/io.js、main.js，`node main.js` 输出 `5 12` / `2`），然后发送：

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

预期：路由 fixer 后台执行（带任务标签、结束回合等通知）；完成后核对产物与验收标准。

## T4 图片分析 → 本版本不适用

> observer 角色在本版本默认关闭：粘贴的图片只会到达主模型本人，无法转交给子代理。
> 当前替代：直接把图片粘贴给具备视觉能力的主模型分析。

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

预期：路由 designer，给出具体可执行的 UI 建议。

## T6 架构咨询 → 预期路由 oracle

```text
有一个 FastAPI + SQLite 单体应用（单一写库、读多写少、单机 systemd 部署，无微服务化历史），用户量预计下个季度涨一个数量级，读写压力和部署灵活性都会吃紧。团队要在本迭代内定一个不可逆方向：
A. 留在 SQLite，做分库分表和垂直拆分；
B. 迁移 PostgreSQL + 读写分离；
C. 维持单体但做模块化改造，为将来拆分铺路。
帮我从架构角度评估三个选项的利弊、风险、迁移成本和长期影响，给出倾向性结论和理由。
```

预期：路由 oracle 后台执行（结束回合等通知），返回带权衡的分析 + 倾向性结论；orchestrator 整合时只做最小核查。

## T7 并行双通道 → explorer + librarian 同时派出

```text
我想引入一个新的状态管理库。一边看看这个项目里现在状态是怎么管理的，
一边查查目前主流方案的对比和社区口碑，最后一起给我个建议。
```

预期：**同一条消息里并行派出两个子代理**（explorer + librarian），orchestrator 结束回合；
两条完成通知先后到达后被唤醒整合，最终结果综合两路发现。
