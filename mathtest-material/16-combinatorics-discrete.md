---
title: "组合与离散数学"
prev: "数论"
next: "逻辑与集合"
---

# 第16章 组合与离散数学

> 组合数学研究有限的、可数的结构——计数、排列、图、网络。在计算机时代，离散数学从"数学的后花园"变成了核心舞台。

---

## 16.1 组合计数：排列与组合

### 基本原理

| 原则 | 公式 | 适用 |
|------|------|------|
| 乘法原理 | $n_1 \times n_2 \times \cdots$ | 独立选择的乘积 |
| 加法原理 | $n_1 + n_2 + \cdots$ | 互斥情况的求和 |
| 排列 | $P(n,k) = \frac{n!}{(n-k)!}$ | 有序选取 |
| 组合 | $C(n,k) = \binom{n}{k} = \frac{n!}{k!(n-k)!}$ | 无序选取 |
| 容斥原理 | $\|A \cup B\| = \|A\|+\|B\|-\|A \cap B\|$ | 重叠修正 |

### 生成函数：用幂级数编码数列

数列 $\{a_n\}$ 的**普通生成函数**：

$$
A(x) = \sum_{n=0}^\infty a_n x^n
$$

> 生成函数将**组合操作**翻译为**代数操作**——加法=不相交并，乘法=Cartesian积，这使得复杂的计数问题变成代数运算。

```python
from itertools import combinations, permutations
import math

items = ['A', 'B', 'C', 'D']

print("4选2的排列 (有序):")
for p in permutations(items, 2):
    print(f"  {p}", end="")
print(f"\n共 P(4,2) = {math.perm(4,2)} 个")

print("\n4选2的组合 (无序):")
for c in combinations(items, 2):
    print(f"  {c}", end="")
print(f"\n共 C(4,2) = {math.comb(4,2)} 个")

# 生成函数系数 = 组合数
# (1+x)⁴ = C(4,0) + C(4,1)x + C(4,2)x² + C(4,3)x³ + C(4,4)x⁴
coeffs = [math.comb(4, k) for k in range(5)]
print(f"\n(1+x)⁴ 的系数: {coeffs}")
```

---

## 16.2 图论：关系的数学

### 图的基本概念

**图** $G = (V, E)$ = 顶点集合 + 边集合。

| 概念 | 定义 | 重要性 |
|------|------|--------|
| 度数 | 与顶点相连的边数 | $\sum \deg(v) = 2\|E\|$ |
| 路径 | 不重复顶点的边序列 | 连通性 |
| 环 | 起终点相同的路径 | 图的结构 |
| 树 | 无环连通图 | $n$ 个顶点 $\to$ $n-1$ 条边 |
| 二分图 | 可二染色的图 | 匹配问题 |

### Euler 与 Hamilton

| 问题 | 条件 | 复杂度 |
|------|------|:---:|
| Euler回路（过每条边一次） | 所有顶点度数为偶数 | $O(E)$ |
| Hamilton回路（过每个顶点一次） | 充要条件未知 | **NP-完全** |

> 这两个外表相似的问题有截然不同的复杂性——这是 $\S$20 中 P vs NP 问题的经典案例。

### 图的着色与四色定理

**四色定理**（Appel-Haken 1976）：任何平面地图可用四种颜色着色使相邻区域不同色。这是第一个主要由计算机辅助证明的重要数学定理。

```python
# 图的邻接表表示与 BFS
from collections import deque

graph = {
    'A': ['B', 'C'],
    'B': ['A', 'D', 'E'],
    'C': ['A', 'F'],
    'D': ['B'],
    'E': ['B', 'F'],
    'F': ['C', 'E']
}

def bfs(graph, start):
    visited = []
    queue = deque([start])
    seen = {start}
    while queue:
        v = queue.popleft()
        visited.append(v)
        for neighbor in graph[v]:
            if neighbor not in seen:
                seen.add(neighbor)
                queue.append(neighbor)
    return visited

print("BFS from A:", " → ".join(bfs(graph, 'A')))
```

---

## 16.3 递推关系与生成函数

### Fibonacci：最经典的递推

$$
F_n = F_{n-1} + F_{n-2}, \quad F_0=0, F_1=1
$$

通解（Binet公式）：

$$
F_n = \frac{\varphi^n - (-\varphi)^{-n}}{\sqrt{5}}, \quad \varphi = \frac{1+\sqrt{5}}{2}
$$

### 递推求解的系统方法

1. **特征方程法**：$a_n = c_1 a_{n-1} + \cdots + c_k a_{n-k}$ → 解特征多项式
2. **生成函数法**：将递推转为生成函数的方程，解出封闭形式

---

## 16.4 Pólya 计数理论

**Burnside 引理**：群 $G$ 作用在集合 $X$ 上的轨道数 = 不动点的平均数：

$$
|\text{Orbits}| = \frac{1}{|G|} \sum_{g \in G} |X^g|
$$

> 这是群论（$\S$8）在计数问题中的经典应用——对称性减少了有效计数的数量。

---

## 16.5 本章关键点汇总

| # | 关键概念 | 直觉 | 连接章节 |
|---|---------|------|---------|
| 1 | **生成函数** | 幂级数编码数列→代数操作 | 计数、递推 |
| 2 | **图 = 关系网络** | 顶点+边描述一切连接 | $\S$20 网络 |
| 3 | **Euler vs Hamilton** | 边 vs 顶点→复杂度天差地别 | $\S$20 P vs NP |
| 4 | **四色定理** | 计算机辅助证明的先驱 | $\S$17 证明 |
| 5 | **Fibonacci → 黄金比例** | 离散递推→连续常数 | $\S$11 $\varphi$ |

> 💡 **核心哲学**：离散数学从"玩具问题"到"核心基础设施"的转变，是计算机时代最重要的数学变革之一。生成函数连接了离散与连续，图论连接了结构与算法，复杂度理论区分了可行与不可行。
