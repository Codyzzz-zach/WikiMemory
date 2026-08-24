# WikiMemory Discovery Backlog

> 状态：Non-normative intake
>
> 更新时间：2026-08-24
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
| D-001 | Wiki assertion role 过度集中为 CURRENT，争议/取代没有真实物化 | I3-Sim：145 CURRENT、10 CONDITIONAL、0 DISPUTE、0 SUPERSEDED | Question formation / materialization | C1 | INTAKE |
| D-002 | Relation 大量进入 Quarantine，无法安全驱动 Wiki 分支角色 | I3-Sim：2 Canonical Relations、152 Quarantined Relations | Relation audit / cross-material detection | C1 输入依赖；是否改动由合同决定 | INTAKE |
| D-003 | 技术材料的历史 proposal、当前行为与版本条件被平铺成 CURRENT | I3SIM-TEC-01 hard failure；technology 9 个模块无 conditional | 条件抽取 / authority / version semantics | C1 | INTAKE |
| D-004 | 引用存在不等于逐断言有支持，模型会补写材料外当前状态 | I3SIM-TEC-01 `UNSUPPORTED_ASSERTION` | Answer contract / Context consumption | C1 或 C2，需选主变量 | INTAKE |
| D-005 | 竞争主张可被领先分支摘要静默抹平 | I3SIM-PSY-03 `CONFLICT_FLATTENED` | Weighted projection / rendering | C1 | INTAKE |
| D-006 | Wiki Context 有时被召回但没有提供独有任务价值 | I3SIM-TEC-02 TIE | Selection / task value | C2 | INTAKE |
| D-007 | Wiki arm 平均总 token 高约 52.4%，尚无边际价值策略 | I3-Sim paired token ledger | Context budget / ambiguity routing | C2 | INTAKE |
| D-008 | 当前 schema 的 ACTIVE/SUPERSEDED 命名容易被产品层误读为真值 | 文档审计与 ADR-0003 | Schema projection / API language | C1 | INTAKE |
| D-009 | 多模块 Context Pack 在固定预算下的价值排序仍未证明 | I2.5/I3-Sim 观察 | Retrieval / pack builder | C2 | INTAKE |
| D-010 | 长期真实使用的周期、任务量和价值阈值缺少真实校准 | 旧 I3 固定 30 天/100 任务无当前依据 | Product experiment design | C3 | INTAKE |
| D-011 | HTTP、远程/多主机运行未实现 | Implementation Status | Transport / operations | 未排期；非 C1 主变量 | PARKED |

## 当前选择

尚无 `SELECTED` 条目。C1 合同评审必须从 D-001/D-003/D-005/D-008 中选择能共同归属于“加权问题
状态”这一主变量的最小集合；D-002/D-004 只有在被证明是该主变量的硬依赖时才能进入。其他条目
保持 Intake/Parked，不得借 C1 顺手实现。
