# TLO Farm 模組邊界定義（MODULE_BOUNDARY）

> 建立時間：2026-07-01  
> 目前穩定基準：commit `cd93b5f` + 備份版本 `tlo-farm-live-backup-20260701-1534`  
> 屬於：T-LO Farm 開發規範 v1.0

---

## 一、永久規則

### 【規則一】禁止跨層呼叫

```
正確：
UI → System → API → Database

禁止：
UI → Database（繞過 System）
System → DOM（System 不應操作 DOM）
FarmScene → BackpackSystem.business（應透過 API）
FarmScene → TaskSystem（應透過 API）
```

### 【規則二】禁止建立第二套系統

```
已存在 BackpackSystem
→ 只能擴充 BackpackSystem
→ 禁止新建第二套 InventorySystem

已存在 TaskModal / tasks.ts
→ 禁止新建第二套 TaskSystem

若已有系統，只能擴充，不能重寫第二套。
```

### 【規則三】禁止順手修改

```
每次只修一個功能。

禁止：
✗ 順便重構
✗ 順便改命名
✗ 順便修 UI
✗ 順便清理
✗ 順便修別的 Bug

若發現其他問題：
→ 只記錄
→ 不得一起修改
→ 下次再處理
```

### 【規則四】任何修改前，必須完成影響範圍分析

```
修改前必須回報：
1. 修改哪些檔案
2. 不修改哪些檔案
3. 影響哪些 API
4. 影響哪些 DB table
5. 影響哪些 UI
6. 回歸風險
7. 驗證方式

未完成，不得開始寫程式。
```

### 【規則五】任何檔案超過 4000 行，禁止新增功能

```
4000 行以上檔案：
→ 只能做 Bug Fix
→ 禁止新增功能
→ 若要新增功能，必須先拆模組
```

### 【規則六】新功能必須遵守分層開發

```
一次只能完成一層：
Layer 1: DB
Layer 2: API
Layer 3: Client State
Layer 4: UI
Layer 5: 互動（FarmScene 最後呼叫）

禁止一次修改：
DB + API + UI + FarmScene
```

---

## 二、模組邊界定義

### FarmScene.ts

**職責定位：**
Phaser 遊戲引擎的 Scene 元件，負責遊戲畫面的 render 與玩家輸入。

```
可以：
✓ 農地 tile 的 sprite render
✓ 作物 sprite 的 render（播種/成長/成熟/枯萎）
✓ 玩家點擊輸入處理（onFarmClick）
✓ 呼叫外部 System（BackpackSystem）
✓ 呼叫 Server API（farm.ts, animals.ts）
✓ 接收 API 回傳並更新 UI 顯示
✓ 操作 Phaser 內部的 GameObjects（Container/Sprite/Graphics）
✓ 管理 Phaser 計時器（TimerEvent）
✓ 雞舍 DOM panel 的創建與銷毀（因為雞舍需要 HTML UI）

不能：
✗ 直接操作 SQL / Database
✗ 直接操作 BackpackSystem 內部 business logic（如 deductItem/addItem 的判斷）
✗ 直接操作 Task business logic
✗ 直接操作 Shop business logic
✗ 直接操作 Player 資料
✗ 直接修改 farm_tiles 內容
✗ 建立新的 private method（除非是純 render / input 處理）
✗ 新增 API endpoint
✗ 直接操作 DOM（除雞舍 panel 外）
```

---

### BackpackSystem.ts

**職責定位：**
背包狀態中心，儲存所有背包品項的 client-side 狀態。

```
可以：
✓ 儲存和管理 seeds/crops/items/fertilizers/livestock 狀態
✓ fetchAll() 從 /api/inventory 取得最新背包資料
✓ addItem() / deductItem() 操作背包數量
✓ sellItem() 販賣物品
✓ 提供 getState() 供其他模組讀取
✓ 訂閱/通知 UI 更新（回傳给呼叫者）

不能：
✗ 直接 render 任何 UI（由 BackpackModal 負責）
✗ 直接呼叫 /api/shop/buy 或 /api/shop/sell（由呼叫者負責）
✗ 操作 FarmScene 狀態
✗ 操作 Task 進度
✗ 操作玩家等級/金幣
✗ 操作任何 DOM 元素
```

---

### BackpackModal.tsx

**職責定位：**
背包 UI 元件，負責顯示背包內容。

```
可以：
✓ 讀取 BackpackSystem.getState()
✓ 切換 tab（道具/種子/作物/飼料）
✓ 顯示物品清單、數量、icon
✓ 呼叫 BackpackSystem.sellItem()
✓ 分頁顯示
✓ 響應 BackpackSystem 狀態變化（透過 useEffect）

不能：
✗ 直接呼叫 /api/inventory（應透過 BackpackSystem）
✗ 直接操作 FarmScene
✗ 直接操作 Task
✗ 直接操作玩家資料
```

---

### SeedShopModal.tsx

**職責定位：**
商店 UI 元件，負責購買種子和道具。

```
可以：
✓ 顯示商品列表（tab: 種子/道具）
✓ 發送 POST /api/shop/buy
✓ 檢查玩家金幣是否足夠（本地顯示）
✓ 成功後呼叫 BackpackSystem.fetchAll()
✓ 顯示購買結果 feedback

不能：
✗ 直接操作 DB
✗ 直接修改 users.gold（由 server API 回寫）
✗ 直接操作 BackpackSystem.addItem()（由 fetchAll() 更新）
✗ 直接操作 Task 進度
```

---

### TaskModal.tsx

**職責定位：**
每日任務 UI 元件，負責顯示任務進度。

```
可以：
✓ GET /api/tasks/daily 取得任務列表
✓ POST /api/tasks/claim 領取獎勵
✓ 顯示任務進度（目前/目標）
✓ 響應最新任務狀態

不能：
✗ 直接修改任務進度（由 farm.ts updateTaskProgress() 更新）
✗ 直接操作 BackpackSystem
✗ 直接操作 FarmScene
✗ 直接操作玩家資料
```

---

### GamePage.tsx

**職責定位：**
React 容器，負責管理所有 modal 的開關狀態、Phaser 遊戲實例生命週期。

```
可以：
✓ 管理 13 個 modal 的 open/close 狀態
✓ mount/unmount Phaser.Game 實例
✓ 顯示玩家 gold HUD（讀取 user state）
✓ 響應 LevelUpModal 彈出
✓ 基本的 toast / notification 顯示

不能：
✗ 直接操作 FarmScene 內部遊戲邏輯
✗ 直接操作 BackpackSystem 內部 business logic
✗ 直接操作 crop / chicken / farm API
✗ 直接操作 DB
✗ 建立新 API route
```

---

### farm.ts（Server）

**職責定位：**
Server-side 農場 API，包含所有農場 business logic。

```
可以：
✓ GET/POST /api/farm/* 所有農場相關 API
✓ 操作 farm_tiles 表（CRUD）
✓ 操作 crops 表（唯讀查詢）
✓ 操作 inventories 表（收成/播種時更新）
✓ 操作 users 表（扣金幣、加經驗值）
✓ 操作 orders 表（完成訂單時更新）
✓ updateTaskProgress() 更新每日任務進度
✓ 農地解鎖 business logic（未啟用）

不能：
✗ 直接 render 任何 UI
✗ 操作 React state
✗ 操作 BackpackSystem
✗ 發送 WebSocket / Server-Sent Events（目前無此機制）
✗ 直接操作 DOM
```

---

### inventory.ts（Server）

**職責定位：**
背包資料 API，負責背包的讀取和販賣。

```
可以：
✓ GET /api/inventory → 取得玩家背包
✓ POST /api/shop/sell → 販賣物品，更新 inventories 表

不能：
✗ 直接操作 FarmScene
✗ 直接操作 BackpackSystem（client state）
✗ 發起 /api/farm/* 呼叫（server-to-server）
```

---

### shop.ts（Server）

**職責定位：**
商店 API，負責處理購買邏輯。

```
可以：
✓ POST /api/shop/buy → 扣金幣、寫入 inventories
✓ 檢查庫存是否足夠

不能：
✗ 直接操作 BackpackSystem（client state）
✗ 直接操作 FarmScene
✗ 修改 users 以外的資料
```

---

### tasks.ts（Server）

**職責定位：**
任務 API，負責每日任務的讀取和領獎。

```
可以：
✓ GET /api/tasks/daily → 取得每日任務
✓ POST /api/tasks/claim → 領取獎勵，更新 users.gold/exp

不能：
✗ 直接操作 FarmScene
✗ 直接操作 BackpackSystem
✗ 直接修改 farm_tiles
```

---

### Chicken API（Server / animals.ts）

**職責定位：**
雞舍 API，負責雞舍狀態、餵食、收蛋、放置。

```
可以：
✓ GET /api/animals/chicken-coop/status
✓ POST /api/animals/chicken-coop/feed-all
✓ POST /api/animals/chicken-coop/collect-all
✓ POST /api/animals/chicken-coop/place
✓ 操作 animals 表（雞隻狀態）
✓ 操作 chicken_coops 表（雞舍狀態）
✓ 操作 inventories 表（收蛋寫入背包）

不能：
✗ 直接操作 FarmScene render
✗ 直接操作 BackpackSystem
✗ 直接修改 users 欄位（金幣由 tasks.ts 領獎時更新）
```

---

## 三、跨模組依賴圖

```
GamePage.tsx
  ├── 管理 BackpackModal（開關狀態）
  ├── 管理 SeedShopModal
  ├── 管理 TaskModal
  ├── 管理 ChickenCoopModal
  ├── 管理 EventModal
  └── mount FarmScene

FarmScene.ts
  ├── 呼叫 BackpackSystem.fetchAll()
  ├── 呼叫 farm.ts API
  ├── 呼叫 animals.ts API
  └── 管理雞舍 DOM panel

BackpackSystem.ts
  ├── 被 SeedShopModal 使用
  ├── 被 BackpackModal 使用
  └── 被 FarmScene 呼叫 fetchAll()

BackpackModal.tsx
  └── 讀取 BackpackSystem.getState()

SeedShopModal.tsx
  ├── 呼叫 BackpackSystem.fetchAll()
  └── 呼叫 shop.ts API

TaskModal.tsx
  └── 呼叫 tasks.ts API

farm.ts
  ├── 被 FarmScene 呼叫
  ├── 操作 farm_tiles
  ├── 操作 inventories
  ├── 操作 users
  └── 操作 orders（完成訂單時）
```

---

## 四、例外說明

以下為現有架構中**已知例外**（不符合單一職責，但目前無法立即重構）：

| 現況 | 為什麼是例外 | 未來方向 |
|------|------------|---------|
| FarmScene 同時管理雞舍 DOM panel | 雞舍需要 HTML UI，Phaser 無法完整支援，只能用 DOM overlay | 未來拆出 CoopDOMBridge |
| FarmScene 直接呼叫 BackpackSystem.deductItem/addItem | 現無 API 支援自動同步，需要 client 自行維護 | 未來新增 `/api/farm/harvest` 回傳背包更新 |
| farm.ts 同時處理農場+任務進度 | updateTaskProgress() 在 harvest 時觸發，task 是 farm 的副作用 | 未來任務進度由 client 自行計算上報 |
| GamePage 同時管理 13 個 modal | React 目前無獨立 Modal controller | 未來拆出 useModalController hook |

**這些例外是現有架構的技術債，不是正確做法。**
