# Reasonix 执行边界 v1

状态：`ACTIVE / FAIL_CLOSED`

## 角色分工

- Codex 负责：产品目标、实验合同、冻结 hash、Gold 隔离、实现验收、报告解释与最终裁决。
- Reasonix 只负责：在明确边界内做机械实现或非权威审查；它的文字结论不能改变门槛，不能替代测试证据。
- WorkBuddy 负责：按两阶段合同搜集公开材料；Stage B 在候选输出冻结前由用户密封。

## 当前能力事实

`reasonix doctor --json` 显示：

- 默认模型是 `deepseek-flash/deepseek-v4-flash`；
- sandbox 可用，但全局 `write_roots` 包含整个 `/Users/mixi/Desktop/WikiMemory`；
- 网络开启，且全局配置加载多个 MCP 插件；
- `--dir` 能改变项目根，但不能单独证明它无法读取父目录中的 Stage B/Gold。

因此，当前不能声称 Reasonix 与 Gold 做到了完整的 OS 级权限分离。

## 现在允许的调用

1. 在新建的临时空目录中运行；
2. `--allowed-tools none`，只把脱敏后的纯函数合同或 diff 直接放入 Prompt；
3. Prompt 不包含仓库路径、caseId、题目、Gold、Stage B、答案或逐题得分；
4. 输出只作为 review note，由 Codex 重新验证；
5. 记录模型、调用方式、usage、是否使用工具和采纳/拒绝内容。

## 现在禁止的调用

- 让 Reasonix 浏览 WikiMemory 仓库或自己找文件；
- 运行 Benchmark、读取 Stage B/Gold、查看首轮答案；
- 修改实验合同、阈值、冻结文件、报告或 canonical 知识；
- 根据逐题结果设计 caseId/领域/语言特例；
- 直接把 Reasonix 的“通过”当作上线依据。

## 未来允许代码施工前必须补齐的硬隔离

必须同时满足：

1. 独立 worktree/临时目录只含接口、合成夹具和待改文件；
2. Reasonix 的可读/可写根都只指向该目录，并以 canary 文件证明越界读取失败；
3. 禁用无关 MCP 插件，网络只允许模型 provider；
4. 产出 patch 而不是直接改主工作区；
5. Codex 在主工作区审 patch、运行冻结测试；
6. 任何越界尝试立即废弃该会话和产物。

在上述六项没有实证前，Reasonix 只能做“Prompt 内、无工具、非权威审查”。
