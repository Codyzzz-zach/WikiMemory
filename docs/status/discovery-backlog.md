# WikiMemory Discovery Backlog

> 状态：Non-normative intake
>
> 更新时间：2026-08-25
>
> 职责：保存迭代中发现但不属于当前阶段主变量的问题；本页不改变 Product Definition、North Star、当前阶段合同或实现优先级。

## 使用规则

1. 新发现先记录来源、证据、影响与可能责任层，不直接塞进当前实现；
2. 只有阶段合同明确选择的条目才进入 `SELECTED`；
3. 产品负责人显式决定后，条目才能改变 North Star、范围或阶段顺序；
4. 重复发现合并证据，不通过增加条目数量制造优先级；
5. 关闭条目必须链接验证证据和 Git 提交；`REJECTED/NO-GO` 也是合法关闭。

## 当前条目

| ID | 发现 | 证据 | 可能责任层 | 候选阶段 | 状态 |
|---|---|---|---|---|---|
| D-001 | Wiki assertion role 过度集中为 CURRENT，争议/取代没有真实物化 | I3-Sim：145 CURRENT、10 CONDITIONAL、0 DISPUTE、0 SUPERSEDED | Question formation / materialization | C1 | SELECTED |
| D-002 | Relation 大量进入 Quarantine，无法安全驱动 Wiki 分支角色 | I3-Sim：2 Canonical Relations、152 Quarantined Relations | Relation audit / cross-material detection | C1 输入依赖；是否改动由合同决定 | INTAKE |
| D-003 | 技术材料的历史 proposal、当前行为与版本条件被平铺成 CURRENT | I3SIM-TEC-01 hard failure；technology 9 个模块无 conditional | 条件抽取 / authority / version semantics | C1 | SELECTED |
| D-004 | 引用存在不等于逐断言有支持，模型会补写材料外当前状态 | I3SIM-TEC-01 `UNSUPPORTED_ASSERTION` | Answer contract / Context consumption | C1 或 C2，需选主变量 | INTAKE |
| D-005 | 竞争主张可被领先分支摘要静默抹平 | I3SIM-PSY-03 `CONFLICT_FLATTENED` | Weighted projection / rendering | C1 | SELECTED |
| D-006 | Wiki Context 有时被召回但没有提供独有任务价值 | I3SIM-TEC-02 TIE | Selection / task value | C2 | INTAKE |
| D-007 | Wiki arm 平均总 token 高约 52.4%，尚无边际价值策略 | I3-Sim paired token ledger | Context budget / ambiguity routing | C2 | INTAKE |
| D-008 | 当前 schema 的 ACTIVE/SUPERSEDED 命名容易被产品层误读为真值 | 文档审计与 ADR-0003 | Schema projection / API language | C1 | SELECTED |
| D-009 | 多模块 Context Pack 在固定预算下的价值排序仍未证明 | I2.5/I3-Sim 观察 | Retrieval / pack builder | C2 | INTAKE |
| D-010 | 长期真实使用的周期、任务量和价值阈值缺少真实校准 | 旧 I3 固定 30 天/100 任务无当前依据 | Product experiment design | C3 | INTAKE |
| D-011 | HTTP、远程/多主机运行未实现 | Implementation Status | Transport / operations | 未排期；非 C1 主变量 | PARKED |
| D-012 | AI 能提出并持久化问题，但语义同一性仍主要依赖模型匹配与规范文本 key；跨来源、跨时间的长期身份持续性未证明 | 2026-08-25 产品讨论、Question formation/lifecycle 代码复核 | Question formation / identity assessment | C1.5 | SELECTED |
| D-013 | 当前 `ACTIVE/CANONICAL` 同时容易承载“可消费”与“长期稳定”的产品解读，身份成熟度没有独立表达 | 2026-08-25 产品讨论、QuestionFrame/Materialization 合同复核 | Question model / publication projection | C1.5 | SELECTED |
| D-014 | 6/18 I3 Episode Sources 未进入 7 个焦点 QuestionFrames，但 Claim 级回放证明它们均已路由到其他问题；Source coverage 无法区分正确拒绝、错误挂接、错误新建与真实漏接 | C1-D Gate + 2026-08-26 Question state replay | Question association / semantic match | C1.5-A Question Association Bridge | SELECTED |
| D-015 | 当前 proposer 只向模型展示问题名称/别名/边界，formation Gate 验证引用、domain/scope 但不验证 Claim 的语义归属；批量 proposal 已把 URL、thread identity/date 等元数据整组挂入问题闭包 | codebase-memory 调用边界复核 + I3 transaction replay | Question association / evidence basin | C1.5-A A0/A1 identity-card shadow | SELECTED |

## 当前选择

D-001/D-003/D-005/D-008 已由 C1 合同共同收束为“冻结问题内部的加权问题状态”主变量；C1-A/B/C
通过，但 C1-D 因 D-014 的上游 association closure 缺口以 REWORK 闭合。
D-002/D-004 只有在被证明是
该主变量的硬依赖时才能进入，且需要重新评审；不得借后续合同修改 Relation audit 或回答链。
D-012/D-013 保持为完整 C1.5 的合同输入；D-014/D-015 已由接受的 C1.5-A Bridge 收束。Bridge
只验证事务前冻结 QuestionHypothesis 的 Claim 级 `ATTACH | REJECT | UNCERTAIN`，不扩到身份成熟、
merge/split 或生产 proposer。其他条目保持 Intake/Parked。
