符合筛选条件的 span 数: 120
采样数: 35
---SPAN 1---
[spanId] span:01-number-systems-80440e2182e5653f-1
[blockId] 01-number-systems#block-1
[原文]
> 从计数石子到量子态的复数——数是人类理解宇宙最底层的语言。本章沿着数系的逐级扩张路线，揭示每一次"不够用"的危机如何推动数学的革命性突破。

---SPAN 2---
[spanId] span:01-number-systems-80440e2182e5653f-8
[blockId] 01-number-systems#block-8
[原文]
**关键洞察**：自然数的本质不是"0,1,2,3..."这些符号，而是**递归结构**——从零出发，反复应用"后继"操作，生成无穷无尽的序列。这就是为什么数学归纳法如此根本：它直接编码了自然数的构造方式。

---SPAN 3---
[spanId] span:01-number-systems-80440e2182e5653f-18
[blockId] 01-number-systems#block-18
[原文]
自然数的根本缺陷：**减法不封闭**。$3 - 5$ 在 $\mathbb{N}$ 中没有答案。这个"不够用"推动了我们第一次数系扩张。

---SPAN 4---
[spanId] span:01-number-systems-80440e2182e5653f-22
[blockId] 01-number-systems#block-22
[原文]
$$
\mathbb{Z} = \{\ldots, -3, -2, -1, 0, 1, 2, 3, \ldots\}
$$

---SPAN 5---
[spanId] span:01-number-systems-80440e2182e5653f-28
[blockId] 01-number-systems#block-28
[原文]
<div class="key-point">
**关键点**：整数通过引入"负数"解决了减法封闭问题，代价是失去了 $\mathbb{N}$ 的良序性（整数没有最小元）。但换来的是**群结构**——$(\mathbb{Z}, +)$ 成为一个阿贝尔群（$\S$8）。
</div>

---SPAN 6---
[spanId] span:01-number-systems-80440e2182e5653f-37
[blockId] 01-number-systems#block-37
[原文]
$$
\forall p,q \in \mathbb{Q}, p < q \implies \exists r = \frac{p+q}{2} \in \mathbb{Q}, \; p < r < q
$$

---SPAN 7---
[spanId] span:01-number-systems-80440e2182e5653f-41
[blockId] 01-number-systems#block-41
[原文]
$\mathbb{Q}$ 是一个**域**（Field）——加减乘除（除数非零）全部封闭：

---SPAN 8---
[spanId] span:01-number-systems-80440e2182e5653f-47
[blockId] 01-number-systems#block-47
[原文]
$$
\frac{1}{1}, \frac{1}{2}, \frac{2}{1}, \frac{3}{1}, \frac{2}{2}, \frac{1}{3}, \frac{1}{4}, \frac{2}{3}, \frac{3}{2}, \frac{4}{1}, \ldots
$$

---SPAN 9---
[spanId] span:01-number-systems-80440e2182e5653f-54
[blockId] 01-number-systems#block-54
[原文]
这个发现在古希腊引发了"第一次数学危机"——有理数不能覆盖数轴上所有的点。数轴上的"洞"需要一种新的数来填。

---SPAN 10---
[spanId] span:01-number-systems-80440e2182e5653f-59
[blockId] 01-number-systems#block-59
[原文]
$$
\mathbb{R} = \mathbb{Q} \cup \{\text{无理数}\}
$$

---SPAN 11---
[spanId] span:01-number-systems-80440e2182e5653f-68
[blockId] 01-number-systems#block-68
[原文]
$$
\begin{aligned}
x_1 &= 0.a_{11}a_{12}a_{13}\ldots \\
x_2 &= 0.a_{21}a_{22}a_{23}\ldots \\
x_3 &= 0.a_{31}a_{32}a_{33}\ldots
\end{aligned}
$$

---SPAN 12---
[spanId] span:01-number-systems-80440e2182e5653f-76
[blockId] 01-number-systems#block-76
[原文]
$$
\mathbb{C} = \{a + bi \mid a,b \in \mathbb{R}, i^2 = -1\}
$$

---SPAN 13---
[spanId] span:01-number-systems-80440e2182e5653f-81
[blockId] 01-number-systems#block-81
[原文]
$$
z_1 \cdot z_2 = r_1r_2 \cdot e^{i(\theta_1 + \theta_2)}
$$

---SPAN 14---
[spanId] span:01-number-systems-80440e2182e5653f-86
[blockId] 01-number-systems#block-86
[原文]
更一般地：$e^{i\theta} = \cos\theta + i\sin\theta$。这揭示了复指数与三角函数的深层统一——振动 = 复平面上的圆周运动。

---SPAN 15---
[spanId] span:01-number-systems-80440e2182e5653f-98
[blockId] 01-number-systems#block-98
[原文]
![数轴上的数系扩张——从自然数到复数的逐级构造](../images/01-number-systems/01-number-systems_数轴上-数系扩张.png)

---SPAN 16---
[spanId] span:03-sequences-limits-e7ea8bc17c2cc4ab-5
[blockId] 03-sequences-limits#block-5
[原文]
**数列** = 定义在自然数上的函数：$a: \mathbb{N} \to \mathbb{R}$（或 $\mathbb{C}$），记作 $(a_n)_{n=1}^\infty$。

---SPAN 17---
[spanId] span:03-sequences-limits-e7ea8bc17c2cc4ab-13
[blockId] 03-sequences-limits#block-13
[原文]
> **定义**（数列极限）：$\lim_{n \to \infty} a_n = L$ 当且仅当：
>
> $$\forall \epsilon > 0, \; \exists N \in \mathbb{N}, \; \forall n > N: |a_n - L| < \epsilon$$

---SPAN 18---
[spanId] span:03-sequences-limits-e7ea8bc17c2cc4ab-24
[blockId] 03-sequences-limits#block-24
[原文]
**级数** = 数列的"累加"：$\sum_{n=1}^\infty a_n = \lim_{N \to \infty} \sum_{n=1}^N a_n$

---SPAN 19---
[spanId] span:03-sequences-limits-e7ea8bc17c2cc4ab-37
[blockId] 03-sequences-limits#block-37
[原文]
$$
f(x) = f(0) + f'(0)x + \frac{f''(0)}{2!}x^2 + \frac{f'''(0)}{3!}x^3 + \cdots
$$

---SPAN 20---
[spanId] span:03-sequences-limits-e7ea8bc17c2cc4ab-51
[blockId] 03-sequences-limits#block-51
[原文]
> **关键洞见**：一致收敛才是"好的"收敛——它保证极限函数继承逼近函数序列的优良性质（连续、可导、可积）。这就是为什么在 $\S$9 泛函分析中要研究**算子的一致收敛**，而不仅仅是逐点收敛。

---SPAN 21---
[spanId] span:05-functions-mappings-7e02712717a02820-4
[blockId] 05-functions-mappings#block-4
[原文]
**函数** $f: X \to Y$ = 对 $X$ 中每个元素唯一指定 $Y$ 中一个元素。

---SPAN 22---
[spanId] span:05-functions-mappings-7e02712717a02820-12
[blockId] 05-functions-mappings#block-12
[原文]
当 $X$ 和 $Y$ 有额外的数学结构时，"好的"映射应该**保持**这些结构。

---SPAN 23---
[spanId] span:05-functions-mappings-7e02712717a02820-19
[blockId] 05-functions-mappings#block-19
[原文]
| 变换 | 公式 | 核心作用 |
|------|------|---------|
| **Fourier** | $\hat{f}(\omega) = \int f(t)e^{-i\omega t}dt$ | 频率分解 |
| **Laplace** | $F(s) = \int_0^\infty f(t)e^{-st}dt$ | ODE→代数方程 |
| **Z变换** | $F(z) = \sum f[n]z^{-n}$ | 离散信号 |
| **小波** | 多尺度分析 | 局部时频分析 |

---SPAN 24---
[spanId] span:05-functions-mappings-7e02712717a02820-33
[blockId] 05-functions-mappings#block-33
[原文]
$$
\|T\| = \sup_{\|f\|=1} \|Tf\| < \infty \iff T \text{ 连续}
$$

---SPAN 25---
[spanId] span:09-functional-analysis-9478dfc1ba6cb58f-5
[blockId] 09-functional-analysis#block-5
[原文]
**泛函** $J: V \to \mathbb{R}$（或 $\mathbb{C}$）——输入是函数，输出是数。

---SPAN 26---
[spanId] span:09-functional-analysis-9478dfc1ba6cb58f-9
[blockId] 09-functional-analysis#block-9
[原文]
$$
\frac{\partial L}{\partial y} - \frac{d}{dx}\left(\frac{\partial L}{\partial y'}\right) = 0
$$

---SPAN 27---
[spanId] span:09-functional-analysis-9478dfc1ba6cb58f-18
[blockId] 09-functional-analysis#block-18
[原文]
> 这四大定理是泛函分析的"武功秘籍"——它们告诉你：在完备空间中，**逐点的性质往往能推出全局的性质**。

---SPAN 28---
[spanId] span:09-functional-analysis-9478dfc1ba6cb58f-26
[blockId] 09-functional-analysis#block-26
[原文]
$$
f(x) = \langle x, y \rangle \quad \text{对某唯一的 } y \in H
$$

---SPAN 29---
[spanId] span:09-functional-analysis-9478dfc1ba6cb58f-34
[blockId] 09-functional-analysis#block-34
[原文]
| 谱的类型 | 含义 | 例子 |
|---------|------|------|
| **点谱** | $\lambda I - T$ 非单射 | 真正的特征值 |
| **连续谱** | 单射但值域稠密（却非满射） | 乘法算子 $(Tf)(x)=xf(x)$ |
| **剩余谱** | 单射但值域不稠密 | unilateral shift |

---SPAN 30---
[spanId] span:09-functional-analysis-9478dfc1ba6cb58f-41
[blockId] 09-functional-analysis#block-41
[原文]
紧算子是"最像矩阵"的无限维算子——它的谱除了可能的 $0$ 之外，完全由特征值构成：

---SPAN 31---
[spanId] span:09-functional-analysis-9478dfc1ba6cb58f-48
[blockId] 09-functional-analysis#block-48
[原文]
> 💡 **核心哲学**：泛函分析 = 无限维线性代数 + 拓扑完备性。有限维中的很多"理所当然"（如所有范数等价、线性算子自动连续）在无限维中全部失效。但也正是这些"失效"创造了丰富性——谱的三种类型、有界与无界算子的鸿沟、紧性与非紧性的分野，构成了现代分析的深层景观。

---SPAN 32---
[spanId] span:11-constants-140ce51a25193ff7-13
[blockId] 11-constants#block-13
[原文]
$$
e = \lim_{n\to\infty} \left(1 + \frac{1}{n}\right)^n = \sum_{n=0}^\infty \frac{1}{n!} \approx 2.71828\ldots
$$

---SPAN 33---
[spanId] span:11-constants-140ce51a25193ff7-22
[blockId] 11-constants#block-22
[原文]
![e^{iπ}+1=0——复平面上从(1,0)沿单位圆旋转π弧度到达(-1,0)，加1回到原点](../images/11-constants/11-constants_eiπ10-复平面.png)

---SPAN 34---
[spanId] span:11-constants-140ce51a25193ff7-30
[blockId] 11-constants#block-30
[原文]
$$
\gamma = \lim_{n\to\infty} \left(\sum_{k=1}^n \frac{1}{k} - \ln n\right) \approx 0.57721\ldots
$$

---SPAN 35---
[spanId] span:11-constants-140ce51a25193ff7-36
[blockId] 11-constants#block-36
[原文]
$$
\varphi = \frac{1+\sqrt{5}}{2} \approx 1.61803\ldots
$$

