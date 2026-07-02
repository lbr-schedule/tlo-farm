# T-LO Farm M002 Stable Playable Baseline

> 建立時間：2026-07-02  
> 正式基準 Commit：`d43adae`  
> 狀態：✅ Stable  
> 屬於：T-LO Farm Development Standard v1.0

---

## 目前正式工作目錄

```
~/.openclaw/workspace/tlo-farm-github/
```

---

## 目前正式 Commit

**Hash：** `d43adae`  
**Message：** `restore: return to stable playable farm baseline`  
**Date：** 2026-07-02  
**GitHub：** `ssh://git@github.com:lbr-schedule/tlo-farm.git`

---

## 目前正式 GitHub

**Remote：** `origin`  
**Branch：** `main`  
**URL：** `git@github.com:lbr-schedule/tlo-farm.git`  
**Commit：** `d43adae` ✅

---

## 目前正式 Railway

**URL：** `https://tlo-farm.up.railway.app/`（待部署）  
**Status：** 等待 Railway US East 故障修復  
**部署觸發方式：** GitHub push → Railway auto-deploy  
**上次有效 Commit：** M001 時期

---

## 10 項回歸測試 PASS

| # | 測試項目 | 結果 |
|---|---------|------|
| 1 | 玩家資訊 | ✅ PASS |
| 2 | 商店購買 | ✅ PASS |
| 3 | 肥料/飼料進背包 | ✅ PASS |
| 4 | 播種成功 | ✅ PASS |
| 5 | 澆水成功 | ✅ PASS |
| 6 | 施肥成功並扣背包 | ✅ PASS |
| 7 | 清除枯萎成功 | ✅ PASS |
| 8 | 雞舍管理可開可關 | ✅ PASS |
| 9 | 收蛋進背包 | ✅ PASS |
| 10 | 每日任務可開啟 | ✅ PASS |

---

## 禁止事項

- 不得直接在 FarmScene 大幅修改
- 新功能必須依照 DEV_RULES
- 修改前必須完成影響範圍分析
- 修 A 壞 B 必須立即 Rollback

---

## 下一步開發方向

- **CropSystem**：建立獨立 crop system 模組
- **PlotUnlockSystem**：重新設計農地解鎖（不破壞現有 API）
- **ProcessingSystem**：加工廠系統（待規劃）

