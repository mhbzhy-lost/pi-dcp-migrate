# 本地压缩审计与回看报告实现计划

**目标：** 让使用者持续看到模型想压缩什么、插件实际移除了什么、最终回填了什么，以及这些变化何时在 DCP 的上下文输出中生效；保留完整原文供人工判断质量，不用 token 节省数字替代内容证据。

**仓库：** `/Users/leshi.zhy/pi-dcp-migrate`，公开 fork `https://github.com/mhbzhy-lost/pi-dcp-migrate`。

**授权：** 用户先要求「对，要补观测能力，写计划吧」，首轮审阅及 inline 修订完成后，通过提问工具明确选择「主会话串行执行」，现按本计划开始实施与隔离真实验证。新增测试、全新 fixture、commit、push、发布、全局安装和改动用户日常 Pi 配置均未获授权。

**执行模式：用户已选择主会话串行执行。** 实现不派发 subagent；规范要求的独立最终验收仍保留。计划由主会话 inline 编写、审阅后 inline 修订。

## 1. 基线、范围与非目标

- 当前工作树已有上一轮精简的未提交改动，不能重置、覆盖或当成外来垃圾删除。Git HEAD 为 `ea1b7b99ff5b678412ccbfc62089b48f6847fcfd`；实施前重新记录 dirty 清单及文件哈希，不以 HEAD 代替实际代码版本。
- 上一轮最终源码指纹为 `443327e662c7a3977e904274253a64e59608f89da309c00dd389f83ebaf4c779`，全量验收目录为 `.evidence/runs/2026-11-11T14-19-34-846Z/`。F1–F5 通过，F6 仍失败：GLM-5.3 未自主调用 compress，压缩后的实际投影、延续和分支未取得证据。新增观测不得篡改这些历史结论。
- 当前 `compress.ts` 只透传模型参数、保存最终块状态并返回处理数量和块 ID，DCP 没有独立保存原始参数；Pi 原始 session 的 toolCall 仍保留这些参数。`CompressionBlock` 保存最终摘要及覆盖集合；`context-render.ts:15-29` 真正执行移除/插入，debug 只记 anchor/blockId。现有 sidecar 不是追加式审计日志，也不能由 `effectiveMessageIds` 推断本次新增移除量。
- `dcp-controller.ts:64-81` 的处理顺序是 canonical 映射、状态协调、摘要投影、软提醒、消息 ID 注入、返回消息。提醒/ID 注入会修改消息对象，取证必须在修改前冻结输入，不能在处理结束后引用原对象冒充 before。
- 继续使用 Node `>=22.19.0`、现有固定 Pi `1.5.0`/TypeScript `5.9.3`/tsx `4.20.6`。不增加依赖、不迁移目录结构；根 TS 模块继续满足少于 400 有效行的既有门禁。新增 CLI 使用 `.ts` 并纳入已有 `tsc --noEmit`。
- 审计独立于压缩 sidecar，不改其路径、key、外形或压缩块恢复语义；不新增模型工具或 Pi 命令，不恢复旧统计、权限门或裁剪策略，不改变压缩提示词、提醒阈值、边界选择和摘要内容。
- 只观测 **DCP context handler 的输入/输出**。不接 `before_provider_request`、headers 或响应网络 hook，不抓系统提示、provider payload、认证头、auth/models 文件、环境密钥。报告明确写「DCP 输出」，不声称这是最终 provider 请求或模型已成功收到。
- 不做自动语义评分、第二个评审模型、自动改进提示词、遥测、上传、数据库、Web 服务、实时仪表盘或任意原文搜索系统。摘要质量仍由使用者结合原文和后续行为判断。

## 2. 整体交付终态

以下 O 项只定义本次观测功能完成，不替代上一轮 F6 的模型自主调用验收。全部必要条件对应当前交付版本，缺失、失败、blocked、未运行均不能计为完成。

**旧验收的继承状态：** 本次改动会改变交付指纹，旧 F5/F6 证据仍钉在 `443327e6…`，故交付后全量 `npm run verify` 预期 F5、F6 均 FAIL：F5 是旧范围审阅证据过期，F6 同时保留原本未自主压缩的失败事实。不能称旧 F5 仍验证了当前版本，也不能改判据/改历史 JSON 强行变绿；重新签发旧 F5 不在本计划范围。O1 有意只覆盖 F1–F4。

`.evidence/latest.json` 中 `allPassed:true` 只代表其中 `requested` 列出的 F 项；当 O1 运行 F1–F4 时，它不是全项目通过证明。本次 O 项的唯一权威索引是 `.evidence/observability/latest.json`。README、runtime notes 和最终独立审阅必须同时记录旧证据指纹、旧结论和当前的过期状态。

| ID | 必须成立的条件 | 方法与环境 / 单项命令 | 通过判据 | 证据位置 | 任务 |
| --- | --- | --- | --- | --- | --- |
| O1 AUTO | 既有压缩能力不退化，新生产模块和 CLI 类型/架构合规 | 本机实际 Node、固定 Pi 1.5.0；`npm run verify:observability -- --only O1` | 调用现有 `npm run verify -- --only F1,F2,F3,F4`；九个既有脚本及 tsc 全 exit 0，未降低断言 | `.evidence/observability/runs/<id>/O1.log`、原 F1–F4 manifest/report | A1–A5 |
| O2 AUTO | 每次真实压缩的原始请求、展开/合并结果、摘要各阶段和内存提交可追溯 | `npm run verify:observability -- --only O2` | 实录含正常模型 toolCall，原始参数可与 session 对照；至少观察两次压缩且第二次纳入旧块；最终摘要与 sidecar/投影相符；保护追加内容有来源，不靠猜测分隔符 | 同目录 O2.log；`.evidence/observability/runtime/acceptance.json` 的 request-materialization 项及原始 session/audit | A3、A6 |
| O3 AUTO | 同一次 context 处理的真实移除、插入、保留及提醒/ID 改动可完整回看 | `npm run verify:observability -- --only O3` | before/projection/output 三阶段完整可校验；新增移除来自实际输入输出而非块的累计覆盖；非选定消息在投影阶段内容/顺序不变；快照未因后续原位修改漂移 | O3.log；实录 projection-diff、next-context-link 项及完整审计附件 | A3、A6 |
| O4 AUTO | 提交与应用状态不混淆；重启/分支不串联事件，不把截断或缺失记录当完整证据 | `npm run verify:observability -- --only O4` | 区分提交、首次及重复 DCP 输出应用、预存块、记录缺失；真实压缩块经正常重启及至少一种公开分支入口后，session/leaf/process 身份及应用关联正确；必须实际覆盖 origin 保留与截断，单纯切换无关会话不够 | O4.log；实录 lifecycle 项、原始 RPC/session/sidecar/audit | A2–A4、A6 |
| O5 AUTO | 默认关闭、显式可信启用、本地私有存储、有界录制与可见失败，不改变压缩行为 | `npm run verify:observability -- --only O5` | disabled 无正文审计文件；项目不能暗中启用；新目录/文件权限正确；真实限额/文件系统故障显示暂停或不完整，正常会话仍可结束，错误不回填给模型；无凭据接口采集 | O5.log；实录 opt-in、budget、io-failure 项及独立源码审阅 | A2、A3、A6、A7 |
| O6 AUTO | 本地 HTML 报告完整展示实录及对比，安全离线、不冒充账单或 provider 实收 | `npm run verify:observability -- --only O6` | Node 原生 CLI 正常退出；报告引用与原文/哈希可复核，长文不静默截断；HTML 特殊字符被转义，无外部资源/脚本；显示缺口和各阶段字节数而非省钱结论 | O6.log；实录 report 项、生成的 HTML 及校验输出 | A4–A6 |
| O7 AUTO | 文档与观测实现、隐私和旧 F5/F6 证据状态一致，独立验收逐项核对原始证据 | `npm run verify:observability -- --only O7` | 固定审阅清单全部 passed、引用存在且指纹一致；明确旧 F5 过期与旧 F6 失败，不以执行者自报、子集 allPassed 或旧指纹替代；没有未经授权的新测试/fixture/提交/发布 | `.evidence/observability/review/{acceptance.json,review.md}`、O7.log | A5、A7 |

### 可直接落盘的 goal 验收清单

```text
目标：Pi DCP 本地压缩审计与回看报告
工作目录：/Users/leshi.zhy/pi-dcp-migrate
统一自动验收命令：npm run verify:observability
证据索引：.evidence/observability/latest.json
O1 AUTO：npm run verify:observability -- --only O1；既有 F1-F4/九脚本/tsc/架构全 exit 0
O2 AUTO：npm run verify:observability -- --only O2；真实请求、展开、保护追加、嵌套块、内存提交证据完整
O3 AUTO：npm run verify:observability -- --only O3；同一 context 三快照与实际增删/保留可逐条复核
O4 AUTO：npm run verify:observability -- --only O4；提交/应用分离，真实块重启及公开分支的origin保留/截断、身份和关联正确
O5 AUTO：npm run verify:observability -- --only O5；可信启用、disabled、权限、限额、IO失败和不干预证据成立
O6 AUTO：npm run verify:observability -- --only O6；离线报告完整、转义、安全、字节量和缺口显示正确
O7 AUTO：npm run verify:observability -- --only O7；独立审阅逐项 passed、引用和当前指纹一致
输出：每项 O编号、PASS/FAIL、真实exit、证据路径；全部通过才 exit 0
源码证据：复用 scripts/verify.ts 的根TS、scripts/*.ts、固定配置/README/package/lock/LICENSE/.gitignore 哈希算法与实际版本；docs/plans、node_modules、.evidence不参与交付指纹
证据状态：runtime和review JSON必须含status、sourceFingerprint、checks[{id,status,evidence[{path,locator}]}]；缺失/blocked/failed/引用缺失/旧指纹均失败
继承状态：旧F5/F6因指纹变化在全量npm run verify中预期FAIL；旧F6原失败不变，不重新签发旧F5；.evidence/latest.json的子集allPassed不代表O项或全项目通过
停滞判据：同一O项连续3轮无新增证据、根因或输出实质变化即停滞，停止盲改，记录未满足项与恢复前提
禁止：用人工构造toolCall/JSONL/审计记录冒充实录；用本次人工请求压缩的成功改写旧F6自主压缩失败；用输出目录存在或subagent自报代替证据
```

审计有用与否的语义质量评判是持续使用行为，不在本轮自动给出「摘要合适」结论。新增测试建议仅列在第 9 节，未授权前不创建。

## 3. 数据与观测契约

### 3.1 身份与边界

- 全部记录 `formatVersion: 1`、本地时间、递增序号、`processRunId`（每个录制进程 UUID）、sessionId/sessionKey/sessionFile、parentSession、当前 leafId；这些来自当前 Host 的只读 sessionManager，不用 mNNNN 作为跨重启主键。parentSession 使用 `ctx.sessionManager.getHeader()?.parentSession`，其余使用 `getSessionId/getSessionFile/getLeafId`；不为审计解析原始 JSONL 首行。
- context 事件另有本进程 `contextPassId`；这只是 DCP 处理编号，不冒充 HTTP requestId。工具事件保留 `compressCallId`、origin entry ID、runId/blockId；块身份使用 session + blockId + origin，不能只用易重复的 bN。
- 保存 raw entry ID ↔ mNNNN 的当时映射；未匹配扩展消息保留 ordinal/hash，明确标为 unbound，不猜造 Host 身份。synthetic summary 用 blockId/anchor 标识，不能把变化的 syntheticCounter 当跨请求身份。
- 记录实际 Node/Pi/package 版本和本次加载的 production 根 TS、package.json、schema 的独立源码哈希；实录验收另绑定完整交付指纹，两种指纹名称和覆盖范围明确区分。

### 3.2 压缩请求、物化和提交

- 在 `compress.ts` 执行入口保存模型原始参数的独立 JSON 表示；每段保留请求边界、当时解析到的 raw IDs、原始模型摘要。
- 在 `compression-engine.ts` 的 requested、扩展/合并最终 plans、materialize、commit 节点采集旁路 trace。调用合并前冻结 `requested[i].selection`；原范围来自该值，最终范围来自合并后 `plan.selection`，合并来源来自 `plan.sources[].inputIndex` 与 `plan.label`。扩展增量严格定义为最终 `messageIds` 减去各贡献 requested selection 的 `messageIds` 并集；不声称捕获 planner 内部「已扩展未合并」中间态，不改 planner 或重跑 `expandRangePlan`。
- 在 `compression-summary.ts` 已有字符串拼接节点记录：模型摘要按现有顺序组合后的文本、旧块展开后的文本、保护追加项及其原始 entry/toolCall/旧块来源、最终 wrap 后摘要。分段 provenance 在生成点采集，不能反向解析自然语言标题来猜。
- 唯一新增机制是可选 observer；关闭时不构造正文快照。observer 不能改变选择、摘要、block/ID、工具响应/`details`、通知或 sidecar。原 `runRangeCompress` 的既有调用形状保留可选参数兼容。
- 各块在现有 commit 后立即复制提交事实。一次批量调用若后段抛错，记录已提交的块和失败位置，不假装事务回滚。原异常仍原样交 Host；不得为审计顺手修压缩事务算法。
- 提交事件只证明内存提交，不声称 sidecar 落盘成功或下游已经使用。没有后续应用记录时显示「已提交，尚未观察到应用」；审计缺口存在时显示「未知/记录不完整」，不推断从未应用。

### 3.3 同一次上下文处理的三份快照

| 阶段 | 采集位置 | 说明 |
| --- | --- | --- |
| before | canonical 映射与 reconcile 后、`pruneMessages` 前 | 本次 DCP 处理的实际输入，不是全部磁盘历史 |
| projection | `pruneMessages` 返回后、提醒/ID 注入前 | 精确体现摘要块替换原文的结果 |
| output | 软提醒与 ID 注入后、handler 返回前 | 本扩展即将返回 Host 的消息；后续扩展/Host/provider 仍可能改变或拒绝它 |

- 进入下一阶段前冻结上一阶段的完整可序列化消息值，不能只保存对象引用；按 JSON 语义保存 AgentMessage 的正文/结构，不为显示而截断或改写，非文本块同样保留其 JSON 内容。序列化失败只标记审计不完整，不引入生产数据兼容分支。
- `context-render.ts` 在实际 skip/push 的位置提供只读 projection trace，包含移除位置/raw ID、插入位置/blockId/anchor。A3 在录制时调用 A1 交付的纯函数 `audit-projection.ts`，由本次 before/projection 计算新增移除与插入并写入 `diff.json`；A4 只读取它，并在 `--check` 中按本次快照重算核对。旧块的 effectiveMessageIds 仅作沿革展示。
- 以实际消息身份、顺序和内容哈希核对保留部分。projection → output 的修改单列为提醒/ID 注入，不能混成压缩移除；未经识别的改动按 unknown 展示，不能隐去。
- 审计开启时持续记录每次有压缩调用、活动块投影或相关生命周期变化的处理；在首个压缩前记录轻量 context 元数据即可。每次有活动块的 context 都保存该次真实三快照，不拿上次快照冒充本次，也不比较相邻请求推算压缩收益。
- 首次应用和后续重复投影分开展示。启用审计前已有的块标为「预存块，请求未录制」，仍可观察本次应用；重启后关联旧记录前核对 origin，不把同名 bN 串到其他分支。原生 compaction/tree/session 切换保留边界事件，历史记录不随 sidecar 重置删除。
- 既有 `message_end → stripAssistantMetadata` 会在两次 context 之间清理 assistant 幻觉元数据；下一次 before 已是清理后的实际输入，不是原始 session 的逐字重放。只比较同一次处理，不能把这一既有跨请求清理误报为本次压缩或 unknown 改动；本轮不扩张采集边界去回放所有 Host 变换。

## 4. 配置、存储、资源与失败策略

### 配置新增面

```jsonc
{
  "audit": {
    "enabled": false,
    "maxRunBytes": 268435456
  }
}
```

- 只有两个字段：默认关闭；单次进程录制正文/记录总预算默认 256 MiB，`maxRunBytes` 必须是正安全整数。`debug` 仍只控制原 debug 日志，与审计开关独立；扩展 `enabled:false` 时连审计也不启动。
- **可信启用：** audit 字段只允许来自全局配置或显式 `PI_CONFIG_DIR`；项目 `.pi` 层出现 audit 字段明确拒绝，不允许仓库配置静默打开全量正文采集或提高预算。schema 与 README 说明该来源约束，旧配置未知键仍 fail closed。
- 固定目录为 `$XDG_DATA_HOME/pi/dcp-audit/v1/<session-key-hash>/<processRunId>/`，未设 XDG 时用 `~/.local/share/pi/dcp-audit/`。不新增项目可指定的上传/输出目录，不与压缩 sidecar 混存。
- session-key-hash 根据 sessionFile 或 in-memory sessionId 计算，避免把用户字符串直接拼入路径；parent/leaf 等原值保存在私有记录内。

### 记录落盘

- `audit-types.ts` 定义版本化 JSON 契约；`audit-storage.ts` 实现固定布局。每条记录是独立目录：`record.json` 引用 `request.json` 或 `before.json`/`projection.json`/`output.json`、`diff.json` 等附件，引用含相对路径、UTF-8 字节数、SHA-256。
- 新建目录 mode `0700`、正文/记录/报告 mode `0600`；不递归 chmod 既有目录。每个进程独立 run，串行写入，先写私有 `.partial` 目录中的附件，最后同文件系统 rename 发布完整目录；未发布的 partial 只显示不完整，不能当有效审计。
- 在 `compress.execute`、async context handler 与退出生命周期中等待自己的写入/flush；engine 的同步 observer 只收集已冻结的值，不做异步即发即忘。不得重现已修复的 shutdown 截断竞态。
- 达到预算不截断原文伪装完整：停止本 run 的后续正文录制，写一个小型 status 记录并提示使用者。status 包含最后完整/当前 contextPassId、已用字节和剩余预算。预算为完整记录预算，status/error 元数据另限 64 KiB、只保存一次终止状态且不含正文；写不下 status 时仍必须向用户警告，不能报告日志完整。
- IO/序列化失败是「观测失败」，不是「压缩失败」：保持原工具结果和上下文返回，向用户警告一次并暂停本 run，后续报告标明缺口。已发生的压缩不能因审计失败被包装为可安全重试的未提交错误。
- 默认不自动删除任何历史；用户可关闭审计或清理明确的录制 run 目录。达到预算后由用户检查空间、保留所需记录、开启新的录制 run 恢复。首版不增加自动 purge/轮转/迁移器。
- 首版不增加内容寻址去重。三快照在长会话中可能较快达到预算，这是可见的录制限制，不是压缩失败。验证可预先在可信隔离配置设定足够预算，或保留完整旧 run 后正常重启同一 session 开新 run 继续取证；跨 run 按 session + origin 关联，不能隐去暂停区间或冒称连续完整。
- 全量正文可能包含会话中原本就有的源码、思考文本、个人信息或秘密。必须明确提示：不会额外读取认证来源，但不会承诺自动脱敏仍能保持精确对比。禁止自动分享/提交/上传原始审计文件。

## 5. 报告与 CLI

- `audit-report.ts` 负责只读加载、引用/哈希校验及会话索引，`audit-html.ts` 负责 HTML 文本转义与静态渲染，预先拆分以满足根模块少于 400 有效行的门禁；`audit-projection.ts` 提供纯差异计算，`audit-types.ts` 提供格式契约。CLI `scripts/dcp-audit.ts` 只消费这些领域实现，不反向作为 production 库。
- 用户入口：`npm run audit:report -- --session <session-key-hash> --out <report.html>`；可带 `--run <processRunId>` 限定单次录制。无 session 参数时列出本地会话索引、录制状态及使用实际 hash 的可复制命令，不要求手算 hash，不导出所有正文。`--check` 只读核验所选实录的 schema、引用、哈希、阶段与差异完整性，损坏或缺失返回非零并说明原因。
- CLI 用 `node scripts/dcp-audit.ts` 原生执行，所有类型 import 使用 type-only 与显式 `.ts` 扩展；不依赖 tsx 的运行时安装。将该入口加入 package files，现有根 TS 生产模块照旧打包；不改包名、版本、许可证，不发布。
- CLI 的运行时传递依赖只允许 Node 内置模块及本仓 `audit-*.ts`。对 Host 包、typebox、controller/index/compress/compression 等其他模块只能 `import type`；所有 audit 模块及 CLI 禁止 enum、namespace、构造函数参数属性等 strip-only 不支持语法。不能用 tsc 或 tsx 通过替代真实 `node` 启动验证；不为此改写现有 controller 的参数属性。
- 报告按会话/分支/process/调用/应用顺序展示：模型原始范围与摘要、事务扩展/合并、旧块引用、实际移除原文、最终回填、保护追加来源、before/projection/output、后续重复应用、生命周期与缺口。未应用、预存块、被替代块和日志暂停须显式显示。
- 长原文用 `<details>` 折叠，不在 JSON 或渲染后的正文中静默截断；折叠是显示行为，不改原始数据。保留按 entryId/blockId 定位的锚点，方便后续把错误行为关联回具体事件；不新增自动质量评分。
- 显示每阶段实际消息数与序列化 UTF-8 字节数，区分新移除与历史覆盖；不显示累计省钱、真实 token 节省或缓存收益，正差异/负收益均如实展示。
- 报告完全离线：不加载远程字体、脚本、图片或 CDN，不启动服务器，不自动打开浏览器或上传；所有正文按 HTML 文本转义，并设置限制性 CSP。读取附件时校验相对路径及 realpath 均在记录目录内、大小/哈希匹配，不能利用符号链接或正文提供的任意路径去读取本机文件。

## 6. 任务拆分与 DAG

```text
A1 审计数据/observer 契约
 ├── A2 可信配置与私有录制存储 ── A3 压缩/上下文旁路采集 ──┐
 └── A4 离线报告与只读 CLI ──────────────────────────────┼── A5 集成/文档/验收编排 ── A6 真实取证 ── A7 独立最终验收
```

依赖只消费具体产物：A2/A4 消费 A1 的记录布局、身份、状态、附件契约和纯差异模块；A4 不依赖 A3 的采集实现，读取格式已在 A1 固定。A3 消费 A1 的差异函数及 A2 的可调用 recorder 与禁用/失败语义；A5 消费 A3 的实际事件及 A4 的报告/校验接口；A6 消费 A5 冻结后的源码和可执行命令；A7 直接检查 A6 的原始证据。A2 和 A4 无相互依赖，可并行；无批次屏障，每个结果到达立即检查所有 ready 任务。

### A1：落实稳定的审计与 observer 契约

**写路径：** 新增 `audit-types.ts`、`audit-projection.ts`，本计划由主会话维护。**交付：** 身份、request/materialization/commit/context/lifecycle/status、附件与差异、report 读取结果的 TypeScript 类型及第 3–5 节对应的固定磁盘布局；纯差异函数只消费这些类型，不引用 Host 运行时或脚本入口。定义同步只读 observer 与异步 recorder 接口、A2 的工厂与 A4 的加载/渲染接口，事件区分内存提交和 DCP 输出；不写审计数据、不改运行路径，遵守 strip-only 依赖/语法限制。

**验收：** `npm run typecheck`；接口不引用脚本/Host 入口，不要求每条应用都有本次录制的请求，不以 bN 单独作为跨分支身份。**停止：** 若 Host 身份 API 与计划不符，记录真实类型位置，由主会话修订契约，不造替代 ID 冒充。

### A2：加入可信开关和有界私有存储

**依赖：** A1 类型/布局。**写路径：** 新增 `audit-storage.ts`；修改 `config.ts`、`dcp.schema.json`。**交付：** `createAuditRecorder`、开关、可信来源校验、原子发布、预算、暂停/警告、flush；不改 sidecar。`PluginConfig.audit` 为有完整默认值的必填配置，observer 为可选；当前九个测试通过 `getConfig` 取得配置，不需要修改其构造。

**验收：** 类型检查及既有配置消费者检查；记录没有自动创建审计目录的禁用路径。真实权限/限额/IO 故障由 A6 单独验证，不在实现任务启动真实会话。**停止：** 必须修改 sidecar/认证来源、引入新依赖或新 fixture 时停止报告。

### A3：接入压缩与上下文旁路采集

**依赖：** A1 纯差异模块、A2 可用 recorder。**写路径：** 修改 `compress.ts`、`compression-types.ts`、`compression-engine.ts`、`compression-summary.ts`、`context-render.ts`、`dcp-controller.ts`；消费但不重写 A1 的差异函数。observer 必须可选，目标是九个既有测试零改动；若必须调整测试，先报告实际接口原因，不擅自删改断言或增加场景。

**交付：** 请求原貌、resolved/expanded/merged selection、物化分段 provenance、每块提交事实、同次三快照与 skip/push trace、生命周期及下一次应用关联。`compression-summary.ts` 此次明确允许添加只读 provenance 采样，但不重写原拼接算法；`compression-commit.ts`、planner、transaction、conversation、persistence 与 sidecar 类型保持只读。

**接线责任：** A3 在 controller 中读取已校验的可信配置、构造 recorder、向 `CompressionRuntime` 注入可选 observer、接入三快照，并在 session_shutdown 等待原 state 保存和 audit flush。生命周期利用 session_start/session_tree/session_compact/session_shutdown，并按实际 Host 行为增加只读 session_before_fork/session_before_switch 监听；新增监听最终必须返回 `undefined`（异步可为 Promise<undefined>），不得返回 Result、取消/重定向 fork/switch 或覆盖 compaction。事件未被某 public 入口发出时如实注明，由实际前后身份/branch 证据补足，不能捏造已监听到的事件。

**验收：** `npm run verify -- --only F1,F2,F3,F4` 全 exit 0；审阅确认快照在原位修改前冻结、observer 错误隔离、审计数据未进入系统提示/tool details/agent message。**停止：** 发现必须改变边界/摘要/事务语义或只读内核，先记录实际入口、权威身份、事件顺序、首个偏离点，分类后报告，不能顺手加 fallback。

### A4：提供离线回看与实录完整性校验

**依赖：** A1 格式、固定目录布局和纯差异函数，不依赖 A3。**写路径：** 新增 `audit-report.ts`、`audit-html.ts`、`scripts/dcp-audit.ts`；不写 package、config、生产采集点或测试。**交付：** 第 5 节原生命令、会话索引、只读 `--check`、静态 HTML、完整原文和差异、明确状态/缺口/范围标签。

**验收：** 类型检查及 `npm run check:eloc` exit 0；使用 `XDG_DATA_HOME="$PWD/.evidence/observability/empty" node scripts/dcp-audit.ts`，必须是 node 而非 tsx，在隔离空目录显示「无记录」且 exit 0、不伪造数据、不读取用户既有审计。真实内容展示和安全证据交 A6。**停止：** 契约不足或需新 fixture/前端依赖/网络服务时先报告，不先手造压缩记录让报告变绿。

### A5：整合入口、公开说明与验收编排

**依赖：** A3 实际事件、A4 实际 CLI。**写路径：** `package.json` 的 scripts/files，`README.md`，新增 `scripts/verify-observability.ts`；A1–A4 文件仅在明确记录接口接缝后做最小修正。既有九个测试保持零改动，必须改动则报告；不改旧 `scripts/verify.ts` 的 F5/F6 判据或历史证据，不重新签发旧 F5。

**交付：** `audit:report`、`verify:observability` 及打包入口；README 写完整新配置/信任来源/私有路径/预算/手工清理/关闭/报告/敏感信息/观测层级，并把陈旧的开发状态改为准确引用证据索引，不嵌入会导致自失效的最终哈希。明确旧 F5 passed 只对应 `443327e6…`、新代码使其过期，旧 F6 未通过；全量旧 verify 预期 F5/F6 FAIL 不是本次回归，`.evidence/latest.json` 的子集 allPassed 不代表全项目通过。本次权威索引是 `.evidence/observability/latest.json`。新审计实录允许普通人工压缩请求但不替代自主触发验证。

**验收编排：** `verify-observability.ts` 仅运行既有 F1–F4、调用领域 CLI 核验真实记录、核对 runtime/review JSON 与当前交付指纹；不创建行为测试/fixture、不自行发模型请求。每次输出 O1–O7 真正 exit 和独立运行目录，`.evidence/observability/latest.json` 索引本次结果；所有子进程 cwd 为仓库根。缺证据全量必须非零。

**固定实录 check IDs：** `request-materialization`、`projection-diff`、`next-context-link`、`lifecycle`、`opt-in`、`budget`、`io-failure`、`report`。O2 读取第一项；O3 读取中间两项；O4 lifecycle；O5 opt-in/budget/io-failure；O6 report。O7 读取独立审阅的 `scope-identity`、`scope-projection`、`scope-storage`、`scope-privacy`、`scope-report`、`scope-regression`。每项必须有非空的存在引用，不把「声明 passed」当作原文审阅的替代。

**验收：** 本地 tsc/九脚本通过；缺 runtime/review 时 O2–O7 明确失败。在最终实录之前冻结 README/package/脚本等全部交付文件，之后只写证据和计划进度。**停止：** 需要发布、改包名版本/lock 依赖、污染旧 F6 或新增测试时停止。

### A6：以真实 Pi 会话取得观测证据

**依赖：** A5 冻结的交付版本。**写路径：** 人工编排和实录仅 `.evidence/observability/` 和本计划进度；运行既有 F1–F4 编排器产生的 `.evidence/runs/`、`.evidence/latest.json` 也在允许范围，仅保留其正常输出，不手改。不得改源码/测试/README，不创建手拼消息/压缩块/审计记录。修复与真实运行验证必须分属不同派发。

**环境：** 使用项目本地 Pi 1.5.0，正常 `PI_CODING_AGENT_DIR=/Users/leshi.zhy/pi-config/pi`，隔离 `PI_CONFIG_DIR`/XDG/session 到本任务证据目录。保持 `--no-extensions --no-mcp --no-skills --no-prompt-templates --no-themes --no-context-files -e ./index.ts --mode rpc`，不 offline、不读复制认证内容；只记录 provider/model 元数据。等待 `agent_settled` 后取 entries/state，不能把 prompt 接受响应当完成。

1. 先运行 F1–F4 固定当前指纹/版本。用正常只读源码分析任务产生真实 read/toolResult；在隔离可信配置启用 audit，且将 `read` 加入 protectedTools，以真实输出覆盖保护追加，无需新增 fixture。
2. 本次为验证观测，可以通过普通用户压缩请求或 `/dcp-compress` 请求模型调用工具，模型仍自己提供范围/摘要。记录 `trigger=operator-requested` 在验证说明中，不伪装 autonomous；不手工塞 toolCall/append JSONL。第一次压缩后继续正常问答，再请求压缩包含已有块的已结束阶段，观察第二次真实调用和后续上下文。
3. 逐条核对原始 session 的 toolCall 参数、各阶段摘要、sidecar 与审计的 block/origin，以及 before/projection/output 的真实内容。报告的新增移除数来自当前差异，不取累计覆盖。证据中的普通内容/标记若包含 HTML 字符，核对报告转义；可正常读取新增报告模块源码形成合法内容，不造恶意消息 fixture。
4. 正常退出并 `--session` 重启同一真实有块会话，再通过公开 fork、同文件 tree 导航或切换至由 public 入口创建的分支，至少采用一种路线实际覆盖 origin 保留与截断，核对录制 run/session/leaf 边界、预存块和应用关联。单纯切换无关会话、clone 相同历史不能替代此判据；不得更改原始历史来制造分支。录制预算耗尽时可正常重开同一 session 形成新 run 继续，保留旧 run 和暂停证据，不静默提高默认预算或隐去缺口。
5. 独立隔离运行 disabled、低 `maxRunBytes` 和审计目录不可创建三类配置/文件系统场景。文件系统故障只在证据目录的 audit 子路径施加，不能破坏压缩 sidecar 路径或用户目录；记录为已知来源的环境故障注入，不当作非法消息的生产兼容需求。核对无正文/暂停警告、正常模型会话可结束、原工具/上下文不被审计错误改写。项目层拒绝另以 `.evidence/observability/runtime/proj/` 为 cwd，在其 `.pi/dcp.jsonc` 放 audit 配置并正常加载本扩展的绝对路径；最近 `.pi` 必须命中该隔离配置，不在仓库根或用户家目录造/改配置。此为真实启动配置，不构造模型消息或压缩记录 fixture。
6. 从 CLI 索引取得可复制的实际 session-key-hash，运行 `node scripts/dcp-audit.ts --session <session-key-hash> --check` 和 `npm run audit:report -- --session <session-key-hash> --out .evidence/observability/report.html`，保存退出码、全部原始审计、RPC/session/sidecar、报告与逐项事实 JSON/说明。
7. 写 `.evidence/observability/runtime/acceptance.json` 和 `notes.md`，按固定 IDs 对应真实引用及指纹，同时写明旧 F5/F6 原指纹/原结论及证据已过期；不可用/未取得压缩则 failed/blocked，不改源码、不伪造数据、不要求用户手工签字。单项连续三轮无实质进展按停滞记录。

**验收：** 当前版本 O1–O6 有完整证据。模型调用是正常 provider 费用，仍不增加审计自身的模型/网络请求。真实语义自主触发不属于本次 O2 的替代证明，旧 F6 状态保持不变。

### A7：唯一一次独立最终验收

**依赖：** A6 当前版本原始证据。计划执行完成后由主会话立即自动派发，全部 subagent 后台模式。**写路径：** 仅 `.evidence/observability/review/`，不改生产、测试或运行证据。

**交付：** `acceptance.json`、中文 `review.md`。独立重算指纹，读取实际 before/projection/output、session/sidecar、HTML 和限额/IO/disabled 证据，对 A5 六项固定 scope 逐项给状态与 `{path,locator}`。核对原文而非执行者自报，确认收集内容未反馈模型或上传、旧 F5 过期/旧 F6 失败未被冒充完成。只审阅本计划 O 项，不重新签发旧 F5；把旧全量 verify 的 F5/F6 预期失败与真正新回归分开列出。

**验收：** 主会话运行统一 `npm run verify:observability`，全部 O 项同时通过才宣告本次交付完成。若有范围内缺陷，拆成修复任务和重验任务持续推进；规范只自动这一轮独立最终验收，不无限追加审阅来追求签字。

## 7. 实施模式与调度规则

- **subagent 并发驱动：** 主会话只调度、整合与汇报；A1 完成后立即启动无真实依赖的 A2/A4，A2 完成立即启动 A3，不等待 A4。更快，但有接口/合并冲突成本。未授权 commit，不能使用要求提交的机械合并 worktree；初期写路径互不重叠，同工作区严格隔离，A5 收口接口，遇到重叠先暂停整合。
- **主会话串行执行：** 本会话按 DAG 拓扑顺序逐项实施，不派发实现 subagent；上下文连续，但受主会话上下文和轮次预算限制。规范要求的首轮独立计划 review 与最终验收不是实现并发。
- 用户选择前不开始实施。每次派发一个可独立审阅的精确任务，完整给出本计划绝对路径、上游具体产物、写路径、30 分钟预算和停止条件。修复与真实运行验证不合并派发。
- 启动后持续推进至全部必要条件满足或真实阻塞，不逐任务请求确认；每个任务完成即重新检查所有尚未启动任务，ready 即派发，不设批次屏障。

## 8. 停止、分类与恢复

- 发现未知工作区修改、写路径冲突、Host 身份/事件顺序与假设矛盾、必须改压缩内核/sidecar格式、需要新依赖/测试/fixture、涉及凭据/用户真实历史/全局配置/提交发布，停止相关操作并报告，不扩大范围。
- 数据异常先记录实际 public 入口、权威身份、事件与资源顺序、首个偏离点和生成链：合法 production 缺陷做最小修复；手工/过期 fixture 只修其来源；来源不明保留现场，禁止预防性 fallback。OS 限额/IO 注入需与真实故障分别标明。
- IO 失败的审计机制只处理本功能承诺的操作系统录制失败，不得借机对无来源证明的异常消息格式增加容错。
- 真实 provider/Host 不可用、模型拒绝普通压缩请求、同一 O 连续三轮无进展均记录未满足项、现有证据、原因、所需外部条件和恢复第一条命令；阻塞不等于完成。
- 实施后所有相关交付文件改动使旧指纹证据失效，必须重新运行受影响检查/真实流程；历史资料归档不覆盖。计划进度和 `.evidence` 不参与指纹，避免记录进度造成循环失效。

## 9. 建议（待用户具体授权，不在默认范围）

- 新增 observer 非干预测试：同一合法 Host 输入在 audit 开/关下完全相同，以及多工具批量部分失败的逐块事实。
- 新增存储故障/中断测试：ENOSPC/EACCES、预算边界、partial 记录、退出 flush、跨进程身份；fixture 必须源自明确的正常入口或精确 OS 故障，不能绕过 public 入口拼假消息。
- 新增报告安全测试：真实捕获内容的 HTML 特殊字符、路径越界、损坏附件、超长文本完整回看。

只有得到具体授权并在本节回填「已授权」后才创建上述测试/fixture。当前验收依靠既有检查、合法真实会话、只读实录完整性诊断与独立审阅；不把新行为断言藏进所谓验收脚本。

## 10. 审阅与执行记录

- 2026-11-12：主会话 inline 完成初稿，仅新增本计划，未实施生产变更。唯一首轮独立后台计划 review `ses_e34432973ffe5tmdYeB0D4Rs2p` 已完成，只读核对真实源码/Host 类型；主会话已 inline 修订，不自动派发第二轮计划 review。
- B1–B3 已修订：纯差异模块归 A1，A4 无未就绪依赖；CLI 运行时依赖/可擦除语法及真实 Node 启动门禁明确；旧 F5/F6 指纹失效、旧 F6 原失败和子集 allPassed 的含义单列，本次不重新签发旧 F5。
- M1–M4 已修订：扩展增量只从原始与最终 selection 推导、不要求 planner 中间态；预先拆 audit-html 以遵守行数门禁；A3 独占 recorder 接线/flush/只读生命周期，新增监听返回 undefined；项目拒绝配置在隔离 cwd 验证。M5 选择不增加内容去重，改为显式余额/暂停状态及合法跨 run 继续取证。
- L1–L6 已修订：纠正原始参数落盘描述，明确 getHeader/parentSession，索引输出带实际 hash 的可复制命令，O 项权威索引固定，可选 observer 以九个测试零改动为目标，说明 message_end 的既有跨请求清理不属于本次差异。
- 分支验收允许公开 fork/tree/既有合法分支切换路线，但仍必须实际覆盖 origin 保留与截断，不放宽成只切换无关会话。Node 22.19 未实机验证、真实模型能否配合以及部分 lifecycle hook 在 RPC 下的时机，仍留作明确环境限制与真实取证项，不提前声称通过。
- 用户通过提问工具选择「主会话串行执行」，实现现已启动；不派发实现 subagent，A1 → A2 → A3 → A4 → A5 → A6 顺序执行，最后按规范派发唯一独立验收 A7。未授权范围保持不变。
- A1–A4 已 inline 实现：新增 `audit-types.ts`、`audit-projection.ts`、`audit-storage.ts`、`audit-report.ts`、`audit-html.ts`、原生 CLI；A3 在既有压缩/物化/投影/生命周期接线。既有九个测试零改动。A3 门禁 `.evidence/runs/2026-11-11T18-15-21-987Z/` F1–F4 全 exit 0。
- A4 使用真实 `node scripts/dcp-audit.ts` 在 `.evidence/observability/empty` 空隔离目录显示无记录，exit 0；架构门禁 exit 0。类型检查发现报告 JSON union 缩窄不完整，已仅修报告局部变量类型；不是 production 数据兼容分支。
- A5 最小接缝修正：observer 增加 active 属性，暂停后不构造正文；报告应用计数只消费实际 inserted trace，不能把全部 activeBlocks 当已应用；run manifest 与一次无正文 status 共用额外 64 KiB 元数据额度，正文/记录预算严格独立。CLI 已验证原生 strip-only 可启动。
- A5 首次统一验收 `.evidence/observability/runs/2026-11-11T18-20-41-933Z/`：O1 exit 0，缺真实 runtime/review 的 O2–O7 exit 1（符合 fail closed）。README/package/验收脚本已更新，A6 前将再冻结当前全部指纹。
- A5 冻结指纹 `9bfca581d0d62601846a1152dcfb7098a395209ac906a06ea4e472fdb7e718f2`；O1 证据 `.evidence/observability/runs/2026-11-11T18-23-21-429Z/` exit 0。A6 期间全量旧 verify `.evidence/runs/2026-11-11T18-28-26-364Z/` 再证 F1–F4 通过、F5 旧审阅过期、F6 旧失败且过期，exit 1 符合继承状态；未改历史 JSON 或旧判据。
- A6 首轮合法 RPC 取证 `.evidence/observability/runtime/main/`：两轮 settled，审计正常收集且私有权限正确，但编排的 `--tools read` 将扩展 compress 一并排除，模型明确报告工具不可用。Host `dist/core/sdk.js:145-160` 证明该参数是完整允许列表；归类为编排入口配置错误，不是插件或模型拒绝压缩。保留该轮全部 session/审计，不改生产；只把 driver 改为 `read,compress` 并在独立 `main-2` 路径重跑。
- A6 已取得当前版本实录：`main-2` 两次真实模型 compress，b2 纳入 b1；受保护 read 输出、原请求/四阶段摘要/内存提交/实际三快照均有原文。同会话重启真实 b2、公开 fork origin 保留/截断均覆盖。默认 disabled、扩展 disabled、4096-byte 预算暂停、审计子路径 ENOTDIR 和隔离项目配置拒绝均保留实际结果；预算/IO 下压缩照常成功、警告不进模型消息。项目拒绝 exit 1 后 driver 响应等待超时如实保留，不伪装正常模型运行。
- A6 原生报告 `report.html` 1,461,009 bytes、0600，三 run/32 事件/74 附件值，CLI 检查 exit 0；暂停报告故意 exit 1。`.evidence/observability/runtime/{acceptance.json,notes.md}` 及下钻原文齐全；`npm run verify:observability -- --only O1,O2,O3,O4,O5,O6` 在 `.evidence/observability/runs/2026-11-11T18-34-25-275Z/` 全 exit 0，指纹未变。
- A7 唯一独立最终验收已后台启动 `ses_e341b6621ffeGlHaYGIT0aPeK0`，仅写 `.evidence/observability/review/`，逐项审阅源码和实录；未返回前不宣告 O1–O7 全部完成，不重签旧 F5/F6。
- A7 已返回：六项固定 scope 全 passed，独立重算 48 文件指纹仍为 `9bfca581d0d62601846a1152dcfb7098a395209ac906a06ea4e472fdb7e718f2`。主会话已读取 `.evidence/observability/review/{acceptance.json,review.md}`，核对原文结论、覆盖限制和继承状态；未发现范围内缺陷，无需额外修复或追加独立审阅。
- 最终统一 `npm run verify:observability` 真实 exit 0，O1–O7 同时 PASS；证据 `.evidence/observability/runs/2026-11-11T18-56-27-138Z/`，权威索引 `.evidence/observability/latest.json`，当前完整指纹与 runtime/review 一致。本计划本地观测交付完成，不代表旧自主触发 F6 已解决；旧 F5/F6 过期/失败及全量旧 verify 非零仍按 README 与历史证据保留。
- 最终限制不隐瞒：实机仅 Node 26.8.1/Pi 1.5.0/GLM-5.3；本次没有实际触发 60% 软提醒、非空事务扩展或部分失败的 tool-error，前两项沿用既有测试覆盖、后者仅源码审阅；不自动评判摘要语义质量。未提交/推送/发布/安装插件，未更改用户日常配置，完整原文仅在本地私有目录。
