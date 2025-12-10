
1. 千万级数据时候，进行套索操作的时候页面会崩溃

what?（现象是什么？）

用户在进行套索操作时，浏览器页面无响应或直接崩溃
崩溃时机：用户在canvas上绘制path的时候



why?（崩溃的原因是什么？）
根本原因：主线程被海量计算阻塞 + 内存爆炸
原因1：每次鼠标位置的更新都触发一次lassoPath的改变然后会触发SceneContent的re-render,都会进行一次千万次数据量的3D投影计算

```
useFrame(() => {
if (selectionMode !== "lasso" || lassoPath.length === 0) return

const projectedPoints: { index: number; x: number; y: number }[] = []
const positions = pointCloud.positions
const vector = new THREE.Vector3()

for (let i = 0; i < positions.length; i += 3) {
    vector.set(positions[i], positions[i + 1], positions[i + 2])
    vector.project(camera)

    const x = ((vector.x + 1) / 2) * gl.domElement.clientWidth
    const y = ((-vector.y + 1) / 2) * gl.domElement.clientHeight

    if (vector.z < 1) {
    projectedPoints.push({ index: i / 3, x, y })
    }
}

onProjectedPoints(projectedPoints)
})
```


原因2: 每帧存储千万级投影点数据
```
  const handleProjectedPoints = useCallback((points: { index: number; x: number; y: number }[]) => {
    projectedPointsRef.current = points
  }, [])
```
内存计算：
每个投影点对象：{ index: number, x: number, y: number }
在 JavaScript 中，每个对象约占 48-64 字节（对象头 + 3个数字）
10,000,000 点 × 60 字节 ≈ 600MB

这个数组每帧都重新创建，60fps = 每秒分配 36GB 内存！


how?（是怎么崩溃的?）
崩溃流程：

用户按下鼠标开始画套索
    ↓
handleMouseDown 设置 isDrawing=true, lassoPath 有值
    ↓
【崩溃链开始】
    ↓
useFrame 每帧执行（60fps）
    ├─ 遍历 10,000,000 点
    ├─ 每个点做 3D → 2D 投影（矩阵运算）
    ├─ 创建 10,000,000 个对象 {index, x, y}
    └─ 存储到 projectedPointsRef（600MB+）
    ↓
同时，用户移动鼠标（mousemove 每秒触发 100+ 次）
    ├─ 每次创建新的 pathRef 数组副本
    ├─ 触发 onPathUpdate(pathRef.current)
    └─ 触发 draw() 重绘 canvas
    ↓
【多重压力叠加】
    ├─ CPU：主线程被 3亿次/帧 的运算占满 → 丢帧 → UI 卡死
    ├─ 内存：每秒分配 36GB 内存 → 浏览器内存限制（2-4GB）触顶
    └─ GC：频繁 Full GC 试图回收内存 → 进一步阻塞主线程
    ↓
浏览器崩溃或页面无响应


how to resolve?

解决方案：将"实时投影计算"改为"延迟计算"

### 优化1：移除 useFrame 中的实时投影计算
**问题**：useFrame 以 60fps 的频率执行千万次投影计算
**解决**：不再在 useFrame 中每帧计算，改为只提供一个计算函数

优化前：每帧都计算
```
useFrame(() => {
  for (let i = 0; i < positions.length; i += 3) {
    // 千万次投影计算
  }
})
```

优化后：只提供计算函数
```
useEffect(() => {
  const computeProjection = () => {
    for (let i = 0; i < positions.length; i += 3) {
      // 只在需要时调用
    }
  }
  onComputeProjection(computeProjection)
}, [])
```

**效果**：
- 绘制套索时：0 次投影计算（原来：60fps × N秒 = 数百次）
- 完成套索时：1 次投影计算

### 优化2：只在套索完成时才计算投影
**问题**：绘制过程中持续存储 600MB 投影数据
**解决**：存储计算函数而不是计算结果

优化前：存储投影结果（600MB）
```
const projectedPointsRef = useRef<{index, x, y}[]>([])
```

优化后：存储计算函数（几KB）
```
const computeProjectionRef = useRef<() => {index, x, y}[]>(null)

// 只在套索完成时调用一次
const projectedPoints = computeProjectionRef.current()
```

**效果**：
- 内存占用：从每秒 36GB → 只在完成时分配一次 600MB
- 绘制过程内存：~0MB（原来：持续累积）

### 优化3：优化套索路径数组的内存分配
**问题**：每次 mousemove 都用扩展运算符创建新数组
**解决**：直接 push 到现有数组

优化前：每次创建新数组
```
pathRef.current = [...pathRef.current, newPoint]
```

优化后：直接修改数组
```
pathRef.current.push(newPoint)
```

**效果**：
- 假设用户画套索移动 200 次
- 优化前：创建 200 个数组副本 + 等待 GC
- 优化后：1 个数组持续增长

### 优化效果对比

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 绘制时投影计算次数 | 180次（3秒×60fps） | 1次 | **180倍** |
| 绘制时内存分配 | 36GB/秒 | ~0MB | **极大改善** |
| 套索路径数组创建 | 200次 | 1次 | **200倍** |
| 主线程阻塞 | 持续阻塞 | 仅完成时短暂计算 | **体验质变** |


## 问题2: 搜索耗时在9000ms左右，需要优化到<1000ms

## 问题3: 上色时会遇到页面崩溃的情况
