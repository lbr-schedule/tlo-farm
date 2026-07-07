# 雞舍 Sprite 渲染設計文件

> 建立日期：2026-07-03
> 狀態：設計階段，待實作

---

## 1. 目前兩套雞舍 Sprite 建立流程

### 流程 A：renderChickenCoop()
- **觸發時機**：`syncChickenCoopStatus()` API 回傳 `hasBuilding=true` 且 `chickenCoopSprite` 不存在時
- **用途**：以 API tileX/tileY 為準，在正確位置建立雞舍 sprite
- **Sprite 物件**：`this.chickenCoopSprite`
- **建立位置**：由 `farmStartX + tileX * FARM_SIZE + FARM_SIZE` 計算

### 流程 B：placeChickenCoopLocal()
- **觸發時機**：`create()` 讀取 localStorage 有 `tlo_farm_chicken_coop` 資料時；或用戶點擊放置按鈕時
- **用途**：本地快速恢復雞舍（不等 API），或用戶主動放置新雞舍
- **Sprite 物件**：`this.chickenCoopSprite`
- **建立位置**：直接使用 localStorage 的 x/y 像素座標

---

## 2. renderChickenCoop() 流程

```
syncChickenCoopStatus() API 回傳
  → hasBuilding=true
  → this.chickenCoopTileX/Y = API tileX/tileY
  → if (!this.chickenCoopSprite) ← guard
    → renderChickenCoop()
      → destroy 舊 sprite（如果存在）
      → 計算 pixelX/Y（from tileX/tileY）
      → this.add.sprite(pixelX, pixelY, 'chicken_coop')
      → setDisplaySize(FARM_SIZE * 2, FARM_SIZE * 2)  → 180×180
      → setOrigin(0.5, 0.5)
      → setDepth(10)
      → setInteractive(Rectangle(-90,-90,180,180), Contains)
      → on('pointerdown') { if (!farmInputEnabled) return; openChickenCoopPanel(); }
      → this.chickenCoopSprite = coopSprite
  → renderChicksInCoop()
```

---

## 3. placeChickenCoopLocal() 流程

```
create() 執行
  → localStorage.getItem('tlo_farm_chicken_coop') 有資料
  → loadChickenCoopLocalState()
    → if (!this.chickenCoopSprite) ← guard
      → placeChickenCoopLocal(state.x, state.y, { save: false, animals: [...] })
        → if (chickenCoopSprite exists) skip
        → this.add.image(x, y, 'chicken_coop')  ← origin 預設 0,0
        → setOrigin(0, 0)
        → setDisplaySize(288, 288)  ← 288×288，比 renderChickenCoop 大
        → setDepth(5000)
        → removeAllListeners('pointerdown')
        → setInteractive({ useHandCursor: true })  ← 無自訂 hitArea
        → on('pointerdown') { if (isFarmActionMenuOpen) return; openChickenCoopPanel(); }  ← 不檢查 farmInputEnabled
        → this.chickenCoopSprite = coopSprite
  → syncChickenCoopStatus()（立即呼叫）
    → API 回傳 tileX/tileY
    → if (!this.chickenCoopSprite) ← 已存在，skip renderChickenCoop()
```

---

## 4. 兩者差異表

| 項目 | renderChickenCoop() | placeChickenCoopLocal() |
|------|---------------------|------------------------|
| **呼叫時機** | API 回傳後 | create() / 用戶放置 |
| **座標來源** | API tileX/tileY → pixel | localStorage x/y 像素 |
| **位置計算** | 動態公式 | 直接使用舊值 |
| **setDisplaySize** | `FARM_SIZE * 2` = **180×180** | **288×288** |
| **setOrigin** | **0.5, 0.5** | **0, 0** |
| **setDepth** | 10 | 5000 |
| **setInteractive** | `Rectangle(-90,-90,180,180)` | `{ useHandCursor: true }`（無自訂範圍）|
| **hitArea 形狀** | Rectangle 180×180 | 完整圖片（288×288）|
| **pointerdown 行為** | 檢查 `farmInputEnabled` | 檢查 `isFarmActionMenuOpen` |
| **使用素材** | `this.add.sprite()` | `this.add.image()` |

---

## 5. 目前造成的問題

### 5.1 大小不一致
- `placeChickenCoopLocal()` 建立 288×288
- `renderChickenCoop()` 建立 180×180
- 端點取的決於誰最後執行

### 5.2 位置不一致
- `placeChickenCoopLocal()` 使用 localStorage 的舊像素座標（可能是 0,0）
- `renderChickenCoop()` 使用 API tileX/tileY 計算的新座標
- 如果 sprite 被 `renderChickenCoop()` 接管，位置會更新；但如果被 guard 保護（sprite 已存在），位置就不更新

### 5.3 點擊範圍不一致
- `renderChickenCoop()` 的 hitArea 是 `Rectangle(-90,-90,180,180)`
- `placeChickenCoopLocal()` 的 hitArea 是完整圖片
- 兩者觸發範圍、形狀、位置都不同

### 5.4 點擊事件行為不一致
- `renderChickenCoop()` handler：檢查 `farmInputEnabled`
- `placeChickenCoopLocal()` handler：檢查 `isFarmActionMenuOpen`
- 兩者阻擋邏輯不同，可能造成有時能點、有時不能點

### 5.5 depth 不一致
- `renderChickenCoop()`：`depth=10`
- `placeChickenCoopLocal()`：`depth=5000`
- 可能造成疊圖問題

### 5.6 origin 不一致
- `renderChickenCoop()`：`origin=(0.5,0.5)` → 圖片中心對齊座標點
- `placeChickenCoopLocal()`：`origin=(0,0)` → 圖片左上角對齊座標點
- 同樣座標值，視覺位置完全不同

---

## 6. 建議統一方案

### 核心原則
1. **DB / API 是唯一位置來源** — localStorage 只快取任務/動物資料，**不作位置來源**
2. **renderChickenCoop() 是唯一 sprite 建立入口** — 刪除 `placeChickenCoopLocal()` 的 sprite 建立職責
3. **同一個 handler 邏輯** — 點擊事件綁定邏制統一

---

## 7. 唯一入口：renderChickenCoop()

**推薦以 `renderChickenCoop()` 為唯一入口**，理由：
- `renderChickenCoop()` 以 API 為準（tileX/tileY → pixel）
- `renderChicksInCoop()` 已經依賴 `renderChickenCoop()` 的 sprite 狀態
- `placeChickenCoopLocal()` 應只保留「購買後寫入 localStorage」的功能，**不應再建立 sprite**

---

## 8. localStorage 是否應停用

**位置：應停用作為位置來源。**

保留用途：
- 快取動物資料（slots, animals）
- 記錄 `chickenCoopPlaced` 狀態（可選）

移除用途：
- `create()` 中讀取後呼叫 `placeChickenCoopLocal()` 建立 sprite → **移除**
- `loadChickenCoopLocalState()` 中的 sprite 建立邏輯 → **移除**
- `placeChickenCoopLocal()` 中的 `this.add.image()` sprite 建立 → **移除**

---

## 9. DB / API 是否應成為唯一位置來源

**是。** 推薦流程：

```
create()
  → syncChickenCoopStatus()  ← 立即從 API 取位置
    → hasBuilding=true
      → this.chickenCoopTileX/Y = API tileX/tileY
      → this.chickenCoopPlaced = true
      → renderChickenCoop()  ← 以 API 為準，無條件建立 sprite
    → hasBuilding=false
      → this.chickenCoopPlaced = false
      → 不建立 sprite
  → renderChicksInCoop()
```

不再需要 `create()` 中的 localStorage restore block。

---

## 10. 點擊事件應統一在哪裡綁定

**統一在 `renderChickenCoop()` 內**，使用一致的 handler：

```typescript
coopSprite.on('pointerdown', (pointer, localX, localY, event) => {
  if (!this.farmInputEnabled) return;
  if (this.isFarmActionMenuOpen) return;
  this.openChickenCoopPanel();
});
```

統一檢查：
- `farmInputEnabled`：遊戲輸入是否啟用
- `isFarmActionMenuOpen`：農地選單是否開啟

---

## 11. Sprite Size / Origin / HitArea 標準值

### 推薦標準值

| 項目 | 推薦值 | 說明 |
|------|--------|------|
| **DisplaySize** | `FARM_SIZE * 2` = **180×180** | 與 2×2 農地大小一致 |
| **Origin** | **0.5, 0.5** | 圖片中心對齊，計算一致 |
| **Depth** | **10** | 雞舍在農地上方（農地 depth=0）|
| **HitArea** | `Rectangle(-FARM_SIZE/2, -FARM_SIZE/2, FARM_SIZE*2, FARM_SIZE*2)` = `Rectangle(-90,-90,180,180)` | 以 sprite 中心為原點的 180×180 矩形 |
| **HitArea 形狀** | `Phaser.Geom.Rectangle.Contains` | 全域包含檢測 |

### Origin 0.5, 0.5 的 pixel 計算公式

```typescript
const coopPixelX = farmStartX + tileX * FARM_SIZE + FARM_SIZE;
// = 農地開始 + tileX個農地單位 + 半個農地（origin在中心）
const coopPixelY = farmStartY + tileY * FARM_SIZE + FARM_SIZE;
```

---

## 12. 修改風險

### 高風險
- **破壞現有 localStorage restore 邏輯**：已習慣開機即見雞舍的用戶會看到空白（需 API 回傳後才建立）
- **點擊事件行為改變**：統一 handler 可能讓原本某些可點的情形變不能點

### 中風險
- **`placeChickenCoopLocal()` 現有 caller**：`create()`、`loadChickenCoopLocalState()`、購買流程。需確認每個 caller 的意圖是否改變
- **農地系統的 `farmInputEnabled` 依賴**：其他建築可能也依賴此開關

### 低風險
- **移除 `setDepth(5000)` 改為 `setDepth(10)`**：視覺可能短暫閃爍（depth 改變）

---

## 13. 分階段修正建議

### 階段 1：統一 renderChickenCoop() 為唯一入口
1. `create()` 移除 localStorage restore block
2. `loadChickenCoopLocalState()` 停用 sprite 建立，只同步任務資料
3. `placeChickenCoopLocal()` 只保留「寫入 localStorage」的職責，移除 `this.add.image()` sprite 建立
4. `syncChickenCoopStatus()`：移除 `if (!this.chickenCoopSprite)` guard，改為無條件 destroy + render
5. 確認 `renderChicksInCoop()` 的 bounds 取樣正確（以 `renderChickenCoop()` 的 sprite 為準）

**影響範圍**：僅 `FarmScene.ts` 雞舍初始化流程

**風險**：低（仍使用 API tileX/tileY，位置不受影響）

---

### 階段 2：統一點擊事件
1. `renderChickenCoop()` 的 handler 統一檢查 `farmInputEnabled` + `isFarmActionMenuOpen`
2. `placeChickenCoopLocal()` 的 handler 完全移除（不再建立 sprite）

**風險**：中（handler 行為改變）

---

### 階段 3：清理 localStorage 職責
1. `placeChickenCoopLocal()` 只負責 `localStorage.setItem('tlo_farm_chicken_coop', {...})`
2. `loadChickenCoopLocalState()` 只負責讀取任務/動物資料，不操作 sprite
3. `create()` 完全移除 localStorage 讀取

**風險**：中（需同步確保 API 足夠快，否則雞舍出現有延遲）

---

### 階段 4：統一是大小 / origin / depth 標準
1. `renderChickenCoop()` 的 `setDisplaySize`、`setOrigin`、`setDepth` 成為標準
2. `placeChickenCoopLocal()` 完全不設定 sprite 屬性

**風險**：低（只是刪除衝突程式碼）

---

## 附錄：修改函式清單

| 檔案 | 函式 | 階段1 | 階段2 | 階段3 | 階段4 |
|------|------|:-----:|:-----:|:-----:|:-----:|
| FarmScene.ts | `create()` | 修改 | - | - | - |
| FarmScene.ts | `loadChickenCoopLocalState()` | 修改 | - | 修改 | - |
| FarmScene.ts | `placeChickenCoopLocal()` | 修改 | - | 修改 | - |
| FarmScene.ts | `syncChickenCoopStatus()` | 修改 | - | - | - |
| FarmScene.ts | `renderChickenCoop()` | - | 修改 | - | 修改 |
| FarmScene.ts | `renderChicksInCoop()` | - | - | - | 檢查 |

**不修改**：農地系統、背包、商店、作物、API、DB、UI 元件
