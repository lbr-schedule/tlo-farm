# T-LO Farm CropSystem 設計文件（CROP_SYSTEM_DESIGN）

> 建立時間：2026-07-02  
> 基準 Commit：`d43adae`  
> 目的：分析農場核心邏輯，建立可獨立測試的 CropSystem 模組  
> 屬於：M002 Phase 2

---

## 一、播種流程（plantCrop）

```
使用者點擊農地
  ↓
檢查 cropState !== 'empty'（農地是空的才能播種）
  ↓
樂觀更新：立即顯示幼苗（optimistic update）
  - 更新 farmState（plantedAt, finishAt, cropState='growing', soilState='dry'）
  - backpackSystem.deductItem('seed', cropId)
  - updateFarmTileVisual()
  - showProgressBar()
  ↓
API: POST /api/farm/plant { x, y, cropId }
  ↓
成功：
  - 用 server 回傳的 tile 同步 farmState
  - events.emit('goldChanged', data.user.gold)
  - events.emit('userUpdated', data.user)
失敗：
  - 回滾 farmState 至播種前
  - 補償背包種子 backpackSystem.addItem('seed', cropId)
```

**API 回傳格式（成功）：**
```json
{
  "success": true,
  "tile": { "plantedAt": 1751449200000, "finishAt": 1751452800000 },
  "user": { "gold": 1500, "level": 1 }
}
```

---

## 二、澆水流程（waterCrop）

```
使用者點擊澆水按鈕
  ↓
檢查 cropState 是 'growing'|'seedling'|'seed'|'dry'
  ↓
顯示水珠動畫（this.add.text + tweens）
  ↓
樂觀更新：更新 farmState（wateredAt, isWatered=true, soilState='watered'）
  ↓
API: POST /api/farm/water { x, y }
  ↓
成功：
  - 用 server 回傳資料同步（可能改變 finishAt）
  - renderFarmland()
  - renderCrop()
失敗：
  - 回滾 farmState
  - 重新渲染
```

---

## 三、施肥流程（fertilizeCrop）

```
使用者點擊施肥按鈕
  ↓
檢查 cropState 是 'growing'|'seedling'|'seed'|'dry'
 檢查 isFertilized === false
  ↓
顯示「使用肥料中...」文字
  ↓
API: POST /api/farm/fertilize { x, y }
  ↓
成功：
  - backpackSystem.fetchAll()（刷新背包）
  - 同步 server 回傳的 tile 狀態
  - 若 server 回 state='growing'：recoverDryTile()
  - 否則：updateFarmTileVisual() + renderCrop()
失敗：
  - 顯示錯誤
```

---

## 四、收成流程（harvestCrop）

```
使用者點擊成熟作物
  ↓
檢查 cropState === 'mature'（乾燥/枯萎不可收成）
  ↓
顯示提示文字（若為 dry 或 withered）
  ↓
立即清除 UI（optimistic）
  - clearAllPopups()
  - hideMatureIndicator()
  - hideProgressBar()
  - farmState 設為 'empty'
  ↓
API: POST /api/farm/harvest { x, y }
  ↓
成功：
  - showHarvestFloatingText()（顯示金幣/EXP 飄字）
  - backpackSystem.fetchAll()
  - events.emit('userUpdated', data.user)
  - events.emit('harvest', { gold, exp, cropId, cropName, harvestYield })
失敗：
  - syncFarmState()（重新讀取農場狀態）
```

---

## 五、共用 State

### farmState（Map<number, TileData>）

```typescript
interface TileData {
  x: number;
  y: number;
  type: 'grass' | 'soil' | 'path' | 'tree';
  cropId?: number;
  plantedAt?: number;        // 播種時間戳
  finishAt?: number;        // 成熟時間戳
  wateredAt?: number;       // 上次澆水時間
  isWatered: boolean;
  cropStatus: 'healthy' | 'needs_water';
  state: 'empty' | 'seed' | 'seedling' | 'growing' | 'mature' | 'dry' | 'withered';
  cropState: 'empty' | 'seed' | 'seedling' | 'growing' | 'mature' | 'dry' | 'withered';
  soilState: 'dry' | 'watered';
  isFertilized?: number;    // 0 或 1
  fertilizedAt?: number;
  fertilizerType?: string;
  fertilizerSpeedBonus?: number;
  dryStartedAt?: number;
  careCheckAt?: number;
}
```

### BackpackSystem（已獨立）

```typescript
backpackSystem.fetchAll()           // 刷新背包
backpackSystem.deductItem('seed', cropId)
backpackSystem.addItem('seed', cropId)
backpackSystem.getState().seeds     // 讀取種子
```

### CropConfig（純資料）

```typescript
getCropDetails(cropId: number): CropData | undefined
CROP_SPRITES: Record<string, Record<GrowthStage, string>>
TILE_TYPES: { GRASS, SOIL, PATH, TREE }
```

### Events（FarmScene 內部）

```typescript
events.emit('goldChanged', gold)
events.emit('userUpdated', user)
events.emit('harvest', { gold, exp, cropId, cropName, harvestYield })
events.emit('game-toast', message)
```

---

## 六、API 呼叫流程

| 方法 | API | 參數 | 成功回傳 |
|------|-----|------|---------|
| plantCrop | POST /api/farm/plant | { x, y, cropId } | { success, tile, user } |
| waterCrop | POST /api/farm/water | { x, y } | { success, wateredAt, state } |
| fertilizeCrop | POST /api/farm/fertilize | { x, y } | { success, tile, user } |
| harvestCrop | POST /api/farm/harvest | { x, y } | { success, harvest, user } |

---

## 七、哪些可以拆出去

### ✅ 可立即拆分

| 模組 | 說明 | 理由 |
|------|------|------|
| **CropConfig** | `getCropDetails()`, `CROP_SPRITES`, `TILE_TYPES`, `CropData` interface | 純資料，無任何依賴 |
| **TileState** | `TileData` interface | 型別定義，無任何依賴 |
| **CropSystem（純邏輯部分）** | plant/water/fertilize/harvest 的業務邏輯（不含 Phaser UI） | API 呼叫 + 狀態更新可獨立 |

### ⚠️ 需要重構才能拆分

| 模組 | 說明 | 理由 |
|------|------|------|
| **ProgressTimer** | 進度條渲染 + 計時器 | 綁定 Phaser `this.add`, `this.tweens` |
| **FloatingText** | 飄字顯示 | 綁定 Phaser |
| **DryRecovery** | 乾燥恢復邏輯 | 需要 Phaser scene context |

---

## 八、哪些現在不能拆

| 模組 | 原因 |
|------|------|
| **updateFarmTileVisual()** | 深度綁定 Phaser container/sprite |
| **renderFarmland()** | 深度綁定 Phaser graphics |
| **renderCrop()** | 深度綁定 Phaser sprites + tweens |
| **showProgressBar()** | 深度綁定 Phaser tweens |
| **harvestCrop 的 UI 部分** | 飄字 + 成 anim callback |
| **waterCrop 的動畫部分** | 水珠 tween animation |
| **fertilizeCrop 的文字部分** | "使用肥料中..." text + destroy |

---

## 九、拆分順序

```
Step 1: CropConfig（Tier 0）
  └── 把 getCropDetails() + CROP_SPRITES + TILE_TYPES + CropData 移到
      apps/client/src/systems/CropConfig.ts
      → 純資料，零風險，零破壞

Step 2: TileState（Tier 0）
  └── 把 TileData interface 移到 apps/client/src/types/TileState.ts
      → 型別歸型別，無邏輯變更

Step 3: CropSystem 介面（Tier 1）
  └── 建立 apps/client/src/systems/CropSystem.ts
      包含：farmState Map、相關型別、業務方法框架
      此時仍呼叫 FarmScene 內部方法（不做實作）

Step 4: 抽出核心邏輯（Tier 2）
  └── 將 plant/water/fertilize/harvest 的：
      - 狀態檢查（guard clauses）
      - API 呼叫
      - farmState 更新
      移入 CropSystem.ts
      UI 動畫留在 FarmScene.ts

Step 5: ProgressTimer（Tier 3）
  └── 將計時器邏輯重構為可測試形式
      需先定義 ProgressTimer interface

Step 6: FloatingText + DryRecovery（Tier 3+）
  └── 最困難，保留最後處理
```

---

## 十、風險分析

| 風險 | 等級 | 說明 |
|------|------|------|
| **FarmScene 依賴 CropSystem** | 🔴 高 | 目前 FarmScene 直接操作 farmState，抽取後需改為呼叫 CropSystem API |
| **Phaser UI 耦合** | 🔴 高 | 所有 render/update 方法都綁定 Phaser container，直接抽取會造成大量破壞 |
| **backpackSystem 依賴** | 🟡 中 | CropSystem 需依賴 BackpackSystem.fetchAll()，介面已存在 |
| **events 耦合** | 🟡 中 | CropSystem 需發送 events，但事件系統是字串-based，可以 mock |
| **API response 格式假設** | 🟡 中 | fertilizeCrop 裡有複雜的 response tile fallback logic，抽取需確保測試覆蓋 |
| **Test coverage 不足** | 🟡 中 | 目前沒有 crop 相關的 unit tests |
| **git history 断層** | 🟢 低 | DEV_RULES.md 規定每個 commit 需包含測試，但目前花園尚未執行 |

---

## 附錄：完整呼叫鏈

### plant() 呼叫鏈

```
使用者點擊農地 tile
  → FarmScene.onTileClicked()
  → FarmScene.plantCrop(index, cropId)
    ├── TileData 驗證（cropState !== 'empty'）
    ├── getCropDetails(cropId) → CropData
    ├── 樂觀更新 farmState
    ├── backpackSystem.deductItem('seed', cropId)
    ├── this.updateFarmTileVisual(index, 'plantCrop')
    ├── this.showProgressBar(index)
    ├── API: authFetch('/api/farm/plant', { x, y, cropId })
    │   ├── 成功：同步 farmState + events.emit('goldChanged') + events.emit('userUpdated')
    │   └── 失敗：回滾 farmState + backpackSystem.addItem('seed', cropId)
```

### water() 呼叫鏈

```
使用者點擊澆水按鈕
  → FarmScene.onUIClick('water', index)
  → FarmScene.waterCrop(index)
    ├── cropState 驗證（'growing'|'seedling'|'seed'|'dry'）
    ├── Phaser 水珠動畫（this.add.text + tweens）
    ├── 樂觀更新 farmState（wateredAt, isWatered=true）
    ├── this.renderFarmland(index)
    ├── this.renderCrop(index)
    ├── API: authFetch('/api/farm/water', { x, y })
    │   ├── 成功：同步 server 回傳狀態
    │   └── 失敗：回滾 farmState + 重新渲染
```

### fertilize() 呼叫鏈

```
使用者點擊施肥按鈕
  → FarmScene.onUIClick('fertilize', index)
  → FarmScene.fertilizeCrop(index)
    ├── cropState 驗證
    ├── isFertilized 檢查
    ├── "使用肥料中..." 文字顯示
    ├── API: authFetch('/api/farm/fertilize', { x, y })
    │   ├── 成功：backpackSystem.fetchAll()
    │   │         同步 farmState（isFertilized=1, fertilizedAt）
    │   │         若 state='growing'：recoverDryTile()
    │   │         否則：updateFarmTileVisual() + renderCrop()
    │   └── 失敗：顯示錯誤
```

### harvest() 呼叫鏈

```
使用者點擊成熟作物
  → FarmScene.onTileClicked()
  → FarmScene.harvestCrop(index)
    ├── cropState 驗證（=== 'mature'，blocking dry/withered）
    ├── getCropDetails(state.cropId)
    ├── 清除 UI（clearAllPopups, hideMatureIndicator, hideProgressBar）
    ├── 樂觀更新 farmState 為 'empty'
    ├── this.renderFarmland(index)
    ├── this.renderCrop(index)
    ├── API: authFetch('/api/farm/harvest', { x, y })
    │   ├── 成功：showHarvestFloatingText()
    │   │         backpackSystem.fetchAll()
    │   │         events.emit('userUpdated')
    │   │         events.emit('harvest', { gold, exp, cropId, cropName, harvestYield })
    │   └── 失敗：syncFarmState()
```

---

## 結論

CropSystem 的核心邏輯（狀態驗證 + API 呼叫 + 狀態更新）可以拆分出去，但 UI 相關（Phaser rendering、animation、floating text）目前與 FarmScene 高度耦合，強行拆分風險極高。

**建議嚴格按照 Step 1 → Step 6 順序拆分，每步確保編譯通過 + 遊戲內功能正常後再進入下一步。**
