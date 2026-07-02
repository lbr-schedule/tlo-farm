# TLO Farm 專案修改流程規範（CHANGE_POLICY）

> 建立時間：2026-07-01  
> 目前穩定基準：commit `cd93b5f` + 備份版本 `tlo-farm-live-backup-20260701-1534`  
> 屬於：T-LO Farm 開發規範 v1.0

---

## 第一章：修改等級（Change Levels）

| 等級 | 層次 | 說明 | 範例 |
|------|------|------|------|
| **L0** | 文件 | 文件、文件、流程定義 | DEV_RULES、ARCHITECTURE、MODLE_BOUNDARY |
| **L1** | UI | 純視覺層，無邏輯變更 | CSS、圖片、Icon、文字 |
| **L2** | Client State | React 狀態、Client System | BackpackSystem、useState、useEffect |
| **L3** | API | Server Route、Service Logic | farm.ts、shop.ts、tasks.ts |
| **L4** | Database | Schema、Migration、資料結構 | 新增 table、欄位、索引 |
| **L5** | Architecture | 核心架構、系統边界、拆分重構 | 新建獨立模組、拆除高風險耦合 |

**核心原則：**
```
一次修改只能集中在同一層。

禁止：
L4 (Database) + L3 (API) + L5 (FarmScene) + L1 (UI)
同時進行。

每次只動一層。
```

---

## 第二章：修改風險等級

### 低風險（L0–L1）

| 類型 | 說明 |
|------|------|
| 文字 | 文案修改、訊息文字 |
| 圖片 | 美術資源替換 |
| Icon | icon 替换 |
| CSS | 樣式調整（不影響邏輯）|

### 中風險（L2）

| 類型 | 說明 |
|------|------|
| Modal | BackpackModal、SeedShopModal、TaskModal |
| Inventory | BackpackSystem 狀態邏輯 |
| Shop | 購買邏輯變更 |
| Task | 任務進度顯示邏輯 |

### 高風險（L3–L5）

| 檔案/系統 | 風險等級 | 理由 |
|-----------|---------|------|
| `FarmScene.ts` | 🚨 最高 | 3928行，14種功能，所有遊戲核心 |
| `GamePage.tsx` | 🚨 最高 | 1066行，13個 modal 狀態 |
| `farm.ts` | 🚨 最高 | 994行，9種 API，全部農場邏輯 |
| `Database` (farm_tiles/inventories) | 🚨 最高 | 資料層，錯誤影響全域 |
| `Player` (users) | 🚨 最高 | 等級/金幣/經驗值全部在此 |
| `Inventory` 核心 | 🚨 最高 | 背包系統破壞影響所有功能 |
| `Chicken` (animals.ts) | 🚨 高 | 雞舍系統 |
| `Task` (tasks.ts) | 🚨 高 | 每日任務 |
| `Shop` (shop.ts) | 🚨 高 | 商店購買 |

**高風險並非禁止修改，而是修改前必須完成完整影響範圍分析。**

---

## 第三章：哪些修改必須先審核

**以下任何一種情況，修改前必須提出完整影響範圍分析：**

- [ ] 修改 `FarmScene.ts`
- [ ] 修改 `farm.ts`
- [ ] 修改 `Database`（新增 table、欄位、migration）
- [ ] 修改 `users` 表（玩家資料）
- [ ] 修改 `inventories` 表（背包核心）
- [ ] 修改 `animals.ts` 或雞舍系統
- [ ] 修改 `tasks.ts` 或每日任務系統
- [ ] 修改 `shop.ts` 或商店系統

**審核前必須回答：**

```
1. 修改目的
   （這次要解決什麼問題或達成什麼功能）

2. 影響範圍
   會修改哪些檔案：
   不會修改哪些檔案：
   會影響哪些 API：
   會影響哪些 DB table：
   會影響哪些 UI：

3. 不能修改哪些檔案
   （本次絕對不碰的檔案清單）

4. 可能造成哪些回歸
   （列出可能受影響的功能）

5. 驗證方式
   （如何確認這次修改沒有破壞其他功能）

未完成，不得開始修改。
```

---

## 第四章：Rollback Policy

### 修改流程（完整版）

```
Step 1: 建立備份
         ↓
Step 2: 取得老闆確認（高風險修改）
         ↓
Step 3: 修改（專注單一層）
         ↓
Step 4: 回歸測試（全部 19 項）
         ↓
         ├─ PASS → Step 5
         │
         └─ FAIL → Step 4a

Step 4a: Rollback（直接還原，不繼續修）
         ↓
         重新分析影響範圍
         ↓
         回到 Step 2

Step 5: Commit（只commit本次變更）
         ↓
Step 6: Push（需要老闆確認）
         ↓
Step 7: Railway Deploy
```

### Rollback 觸發條件

```
□ 回歸測試有任何一項 FAIL
□ 出現新的 Console Error
□ 出現新的 API Error（4xx/5xx）
□ UI 出現異常
□ 資料出現異常
```

### Rollback 執行原則

```
禁止：
✗ 邊修邊測（試著修看看）
✗ 忽略 FAIL 繼續前進
✗ 只修 FAIL 的部分，不回滾其他變更

正確：
✓ 任何 FAIL → 直接完整 Rollback
✓ 回到上一個已知穩定狀態
✓ 重新分析影響範圍
```

---

## 第五章：MVP Freeze

### Core Stable System（凍結清單）

以下系統除非修 Bug，**不得修改**：

```
□ 登入
□ 玩家資料（等級/經驗值）
□ 金幣系統
□ 商店購買
□ 背包顯示
□ 播種功能
□ 澆水功能
□ 施肥功能
□ 收成功能
□ 雞舍
□ 收蛋
□ 餵食
□ 每日任務
□ 訂單系統
```

**原則：**
```
Core Stable System = 遊戲地基
地基不穩，上層建築全部搖晃。

新增功能不得直接修改 Core。
新功能必須建立獨立模組，與 Core 解耦。
```

---

## 第六章：Code Review Checklist

### 修改前（Before Code）

```
□ 是否已有同類系統？（若有，只能擴充，不能新建）
□ 能否建立新模組？（新功能應獨立，不塞進現有檔案）
□ 是否會碰 FarmScene？（FarmScene 是高風險，原則上不改）
□ 是否需要 DB？（需要什麼欄位/table？）
□ 是否需要 API？（需要什麼 route？）
□ 是否需要 UI？（新增/修改什麼元件？）
□ 是否有回滾方案？（修改前能否一鍵還原？）
□ 是否完成影響範圍分析？（見第三章）
□ 是否在正確的 Layer 層次？（見第一章）
```

### 修改後（After Code）

```
□ 回歸測試 19 項全部 PASS
□ 無新的 Console Error
□ 無新的 Warning
□ 無新的 API Error（4xx / 5xx）
□ UI 顯示正常（背包/商店/任務/雞舍）
□ 遊戲核心功能正常（播種/澆水/施肥/收成）
□ 無破壞任何 MVP Freeze 清單中的系統
□ Backup 已更新
□ 文件已同步更新（如有）
```

---

## 第七章：版本管理

### Commit 原則

```
開始任何功能前：
→ 建立 Backup（資料夾 copy，不要只靠 git）

完成後：
→ 必須通過全部 19 項回歸測試
→ 才能 Commit

禁止：
✗ 修改後不測試就直接 Commit
✗ Commit 訊息寫「XXX」或「update」
✗ Commit 包含多個不相關的變更

正確：
✓ Commit 訊息描述：「修什麼：什麼問題」
✓ 每次 Commit 只包含一個邏輯變更
✓ Commit 前已完成影響範圍分析
```

### 版本状態

```
┌─────────────────────────────────┐
│ Draft（草稿）                    │
│ 只在本地，不Commit               │
└─────────────┬───────────────────┘
              ↓ 影響範圍分析完成 + 老闆確認
┌─────────────────────────────────┐
│ In Progress（開發中）             │
│ 本地開發，隨時可 Rollback         │
└─────────────┬───────────────────┘
              ↓ 回歸測試 19 項 PASS
┌─────────────────────────────────┐
│ Ready to Push（待發布）           │
│ 老闆確認，最後檢查               │
└─────────────┬───────────────────┘
              ↓ 老闆最終確認
┌─────────────────────────────────┐
│ Pushed（已發布）                  │
│ Railway Deploy                   │
└─────────────────────────────────┘
```

---

## 第八章：已知重大回歸案例

### 案例一：肥料修改 → 背包損壞

| 屬性 | 內容 |
|------|------|
| 日期 | 2026-06 |
| 修改目標 | 肥料 icon 顯示 |
| 影響範圍 | 背包顯示、道具 tab |
| **原因** | BackpackModal 和 BackpackSystem 高度耦合，改其中一個直接影響另一個 |
| **如何避免** | 建立獨立的 `InventoryIconSystem`，解耦 icon 邏輯與背包顯示邏輯 |

---

### 案例二：每日任務修改 → 收成功能損壞

| 屬性 | 內容 |
|------|------|
| 日期 | 2026-06 |
| 修改目標 | 每日任務進度顯示 |
| 影響範圍 | 收成按鈕、收成後背包更新 |
| **原因** | `farm.ts` 的 `updateTaskProgress()` 在收成時被觸發，改任務邏輯時意外破壞了觸發條件 |
| **如何避免** | `updateTaskProgress` 應為独立 service，收成 API 不應依賴任務系統的存在 |

---

### 案例三：農地解鎖 → 玩家等級 + 農地大小 + 雞舍 + 商店全部損壞

| 屬性 | 內容 |
|------|------|
| 日期 | 2026-06 |
| 修改目標 | 農地解鎖功能 |
| 影響範圍 | 玩家等級資料、農地大小（6格）、雞舍位置、商店購買 |
| **原因** | 直接修改 `FarmScene.ts`（layout）、`farm.ts`（auto-INSERT）、`farm_tiles` 語意。高耦合架構下，碰任何一個地方都會產生骨牌效應。 |
| **如何避免** | 遵守「隔離式開發」，新功能建立獨立模組，不碰高風險檔案 |

---

### 案例四：其他潛在風險（已知但未爆發）

| 風險點 | 說明 |
|--------|------|
| BackpackSystem 被多處同時依賴 | FarmScene、SeedShopModal 都呼叫 `fetchAll()`，任一方改壞都會傳染 |
| farm.ts 同時處理農場 + 任務 + 雞舍 | 所有 business logic 塞在一個 route 檔案，任何改動都有連鎖反應 |
| GamePage 同時管理 13 個 modal | 13個 modal 的狀態全在一個元件，任何一個邏輯錯誤會影響整體穩定性 |

---

## 附錄：開發規範 v1.0 總覽

```
T-LO Farm 開發規範 v1.0
│
├── DEV_RULES.md        → 穩定基準、開發規則、回歸測試
├── ARCHITECTURE.md     → 系統架構、資料流、Case Study
├── MODULE_BOUNDARY.md  → 模組邊界定義、永續規則
└── CHANGE_POLICY.md    → 修改流程、風險分級、Rollback 政策
```

**所有文件集中於 `docs/` 目錄，不分散於 `apps/client`、`apps/server`、`packages`。**
