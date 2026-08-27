# Semantic Overlap Review Matrix (21 new clusters × 9 historical clusters)

Method: 模型复核（WorkBuddy）+ 逐簇证据。领域相同不算重叠；事件/文档/法规/论文版本身份不同才算不重叠。

历史簇（9）：cluster-ai-mcp-transports（MCP transports 规范（2024-11→2025-03）与 HN 讨论）；cluster-tech-redis-licensing（Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3））；cluster-fin-nvda-h20-fy26（NVIDIA H20 对华出口计提与 FY26 财报）；cluster-design-wcag-2x（WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单）；cluster-health-covid-airborne（COVID-19 空气传播（WHO 2020/2024 简报））；cluster-history-vesuvius（Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024））；cluster-psych-reproducibility（可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016））；cluster-climate-eu-law-iea23（EU 气候法（2021/1119）与 IEA WEO 2023）；cluster-law-eu-ai-act-dpc-meta（EU AI Act（2024/1689）与 DPC Meta GDPR 决定）

## cluster-ai-llama-01（7 sources）

Focus: Meta Llama 3.1 发布（2024-07）

Evidence: 与历史簇无重叠：Llama 3.1 model card/LICENSE/发布为独立产品事件；与 cluster-ai-mcp-transports（MCP 规范）主题不同；与 cluster-law-eu-ai-act-dpc-meta 无关（非欧盟 AI 监管）；stable identity = github.com/meta-llama/llama-models + arxiv 对应页，不撞历史 URL/hash。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-ai-pytorch-01（6 sources）

Focus: PyTorch 2.0/2.6 官方发布（pytorch.org）

Evidence: 与全部 9 个历史簇无重叠：对象是 PyTorch 软件发布而非 MCP 规范（cluster-ai-mcp-transports）；无 Redis 许可证/NVIDIA/ASML 财务事件、WCAG/APCA 无障碍、COVID/mpox 疫情、考古、心理学、气候或 AI 监管事件。稳定身份为 pytorch.org 官方文档 URL，不与任何历史 canonical URL/hash 相撞。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-ai-swebench-01（5 sources）

Focus: SWE-bench 基准（arXiv 2310.06770v1/v3、GitHub repo、Verified 数据集）

Evidence: 与历史簇无重叠：SWE-bench 是软件工程评测基准，与 MCP transports 规范（cluster-ai-mcp-transports）、Redis 许可、NVIDIA/ASML、WCAG、疫情、考古、心理复现、气候、AI 监管均非同一事件；arXiv:2310.06770 与历史 arXiv 2304.02084（Vesuvius）不同论文。v1/v3 为同一论文的显式固定版本，已在簇内用版本化 canonicalUrl 区分，不构成跨源重复。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-climate-cbam-01（5 sources）

Focus: 欧盟碳边境调节机制（CBAM，Reg 2023/956）

Evidence: 与历史簇无重叠：CBAM 是独立欧盟法规（CELEX 32023R0956），与 EU 气候法（cluster-climate-eu-law-iea23，CELEX 32021L1119）为不同法规、不同 CELEX 编号；与 IEA WEO 2023 报告为不同文档；EUR-Lex URL 不同。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-climate-nuclear-01（7 sources）

Focus: 核能现状与政策转向（IEA 2025/WNA/OWID）

Evidence: 与历史簇无重叠：核能专题报告为独立事件；与 cluster-climate-eu-law-iea23（EU 气候法/IEA WEO 2023）为不同文档（IEA 2025 核能报告 vs WEO 2023 执行摘要）；iea.org/ourworldindata.org URL 不撞历史。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-design-apca-01（8 sources）

Focus: APCA 对比度算法与 WCAG 3 草案

Evidence: 与历史簇无重叠：APCA（Myndex 仓库）与 WCAG 3 草案为 WCAG 2.x（cluster-design-wcag-2x）的后续提案，但属于不同文档生命周期：WCAG 2.x 为已定稿 REC（2018/2023），WCAG 3 仍为 Working Draft（2026-03），APCA 为独立开源算法仓库；不同 canonical URL（w3.org/TR/wcag-3.0 vs /TR/WCAG22）、不同事件时间线。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-design-aria-01（8 sources）

Focus: WAI-ARIA 1.1/1.2 无障碍规范与实现指南

Evidence: 与历史簇无重叠：ARIA 是 W3C 角色/属性规范；与 cluster-design-wcag-2x（WCAG 2.1/2.2 成功准则）是不同 W3C 文档与不同标准事件（ARIA 1.1 REC 2017 / 1.2 REC 2023 vs WCAG 2.1 2018 / 2.2 2023），共享'无障碍'领域但文档身份、issue 编号（w3c/aria#923 vs w3c/wcag#2705）、URL 均不同。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-fin-asml-01（8 sources）

Focus: ASML 对华业务与出口管制（20-F/6-K）

Evidence: 与历史簇无重叠：ASML 公司申报为独立事件；与 cluster-fin-nvda-h20-fy26 虽同涉'对华出口'主题，但主体不同（ASML 光刻机 vs NVIDIA H20），监管事件不同（荷兰出口许可 vs 美国商务部规则），无共享 URL/hash/DOI。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-fin-fed-rates-01（8 sources）

Focus: 美联储 FOMC 利率决议（2024-09→2025-05）

Evidence: 与历史簇无重叠：美联储货币政策声明为独立宏观经济事件；与 cluster-fin-nvda-h20-fy26（NVIDIA 公司财报）主题不同（央行 vs 公司）；federalreserve.gov 官方声明 URL 不撞历史 URL/hash。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-health-hpv-01（5 sources）

Focus: HPV 疫苗单剂次证据与 WHO 建议

Evidence: 与历史簇无重叠：HPV 疫苗为独立公共卫生议题，与 COVID 空气传播（cluster-health-covid-airborne）、mpox 等疫情事件不同；WHO HPV 立场文件/新闻稿 URL 不撞历史 URL/hash。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-health-mpox-01（5 sources）

Focus: mpox 疫情（2022/2024 PHEIC）

Evidence: 与历史簇无重叠：mpox 与 COVID-19（cluster-health-covid-airborne）是不同病原体、不同疫情事件（WHO 不同 PHEIC 声明、不同 fact sheet 页）；who.int fact sheet URL 不同；无共享 hash。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-health-sugar-01（6 sources）

Focus: WHO 糖摄入指南（2015）与非糖甜味剂指南（2023）

Evidence: 与历史簇无重叠：营养指南为独立事件，与疫情簇（COVID/mpox）无关；who.int 糖指南与 NSS 指南 URL 不撞历史。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-hist-hobbit-01（8 sources）

Focus: Homo floresiensis（Liang Bua 2004→Mata Menge 2016/2024）

Evidence: 与历史簇无重叠：古人类学发现（hobbit）与 Vesuvius Challenge 卷轴（cluster-history-vesuvius）为完全不同的考古/历史事件（不同化石、不同文献 Nature 02999 vs Nature 2304.02084 arXiv、不同 URL）；无共享 DOI/URL/hash。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-hist-rosetta-01（5 sources）

Focus: 罗塞塔石碑（发现史与破译）

Evidence: 与历史簇无重叠：罗塞塔石碑为埃及学文物事件，与 Vesuvius 卷轴（cluster-history-vesuvius）、hobbit 化石（cluster-hist-hobbit-01）均为不同研究对象；britishmuseum.org/gutenberg 等 URL 不撞历史。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-law-chinaai-01（7 sources）

Focus: 中国生成式 AI 监管（暂行办法 2023→标识办法 2025→AI 法预备）

Evidence: 与历史簇无重叠：中国 AI 监管（gov.cn/cac.gov.cn 文件）与 EU AI Act/DPC Meta（cluster-law-eu-ai-act-dpc-meta）为不同法域、不同法律文件（中文法规 vs EU CELEX）；无共享 URL/hash。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-law-dma-01（7 sources）

Focus: 欧盟数字市场法（DMA，Reg 2022/1925）与守门人指定

Evidence: 与历史簇无重叠：DMA 是独立欧盟法规（CELEX 32022R1925），与 EU AI Act（cluster-law-eu-ai-act-dpc-meta，CELEX 32024R1689）为不同法规；与 DPC Meta GDPR 决定（爱尔兰）为不同法律程序；EUR-Lex/EC presscorner URL 不同。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-psych-nudge-01（5 sources）

Focus: nudge 有效性元分析争议（Mertens 2022 vs Maier 2022）

Evidence: 与历史簇无重叠：nudge 元分析争议与可重复性危机（cluster-psych-reproducibility：OSC RPP 2015/Many Labs/Gilbert 2016）为不同研究项目、不同论文（PNAS 2022 DOI 10.1073/pnas.2200300119 vs Science RPP 2015 DOI 10.1126/science.aac4716）；无共享 DOI/URL/hash。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-psych-prereg-01（8 sources）

Focus: 预注册运动（Simmons 2011→TOP 2015→COS 2018）

Evidence: 与历史簇无重叠：预注册倡议与可重复性危机（cluster-psych-reproducibility）主题相关但为不同事件/文档：本簇锚定 Simmons 2011（Psych Sci 22(11)）、Nosek TOP（Science aab2374）、COS/AsPredicted 平台；历史簇锚定 OSC RPP/Many Labs/Gilbert comment。无共享 DOI（10.1177/0956797611417632 vs 10.1126/science.aac4716）与 URL。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-tech-go-modules-01（7 sources）

Focus: Go 模块系统（vgo 提案→Go 1.25）

Evidence: 与历史簇无重叠：Go modules 是语言工具链演化，与 Redis 许可证（cluster-tech-redis-licensing）、MCP、财务、无障碍、健康、考古、心理、气候、法律事件均不同；go.dev/golang.org 官方文档 URL 不撞历史 URL/hash。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-tech-http3-01（8 sources）

Focus: HTTP/3（RFC 9114）与 QUIC 部署

Evidence: 与历史簇无重叠：IETF 标准（RFC 9000/9110/9114）与 MCP 规范（cluster-ai-mcp-transports）为不同标准体系与不同事件；RFC 编号与 MCP transports 规范日期无交叠；rfc-editor.org 与 Cloudflare 博客 URL 不撞历史。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |

## cluster-tech-kubernetes-01（7 sources）

Focus: Kubernetes 1.28–1.31 版本发布与特性

Evidence: 与历史簇无重叠：K8s 版本发布（1.28 Sidecar/1.31 Elli）为独立工程事件，与 Redis 许可证（cluster-tech-redis-licensing）、MCP 等主题不同；kubernetes.io/releases changelog URL 不撞历史 URL/hash。

| 历史簇 | 判定 | 理由 |
|---|---|---|
| cluster-ai-mcp-transports | no-overlap | MCP transports 规范（2024-11→2025-03）与 HN 讨论；身份/URL/时间线均不同 |
| cluster-tech-redis-licensing | no-overlap | Redis 许可证变更（2024-03 RSALv2+SSPLv1 / 2025-05 AGPLv3）；身份/URL/时间线均不同 |
| cluster-fin-nvda-h20-fy26 | no-overlap | NVIDIA H20 对华出口计提与 FY26 财报；身份/URL/时间线均不同 |
| cluster-design-wcag-2x | no-overlap | WCAG 2.1（2018）/2.2（2023）与 WebAIM 清单；身份/URL/时间线均不同 |
| cluster-health-covid-airborne | no-overlap | COVID-19 空气传播（WHO 2020/2024 简报）；身份/URL/时间线均不同 |
| cluster-history-vesuvius | no-overlap | Vesuvius Challenge 卷轴破译（arXiv 2304.02084 / Nature 2024）；身份/URL/时间线均不同 |
| cluster-psych-reproducibility | no-overlap | 可重复性危机（OSC RPP 2015 / Many Labs / Gilbert 2016）；身份/URL/时间线均不同 |
| cluster-climate-eu-law-iea23 | no-overlap | EU 气候法（2021/1119）与 IEA WEO 2023；身份/URL/时间线均不同 |
| cluster-law-eu-ai-act-dpc-meta | no-overlap | EU AI Act（2024/1689）与 DPC Meta GDPR 决定；身份/URL/时间线均不同 |
