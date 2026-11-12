# 模型驱动的 range-only 局部压缩实现计划

> **给执行 agent：** 逐任务执行并用复选框记录进度。只有整体交付终态全部验证通过，才算执行完成；否则持续修复、验证并对照终态。用户已选择 subagent 并发驱动并授权修订后自动执行，不再要求人工审阅签字。

**目标：** 在 Snowy 的公开 fork 上做减法，交付由当前模型自主选择时机和范围、自行撰写摘要的局部压缩扩展。

**架构：** 保留现有会话映射、range 压缩、工具事务完整性和压缩块恢复内核；删除独立裁剪策略和多模式控制。固定系统指引配合一种软提醒；不引入网关、额外摘要模型或第三方运营服务。

**技术栈：** TypeScript、Pi Extension API、typebox、Node.js；沿用根目录模块布局，不迁往其他项目的扩展目录。

**仓库：** `https://github.com/mhbzhy-lost/pi-dcp-migrate`；本地 `/Users/leshi.zhy/pi-dcp-migrate`。

**基线：** `ea1b7b99ff5b678412ccbfc62089b48f6847fcfd`，默认分支 `master`。上游 Git 中 package 版本是 `0.1.2`，与 npm 的 `0.1.3` 不同；不得据此擅自发版。

**授权状态：** 用户已授权按修订后的计划自动执行，并选择 subagent 并发驱动。新增测试、全新 fixture、提交、推送、发布和全局安装均未获授权。用户不再人工审核；独立验收和真实运行证据仍不可省略。

## 全局约束

- 自动性指模型自主调用 `compress`，不是定时强制压缩，也不依赖用户执行命令。
- 不等窗口接近上限才允许压缩；不鼓励每个小步骤都压缩。优先处理已经结束且有实质体量的阶段，保留正在使用的原文。
- 摘要由当前模型通过工具参数提交，不额外发起摘要模型请求。
- 第一轮不重写 block 状态机，不改变 sidecar 的存储目录、会话 key 或 JSON 外形，不运行批量状态迁移。
- 保留原始会话历史；上下文压缩只改变交给模型的投影，不能回写或删除历史正文。
- 保留工具配对、稳定 ID、失败/中断消息处理、受保护内容、重启恢复和 fork/tree 协调。
- 不增加模型/会话原文向第三方的上传、遥测、账户或授权服务；正常 Pi 到用户所选 provider 的模型请求不在此列。
- 采用“实现 → 验证 → 修复”，不采用 TDD。既有测试可随本次变更调整；新增测试或全新 fixture 只列为待授权建议。
- 不默认 commit、push、npm publish、修改用户 Pi 配置或安装扩展。保留 `AGPL-3.0-or-later`、`LICENSE` 和上游归属说明。
- Node.js 下限保持 `>=22.19.0`；本轮兼容性证据只声明实际运行过的 Node 版本与 Pi `1.5.0`，不把 peer 的 `*` 视作全版本支持。
- 开发依赖仅使用 `https://registry.npmjs.org/`；生产不增加运行时依赖。新 CLI 使用 `.ts`，并纳入 `tsc --noEmit`。
- 任何失败先区分真实入口、既有 fixture 和运行环境；不因手工构造数据失败而增加生产 fallback，不删除安全断言换取通过。

## 整体交付终态

| ID | 必须成立的条件 | 验证方法与环境 | 通过判据 | 证据位置 | 覆盖任务 |
| --- | --- | --- | --- | --- | --- |
| F1 AUTO | 入口、生产代码和验收 CLI 可类型检查，沿用架构门禁 | 本机实际 Node、固定开发依赖、Pi 1.5.0；`npm run verify -- --only F1` | `tsc --noEmit`、既有架构检查均退出 0；记录实际版本和源码指纹 | `.evidence/latest.json` 指向运行目录中的 `manifest.json`、`F1.log` | T1、T2、T3、T4、T5 |
| F2 AUTO | 现有 range 场景仍能把选定原文投影为摘要，非选定内容保留；既有重复调用/失败调用场景不再被规则裁剪 | `npm run verify -- --only F2` | 调整后的 `test-range.ts`、`test-runtime.ts`、`test-compress-tool-expansion.ts` 全通过；只移除与已删除功能绑定的分支，不删对应 range 安全断言 | 同运行目录 `F2.log`、`report.json` | T2、T3、T5 |
| F3 AUTO | 已有事务原子性、元数据和 canonical conversation 场景不退化 | `npm run verify -- --only F3` | `test-tool-transaction-integrity.ts`、`test-tool-call-metadata-integrity.ts`、`test-canonical-conversation.ts`、`test-pi-invisible-messages.ts` 全通过 | 同运行目录 `F3.log`、`report.json` | T2、T3、T5 |
| F4 AUTO | 已有保存、重载和 fork 继承场景保留 block 身份与分支隔离，不再恢复规则裁剪/手动模式/累计统计行为 | `npm run verify -- --only F4` | 调整后的 `test-fork-inheritance.ts` 全通过；保留父状态不被改写、截断条目不继承和自身状态优先等断言 | 同运行目录 `F4.log`、`report.json` | T4、T5 |
| F5 AUTO | 产品边界、配置、提示词、旧状态策略和公开说明与本计划一致 | 独立验收 agent 按下方固定清单审阅，`npm run verify -- --only F5` 核对结构化结论、逐项证据和当前源码指纹 | 固定清单全部通过；结论必须引用实际文件/行号，不能以执行者自报代替审阅；无用户签字步骤 | `.evidence/audit/scope-review.json` 及同目录 `scope-review.md` | T2、T3、T4、T5、T6、T7 |
| F6 AUTO | 真实 Pi 会话中观察到无需手动命令的模型驱动压缩，并在压缩后继续任务；重启与分支操作不串用状态 | T7 自动使用现有 CLI/RPC 或公开 SDK，在隔离 session/sidecar 目录验证；`npm run verify -- --only F6` 核对实际记录和指纹 | 模型实际提交摘要与范围；当前约束/工作延续；日志证明摘要投影；恢复/分支核对通过。环境不可用或未触发则 FAIL/BLOCKED，不得计为通过 | `.evidence/runtime/acceptance.json`、说明和原始 session/sidecar/debug 日志 | T7 |

**完成规则：** F1–F6 必须同时满足，且证据对应当前交付版本。单纯完成任务、通过既有 fixture 或得到 subagent 的完成回执，不能替代整体终态。F2–F4 只证明已有场景，不宣称覆盖全部真实 Host 行为或摘要保真。

### 可直接落盘的 goal 验收清单

```text
目标：Snowy fork 的自动模型驱动 range-only 局部压缩
工作目录：/Users/leshi.zhy/pi-dcp-migrate
统一自动验收命令：npm run verify
证据索引：.evidence/latest.json -> .evidence/runs/<本次运行编号>/
F1 AUTO：npm run verify -- --only F1；类型检查及既有架构门禁全通过
F2 AUTO：npm run verify -- --only F2；三个既有 range/runtime/expansion 脚本全通过
F3 AUTO：npm run verify -- --only F3；四个既有事务/元数据/canonical/invisible 脚本全通过
F4 AUTO：npm run verify -- --only F4；既有 fork/persistence 脚本全通过
F5 AUTO：npm run verify -- --only F5；独立验收结构化结论逐项通过且引用当前源码证据
F6 AUTO：npm run verify -- --only F6；真实Pi模型调用、摘要投影、继续任务和恢复/分支证据全部成立
自动输出：每项输出 F编号、PASS/FAIL、exit 和证据路径；全部 AUTO 通过才返回 0
证据有效性：记录 Git 基线、根TS（含既有测试）、scripts/*.ts、package.json/package-lock.json、tsconfig.json、dcp.schema.json、README.md、LICENSE、.gitignore 的 SHA-256 清单及实际工具版本；相关文件变化后重验；排除node_modules、.evidence和docs/plans，避免进度记录造成自失效
停滞判据：同一 F 项连续 3 轮没有新增证据、根因定位或输出实质变化，停止盲改并记录阻塞、待满足条件和恢复下一步
禁止：把缺少独立审阅、未观察到模型调用、跳过、环境失败或待授权测试计为完成
```

`verify` 是已有检查及实际运行/独立审阅证据的编排入口，不创建行为测试或 fixture，不自行发模型请求，不增加生产兼容逻辑。F5/F6 只核对已有证据的完整性、状态、引用和指纹，缺失即失败；证据内容由独立验收复核。T1 创建它之前，本清单尚不可运行，不能提前登记为通过。F6 的环境阻塞是允许报告的真实终态，但不是完成；其余项仍照常收口。

### F5 独立审阅固定清单

- 生产中无 `deduplicate`、`purgeErrors`、`applyToolPruning`、`runMessageCompress`、`MessageSchema`、`PromptStore`、custom prompts、manual/pending/ask 权限控制或 turn/iteration 提醒运行路径。
- `registerCommands` 仅注册 `dcp-compress`；compress 参数只有 range schema，新块只创建 `mode: "range"`，仍保留有效历史 `mode: "message"` 块的读取/投影。
- sidecar 仍有 `manualMode`、`prune.tools`、`stats` 和旧 anchors 外形键，值为固定中性；运行时 SessionState 不再读写这些旧字段。
- schema/配置默认值、未知键拒绝、disabled 不注册、固定指引、单一软提醒与受保护内容符合接口契约；软提醒不强制压缩。
- 稳定 ID、完整工具事务、原生 compaction、重启和分支协调未被旁路；元数据仍支持文件保护。已有安全断言未被删空或改成恒真。
- 无新增第三方运行时通信、额外摘要模型、全局安装或未经授权的新测试/fixture；README、AGPL、LICENSE 和上游归属正确。

## 接口与行为契约

### 工具和用户入口

- 唯一模型工具仍名为 `compress`，参数保持 `{ topic: string, content: Array<{ startId: string, endId: string, summary: string }> }`。
- 继续使用 `mNNNN` 原始消息引用、`bN` 压缩块引用、区间顺序检查、事务扩展/合并和旧摘要占位展开。不新增别名协议。
- `startId === endId` 沿用现有 range 的可用性；删除的是独立 message 模式，不禁止单消息长度的合法 range。
- 唯一补救命令是 `/dcp-compress [focus]`：发送一次普通压缩请求，让模型评估；不设置 pending 标记，不锁定下一次工具调用，不修改后续自主压缩权限。
- 删除 `/dcp` 的 help/stats/context/manual/sweep/compress 多路命令。成功回执保留 block ID、处理数量；错误明确说明原因。通知固定为一条简短信息，不展示摘要预览或 token 节省账单。

### 配置

保留 `getConfig(cwd: string): PluginConfig` 和现有 global → `PI_CONFIG_DIR` → project 搜索顺序、JSON/JSONC 支持；停止自动创建配置文件。`enabled: false` 时不注册工具/命令，不注入指引或改写上下文。

```ts
interface PluginConfig {
  enabled: boolean;                       // 默认 true
  debug: boolean;                         // 默认 false
  protectedFilePatterns: string[];        // 默认 []，保留既有保护语义
  compress: {
    protectedTools: string[];             // 默认 ["subagent"]，与默认值去重合并
    protectTags: boolean;                 // 默认 false
    protectUserMessages: boolean;         // 默认 false
  };
  nudge: {
    thresholdPercent: number;             // 默认 60，有限值且 0 < 值 < 100
    minMessageInterval: number;           // 默认 5，正整数
  };
}
```

- 不兼容上游完整配置。未知键、错误类型和非法数值明确报出路径与键名后停止加载扩展，不能静默回退为 enabled/allow；`$schema` 元数据除外。不能把旧 `permission: deny` 忽略后意外启用自动压缩。
- 不增加配置迁移器或废弃选项兼容层。README 给出以上完整配置与旧配置替换说明。
- 保留文件路径、工具输出、用户原文和 protect 标签的既有保护能力；删配置复杂度不能悄悄削弱保护。

### 固定指引与单一提醒

- `prompts.ts` 只提供固定的系统指引、range 工具描述和一种软提醒；删除 `PromptStore`、文件覆盖/生成/热加载、message/manual/强制恢复提示词。
- 系统指引明确阶段闭合、当前原文价值、用户意图与技术细节保真、批量处理、避免碎片化压缩、摘要不确定时不冒充原始事实。已有 block 按原有占位机制保留，不在本轮设计“摘要的摘要”算法。
- 继续从当前模型窗口和最近有效 usage 获得近似空间压力；无需另建 tokenizer。未知窗口或没有可用 usage 时跳过空间提醒，不妨碍模型按语义自主调用。
- 只有达到 `thresholdPercent` 且距上次提醒锚点至少 `minMessageInterval` 条有效 canonical 消息才增加提醒。候选锚点是最近有效 canonical 条目；若为带 toolCall 的 assistant，沿用事务完成后结果的落点规则。提醒不强迫调用，不改变工具权限。
- 复用 `contextLimitAnchors` 保存这一种提醒的锚点；旧 turn/iteration 锚点忽略。锚点无效、压缩完成或原生 compaction 时沿用协调/清理规则。
- 不把文本或 ID 注入带 toolCall 的 assistant 内容；提醒若落在该消息，沿用完整事务后的 toolResult 落点规则，结果尚不完整则不注入。

### 状态与删除边界

- 保留 `CompressionBlock` 图、ID 分配、active 索引、原生 compaction 重置、ancestor 恢复和 tree 协调。不以行数为目标重写 `conversation.ts`、`tool-transactions.ts`、`compression-planner.ts`。
- `tool-pruning.ts` 的实际剩余职责是受保护文件输出所需的调用元数据：迁为 `tool-metadata.ts`，只保留 `buildToolMeta(state: SessionState, messages: DcpMessage[]): void`，记录工具名、参数、状态、assistant/result entry ID；删除去重签名、工具年龄和规则裁剪。
- sidecar 继续保留旧外形：`manualMode: false`、`prune.tools: {}`、两个累计 `stats` 值为 0、turn/iteration anchors 为空数组；这只是序列化占位，不能驱动运行时行为。
- 读取旧状态时保留合法 range/message 压缩块及其历史 `mode` 元数据；以后只创建 `mode: "range"` 的块。旧 `prune.tools`、manualMode、累计 stats、turn/iteration anchors 不恢复执行。
- block 和 message index 中现有 token 字段可保留以维持格式；不再计算、更新或展示累计“节省 token”统计，不因去统计而改变嵌套块结构。
- 不删除用户旧状态文件，也不安装或运行旧插件来回写状态；验证使用隔离目录。公共 fork 的首次精简版本不承诺与旧插件反复切换使用同一 sidecar 的行为。

## 文件职责与写入范围

| 设计单元 | 文件 | 处理方式 |
| --- | --- | --- |
| 唯一 Host 入口和生命周期 | `index.ts`、`dcp-controller.ts`、`commands.ts` | 保留入口；删除 manual/权限分流，保留一个补救命令和必要事件 |
| 配置和固定指引 | `config.ts`、`dcp.schema.json`、`prompts.ts`、`context-nudges.ts` | 按上述契约缩减，不引入新配置框架 |
| range 工具和提交 | `compress.ts`、`compression-types.ts`、`compression-engine.ts`、`compression-commit.ts` | 删除 message 执行路径与累计统计，保留 range 内核与简短回执 |
| 元数据和投影 | `tool-pruning.ts` → `tool-metadata.ts`、`session-runtime.ts`、`context-render.ts`、`messages.ts`、`types.ts`、`compression-state.ts` | 删除规则裁剪，只保留保护所需元数据和摘要投影 |
| 状态恢复 | `persistence.ts` | 外形不迁移；旧旁路字段不再影响行为，压缩块与分支恢复不变 |
| 既有检查 | 九个现有 `test-*.ts`，具体按任务列举 | 只调整受本轮影响的接口、已有场景与断言，不创建新 fixture |
| 验收编排和开发环境 | `scripts/verify.ts`、`package.json`、`package-lock.json`、`tsconfig.json`、`.gitignore` | 新增一个编排 CLI、锁定开发依赖、忽略本地证据；不增加新行为测试 |
| 公开说明 | `README.md`、`package.json`、本计划 | 区分 fork 与上游、说明削减边界和已验证版本；不发版 |

`conversation.ts`、`tool-transactions.ts`、`compression-planner.ts`、`compression-summary.ts`、`patterns.ts`、`tokens.ts`、`logger.ts`、`LICENSE` 默认只读；发现必须修改才能满足安全条件时，先记录真实调用链并报告，不顺带重构。

## DAG 与调度

```text
T1 可复现基线与验收入口
 ├── T2 删除规则裁剪与累计统计 ──┐
 ├── T3 固定 range 工具与命令 ───┼── T5 配置/指引/提醒与接缝收口 ── T6 公开说明 ── T7 最终验证
 └── T4 旧状态语义收敛 ──────────┘
```

- Wave 1：T1。
- Wave 2：T2、T3、T4；相互不依赖，可并行，但 T5 必须对实际合并版本收口。
- Wave 3：T5。
- Wave 4：T6。
- Wave 5：T7；这是最后的广域验收，不替代各任务的局部验证。

**依赖产物：** T2/T3/T4 消费 T1 的基线结果、锁定工具链和可执行检查入口；T5 消费 T2 的无裁剪元数据/投影接口、T3 的 range-only 注册与命令、T4 的旧状态中性化读写；T6 消费 T5 的最终公开配置与操作行为；T7 验证 T6 完成后的最终文件指纹。

**关键路径：** T1 → T2/T3/T4 中最慢分支 → T5 → T6 → T7；真实模型服务是否可用可能决定最终完成时间。

Wave 仅作依赖展示，不是批次屏障。每个任务完成即检查所有未启动任务，依赖 ready 的立即启动。用户未授权 commit；T2/T3/T4 已核实写路径互不重叠，因此使用后台 subagent 在同一工作区按严格写路径并行，不启用要求提交的 `worktree: true`。其他任务独占写入；T5 负责明确的接口接缝，不允许覆盖其他 agent 或用户改动。

## 任务

### T1：建立可复现基线和现有检查编排

**Deps：** none。**Resources：** 官方 npm registry；本机 Node；不访问模型服务。

**WritePaths / Files：** 创建 `scripts/verify.ts`、`package-lock.json`；修改 `package.json`、`tsconfig.json`、`.gitignore`；生成被忽略的 `.evidence/`。本任务不改测试和生产逻辑。

**接口契约：** 产出 `npm run verify` 和 `npm run verify -- --only F1|F2|F3|F4|F5|F6`，以及 `.evidence/latest.json` 证据索引。F1–F4 执行既有检查，F5/F6 读取上述审阅/真实运行证据；记录真实 exit，不能只靠 PASS 文本判断。所有子进程 cwd 固定为仓库根，隔离仅通过环境变量实现，证据使用绝对路径写入。按明确清单核对九个 test 文件和全部选定命令存在，缺失即失败，不能 glob 静默跳过。

**终态关联：** F1–F4 的执行和证据基础。**验收标准：** 上游原始代码的九个现有脚本可运行；失败也完整保留，不能提前登记精简后的 F2/F4 通过。

- [x] 核对 HEAD、dirty 状态和真实 Host 类型，记录基线源码与现有九个脚本清单。基线失败先分类；不借此修生产或增加 fallback。
- [x] 固定开发依赖：TypeScript `5.9.3`、tsx `4.20.6`、`@types/node` `26.4.1`、三个 `@earendil-works/*` Host 包 `1.5.0`、typebox `1.3.27`；peer 范围不在此轮冒充支持矩阵。使用官方源 `npm install --ignore-scripts --registry=https://registry.npmjs.org/` 生成 lock，之后用同源 `npm ci --ignore-scripts`。
- [x] 将既有 scripts 中临时下载的 `npx --yes` 改为本地 `tsc`/`tsx`；`tsconfig.json` 包含根 TS 和 `scripts/*.ts`。`verify.ts` 只编排现有检查，按 F1–F4 表映射日志；每次创建独立运行目录，记录真实版本、SHA-256 和 exit，提供 latest 索引，不读取认证内容。
- [x] 每个子进程设置隔离的 `HOME`、`XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`PI_CONFIG_DIR`、`PI_CODING_AGENT_DIR` 和 `TMPDIR` 到本次证据目录；运行目录不落任何生产配置。把 `.evidence/` 加入 ignore。
- [x] 执行 F1–F4 保存为基线运行；全量 `npm run verify` 在 F5/F6 缺失时应明确失败。报告尚未实现的差异，后续任务不得把基线当作最终验收。

**T1 证据：** `.evidence/runs/2026-11-11T10-33-12-761Z/`；基线 F1–F4 全部 exit 0，F5/F6 证据缺失导致全量 exit 1。基线指纹 `b4d16e9bf1e1de6477b3103ae29a8543e8a2a85b8712fbb7df2ed88fc626730e`；不代表精简后终态已满足。

### T2：移除规则裁剪和累计统计

**Deps：** T1 的基线报告与本地检查入口。**Resources：** 本地 Node，无模型调用。

**WritePaths / Files：** 迁移 `tool-pruning.ts` 为 `tool-metadata.ts`；修改 `session-runtime.ts`、`context-render.ts`、`messages.ts`、`compression-commit.ts`、`types.ts` 的 ToolMeta 定义、`test-range.ts`、`test-runtime.ts` 中原有重复/失败场景及相关导入。

**接口契约：** 产出 `buildToolMeta(state, messages)`，保留保护文件输出需要的元数据；`reconcileConversation` 不再调用 deduplicate/purge，但本波保持 `(state, config, logger, messages)` 签名；`pruneMessages` 只投影有效 block。`isProtectedUserMessage` 本波不动，T3 删除其 message 消费方，T5 清理函数、barrel 导出和 BLOCKED 标签分支。暂留其他任务仍用的 config/state 字段，由 T5 最后收口。

**终态关联：** F1、F2、F3、F5。**验收标准：** 不调用 compress 时，原有重复工具结果与失败调用参数不被规则替换；受保护输出的元数据仍可查询；没有累计统计更新。

- [x] 从 `compression-summary.ts` 对 toolMeta 的实际消费倒推保留字段；不直接删除文件保护所需参数。
- [x] 删除去重、失败清理、年龄保护、签名归一化和 `applyToolPruning`；删掉累计 stats 的写入，不改变 block/index 字段和提交顺序。
- [x] 在已有重复/失败场景内把预期改为保留原内容；移除只服务旧规则的年龄检查，不新增场景或 fixture。保留 range 原文投影断言。
- [x] 执行 `npm run verify -- --only F2` 与 `npm run verify -- --only F3`，记录适用结果；接缝尚未完成时明确列出未通过原因，不增加临时运行时 fallback。

**T2 证据：** `.evidence/runs/2026-11-11T10-52-44-847Z/` 的 F2/F3 全部 exit 0；`.evidence/runs/2026-11-11T10-54-59-946Z/` 的 F1 exit 0。主会话已核对报告、`buildToolMeta` 字段和运行管线；当前无规则裁剪调用。旧 config/state 字段及 BLOCKED 标记按接口约定留 T5 清理，尚不登记整体终态通过。

### T3：只注册 range 工具和一个补救命令

**Deps：** T1 的基线报告与检查入口。**Resources：** 本地 Node，无模型调用。

**WritePaths / Files：** 修改 `compress.ts`、`compression-types.ts`、`compression-engine.ts`、`commands.ts`、`dcp-controller.ts`、`test-compress-tool-expansion.ts`。本任务不写 T2 的投影/元数据文件和 T4 的 persistence。

**接口契约：** 保留 `registerCompressTool`、`runRangeCompress`、既有 range 参数，以及 `compress.ts` 中仍被消费的 `formatBlockRef`/planner re-export；删除 `runMessageCompress`、MessageSchema、manual permission gate；`registerCommands` 只注册 `dcp-compress`。T3 不删除 T2 的 `isProtectedUserMessage` 本体，只删除消费导入。生产仍暂可读取旧配置中未清理的只读字段，T5 删除残留。

**终态关联：** F1、F2、F3、F5。**验收标准：** 模型可以直接调用 range 工具；补救命令不产生 pending/active 模式；不再注册 ask/message 或多路命令执行路径。

- [x] 移除独立 message schema/实现/导出；固定新 block 的 mode 为 range，保留历史 block 类型，不改 planner、工具事务扩展和摘要占位展开。
- [x] 删除 manualMode、permission 分支的运行时控制；`/dcp-compress` 只发送普通请求，不追加持久触发标记，不限制随后工具调用。
- [x] 固定简短成功通知和工具回执，保留可定位错误；删 detailed/showCompression 分支。controller 的 session_start/model_select/context/compaction/tree/shutdown 等必要事件保留。
- [x] 既有 expansion 脚本中保留 range、事务扩展、失败/中断、待完成事务、嵌套 block 的安全断言；仅移除独立 message 模式分支及过时通知设置。
- [x] 执行 `npm run verify -- --only F2`、`npm run verify -- --only F3`；记录并向 T5 提供剩余 prompt/config 接缝，不把生成摘要内容搬到额外模型请求中。

**T3 证据：** `.evidence/runs/2026-11-11T10-58-36-860Z/` 的 F2/F3 全部 exit 0，另执行本地 `tsc --noEmit` exit 0。主会话已核对唯一 range schema、普通补救命令和必要生命周期；PromptStore、旧 config/state 及 BLOCKED 标记继续交 T5 收口。

### T4：保持 sidecar 外形，停止恢复被删除策略

**Deps：** T1 的基线报告与检查入口。**Resources：** 仅隔离文件系统。

**WritePaths / Files：** 修改 `persistence.ts`、`test-fork-inheritance.ts`。

**接口契约：** `saveSessionState`、`loadOrInheritSessionState`、`applyPersistedState` 的调用签名、路径和 block JSON 保持不变。退出时 persistence.ts 不得再引用 SessionState 的 manualMode、prune.tools、stats、turn/iteration anchors 字段；旧外形仅作为持久化类型和序列化字面量保留，供 T5 安全删除运行时字段。

**终态关联：** F1、F4、F5。**验收标准：** 原有 fork 场景保持 block 图、active 索引和身份不变；旧 stats/tools 不再继承为行为；不修改父状态或用户真实状态。

- [x] 在 `applyPersistedState` 中忽略 manual、tools、累计 stats 和 turn/iteration anchors；保留合法压缩块、单一 context anchors 与 ID 序号。
- [x] 在 `saveSessionState` 固定写入旧外形的中性字段；不删除 token 元数据、历史 mode 或 block 图，不另建状态版本/迁移器。
- [x] 调整既有 fork fixture 对 tools/stats 的预期为空/0，保留恢复、截断、断链、父状态不变等断言；自身状态优先改以现有块集合断言判别，不用恒为0的stats冒充覆盖。不补造新的 legacy fixture。
- [x] 执行 `npm run verify -- --only F4`，旧 message block 的读取语义由 F5 源码审阅；缺少真实旧样本的限制如实记录，不新造 fixture 或把手工状态当生产可达性证明。

**T4 证据：** `.evidence/runs/2026-11-11T10-58-21-998Z/` 的 F4 exit 0。主会话已核对中性序列化字面量、只恢复 block/context anchors 的路径及自身优先断言。缺少真实旧 message sidecar 样本和原场景的 context anchors 动态覆盖，留 F5 静态审阅并如实披露。

### T5：收口配置、固定指引与单一软提醒

**Deps：** T2 的无裁剪元数据/投影接口；T3 的 range-only 注册和命令；T4 的旧状态中性化读写。

**Resources：** 本地 Node，无模型调用。**WritePaths / Files：** 修改 `config.ts`、`dcp.schema.json`、`prompts.ts`、`context-nudges.ts`、`dcp-controller.ts`、`compress.ts`、`compression-types.ts`、`compression-state.ts`、`context-render.ts`、`session-runtime.ts`、`messages.ts`、`types.ts`；同步调整九个既有测试中受影响的配置、导入和提醒断言，不新建测试文件。

**接口契约：** 最终 `PluginConfig` 完全遵从本计划定义；固定 RuntimePrompts 仅含 `system`、`compressRange`、`contextNudge`。`injectCompressNudges(state, config, logger, messages, prompts): void` 保持主调用形状，只实现一种节流提醒。压缩仍由模型决策，不能加入自动执行策略。

**终态关联：** F1–F5。**验收标准：** 新 schema、配置加载、注册行为、提示词和 sidecar 行为一致；旧旁路字段不再控制运行；所有 AUTO 门禁通过。

- [x] 按配置契约缩减默认值/合并/校验，保留路径搜索和保护能力；删除自动写默认文件、旧策略/模式/权限/实验/通知配置及多模型阈值。非法配置 fail closed，报错不回显文件内容。
- [x] 把 PromptStore 换为固定常量/对象；重写单一软提醒，保留已有 range 边界、占位、保护工具和事务原子性说明。
- [x] 只保留一套 context anchors 和约定的百分比/消息间隔规则；不在 toolCall assistant 中插文本，不强迫模型调用。未知窗口/usage 时只跳过提醒。
- [x] 合并 T2/T3/T4 的实际接口，删除未再使用的年龄计数、manual/permission 状态和导出；持久化外形占位只留在 serializer/loader，不能为清理内存类型改 block 格式。
- [x] 既有测试只做接口和预期同步；metadata-integrity 的既有事务内允许调整消息顺序/usage，或调用保留的提醒落点入口，使单一提醒仍实际覆盖 toolCall assistant→完整结果的落点，不删除断言或改成恒真。任何新场景/fixture 先列为待授权建议。执行 F1–F4 全部通过才 ready；F5/F6 此时可以尚缺证据。

**T5 证据：** `.evidence/runs/2026-11-11T12-34-09-183Z/`；当前阶段 F1–F4 全部 exit 0，源码指纹 `f6cd4d55fa2b0e43a72d525a49f4480c5dd51c5529c7555177d880177ea17b7f`。F5/F6 尚未生成，不把阶段证据当整体终态。

### T6：更新公开 fork 的说明与安装边界

**Deps：** T5 的最终配置 schema、唯一工具/命令和实际行为。**Resources：** 无网络发布操作。

**WritePaths / Files：** 修改 `README.md`、`package.json` 的 description/repository/homepage/bugs 和本计划的进度/已知限制；不改 `LICENSE`，不改包名或版本。

**接口契约：** 使用本地临时加载或用户主动从 fork 安装的说明；不把安装上游 npm 包写成安装本 fork。安装示例不得在本轮执行。

**终态关联：** F5、F6 的操作依据。**验收标准：** 文档精确区分删除/保留项、旧配置拒绝、旧状态恢复边界、实际已验证版本与尚未完成的真实运行/独立验收项；保留上游归属和许可证。

- [x] 以中文说明模型驱动、不依赖手动、非满窗强制 compaction，以及摘要和 prompt cache 的固有限制；不宣称无损或固定省钱比例。
- [x] 写明完整小配置、简短补救命令、隔离试用/恢复步骤和未知键拒绝策略；明确取消全量 OpenCode DCP 配置兼容。
- [x] 更新 GitHub 元数据指向本 fork；保留 npm 名称/版本但明确尚未发布，避免 npm 安装上游被误认作精简版。
- [x] 对照 F5 准备逐项审阅索引，在最终自动验收前完成 README 等交付文档；本计划进度被明确排除指纹，不影响已生成证据。

**T6 证据：** 本任务（公开说明文档变更）已完成，未触及实现/测试/安装/发布：

- `README.md` 改写为中文精简 fork 说明：上游 Snowy pi-dcp 的 AGPL-3.0-or-later 公开 fork 与归属；模型驱动 range-only 局部压缩（模型自选时机/范围/摘要、调用唯一 `compress`）；不等满窗、不保证无损/固定省钱比例、不增加额外摘要模型或第三方运营通信；删除项（独立 message 路径、dedup/error purge、manual/permission、custom prompt 热加载、复杂 nudge、stats）与保留项（工具事务完整性、失败/中断、native compaction、重启、fork/tree、受保护输出、历史 message block 只读兼容）；唯一命令 `/dcp-compress [focus]`；完整小配置与默认、XDG→PI_CONFIG_DIR→.pi 搜索优先级、未知键/非法值 fail closed 且不自动写默认文件、`enabled:false` 行为；sidecar 保形但旧字段固定中性且不再驱动、真实旧 message 样本未验证；隔离恢复概念（不要求手改 JSONL）；本地试用优先 `-e ./index.ts` / `pi --no-extensions -e ./index.ts`，明确未发布 npm、`npm:@snowy117/pi-dcp` 是上游非本 fork、尚未承诺兼容矩阵；F1–F4 已通过的版本/日期与 F5/F6 尚未完成。
- `package.json` 仅改 description/repository/homepage/bugs 指向 `mhbzhy-lost/pi-dcp-migrate`；name/version/license/dependencies/scripts/pi manifest 未改；仍为合法 JSON。
- 本计划回填 T6 进度与已知限制；T5 复选框与证据此前已记录，未重复改动。
- 未改 `LICENSE`、源码、测试、`package-lock.json`。已只读核对：package-lock 的 `packages[""]` 不含 description/repository/homepage/bugs，元数据变更不触发 lock 同步（`git diff package-lock.json` 为空）。
- `README.md` 与 `package.json` 属 `scripts/verify.ts` 的指纹固定文件（FIXED_MANIFEST_FILES），本次变更改变源码指纹；T5 阶段指纹 `f6cd4d55…` 对应文档变更前源码，最终指纹、F1–F4 重验、F5 独立验收与 F6 真实运行证据均由 T7 负责，尚未完成。

**T6 对照 F5 的逐项审阅索引（交 T7 独立验收，非 F5 结论；未创建 `.evidence/audit/scope-review.json`，全部状态＝待独立验收；行号以 T6 时点为准，审阅者按当前源码核对）：**

- scope-1（无 dedup/purgeErrors/applyToolPruning/runMessageCompress/MessageSchema/PromptStore/custom prompts/manual/pending/ask 权限/turn/iteration 提醒运行路径）：`compress.ts`（仅 RangeSchema+runRangeCompress）、`commands.ts`（仅 dcp-compress）、`prompts.ts`（固定常量，无 PromptStore）、`context-nudges.ts`（仅 contextLimitAnchors 单一提醒）；全仓 grep 仅 `persistence.ts:116/146/152/326` 的 `manualMode` 中性占位与注释/测试命中。README「相对上游删除了什么」。
- scope-2（仅注册 dcp-compress；compress 只有 range schema；新块只 mode:"range"；保留历史 mode:"message" 读取/投影）：`commands.ts:7-18`、`compress.ts:9-16`、`compression-engine.ts:70`、`persistence.ts:215/247-254`、`types.ts:1`。README「命令」「历史 message block 只读兼容」。
- scope-3（sidecar 保留 manualMode/prune.tools/stats/旧 anchors 外形键且固定中性；运行时 SessionState 不读写旧字段）：`persistence.ts:115-128/142-169/320-333`、`types.ts:66-80`。README「sidecar 状态与旧字段」。
- scope-4（schema/默认值、未知键拒绝、disabled 不注册、固定指引、单一软提醒不强制、受保护内容）：`config.ts:49-64/201-219/221-294`、`dcp.schema.json:6-85`、`dcp-controller.ts:44-48`、`prompts.ts:10-143`、`context-nudges.ts:20-53`。README「配置」「fail closed」「enabled: false」「明确的边界」。
- scope-5（稳定 ID、完整工具事务、native compaction、重启、分支协调未旁路；元数据支持文件保护；安全断言未删空/恒真）：`compression-engine.ts:59-62`、`dcp-controller.ts:49-58`、`tool-metadata.ts`、`context-render.ts`、`persistence.ts:289-318`；F2/F3/F4 既有断言 exit 0。README「保留了什么（安全边界）」。
- scope-6（无第三方运行时通信/额外摘要模型/全局安装/未授权新测试/fixture；README/AGPL/LICENSE/上游归属正确）：`prompts.ts:41-101`（摘要由当前模型经工具参数提交）、无网络上传/遥测代码、`LICENSE` 未改、`package.json:1-5`（name/version/license 保留）、README「许可证与归属」「安装与本地试用」。

**T6 已知限制：** F5 独立验收与 F6 真实 Pi 会话模型驱动压缩证据尚未取得，README 未声称其通过；缺少真实旧 message-mode sidecar 样本，历史块只读兼容仅经源码审阅与合成 fixture；本 fork 未发布 npm、未承诺兼容矩阵，仅声明实际运行过的版本（Node v26.8.1 / Pi 1.5.0 / TS 5.9.3 / tsx 4.20.6 / typebox 1.3.27）。

### T7：对当前交付版本做最终验证并取得真实运行证据

**Deps：** T6 完成后的最终源码/配置/README 指纹。**Resources：** 本地 Node、开发依赖中的 Pi CLI；真实会话使用正常配置的 provider 和认证，产生普通模型调用费用，不读取或复制认证内容。

**WritePaths / Files：** 仅 `.evidence/` 和本计划的进度/验收记录；不写生产或测试。发现缺陷时交回对应实现任务，修复和真实运行验证分开执行。

**终态关联：** F1–F6。**验收标准：** 每项都有当前版本证据；F6 不可运行或未观察到自主压缩时报告真实阻塞，不宣告整体完成。

- [x] 执行 F1–F4，逐项核对真实 exit、运行环境与源码指纹，不使用基线或旧分支结果；F5 由随后唯一一次独立验收产生，缺失时全量验收不得通过。
- [x] 准备 F5 的源码位置和删除清单，交独立验收而非用户签字。
- [x] 按下节自动取得真实运行证据；没有模型服务、认证或受支持运行入口时明确记录 F6 阻塞与恢复步骤，不读取/复制认证文件。
- [x] 计划执行结束后，按主会话规范立即派发一次独立验收，核对实际证据与全部 F 项，不采信任务自报完成。发现范围内问题修复并重验；不自动追加第二轮验收派发。

**T7 运行验证证据（真实运行部分已完成；F6 = failed，整体终态未满足）：**

- **最终 F1–F4（当前交付版本）**：`npm run verify -- --only F1,F2,F3,F4` → **exit 0**，run 目录 `.evidence/runs/2026-11-11T12-55-53-263Z/`，stdout 绝对日志 `.evidence/runtime/logs/f1-f4-final.log`，**最终源码指纹 `a4ee46f4390b5f7d15ce55ca9fa09cb91cde14be08a6103c81c642bd9027c64f`**（T5 阶段指纹 `f6cd4d55…` 因 README/package.json 变更已作废）。Node v26.8.1、Pi 1.5.0、tsc 5.9.3、tsx 4.20.6、typebox 1.3.27；git HEAD `ea1b7b99`，dirty=33（T2–T6 未提交改动，未获提交授权）。同指纹另有一次先行执行 `.evidence/runs/2026-11-11T12-55-22-306Z/`（zsh 管道丢失 exit code，故以第二次带 exit 捕获的执行为最终证据）。
- **F5 交独立验收的源码位置与删除清单**：`.evidence/handoff/2026-11-11-t7-f5-source-index.md`（含逐项复核命令、T6 索引行号漂移表、5 项审阅注意点）。**未创建 `.evidence/audit/scope-review.json`**。
- **F6 真实运行**：`.evidence/runtime/acceptance.json`（`status: "failed"`）+ `.evidence/runtime/notes.md` + `.evidence/runtime/logs/` 原始 RPC/stdout/stderr/driver 日志 + `.evidence/runtime/sessions/*.jsonl` + `.evidence/runtime/data/pi/dcp/*.json` + `.evidence/runtime/config/pi/logs/dcp/daily/2026-11-11.log`；编排脚本 `driver.mjs`/`smoke.mjs`/`probe.mjs` 与事实汇总 `flow-result.json` 均在 `.evidence/runtime/`，不提交。`npm run verify -- --only F6` → **exit 1**（正确拒绝，未冒充通过），日志 `.evidence/runtime/logs/f6-verify.log`。
- **模型/网络/认证实际可用性：可用。** provider `zai-coding-cn`、model `glm-5.3`、上下文窗口 1,000,000；6 轮真实模型调用全部 `agent_settled(aborted=false)`；未使用 `--offline`，子进程已清除 `PI_OFFLINE`；认证沿用 `PI_CODING_AGENT_DIR=/Users/leshi.zhy/pi-config/pi`，全程未读取/复制/打印 auth、models.json、settings.json 内容。
- **F6 五项结论**：`autonomous-compress` **failed**（6 轮真实交互中模型从未自主调用 compress；独立探针证实 compress 工具已暴露、系统提示含压缩指引，故非接线/环境问题；未发 `/dcp-compress`、未伪造 tool call、未反复提示压缩）；`projection` **blocked**（无 block 可投影，debug 日志无 `Injected compress summary`）；`continuation` **blocked**（无压缩后场景）；`restart` **failed**（会话层恢复成功：exit 0 → `--session <id>` 重开、messageCount=30、32 条 entry、D1 轮成功；DCP 状态层失败：sidecar 被截断为 0 字节并 WARN）；`branch-isolation` **blocked**（无 block 可对照，未手拼 JSONL、未动用户真实会话）。
- **发现实现缺陷（未在 T7 修复，交回主会话）**：`dcp-controller.ts:56-58` 的 `session_shutdown` 以即发即忘方式调用 `saveSessionState`（未 await/未返回 promise），Pi rpc-mode `shutdown()` 随即 `process.exit(0)`，而 `persistence.ts:165` 的 `fs.promises.writeFile` 为 `'w'` 语义（先截断），导致 sidecar 停留 **0 字节**；重启加载报 `Failed to load DCP state ... Unexpected end of JSON input`。在 smoke（无 prompt）、parent（4 轮）、probe（1 轮）三个独立进程上确定性复现。**若曾发生压缩，`compress.ts:31` 落盘的完整 sidecar 同样会在正常退出时被截断**，因此 `restart` 与 `branch-isolation` 在当前实现下不可能通过。首个偏离点、完整入口/身份/事件顺序与恢复第一条命令见 `acceptance.json` 的 `defectReport`。
- **未触发/未执行项**：默认软提醒路径（60% × 1M ≈ 600k tokens 在只读分析任务中不可达），按计划属可选分开标注项，本次未降低阈值制造提醒；同文件 `AgentSession.navigateTree` 未使用（条件项未触发）；未提交/推送/发布/全局安装/安装新依赖；未创建行为测试或 fixture。
- **恢复下一步（第一条命令）**：先在 T5/persistence 范围内修复 shutdown 持久化竞态（await 或改为原子写），执行 `npm run verify -- --only F1,F2,F3,F4`；再重跑 `node .evidence/runtime/driver.mjs` 取得非 0 字节 sidecar 且无 WARN 的 restart 证据；`autonomous-compress` 需由主会话决定是继续以真实模型观察（不得提示压缩）还是按停滞判据登记阻塞。


## 自动真实会话验收步骤

**操作者：T7 验证 agent。** 使用现有 CLI/RPC 或公开 SDK、隔离 session 和状态目录；模型与账户沿用正常 Pi 认证，不新接入第三方服务。不创建新测试/fixture，不通过手工 append 或投影拼接假造 Host 历史；进程编排和事实记录可放被忽略的 `.evidence/runtime/`，不新增生产观测逻辑。

1. 在最终源码版本运行 F1–F4，记录指纹。准备 `.evidence/runtime/config/pi/dcp.json`，按新配置设 `debug: true`，其余保留默认值。隔离目录与 session 不提交。
2. 使用 T1 开发依赖提供的项目本地 CLI，不依赖 PATH 中的全局 `pi`，不另行安装软件；在仓库根启动仅加载本扩展的 Pi。非交互验证使用 `--mode rpc` 或多次 `--print --mode json --session <隔离session>`；基本启动参数如下：

   ```sh
   PI_CODING_AGENT_DIR="/Users/leshi.zhy/pi-config/pi" PI_CONFIG_DIR="$PWD/.evidence/runtime/config/pi" XDG_CONFIG_HOME="$PWD/.evidence/runtime/config" XDG_DATA_HOME="$PWD/.evidence/runtime/data" ./node_modules/.bin/pi --no-extensions --no-mcp --no-skills --no-prompt-templates --no-themes --no-context-files -e ./index.ts --session-dir "$PWD/.evidence/runtime/sessions" --mode rpc
   ```

   这些 CLI 选项已在本机 Pi 1.5.0 参数解析器核对；虽 PATH 中没有 pi，但 `node /Users/leshi.zhy/pi-config/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js --version` 已返回1.5.0。Pi 模型/认证只由 `PI_CODING_AGENT_DIR`/HOME 定位，XDG 不控制其加载；因此 F6 不继承 F1–F4 的空 agentDir，不加 `--offline`，也不继承 `PI_OFFLINE`。sidecar、debug、扩展配置、session 仍隔离到证据目录。只读 `--list-models` 已能发现已配置模型，但不等于服务已实际连通；真实请求仍须验证。若认证或服务不可用，记录环境阻塞，不复制认证文件或改全局配置。具体入口与 `agent_settled` 等待判据见 `.evidence/preflight/2026-11-11-t7-runtime-preflight.md`。

3. 给模型真实的只读仓库分析任务，分阶段完成架构、压缩过程、恢复路径的理解；明确保留“只读、不改代码、输出中文”的当前约束。正常推进到已有阶段结束，不运行 `/dcp-compress`，也不要求它手工伪造工具调用。
4. 观察模型自主调用 `compress`，记录它选择的真实 ID 范围和摘要。继续一个需要前面结论的后续问题，核对当前约束、关键路径和未完成工作仍保留。debug 日志应出现对应摘要投影的 anchor/block；原 session 历史仍可读取。
5. 若默认配置下未出现自主调用，记录 F6 未满足，不降低标准或手动命令冒充成功。可另外降低软提醒阈值验证提醒路径，但分开标注，不能替代语义自主选择。对产品问题回到 T5 修复、重验；三轮无实质进展按停滞处理。
6. 退出并通过正常会话恢复入口重开同一 session，核对摘要/block 身份与当前工作；通过公开 fork/切换入口验证分支隔离。若需要同文件 tree 导航，使用公开 `AgentSession.navigateTree`，不直接改 JSONL。仅对该隔离会话操作。
7. 在 `.evidence/runtime/acceptance.json` 和同目录说明写入实际 Node/Pi/model、源码指纹、session/sidecar/debug 路径及每项观察的原始证据引用。F5/F6证据统一包含 `status: "passed"|"blocked"|"failed"`、`sourceFingerprint`、`checks: [{id,status,evidence:[{path,locator}]}]`；F6检查ID固定 `autonomous-compress`、`projection`、`continuation`、`restart`、`branch-isolation`，F5按上述六项固定清单使用 `scope-1`至`scope-6`。verify缺任何项或指纹不符即失败，独立验收必须核对原始内容，不能相信声明。无用户签字步骤。

## 新增测试建议：待用户具体授权

不在默认执行范围内创建这些文件，也不把它们当作已经存在的验收能力：

- `test-config.ts`：合法新配置、旧 deny/未知键、非法数值、disabled 不注册；需创建新的 Host 注册样例。
- `test-nudge-policy.ts`：低于/达到阈值、节流、未知 usage、事务未完成时跳过；需新的消息序列。
- `test-legacy-state.ts`：由真实旧版本入口产生的 range/message sidecar 在新版本恢复，旧裁剪记录不执行；必须先取得真实 provenance，不手拼状态冒充生产证据。

若用户授权具体项目，先回填授权范围，再定义入口、断言和 fixture 来源；不能因为 reviewer 建议就自动添加。

## 执行模式、停止与恢复

**执行模式：用户已选择 subagent 并发驱动。** 以下为选择时说明的代价：

- **subagent 并发驱动：** 主会话只调度、整合和汇报；T2/T3/T4 依赖 ready 即后台派发，写任务优先独立 worktree；更快，但需处理合并和接缝冲突。每次派发是一个精确任务，预算约 30 分钟，附本计划绝对路径、写路径和停止条件。
- **主会话串行执行：** 本会话按 DAG 拓扑顺序逐任务实施，不派发实现 subagent；上下文连续，但受主会话上下文和轮次预算限制。规范要求的独立首轮计划审阅和最终验收不属于实现并发。

此次使用同工作区严格非重叠写路径，不创建需要提交的机械合并 worktree；用户选择并发不构成 commit 授权。若出现写路径相交，暂停相关写入、先整合接口或串行安排该接缝，不覆盖他人改动。

**停止条件：** 发现基线/Host 合同与计划矛盾、需要改默认只读内核或声明外文件、需要新测试/fixture、需要状态格式迁移或用户既有真实会话操作、依赖只能从非官方源获得、涉及提交/发布/全局安装、真实 provider/受支持自动入口不可用，或任一 F 项连续三轮无进展时，停止相关操作并记录证据。其他独立 ready 任务继续推进；安装已授权的T1开发依赖不在停止项内。

**恢复记录：** 写明未满足 F 编号、最近三轮结果、数据来源与首个偏离点、阻塞原因、所需外部决定及恢复后的第一条验证命令。不得把阻塞、预算耗尽或未执行算作完成。

## 计划审阅记录

- 首轮独立审阅已完成（只读），发现并修正B1–B3及I1–I4：取消人工签字，断开计划进度指纹循环，固定检查cwd和文件清单，明确既有提醒断言/自身状态优先断言与并行接缝。
- 用户已授权修订后自动执行，并选择subagent并发驱动；采用互不重叠写路径同树并行，不擅自提交。修订后的计划不再自动派发第二轮计划审阅。
- T1 已完成：`ses_e35e27d5bffeXs0qkbsNgDO9ZP`；主会话已核对基线索引、检查入口和固定依赖，随后立即并行派发 T2/T3/T4。
- T2 `ses_e35d2c7c1ffeHT1rn05vE4lXxJ`、T3 `ses_e35d2c7b4ffezG36Ht3i2jN4m5`、T4 `ses_e35d2c7aaffe7fl51y49RbaESf` 均已完成，主会话已核对接口和实际报告。T5 `ses_e35ba8feaffeQle6q3NBrF3Bca` 随后完成，主会话已核对 F1–F4 报告；T6 `ses_e3562d3a8ffe9jIxsBkVT02q4x` 随后完成，仅更新 README、包元数据和计划进度。
- T6 已完成：`README.md` 改写为中文精简 fork 说明（上游归属、模型驱动 range-only、删除/保留边界、唯一命令、完整小配置与 fail closed、sidecar 中性旧字段与未验证限制、隔离恢复、本地试用优先、未发布 npm/未承诺兼容矩阵、F1–F4 版本日期与 F5/F6 未完成）；`package.json` 仅改 description/repository/homepage/bugs 指向 `mhbzhy-lost/pi-dcp-migrate`，name/version/license/dependencies/scripts/pi manifest 与 `package-lock.json` 未改（lock 不含这些元数据字段，只读核对 `git diff package-lock.json` 为空）；本计划回填 T6 进度、F5 逐项审阅索引与已知限制。README/package.json 属指纹固定文件，最终指纹与 F1–F4 重验、F5 独立验收、F6 真实运行证据由 T7 负责，尚未完成；未提交/推送/发布/安装。
- 真实运行前提只读探查已完成：`ses_e35e0e21affeXZVdZSRklfVq4L`；报告 `.evidence/preflight/2026-11-11-t7-runtime-preflight.md`。已确认 RPC、重启和公开分支入口，并修正真实运行 profile/隔离变量；仅列表预检，无模型请求。此前 explore 调用被其模型提供商以 HTTP 400 拒绝，未执行仓库操作；不将该基础设施错误归为插件缺陷。
- T7 已按 DAG 启动：负责最终指纹下的 F1–F4 重验、真实 Pi/RPC 模型驱动会话与 F6 原始证据；不写生产/测试，不创建 F5。T7 完成后由主会话立即派发一次唯一独立最终验收，审阅 F5、F6 和全部原始证据。
- T7 运行验证部分已完成（真实运行，非自报）：最终指纹 `a4ee46f4390b5f7d15ce55ca9fa09cb91cde14be08a6103c81c642bd9027c64f` 下 F1–F4 exit 0（`.evidence/runs/2026-11-11T12-55-53-263Z/`）；F6 真实 Pi 1.5.0 RPC 会话执行完毕但 **status=failed**（`autonomous-compress` failed、`restart` failed、其余三项 blocked），`npm run verify -- --only F6` exit 1，未冒充通过；同时发现 `dcp-controller.ts:56-58` + `persistence.ts:165` 的 shutdown 持久化竞态缺陷（sidecar 被截断为 0 字节，三进程确定性复现），按写路径约束未在 T7 修复，已交回主会话。整体交付终态 **未满足**，独立验收仍须派发。
- T7 缺陷修复已另行派发：`ses_e35360e90ffeSuli4vyeQ29ByI` 仅修改 `dcp-controller.ts`，将 `session_shutdown` 的异步保存改为 Host 可等待的 Promise；不得与真实运行验证同派发。修复完成后主会话先核对 diff 和 tsc/F1–F4，再重新运行真实 driver；F6 仍须如实记录模型是否自主调用 `compress`，不得用人工命令替代。
- T7 缺陷修复已完成：`dcp-controller.ts` 的 `session_shutdown` handler 改为 `async` 并 `await saveSessionState`；Pi 1.5.0 Host 类型、runner 和 runtime dispose 路径确认会等待 Promise。修复证据为 `.evidence/fixes/2026-11-11-shutdown-await-fix.md`，主会话直接执行 `tsc --noEmit` exit 0；旧最终指纹 `a4ee46f4…` 已失效。修复未改存储格式、测试或依赖。
- 修复后的 T7 真实重跑已另行启动：`ses_e3532412fffei26qyk6pvBZ3eL`；先重跑当前指纹 F1–F4，再用真实 Pi/RPC 验证 F6，保留原始 session/sidecar/debug/RPC 证据，不创建 F5。未触发模型自主 `compress` 时按 failed/blocked 如实记录；只有重跑完成后才派发唯一独立最终验收。
- 修复后的 T7 真实重跑已完成：F1–F4 在最终指纹 `443327e662c7a3977e904274253a64e59608f89da309c00dd389f83ebaf4c779` 下全部 exit 0，证据 `.evidence/runs/2026-11-11T13-38-45-545Z/`。F6 真实 Pi/RPC 证据 `.evidence/runtime/acceptance.json` 为 `failed`：GLM-5.3 七轮真实交互中工具定义和系统提示均已下发，但 `compress` 调用为 0；因此 projection、continuation、branch-isolation 按前置条件 blocked。D1 shutdown 持久化修复已通过三进程 sidecar 非空 JSON、重启无 WARN 的端到端验证，restart 翻转为 passed。`npm run verify -- --only F6` exit 1，未冒充通过。
- 按终态规则立即派发唯一独立最终验收，审阅当前源码、F1–F4、F6 及全部原始日志/会话/sidecar，生成 `.evidence/audit/scope-review.json` 与 `scope-review.md`；最终是否完成以 F1–F6 和独立审阅结果为准。当前已知未满足项为 F6 autonomous-compress 及其下游真实压缩块证据，不能因 D1 修复或既有检查通过而宣告完成。
