# 可复现基线验证

> 验证日期：2026-08-13
> 基线 commit：`4c2fd025c076f828bb99417a52b4b9cecd5b2841`
> 分支：`codex/integration-baseline-2026-08-13`

## 独立 worktree

从上述 commit 建立 detached、无 `node_modules`、无 `.env`、无本地索引/缓存的临时 worktree。
以下命令全部通过：

- `npm ci`：148 packages；
- `npm run typecheck`：主代码与 scripts 双项目通过；
- `npm run lint`：182 files，0 error；
- `npm test`：45 files / 300 tests；
- `npm run build`：CLI、MCP、Worker 三入口及声明文件构建成功。

这证明基线可以从 Git 和 lockfile 重建，不依赖原工作目录中的未提交资产。

## Docker

镜像：`wikimemory:baseline-4c2fd02`

- image ID：`sha256:fa77da82d43103d8761b8dd3619e381f0c0dd3deb91d7f8f284a809eaf2b495c`；
- size：89,853,112 bytes；
- runtime user：`node`，容器内 UID 1000；
- `@modelcontextprotocol/server`、`openai`、`zod` 运行时 import 成功；
- `/app/dist/index.js`、`mcp.js`、`worker.js` 存在；
- 镜像中不存在 `.env`、`experiments/`、`references/`、S200 Stage B 或 Gold；
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。

镜像 ID 是本机 Docker Desktop 对本次构建的证明，不是跨架构可复用的发布 digest；正式发布仍需 registry digest/签名。

## 依赖审计边界

全依赖审计初始识别 3 个仅开发/构建链的间接依赖项：`nanoid` high、`postcss` moderate、
`esbuild` low。兼容的 lockfile 更新将前两项升级到 `nanoid 3.3.18`、`postcss 8.5.26`；
剩余 `esbuild 0.27.7` low 只影响 Windows 本地开发服务器场景，不进入生产镜像。该项保留为上游
`tsup/vite` 更新维护任务，不用强制 resolution 破坏构建约束。

## 未证明

- 未证明在线 DeepSeek 编译逐 token 可重复；
- 未证明远程部署、多主机锁或 30 天负载；
- 未证明 WikiMemory 相对基线的长期产品增益；
- 未读取或评分仍处于密封合同下的 S200 Stage B。
