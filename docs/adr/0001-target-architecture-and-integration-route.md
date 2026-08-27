# ADR 0001：目标架构与当前状态分权

- 状态：Accepted（文档分权与架构边界继续有效；I0–I3 路线由 ADR-0002/0003 演进）
- 日期：2026-08-12

## 背景

旧 `architecture-baseline.html` 同时记录长期架构、当前对象数量、历史 Goal、短期实验结论和下一轮计划。它在单轮审计时信息完整，但会产生两个系统性问题：短期 Dev 结果容易反向改写产品架构；当前事实变化后，整份“架构”立即过期。

同时，知识内核已经拥有大量内部能力，却没有稳定 Agent 接口、显式运行根、容器恢复和自然语言纠正入口。继续延长内部 Goal 无法证明产品闭环。

## 决策

1. 根目录 `architecture-baseline.html` 固定为目标架构，只定义长期不变量、模块、数据、接口、权限、部署和交付门。
2. 当前实现、数据数字、历史 Goal 裁决和差距统一写入 `docs/status/implementation-status.md`。
3. 当前施工路线切换为 I0 运行边界、I1 MCP 读取、I2 纠正、I3 长期 Pilot。
4. 采用模块化单体 + 异步 Worker；在真实并发/故障域证据出现前不拆微服务。
5. MCP 优先，HTTP/CLI 同合同；所有 Transport 调用同一 Application Service。
6. Graph 始终是离线治理基础设施，在线候选导航按任务条件触发，遍历结果不自动进入可见 Context。
7. Docker 只封装运行内核；Benchmark、Gold、实验、密钥、外部参考和用户状态均不进入镜像。

## 结果

- 上述第 3 项是 2026-08-12 的历史施工决策：I0–I2.5 已形成工程/机制基线；2026-08-24 起
  后续路线由 ADR-0003 的 C0–C3 取代。其余文档分权和架构边界继续有效。
- 文档权威关系更清晰，历史事实仍保留但不继续产生规范权力。
- I0/I1 期间应主要新增 facade、ports、adapter 和协议测试，不重写 Compiler/Graph/Wiki 算法。
- 现有 Batch A/B/C、Evolution、数学和 S200 子集转为集成回归；新 Blind 不阻塞产品接口建设。
- 架构方向只有在新产品约束、可复现事故、跨域重复证据或明确人类决策出现时修改，并追加 ADR。

## 参考

- MCP TypeScript SDK：协议适配器与业务逻辑分离；
- codebase-memory-mcp：本地持久索引、小型工具面、状态独立于会话；
- Graphiti：episode provenance、时态事实、增量图与混合检索；
- Letta / Mem0：长期 Agent 状态与 user/session/agent scope。
