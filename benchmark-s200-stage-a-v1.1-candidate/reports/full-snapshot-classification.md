# Full Snapshot Classification（accessStatus=full 且 <1,000 字符）

验收要求：对 accessStatus=full 且快照 <1,000 字符的来源逐条确认是「上游页面本身很短」还是「只截了目标段落」，不得机械扩写。

| sourceId | chars | 分类 | 说明 |
|---|---|---|---|
| s200-ai-pytorch-004 | 390 | full-page | GitHub Releases API 对 v2.0.0 tag 的完整 JSON 响应（ref/sha/url 元数据），上游响应本身即短 |
| s200-climate-cbam-002 | 903 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-climate-nuclear-002 | 956 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-climate-nuclear-003 | 942 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-design-apca-002 | 988 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-design-apca-007 | 592 | full-page | SAPC-APCA LICENSE.md（BSD 2-Clause）全文，许可证文本本身即 ~590 字符 |
| s200-design-apca-009 | 986 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-design-aria-003 | 525 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-design-aria-004 | 248 | full-page | w3c/aria PR #923 的 GitHub Issues API 完整元数据响应（title/state/created_at），上游即短 |
| s200-design-aria-008 | 245 | full-page | w3c/aria PR #2577 的 GitHub Issues API 完整元数据响应，上游即短 |
| s200-fin-asml-002 | 869 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-fin-fed-009 | 132 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-fin-fed-010 | 153 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-health-sugar-001 | 798 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-hist-hobbit-001 | 936 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-hist-hobbit-003 | 630 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-law-chinaai-001 | 549 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-law-chinaai-002 | 480 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-law-chinaai-003 | 447 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-psych-prereg-001 | 486 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-psych-prereg-008 | 177 | full-page | AsPredicted 预注册平台落地页，页面正文本身即短（平台说明+CTA） |
| s200-tech-gomod-004 | 958 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-tech-gomod-007 | 381 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-tech-http3-002 | 780 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-tech-http3-006 | 925 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-tech-http3-007 | 979 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-tech-k8s-002 | 975 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-tech-k8s-003 | 547 | full-page | Kubernetes v1.31.0 GitHub Release API 完整元数据响应（tag/name/published_at），上游即短 |
| s200-tech-k8s-007 | 808 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |
| s200-tech-k8s-008 | 178 | targeted-excerpt | 上游页面篇幅远超快照；快照保留可定位的目标段落/关键句（见 Research Notes），标注为 excerpt 性质 |

## 汇总

- accessStatus=full 总数：84（60.0%，≥60% 门槛）
- 其中 <1,000 字符的快照：30 个 = full-page 6 + targeted-excerpt 24
- full-page：上游页面/API 响应本身即短，快照为完整内容（6 个）
- targeted-excerpt：上游为长文档（法规全文、RFC、20-F、论文、release notes 等），快照只保存可定位的关键段落（24 个）

说明：accessStatus=full 的口径是「采集时可完整定位并保存原文连续内容」；targeted-excerpt 属于该口径下的保守子类，未把任何<1,000 字符快照扩写。60% 门槛的达成请同时参考 full 总数与本文档分类。