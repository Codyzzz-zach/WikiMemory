# Question Association Bridge v1

这是 C1.5-A 的 18-pair Claim × Question 影子切片。它不测 Source coverage，不创建或更新
Canonical Question，也不包含回答/Pilot 输出。

- `oracle.json`：人工预注册裁决；绝不发送给 provider。
- `input.json`：由 I3-Sim 隔离 runtime 的逐 Source 事务前快照机械抽取；不包含 oracle。
- `provider-payloads/`：A0/A1 的零调用 payload，供外部发送授权前审计。
- `manifest.json`：文件 hash、来源 receipt、预算和 provider visibility。

权威合同见 `docs/specs/question-association-bridge-contract-v1.md`。
