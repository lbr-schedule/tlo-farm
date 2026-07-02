# TLO Farm 開發規則（DEV_RULES）

> 建立時間：2026-07-01  
> 最後更新：2026-07-01  
> 目前穩定基準：commit `cd93b5f` + 備份版本 `tlo-farm-live-backup-20260701-1534`

---

## 1. 穩定基準

- **commit**：`cd93b5f`
- **本地備份**：`~/Desktop/tlo-farm-live-backup-20260701-1534/`
- **回歸測試**：19 PASS / 0 真正 FAIL
- **原則**：任何修改後，有一項回歸失敗即回滾

---

## 2. 高風險檔案（禁止再胖）

| 檔案 | 行數 | 現負責功能數 | 狀態 |
|------|------|------------|------|
| `FarmScene.ts` | 3928 | 14種 | 🚫 禁止繼續變胖 |
| `GamePage.tsx` | 1066 | 13種 | 🚫 禁止繼續變胖 |
| `farm.ts` | 994 | 9種 | 🚫 禁止繼續變胖 |
| `SeedShopModal.tsx` | 879 | 6種 | 🚫 禁止繼續變胖 |
| `BackpackSystem.ts` | 378 | 5種 | ⚠️ 謹慎新增 |

---

## 3. 禁止直接修改 FarmScene 的情況

以下任何一種情況，**不准**直接修改 `FarmScene.ts`：

- [ ] 新功能需要 DB 判斷邏輯
- [ ] 新功能需要 API 呼叫
- [ ] 新功能需要狀態機
- [ ] 新功能涉及解鎖機制（農地、道具、建築）
- [ ] 新功能涉及商店邏輯
- [ ] 新功能涉及背包邏輯
- [ ] 新功能涉及任務邏輯
- [ ] 新功能涉及雞舍 business logic
- [ ] 新功能需要新增 `private` method

**替代方案：**
必須先建立獨立模組，再由 FarmScene 呼叫。

---

## 4. 新功能開發流程（隔離式開發）

一次只能動**一層**，順序固定：

```
1. DB 層      → 新增 schema / migration（隔離）
2. API 層     → 新增獨立 route（隔離）
3. Client state 層 → 新增獨立 system（隔離）
4. UI 顯示層  → 新增獨立 component（隔離）
5. 互動層     → FarmScene 最後呼叫（最小改動）
6. 回歸測試  → 19 項全部通過
```

**禁止同時動多層。**

---

## 5. 必填影響範圍模板

每次修改前必須回報：

```
【開工前必填｜影響範圍確認】

本次要做的功能：
（功能名稱）

==================================================
一、本次預計修改
==================================================

預計修改檔案：
1.
2.
3.

預計修改 API：
1.
2.

預計修改 DB/table：
1.
2.

預計修改 UI：
1.
2.

==================================================
二、本次禁止修改
==================================================

禁止修改檔案：
1.
2.
3.

禁止影響功能（全部）：
- 登入
- 玩家資料
- 金幣
- 商店購買
- 背包
- 肥料
- 飼料
- 每日任務
- 播種
- 澆水
- 施肥
- 收成
- 雞舍
- 收蛋
- 餵食
- 訂單

==================================================
三、風險評估
==================================================

可能影響哪些功能：
1.
2.

可能造成什麼回歸：
1.
2.

若出問題如何回滾：
1.

==================================================
四、驗證方式
==================================================

修改後必測：

□ 登入
□ 玩家資料
□ 金幣
□ 商店購買
□ 背包
□ 肥料
□ 飼料
□ 每日任務
□ 播種
□ 澆水
□ 施肥
□ 收成
□ 雞舍
□ 收蛋
□ 餵食
□ 訂單

==================================================
五、限制
==================================================

未完成這份影響範圍前，不准修改。
不准順手改。
不准重構。
不准動 FarmScene，除非先取得確認。
```

---

## 6. 回歸測試清單（19 項）

任何修改後必須全部通過：

```
□ 登入
□ 玩家資料
□ 金幣
□ 商店購買
□ 背包
□ 肥料（道具tab顯示正確，無重複，amount>0）
□ 飼料
□ 每日任務（harvest_wheat 0/10, harvest_any 0/20, complete_orders 0/3）
□ 播種
□ 澆水
□ 施肥
□ 收成
□ 雞舍
□ 收蛋
□ 餵食
□ 訂單
□ 背包容量顯示（12 / 50）
□ 金幣顯示（1155 等正確數值）
□ 肥抖+去重邏輯（beforeMerge → afterDedup）
```

**有一項 FAIL 即回滾。**

---

## 7. 農地解鎖暫停原因

農地解鎖目前暫停，等待獨立設計方案。

**暫停原因：**
- `farm_tiles` 目前代表「已放置農地」，不是「持有農地」
- 需要區分「持有」「已放置」「未放置」三種狀態
- FarmScene layout 是 hardcode `for (let i=0; i<6; i++)`，直接動會壞掉
- 雞舍佔格邏輯與農地 layout 高度耦合
- 農地解鎖涉及：DB schema、FarmScene、商店、玩家等級、放置系統

**正確做法（未來）：**
1. 先建立 `farm_plots` 表（status: owned/placed/removed）
2. 建立獨立 `/api/farm/plots/*` API
3. 建立 `PlotUnlockSystem` client system
4. 最後才讓 FarmScene 呼叫

**絕對不准：**
- 直接 INSERT farm_tiles
- 直接修改 layoutFarmlands()
- 直接改 COLS/ROWS

---

## 8. 未來拆分方向

### FarmScene 可拆出的系統

| 未來模組 | 職責 |
|---------|------|
| `CropSystem` | 播種/成長/澆水/施肥/收成/乾旱/枯萎 business logic |
| `CoopSystem` | 雞舍狀態/餵食/收蛋 business logic |
| `PlacementSystem` | 放置 preview/validity/check，通用於所有建築 |
| `FarmRenderer` | 農地 tile render，只負責 sprite 擺放 |
| `FarmUIManager` | popup/action menu/indicator/progress bar |
| `TimerManager` | 統一管理所有計時器（wither/poll/cooldown） |
| `DOMPanelBridge` | 雞舍 DOM panel 創建/銷毀，與 Phaser 遊戲邏輯無關 |

### farm.ts 可拆出的系統

| 未來模組 | 職責 |
|---------|------|
| `FarmTileService` | 農地 tile CRUD，剝離 crop logic |
| `CropService` | 播種/收成/澆水/施肥 business logic |
| `CoopService` | 雞舍所有 API logic |
| `PlotUnlockService` | 農地解鎖（Phase 2 殘留，未啟用） |

### GamePage.tsx 可拆出的系統

| 未來模組 | 職責 |
|---------|------|
| `ModalController` | 所有 modal 的 open/close 狀態，隔離 React |
| `PhaserGameManager` | Phaser instance mount/unmount/resize，獨立生命週期 |

### BackpackSystem.ts 可拆出的系統

| 未來模組 | 職責 |
|---------|------|
| `InventoryState` | 純 state，無 fetch/sell logic |
| `ShopSyncService` | 商店購買→背包同步邏輯 |

---

## 附錄：已發生的回歸事件（教訓）

| 日期 | 事件 | 教訓 |
|------|------|------|
| 2026-06 | 修肥料 icon | 動了 BackpackModal，壞了背包顯示 |
| 2026-06 | 修每日任務 | 動了 TaskModal，壞了收成 |
| 2026-06 | 嘗試農地解鎖 | 直接碰 FarmScene，壞了等級/雞舍/商店/農地大小 |

**結論：所有高風險檔案互相依賴，任何直接修改都會產生骨牌效應。**
