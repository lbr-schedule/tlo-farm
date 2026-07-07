# T-LO Farm 工程里程碑（MILESTONE）

> 建立時間：2026-07-01  
> 目前穩定基準：commit `cd93b5f` + 備份版本 `tlo-farm-live-backup-20260701-1534`  
> 屬於：T-LO Farm 開發規範 v1.0

---

## 里程碑 Commit 規則

每一個 Milestone 必須符合：

```
✓ 功能完成
✓ 回歸測試 PASS（19 項全部）
✓ 文件同步完成
✓ 才能 Commit
```

---

## Milestone 命名格式

```
Milestone 編號：M001, M002, M003, ...
Version 格式：v1.0, v1.1, v2.0, ...
```

---

## 版本歷史

### Milestone 001

**名稱：** T-LO Farm Development Standard v1.0  
**日期：** 2026-07-01  
**Version：** v1.0

**完成內容：**

建立正式開發規範：
- `DEV_RULES.md` — 穩定基準、回歸測試、禁止規則
- `ARCHITECTURE.md` — 系統架構、Mermaid 圖、資料流、Case Study
- `MODULE_BOUNDARY.md` — 模組邊界定義、6 條永續規則
- `CHANGE_POLICY.md` — 8 章修改流程規範

**目的：**
- 建立統一開發流程
- 建立模組邊界
- 建立修改流程
- 建立回歸測試文化

**備註：**
此版本開始，所有功能必須依照 T-LO Farm Development Standard 開發。

**Git Tracking：** `docs/` 已 staged，待下次功能完成後一併 commit。

---

## 建議 Commit Message

```
docs: establish T-LO Farm Development Standard v1.0
```

或

```
feat: MVP stabilization with T-LO Farm Development Standard v1.0
```

---

## 未來 Milestone 規劃

| Milestone | 內容 | 預定階段 |
|-----------|------|---------|
| M002 | 農地解鎖系統 | Phase 2（獨立模組設計後）|
| M003 | 加工廠系統 | 待定 |
| M004 | 好友系統 | 待定 |
| M005 | 玩家市集 | 待定 |
| M006 | 裝飾系統 | 待定 |
| M007 | 活動系統 | 待定 |

---

## 里程碑維護原則

1. 每個重大功能完成，必須建立一個新 Milestone 記錄
2. Milestone 內容包含：完成日期、功能摘要、目的、備註
3. 同一個 Milestone 下的所有變更（程式 + 文件）必須一起 Commit
4. 不只留下 Git Commit，也要留下專案發展歷史
5. Milestone 文件位於 `docs/MILESTONE.md`，與其他開發規範文件集中管理

---

## Milestone 002

**名稱：** T-LO Farm Stable Playable Baseline  
**日期：** 2026-07-02  
**Version：** v1.0  
**Commit：** `d43adae`  
**狀態：** ✅ Stable

**Regression 測試：10 / 10 PASS**

- ✅ 玩家資訊
- ✅ 商店購買
- ✅ 肥料/飼料進背包
- ✅ 播種成功
- ✅ 澆水成功
- ✅ 施肥成功並扣背包
- ✅ 清除枯萎成功
- ✅ 雞舍管理可開可關
- ✅ 收蛋進背包
- ✅ 每日任務可開啟

**說明：**
已恢復為目前正式可玩的穩定版本。
workspace 已還原至 `tlo-farm-live-backup-20260701-1534`。
後續所有功能皆以此版本為基準開發。

**還原原因：**
commit `867584e`（農地解鎖系統）破壞了 fertilize / clear-withered API，
workspace HEAD (`16d019a`) 繼承了該破壞。已用 M001 備份還原至穩定狀態。

**Railway 部署：**
- GitHub: `d43adae` ✅
- Railway: 等待平台故障修復後部署

**備註：**
此版本禁止未經分析直接修改 FarmScene 或 API，
未來新功能必須依照 DEV_RULES 流程開發。

---

### M002.1｜肥料資料修復 + 雞舍 Sprite 重構｜2026-07-07

**Version：** v1.1
**Status：** ✅ Stable

**完成內容：**

1. **普通肥料資料格式統一**
   - Root Cause：早期購買寫入 `item_type='item'`（殘留），fertilize API 查 `item_type='fertilizer'`，兩者找不到，導致 400 "肥料不足"
   - Fix：DB Migration 將所有 `item_type='item', item_id=1` 合併進 `item_type='fertilizer', item_id=1`
   - **正式格式（唯一有效格式）：** `item_type='fertilizer', item_id=1`
   - 正式站 Smoke Test ✅ PASS

2. **Commit e5f92e5** — `fix(chicken-coop): unify sprite creation and input handling`
   - 雞舍 Sprite 統一由 `renderChickenCoop()` 管理
   - 移除 Zone-based 點擊偵測改為 API 驅動渲染
   - `docs/CHICKEN_COOP_RENDER_DESIGN.md` 新增追蹤文件

3. **Commit 6bf716f** — `fix(fertilize): remove obsolete inventory debug query`
   - 移除 `farm.ts` lines 793-798 殘留 debug log
   - 不影響 API 邏輯

**Regression 測試（本地 19 項）：19/19 PASS**

| 類別 | 項目 | 結果 |
|------|------|------|
| 農場 | 播種 | ✅ |
| 農場 | 澆水 | ✅ |
| 農場 | 施肥 | ✅ |
| 農場 | 收成 | ✅ |
| 背包 | 種子同步 | ✅ |
| 背包 | 肥料同步 | ✅ |
| 背包 | 作物同步 | ✅ |
| 背包 | 飼料同步 | ✅ |
| 商店 | 買種子 | ✅ |
| 商店 | 買普通肥料 | ✅ |
| 商店 | 買普通飼料 | ✅ |
| 雞舍 | 建築顯示 | ✅ |
| 雞舍 | 點擊管理 | ✅ |
| 雞舍 | 餵食 | ✅ |
| 雞舍 | PRODUCING | ✅ |
| 雞舍 | 倒數 | ✅ |
| 雞舍 | 收蛋 | ✅ |
| 雞舍 | 雞蛋進背包 | ✅ |
| 玩家 | 金幣/經驗/等級 | ✅ |

**正式站 Smoke Test：** ✅ PASS（test999 新帳號）

**Railway Deploy：**
- Deployment ID：`f4203f65-0078-425c-929d-892e183c76ca`
- URL：https://tlo-farm-production.up.railway.app
- 狀態：● Online ✅

**既有問題（本次未修）：**
- `PATCH /api/player/profile` empty body 回傳 `gold=None` — login response 有值，不影響遊戲運行

**Commit History：**
```
6bf716f fix(fertilize): remove obsolete inventory debug query
e5f92e5 fix(chicken-coop): unify sprite creation and input handling
```

**Git Tracking：** `docs/` 已更新，待下次功能完成後一併 commit。
