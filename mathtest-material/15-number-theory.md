---
title: "数论"
prev: "概率与统计"
next: "组合与离散数学"
---

# 第15章 数论

> "数学是科学的皇后，数论是数学的皇后"——Gauss。数论研究整数的性质与规律，它的魅力在于：问题陈述极其简单（甚至小学生能懂），但解答却需要人类最深邃的智慧。

---

## 15.1 整除与素数

### 算术基本定理

> 每个大于1的整数可**唯一**分解为素数的乘积。

$$
n = p_1^{e_1} p_2^{e_2} \cdots p_k^{e_k}
$$

素数 = 整数的"原子"。这个唯一性是整数环 $\mathbb{Z}$ 是**唯一分解整环**（UFD）的体现（$\S$8）。

### 素数有无穷多个——欧几里得的经典证明

假设只有有限个素数 $p_1,\ldots,p_k$，则 $N = p_1 p_2 \cdots p_k + 1$ 不能被任何一个 $p_i$ 整除，但必有一素因子——矛盾！

### 素数定理 (PNT)

$$
\pi(x) \sim \frac{x}{\ln x} \quad (x \to \infty)
$$

其中 $\pi(x)$ 是不超过 $x$ 的素数个数。Hadamard 和 de la Vallée Poussin 于 1896 年独立证明。

```python
def sieve_of_eratosthenes(n):
    """埃拉托色尼筛法: 找出 n 以内的所有素数"""
    is_prime = [True] * (n + 1)
    is_prime[0] = is_prime[1] = False
    for i in range(2, int(n**0.5) + 1):
        if is_prime[i]:
            for j in range(i*i, n+1, i):
                is_prime[j] = False
    return [i for i, p in enumerate(is_prime) if p]

primes = sieve_of_eratosthenes(200)
print(f"200以内的素数 ({len(primes)}个):")
print(" ".join(str(p) for p in primes[:30]), "...")

# 验证素数定理: π(x) ≈ x/ln(x)
import math
x = 1000000
primes_to_x = sieve_of_eratosthenes(x)
actual = len(primes_to_x)
approx = x / math.log(x)
print(f"\nπ({x}) = {actual}")
print(f"x/ln(x) = {approx:.0f}")
print(f"比值 = {actual/approx:.4f}")
```

---

## 15.2 同余与模算术

### Gauss 的伟大发明：模算术

$$
a \equiv b \pmod{m} \iff m \mid (a - b)
$$

模 $m$ 的算术产生有限环 $\mathbb{Z}/m\mathbb{Z}$。当 $m$ 为素数时，这是一个**有限域** $\mathbb{F}_p$（$\S$8）。

### 中国剩余定理 (CRT)

若 $m_1, m_2, \ldots, m_k$ 两两互质，则同余方程组：

$$
x \equiv a_1 \pmod{m_1}, \ldots, x \equiv a_k \pmod{m_k}
$$

在模 $M = \prod m_i$ 下有唯一解。

### Euler 定理与 RSA 密码

**Euler 定理**：若 $\gcd(a, n) = 1$，则

$$
a^{\varphi(n)} \equiv 1 \pmod{n}
$$

其中 $\varphi(n)$ 是 Euler 函数（$\leq n$ 且与 $n$ 互质的数的个数）。

> RSA 加密直接建立在这个定理上：选择两个大素数 $p,q$，$n=pq$，公钥 $e$，私钥 $d \equiv e^{-1} \pmod{\varphi(n)}$。加密 $c = m^e \bmod n$，解密 $m = c^d \bmod n$。

### 二次互反律 (Gauss 的"黄金定理")

对于奇素数 $p,q$：

$$
\left(\frac{p}{q}\right)\left(\frac{q}{p}\right) = (-1)^{\frac{p-1}{2}\cdot\frac{q-1}{2}}
$$

> Gauss 称之为"算术的宝石"——它在两个素数的"二次剩余关系"之间建立了对称性。这一风格后来在 Langlands 纲领中被推广到极深远的程度。

---

## 15.3 丢番图方程

求整数解的方程。最著名的例子：

### Fermat 大定理 (Wiles 1995)

$$
x^n + y^n = z^n \quad (n \geq 3) \Rightarrow \text{无非零整数解}
$$

证明需要**椭圆曲线**和**模形式**的深层联系——这是 $\S$6 代数几何和数论交叉的巅峰成就。

### Pell 方程

$$
x^2 - Dy^2 = 1
$$

无穷多组整数解，与 $\mathbb{Q}(\sqrt{D})$ 的单位群结构相关。

---

## 15.4 解析数论：用连续方法研究离散

| 工具 | 应用 |
|------|------|
| **Riemann $\zeta$ 函数** $\zeta(s) = \sum n^{-s}$ | 素数分布 |
| Dirichlet $L$-函数 | 等差数列中的素数 |
| 模形式 | Fermat大定理、Langlands |
| 圆法 (Circle Method) | Goldbach猜想 |

### Riemann 猜想（未解决，悬赏$1,000,000）

$\zeta(s)$ 的所有非平凡零点的实部都是 $\frac{1}{2}$。如果为真，素数定理的误差项将大幅改进。

---

## 15.5 本章关键点汇总

| # | 关键概念 | 直觉 | 连接章节 |
|---|---------|------|---------|
| 1 | **算术基本定理** | 素数 = 整数的原子 | $\S$8 UFD |
| 2 | **模算术** | $\mathbb{Z}/m\mathbb{Z}$ 环 | $\S$8 环论 |
| 3 | **RSA** | Euler定理 → 公钥密码 | $\S$20 信息 |
| 4 | **Fermat大定理** | 椭圆曲线 + 模形式 | $\S$6 代数几何 |
| 5 | **Riemann $\zeta$** | 素数分布的生成函数 | 解析数论 |

> 💡 **核心哲学**：数论是"最简单问题"与"最深刻理论"的奇异交汇。Fermat大定理的陈述需要一行，证明需要350年+椭圆曲线+模形式。这种"简单-深刻"的张力正是数论魅力的源泉。
