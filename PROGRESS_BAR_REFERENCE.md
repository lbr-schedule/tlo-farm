# 進度條實作參考（Progress Bar Implementation）

>這個技術會用於：作物生長、動物產物、加工品製造、冷卻時間…等所有需要時間進度的場合。

---

## 🎯 核心設計原則

### 基本結構（三層疊加）
```
[1] 背景層 — 深色底（固定不變）
[2] 外框層 — 黑色描邊（固定不變）
[3] 前景層 — 彩色進度填充（動態變化）
```

---

## 📐 標準尺寸（像素單位）

|層次 | 尺寸 | 起點相對於容器 |備註 |
|------|------|----------------|------|
| 背景 | 26×7 px | `fillRect(-13, 9, 26, 7)` | 26px寬 |
| 前台外框 | 26×7 px | `strokeRect(-13, 9, 26, 7)` | 1px黑色 |
| 前景 | 24×5 px | `fillRect(-12, 10, 24 * progress, 5)` | 比背景小 1px，留內邊距 |

### ⚠️ 關鍵對齊
-前景起點 `-12` 比背景起點 `-13` 多 1px（視覺置中）
- 前景寬度 `24 * progress` 永遠 ≤24px
- 背景 26px，前景最大 24px，兩側各留 1px

---

## 🔢 進度計算公式

```typescript
// 通用進度計算
const totalTime = config.totalTimeMs;        // 總時間（毫秒）
const elapsed = Date.now() - config.startAt; // 已流逝（毫秒）
const speedup = config.speedup ?? 1;         // 加速倍率（預設1）
const effectiveElapsed = elapsed * speedup;
const progress = Math.min(1, Math.max(0, effectiveElapsed / totalTime));
```

###範例情境

| 情境 | totalTime | speedup | 備註 |
|------|-----------|---------|------|
| 作物生長 | `growTimeSec * 1000` | 1.5（澆水） | 基準 |
| 動物產物 | `productTimeMs` | 1 | 無加速 |
| 加工製造 | `processTimeMs` | 2（電力加速） | 可變倍率 |
| 冷卻時間 | `cooldownMs` | 1 | 無加速 |

---

## 🎨顏色階梯（非常重要！）

```typescript
const barColor =
  progress > 0.66 ? 0x52BE80 :   // 綠色（66-100%）生長完成
  progress > 0.33 ? 0xF7DC6F :   // 黃色（33-66%）生長中期
  0x6CB4EE;                      // 藍色（0-33%）生長初期
```

### 特殊狀態顏色

| 狀態 | 顏色 | Hex | 視覺意義 |
|------|------|-----|----------|
| 靜止/需action | 紅色 | `0xEC7063` | 需要玩家 action |
| 完成 | 綠色 | `0x52BE80` | 可收成/領取 |
| 加速中 | 紫色 | `0xC39BD3` | 特殊加速狀態 |
| 等待資源 | 橙色 | `0xE67E22` | 缺少某種資源 |

---

## 🔄 更新機制

### 頻率控制
```typescript
// 每30幀更新一次（約1-2秒），不是每幀更新
if (this._frameCount %30 === 0) {
  this.updateAllProgressBars();
}
```

### Frame Counter設定
```typescript
// 在 update() 頂部
if (this._frameCount === undefined) this._frameCount = 0;
this._frameCount++;
```

---

## 🏗️ 容器管理（最重要！）

### Tile Container索引結構
```
Container
 [0] = 土壤/地板圖示（base image）
  [1] = 主體圖示（作物/動物/加工機械）
  [2+] = 進度條圖形（每次更新先砍掉這裡）
```

###清理進度條（每次更新前執行）
```typescript
// 只清除 index 2 以後，保留 [0] 和 [1]
const oldChildren = tile.list.slice(2);
oldChildren.forEach(child => { if (child) child.destroy(); });
```

### ⚠️ 千萬不要做的
```typescript
// ❌ 錯誤：清空整個容器
tile.removeAll(true);

// ❌ 錯誤：破壞容器本身
tile.destroy();

// ✅正確：只砍 slice(2)以后的子元素
tile.list.slice(2).forEach(c => c?.destroy());
```

---

## 📝實作模板（可直接複製）

```typescript
function updateProgressBar(
  container: Phaser.GameObjects.Container,
  progress: number,      // 0-1
  options?: {
    backgroundColor?: number;  // 預設 0x1a1a1a
    borderColor?: number;     // 預設 0x000000
    borderAlpha?: number;     // 預設 0.8
    x?: number;              // 預設 -13
    y?: number;              // 預設 9
    width?: number;          // 預設 26
    height?: number;         // 預設 7
    speedup?: boolean;       // 是否顯示加速中（紫色）
  }
) {
  const {
    backgroundColor = 0x1a1a1a,
    borderColor = 0x000000,
    borderAlpha = 0.8,
    x = -13,
    y = 9,
    width = 26,
    height = 7,
    speedup = false,
  } = options ?? {};

  // 清理舊進度條
  const oldChildren = container.list.slice(2);
  oldChildren.forEach(child => { if (child) child.destroy(); });

  // 計算顏色
  let barColor: number;
  if (speedup) {
    barColor = 0xC39BD3; // 加速中 → 紫色
  } else if (progress <= 0) {
    barColor = 0xEC7063; // 靜止/暫停 → 紅色
  } else if (progress >= 1) {
    barColor = 0x52BE80; // 完成 → 綠色
  } else {
    barColor =
      progress > 0.66 ? 0x52BE80 :
      progress > 0.33 ? 0xF7DC6F :
      0x6CB4EE;
  }

  // 背景
  const barBg = container.scene.add.graphics();
  barBg.fillStyle(backgroundColor, 1);
  barBg.fillRect(x, y, width, height);
  container.add(barBg);

  // 外框
  const barBorder = container.scene.add.graphics();
  barBorder.lineStyle(1, borderColor, borderAlpha);
  barBorder.strokeRect(x, y, width, height);
  container.add(barBorder);

  // 前台（根據 progress決定寬度）
  const barFg = container.scene.add.graphics();
  barFg.fillStyle(barColor, 1);
  const innerWidth = width - 2; // 留1px 內邊距
  const innerHeight = height - 2;
  barFg.fillRect(x + 1, y + 1, Math.floor(innerWidth * progress), innerHeight);
  container.add(barFg);
}
```

---

## 🔧 資料模型設計

### TileData 結構（適用於所有有时间进度的对象）
```typescript
interface TimedProgress {
  // 通用欄位
  state: 'idle' | 'inProgress' | 'complete' | 'paused';
  startAt: number;        // 開始時間戳（毫秒）
  totalTime: number;     // 總時間（毫秒）
  speedup?: number;       // 加速倍率（預設1）
  
  // 可選：適用於作物/養殖
  wateredAt?: number;    // 額外資源標記
  fedAt?: number;        // 動物餵養標記
  
  // 可選：適用於加工
  processType?: string; // 加工類型
  outputItemId?: number; // 產出物品ID
}
```

---

## 🐄 動物產物範例

```typescript
interface AnimalProduct {
  animalId: number;
  productId: number;
  readyAt: number;      // 完成時間戳
  state: 'producing' | 'ready' | 'collected';
}

// 產物進度條更新
if (animal.state === 'producing') {
  const elapsed = Date.now() - animal.startedAt;
  const progress = Math.min(1, elapsed / animal.totalTime);
  updateProgressBar(animalContainer, progress);
} else if (animal.state === 'ready') {
  updateProgressBar(animalContainer, 1); // 顯示綠色完成
}
```

---

## 🏭加工製造範例

```typescript
interface ProcessingJob {
  machineId: number;
  inputItems: { id: number; count: number }[];
  outputItemId: number;
  startedAt: number;
  totalTime: number;    // 毫秒
  speedup: number;      // 可能有電力加速
  state: 'waiting' | 'processing' | 'complete';
}

// 更新加工進度
const elapsed = Date.now() - job.startedAt;
const effectiveElapsed = elapsed * job.speedup;
const progress = Math.min(1, effectiveElapsed / job.totalTime);
const isSpeedup = job.speedup > 1;
updateProgressBar(machineContainer, progress, { speedup: isSpeedup });
```

---

## ⚠️ 注意事項

1. **外框一定要畫**：否則淺色進度條會跟背景融在一起看不見
2. **每次更新前先清理**：`slice(2)` 以後的全部摧毀
3. **不要每幀更新**：設定 frame counter，每 N幀更新一次
4. **progress 要 clamp**：`Math.min(1, Math.max(0, progress))`
5. **容器坐標是相對的**：進度條位置是相對於容器的局部座標
6. **時間用毫秒**：统一用 `Date.now()` 和 `*1000` 保持一致

---

## 📦 新專案複製檢查清單

- [ ] 進度條尺寸：背景26×7，前景 24×5
- [ ] 外框：`strokeRect` 1px 黑色 80% 透明度
- [ ] 顏色階梯：藍(#6CB4EE)→黃(#F7DC6F)→綠(#52BE80)（66%變綠）
- [ ] 特殊狀態：紅色=靜止，紫色=加速，綠色=完成
- [ ] 清理機制：`slice(2)` 以後只砍子元素
- [ ] 更新頻率：frame counter，每30 幀更新
- [ ] 資料模型：startAt + totalTime + speedup
