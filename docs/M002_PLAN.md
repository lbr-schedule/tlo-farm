# T-LO Farm M002 開發計畫（M002_PLAN）

> 建立時間：2026-07-02  
> 目前正式開發基準：commit `d43adae`  
> 狀態：Stable Playable Baseline  
> 屬於：T-LO Farm 開發規範 v1.0

---

## 目前正式開發基準

**Commit：** `d43adae`  
**GitHub：** `ssh://git@github.com:lbr-schedule/tlo-farm.git`  
**Railway：** `https://tlo-farm.up.railway.app/`（待部署）  
**Local Workspace：** `~/.openclaw/workspace/tlo-farm-github/`

---

## M001 完成內容

M001 建立了完整的開發規範：

- `DEV_RULES.md` — 穩定基準、回歸測試、禁止規則
- `ARCHITECTURE.md` — 系統架構、Mermaid 圖、資料流
- `MODULE_BOUNDARY.md` — 模組邊界定義、6 條永續規則
- `CHANGE_POLICY.md` — 8 章修改流程規範
- `MILESTONE.md` — 工程里程碑
- `PROGRESS_BAR_REFERENCE.md` — 進度條實作參考

---

## M002 目前已完成

✅ 玩家資訊  
✅ 商店購買  
✅ 背包（肥料/種子）  
✅ 播種  
✅ 澆水  
✅ 施肥  
✅ 清除枯萎  
✅ 雞舍管理  
✅ 收蛋進背包  
✅ 每日任務

**Regression：10 / 10 PASS**

---

## M002 下一階段開發方向

### Phase 1：整理架構（不新增功能）

- 建立 CropSystem 模組
- 建立 CropConfig 設定檔
- 統一作物生長邏輯
- 不修改任何現有 API 行為

### Phase 2：拆分 CropSystem

- 將 FarmScene.ts 中的 crop logic 抽出成独立 system
- 建立 `systems/CropSystem.ts`
- 統一作物狀態機制
- 確保破壞性變更被杜絕

### Phase 3：重新設計農地解鎖

- 重新設計農地解鎖系統
- 確保不破壞 fertilize / clear-withered API
- 依照 CHANGE_POLICY.md 流程開發

---

## 禁止事項

- 不得直接在 FarmScene 大幅修改
- 新功能必須依照 DEV_RULES
- 修改前必須完成影響範圍分析
- 修 A 壞 B 必須立即 Rollback

