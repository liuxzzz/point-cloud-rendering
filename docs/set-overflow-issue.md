# JavaScript Set 容量溢出问题

## 问题描述

在套索选择大量点时，抛出以下错误：

```
RangeError: Set maximum size exceeded
    at Set.add (<anonymous>)
    at new Set (<anonymous>)
```

## 原因

JavaScript `Set` 的最大容量约为 **2^24（约 1677 万）** 个元素。当选中的点数超过此限制时，`new Set(indices)` 会抛出 `RangeError`。

## 解决方案

使用 `Uint32Array` 替代 `Set<number>` 存储选中索引：

```typescript
// Before
const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())

// After
const [selectedIndices, setSelectedIndices] = useState<Uint32Array>(new Uint32Array())
```

## 对比

| 特性 | Set | Uint32Array |
|------|-----|-------------|
| 最大元素数 | ~1677 万 | ~10 亿+ |
| 内存占用 | 16-24 字节/元素 | 4 字节/元素 |
| 迭代性能 | 较慢 | 快（连续内存） |
| Worker 传输 | 需序列化 | 可 transfer |



## 为什么MAC上使用同样的运行程序，上传同样的文件，使用同样的浏览器不会出现这个问题？

原因暂时正在研究中，初步怀疑是浏览器对内存的限制不同。