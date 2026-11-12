# pi-dcp-migrate · 模型驱动的 range-only 局部压缩

> 本仓库是 **Snowy 的 pi-dcp（上游 [`Snowy117/pi-dcp-migrate`](https://github.com/Snowy117/pi-dcp-migrate)）的公开精简 fork**，托管在 [`mhbzhy-lost/pi-dcp-migrate`](https://github.com/mhbzhy-lost/pi-dcp-migrate)。上游又是 [opencode-dynamic-context-pruning](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)（DCP）向 [pi coding agent](https://github.com/earendil-works/pi-mono) 扩展模型的移植。本 fork 沿用上游的 **AGPL-3.0-or-later** 许可证与全部归属声明；精简内核之外提供可选本地审计，不改变许可证，完整许可证见 [`LICENSE`](./LICENSE)。

DCP 只改变「交给模型的上下文投影」，**从不修改磁盘上的会话历史**。本 fork 把上游的多策略、多模式控制收敛为单一的、由模型自主驱动的 range 局部压缩。

## 这个 fork 做什么

- **唯一模型工具 `compress`（range-only）** —— 由当前对话模型自主决定**何时**压缩、压缩**哪一段**（`startId`/`endId` 区间），并**自行撰写**该区间的技术摘要，再调用这一个工具提交。摘要保留文件路径、函数签名、决策、约束、关键发现与受保护工具输出。
- **模型自主 + 单一软提醒** —— 不等上下文窗口接近上限才允许压缩，也不强制每个小步骤都压缩；优先处理已闭合且有实质体量的阶段。当近似上下文压力达到阈值、且距上次提醒锚点已隔足够条有效消息时，注入**一条**软提醒，提示模型评估可压缩的已闭合区间。提醒**不强制**调用、**不改变**工具权限，模型可以忽略并继续工作。
- **稳定消息 ID** —— 注入 `(dcp-msg-id mNNNN)` 标记，让模型在调用 `compress` 时引用区间边界；已压缩块用 `(bN)` 引用。
- **状态持久化** —— 压缩状态按会话文件 key 持久化，重启后恢复，并被 fork/clone 出的会话继承。

### 明确的边界（本 fork 不承诺的事）

- **不保证无损**：摘要由模型生成，压缩质量取决于模型本身；摘要不确定时要求模型如实标注，而不是冒充原始事实。
- **不承诺固定的「省钱比例」**，也**不展示「节省 token」账单**、不做累计统计。压缩会改写交给模型的上下文前缀，可能使 provider 的 prompt 缓存对受影响前缀失效；因此实际 token 收益不固定，取决于模型摘要质量、provider 缓存行为与会话情况。
- **不引入额外的摘要模型**：摘要由当前对话模型通过工具参数提交，不另行发起摘要请求。
- **不引入任何第三方运营通信**：不上传会话原文，不加遥测 / 账户 / 授权服务。正常的 pi → 你所选 provider 的模型请求不在此列。
- 压缩是**模型驱动的局部 range 压缩**，不是定时强制 compaction，也不依赖用户执行命令。

## 相对上游删除了什么

本 fork 删除了上游的多策略与多模式控制，只保留 range 压缩内核：

- 删除**独立 message 压缩路径**：新块只创建 `mode: "range"`。
- 删除**去重（deduplication）**与**错误清理（purge errors）**规则裁剪：重复工具结果、失败调用参数不再被规则替换。
- 删除**手动模式（manual mode）**、**permission（ask / allow / deny）权限门**与多路 `/dcp` 命令（help / stats / context / manual / sweep / compress）。
- 删除**custom prompts 文件覆盖 / 生成 / 热加载**（PromptStore）：提示词现在是代码内固定常量。
- 删除**复杂 nudge**（turn / iteration 提醒、force / strong、`min/maxContextLimit` 多阈值、per-model limits）与**累计 stats 统计**。

## 保留了什么（安全边界）

- **工具事务完整性**：区间若只覆盖事务一侧，工具自动扩展以包含 assistant 的 toolCall 消息与全部对应 toolResult；重叠的自动扩展区间会合并。摘要须忠实覆盖被自动扩展纳入的事务消息。
- **失败 / 中断消息处理**：以 `stopReason: "error"` / `"aborted"` 结束的 assistant 轮次被排除在 DCP 视图外（与 pi 的 `transformMessages` 一致），其中的孤立 toolCall 不会阻塞压缩。
- **原生 compaction**：检测到 pi 的 `session_compact` 事件时重置 DCP 状态。
- **重启恢复**与 **fork / tree 协调**：fork / clone 沿 `parentSession` 链继承最近的祖先状态，并按当前会话实际包含的条目过滤（截断条目不继承），结果只写入新会话自己的 key，**父状态文件从不被改写**；tree 导航后在下次 `context` 事件重新协调 block 状态。
- **受保护输出**：`compress.protectedTools`（默认 `["subagent"]`）的已完成输出、`protectedFilePatterns` 命中的文件输出、`<protect>...</protect>` 标签，以及（可选）区间内用户原文，按既有语义保留。
- **历史 message block 只读兼容**：读取旧状态时保留合法的 `mode: "message"` 历史块及其元数据；但本 fork 之后只创建 `mode: "range"` 块。

## 安装与本地试用

> **本 fork 尚未发布到 npm。** 它的 `package.json` 仍保留上游包名 `@snowy117/pi-dcp` 与版本 `0.1.2`（未改名、未发版），但 npm 上的 `@snowy117/pi-dcp` 是**功能完整的上游版本**，不是这个精简 fork。执行 `pi install npm:@snowy117/pi-dcp` 安装到的是上游，**不要**把它当作本 fork。

推荐的本地试用方式（显式从 fork 工作副本加载，本轮未执行任何安装）：

```bash
# 在 fork 仓库根目录，仅加载本扩展
pi -e ./index.ts

# 或：禁用其他扩展，只加载本 fork
pi --no-extensions -e ./index.ts
```

手动安装为全局扩展（克隆到 pi 的扩展目录，pi 会自动发现，编辑后用 `/reload`）：

```bash
git clone https://github.com/mhbzhy-lost/pi-dcp-migrate ~/.pi/agent/extensions/pi-dcp-migrate
```

从 fork 仓库安装（示例，本轮未执行）：

```bash
pi install git:github.com/mhbzhy-lost/pi-dcp-migrate
```

## 命令

只有一个补救命令：

- `/dcp-compress [focus]` —— 发送**一次普通压缩请求**，让模型自行评估并对已闭合区间调用 `compress`。它**不**设置 pending 标记、**不**锁定下一次工具调用、**不**修改模型随后的自主压缩权限。可选 `focus` 文本用于提示关注点。

成功回执只保留处理数量与 block ID（例如 `Compressed 12 messages into 1 block (b3).`），不展示摘要预览，也不展示 token 节省账单；错误会明确说明原因。

## 配置

DCP 读取自己的小配置，按以下顺序搜索（**后者覆盖前者**），每层都支持 JSON / JSONC（注释与尾逗号）：

1. **全局**：`$XDG_CONFIG_HOME/pi/dcp.jsonc`（或 `dcp.json`）；未设 `XDG_CONFIG_HOME` 时为 `~/.config/pi/`。
2. **`$PI_CONFIG_DIR`**：`$PI_CONFIG_DIR/dcp.jsonc`（或 `dcp.json`）。
3. **项目**：从当前目录向上查找最近的 `.pi/dcp.jsonc`（或 `dcp.json`）。

**不会自动创建任何默认配置文件。**

### 完整字段与默认值

```jsonc
{
  "$schema": "./dcp.schema.json",    // 可选；唯一被允许的元数据键
  "enabled": true,                    // false 时不注册工具/命令，不注入指引，不改写上下文
  "debug": false,                     // 调试日志
  "audit": {                         // 仅全局或 PI_CONFIG_DIR 可信层允许，项目层拒绝
    "enabled": false,                // 默认关闭，与 debug 独立
    "maxRunBytes": 268435456          // 单次录制预算，正安全整数；默认 256 MiB
  },
  "protectedFilePatterns": [],        // 命中文件的工具输出追加进摘要
  "compress": {
    "protectedTools": ["subagent"],   // 与内置默认 ["subagent"] 去重合并；支持 * / ? 通配
    "protectTags": false,             // 保留 <protect>...</protect>
    "protectUserMessages": false      // 将区间内用户原文逐字追加进摘要
  },
  "nudge": {
    "thresholdPercent": 60,           // 有限值且 0 < 值 < 100
    "minMessageInterval": 5           // 正整数（>= 1）
  }
}
```

### fail closed（拒绝非法配置）

- **未知键**（`$schema` 除外）、**错误类型**与**非法数值**会被明确拒绝：报错指出文件路径与出错的键路径，然后**停止加载扩展**，绝不静默回退为 enabled / allow。
- 因此一份陈旧的上游配置（例如 `compress.permission: "deny"`、`strategies`、`manualMode`、`pruneNotification` 等）会被**拒绝**，而不会被忽略后意外启用模型驱动压缩。
- 本 fork **不兼容上游完整配置**，不提供配置迁移器或废弃选项兼容层；请改用上面的小配置。
- 出于隐私，报错**不回显配置文件内容**。

### `enabled: false`

`enabled` 为 `false` 时，扩展不注册 `compress` 工具与 `/dcp-compress` 命令，不注入系统指引或软提醒，也不改写上下文。

## sidecar 状态与旧字段

DCP 的会话状态写入 sidecar 文件：`$XDG_DATA_HOME/pi/dcp/<sessionKey>.json`（未设 `XDG_DATA_HOME` 时为 `~/.local/share/pi/dcp/`）。

- sidecar **保留旧外形**：`manualMode: false`、`prune.tools: {}`、两个累计 `stats` 值为 `0`、turn / iteration anchors 为空数组。这些只是**序列化占位**，运行时**不再读取、不再驱动任何行为**。
- 运行时只从 sidecar 恢复**压缩块图**与**单一 context-limit 提醒锚点集合**。
- 旧的 `prune.tools`、`manualMode`、累计 stats、turn / iteration anchors **不会恢复执行**。

> **已知限制：** 缺少真实旧版本产生的 message-mode sidecar 样本，因此「读取旧 `mode: "message"` 块」的兼容路径只经过源码审阅与合成 fixture 验证，**尚未用真实旧样本验证**。本 fork 的首个精简版本**不承诺**与旧插件反复切换共用同一 sidecar 的行为。

## 隔离试用与恢复

要在不触碰真实状态的情况下试用或重置：

- 把 `XDG_DATA_HOME`、`XDG_CONFIG_HOME`、`PI_CONFIG_DIR` 指向临时目录，即可让 sidecar 与配置完全隔离。
- 想清空某个会话的 DCP 状态，删除对应的 sidecar `<sessionKey>.json` 即可；下次会话会从空状态或沿父会话继承重建。
- **不要手工编辑会话历史 `.jsonl`**：DCP 从不修改磁盘历史，压缩只改变交给模型的投影。恢复 / 重置只通过隔离目录或删除 sidecar 完成，不需要也不应该手改 JSONL。

## 开发验证状态

本 fork 的开发验证只覆盖**实际运行过的版本**，**不是**承诺的兼容矩阵：

- **既有门禁 F1–F4：** 类型检查、架构门禁和九个既有脚本。当前执行结果见 `.evidence/runs/` 和 `.evidence/latest.json`；其中 `allPassed` 只代表 `requested` 列出的项目，不能把 F1–F4 子集通过当作全项目通过。
- **运行版本：** Node `v26.8.1`、TypeScript `5.9.3`、tsx `4.20.6`、Pi（`@earendil-works/pi-*`）`1.5.0`、typebox `1.3.27`。`engines.node` 为 `>=22.19.0`、peer 依赖为 `*`，但本轮只声明上述实际运行过的版本，**不**把 peer 的 `*` 当作全版本支持矩阵。
- **继承状态：** 上一轮指纹 `443327e662c7a3977e904274253a64e59608f89da309c00dd389f83ebaf4c779` 的 F1–F5 通过，但 F6 失败：GLM-5.3 的真实会话没有自主调用 compress。退出写入竞态已修复并验证空块状态重启，但真实压缩块投影/延续/分支当时未取得证据。
- **本次新增审计使旧 F5/F6 指纹过期。** 因此全量 `npm run verify` 的旧 F5/F6 预期 FAIL，不重新签发旧 F5，也不修改旧 F6 原失败。本次 `npm run verify:observability` 的 O1–O7 是另一份契约，权威索引为 `.evidence/observability/latest.json`；缺少真实录制或独立审阅证据时明确失败。即使人工请求的压缩实录成功，也不替代模型自主调用的旧 F6 验收。

## 本地压缩审计：持续观测移除了什么、回填了什么

审计是独立旁路，默认关闭；不修改模型决策、摘要、工具响应或 sidecar。**只录制 DCP context handler 的实际输入、摘要投影、DCP 输出，不是最终 provider 请求，也不证明模型已收到。** 不抓系统提示、认证来源、网络头或 provider payload，不额外调用模型、上传或遥测。debug 开关与它无关。

在全局配置或显式 `PI_CONFIG_DIR/dcp.jsonc` 加入 `"audit": {"enabled": true}` 后加载扩展。项目 `.pi` 中出现 `audit` 字段（包括 false）均拒绝，防止仓库静默采集正文或放大预算。扩展 `enabled:false` 时也不录制。

录制目录固定为 `$XDG_DATA_HOME/pi/dcp-audit/v1/<session-key-hash>/<processRunId>/`，未设 XDG 时为 `~/.local/share/pi/dcp-audit/v1/`。hash 来自会话文件身份（无文件时用 sessionId），不直接拼用户路径；新目录 `0700`、新文件与报告 `0600`。每条记录附件有 UTF-8 字节数和 SHA-256，先写私有 partial 再原子发布完整记录。关闭时等待 flush，不复用 sidecar 保存审计。

回看入口（Node 原生执行，不需要 tsx 或浏览器服务）：

```bash
# 列会话索引、状态和带实际 hash 的可复制命令，不导出全部正文
node dist/scripts/dcp-audit.js
# 用索引中的 hash 替换下例；可加 --run <processRunId>
node dist/scripts/dcp-audit.js --session <session-key-hash> --check
npm run audit:report -- --session <session-key-hash> --out report.html
```

`dist/` 的 JavaScript 产物随 Git tag 和 npm 包一起交付，因此 `npm ci --ignore-scripts` 安装后也可运行，不依赖安装期编译、tsx 或 Pi 的加载器。修改报告源码后运行 `npm run build:audit`，使用 `npm run build:audit -- --check` 检查产物是否同步。Node 不支持直接擦除 `node_modules` 内的 `.ts`；不要在安装目录直接执行 `scripts/dcp-audit.ts`。例如在使用方项目运行 `node node_modules/@snowy117/pi-dcp/dist/scripts/dcp-audit.js` 即可列出录制索引。

`--check` 只读校验记录、附件大小/哈希、三快照及同次差异；损坏、缺失、partial 或暂停返回非零。报告可在不完整时生成并显示缺口，但命令仍非零。报告独占新建，不覆盖已有文件。HTML 完全离线、无脚本/外部资源/上传，正文按文本转义并完整折叠，不截断原始数据。

报告内容包括：模型原始边界/摘要；实际解析和事务扩展/合并；模型摘要→旧块展开→保护追加→最终回填的各阶段及来源；每块内存提交；**同一次** context 的 before/projection/output 和实际移除、插入、保留；投影之后的提醒/ID 改动单列。块累计 effective 覆盖不是本次新增移除量。contextPassId 只是 DCP 处理编号，不是 HTTP 请求 ID；未映射条目用 ordinal/hash，不冒充 Host ID。提交不等于已应用；首次/重复应用、预存块、未录制请求、分支和重启边界均明确显示。

预算默认 256 MiB/录制 run，正文不去重，长会话的重复快照可能很快耗尽。预算到达或 IO/序列化失败时暂停此 run，用户收到一次警告，尽可能写一个不含正文的终止状态（最多 64 KiB），显示最后完整/当前 contextPass、已用与余额；压缩与原会话继续，不把审计错误反馈模型。文件系统完全不可写时状态可能也无法落盘，因此报告不能把没有 status 当完整证明，会检查关闭/partial 等线索。

**不会自动清理历史。** 可关闭 audit，或手动清理确认不再需要的单个录制 run 目录；切勿误删 sidecar/session。预算不足可保留旧 run，正常重启同会话开启新 run 续录，暂停区间仍是缺口。字节数不是实际 token、账单、缓存收益或摘要质量评分。

**隐私警告：** 完整正文可能含源码、思考文本、个人信息和会话中已有的秘密。不额外读取凭据不等于自动脱敏；精确比较需要保留原值。不要提交、上传或分享原始审计/HTML。选择边界、丢失约束、事实是否可信仍需持续人工判断，本功能不自动给摘要打分。

## 许可证与归属

**AGPL-3.0-or-later**，继承自上游 opencode-dynamic-context-pruning 与 Snowy 的 pi-dcp 移植。本 fork 保留上游归属，不改变许可证。完整许可证见 [`LICENSE`](./LICENSE)。
