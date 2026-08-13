---
sourceId: s200-ai-swebench-006
title: "SWE-bench official documentation (docs/index.md, pinned commit)"
domain: ai
clusterId: cluster-ai-swebench-01
sourceRole: C-implementation
platform: github
author: "SWE-bench team (Princeton NLP)"
canonicalUrl: "https://github.com/SWE-bench/SWE-bench/blob/main/docs/index.md"
publishedAt: "2025-12-01"
capturedAt: "2026-08-10T23:58:00+08:00"
versionRef: "commit 2f106b56ffc9e73f7179a962d4d0f45673319ac5 (2025-12-01); file blob sha aeb80a05ff77245b68e63d08d296540da0486d72"
mediaType: documentation
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:0e2cfb75de2ce90c98c93412d088e00f7de8f825b2f76c82ec70177c0f65e8f5"
collectionMethod: public-api
licenseOrUsageNote: "MIT-licensed repository content (docs/index.md at pinned commit); internal benchmark use only."
collectionNotes: "SWE-bench 官方文档首页，经 GitHub Contents API 按固定 commit 2f106b56 抓取（GitHub blob sha aeb80a05）。记录了 SWE-bench Verified（Aug 13, 2024, 500 个工程师确认可解问题）与多数据集支持；与 s200-ai-swebench-002（README）同仓库但为独立文档页面。"
---

# SWE-bench official documentation (docs/index.md, pinned commit)

## Source Snapshot

# SWE-bench

SWE-bench is a benchmark for evaluating large language models on real world software issues collected from GitHub. Given a *codebase* and an *issue*, a language model is tasked with generating a *patch* that resolves the described problem.

## 🔍 All of the Projects

Check out the other projects that are part of the SWE-bench ecosystem! (SWE-agent, SWE-smith, SWE-rex, CodeClash, SWE-bench CLI, mini-swe — banners omitted)

## 🏆 Leaderboard

You can find the full leaderboard at [swebench.com](https://swebench.com)!

## 📋 Overview

SWE-bench provides:

* ✅ **Real-world GitHub issues** - Evaluate LLMs on actual software engineering tasks
* ✅ **Reproducible evaluation** - Docker-based evaluation harness for consistent results
* ✅ **Multiple datasets** - SWE-bench, SWE-bench Lite, SWE-bench Verified, and SWE-bench Multimodal

## 📰 Latest News

* **[Jan. 13, 2025]**: SWE-bench Multimodal integration with private test split evaluation
* **[Jan. 11, 2025]**: Cloud-based evaluations [via Modal](guides/evaluation.md)
* **[Aug. 13, 2024]**: SWE-bench Verified release with 500 engineer-confirmed solvable problems
* **[Jun. 27, 2024]**: Fully containerized evaluation harness using Docker
* **[Apr. 2, 2024]**: SWE-agent release with state-of-the-art results
* **[Jan. 16, 2024]**: SWE-bench accepted to ICLR 2024 as an oral presentation

## 🚀 Quick Start

```python
# Access SWE-bench via Hugging Face
from datasets import load_dataset
swebench = load_dataset('princeton-nlp/SWE-bench', split='test')
```

```bash
# Setup with Docker
git clone git@github.com:princeton-nlp/SWE-bench.git
cd SWE-bench
pip install -e .
```

## 📚 Documentation Structure

- **[Installation](installation.md)** - Setup instructions for local and cloud environments
- **Guides**
  - [Quickstart](guides/quickstart.md) - Get started with SWE-bench
  - [Evaluation](guides/evaluation.md) - How to evaluate models on SWE-bench
  - [Docker Setup](guides/docker_setup.md) - Configure Docker for SWE-bench
  - [Datasets](guides/datasets.md) - Available datasets and how to use them
  - [Create RAG Datasets](guides/create_rag_datasets.md) - Build your own retrieval datasets
- **Reference**
  - [Harness API](reference/harness.md) - Documentation for the evaluation harness
  - [Inference API](reference/inference.md) - Documentation for model inference
  - [Versioning](reference/versioning.md) - Documentation for versioning
- **[FAQ](faq.md)** - Frequently asked questions

## ⬇️ Available Resources

| Datasets | Models | RAG |
| - | - | - |
| [💿 SWE-bench](https://huggingface.co/datasets/SWE-bench/SWE-bench) | [🦙 SWE-Llama 13b](https://huggingface.co/princeton-nlp/SWE-Llama-13b) | [🤗 "Oracle" Retrieval](https://huggingface.co/datasets/SWE-bench/SWE-bench_oracle) |
| [💿 SWE-bench Lite](https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite) | [🦙 SWE-Llama 13b (PEFT)](https://huggingface.co/princeton-nlp/SWE-Llama-13b-peft) | [🤗 BM25 Retrieval 13K](https://huggingface.co/datasets/SWE-bench/SWE-bench_bm25_13K) |
| [💿 SWE-bench Verified](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified) | [🦙 SWE-Llama 7b](https://huggingface.co/princeton-nlp/SWE-Llama-7b) | [🤗 BM25 Retrieval 27K](https://huggingface.co/datasets/SWE-bench/SWE-bench_bm25_27K) |
| [💿 SWE-bench Multimodal](https://huggingface.co/datasets/SWE-bench/SWE-bench_Multimodal) | [🦙 SWE-Llama 7b (PEFT)](https://huggingface.co/princeton-nlp/SWE-Llama-7b-peft) | [🤗 BM25 Retrieval 40K/50K](https://huggingface.co/datasets/SWE-bench/SWE-bench_bm25_50k_llama) |

## 💫 Contributing

We welcome contributions from the NLP, Machine Learning, and Software Engineering communities! Please check our [contributing guidelines](https://github.com/princeton-nlp/SWE-bench/blob/main/CONTRIBUTING.md) for details.

## ✍️ Citation

```bibtex
@inproceedings{
    jimenez2024swebench,
    title={{SWE}-bench: Can Language Models Resolve Real-world Github Issues?},
    author={Carlos E Jimenez and John Yang and Alexander Wettig and Shunyu Yao and Kexin Pei and Ofir Press and Karthik R Narasimhan},
    booktitle={The Twelfth International Conference on Learning Representations},
    year={2024},
    url={https://openreview.net/forum?id=VTF8yNQM66}
}

@inproceedings{
    yang2024swebenchmultimodal,
    title={{SWE}-bench Multimodal: Do AI Systems Generalize to Visual Software Domains?},
    author={John Yang and Carlos E. Jimenez and Alex L. Zhang and Kilian Lieret and Joyce Yang and Xindi Wu and Ori Press and Niklas Muennighoff and Gabriel Synnaeve and Karthik R. Narasimhan and Diyi Yang and Sida I. Wang and Ofir Press},
    booktitle={The Thirteenth International Conference on Learning Representations},
    year={2025},
    url={https://openreview.net/forum?id=riTiq3i21b}
}
```

## Research Notes

原文来自 https://github.com/SWE-bench/SWE-bench/blob/main/docs/index.md（固定 commit 2f106b56ffc9e73f7179a962d4d0f45673319ac5，captured 2026-08-10 via GitHub Contents API）。banner 由 curator 添加，非上游文本。
HTML 横幅图片（img/div 装饰）已省略，仅保留文本内容；"Multiple datasets" 行与 "Aug. 13, 2024: SWE-bench Verified release with 500 engineer-confirmed solvable problems" 为 Verified 的官方记录。
