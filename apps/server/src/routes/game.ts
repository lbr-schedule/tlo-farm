import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { db } from '@tlo-farm/database';

const router: RouterType = Router();

// 等级的各類解鎖項目（從現有程式碼匯總而來）
const LEVEL_UNLOCKS: Record<number, { crops: string[]; items: string[]; buildings: string[] }> = {
  // Lv5 - 雞舍
  5: { crops: [], items: [], buildings: ['雞舍'] },
  // Lv8 - 農地可擴充（依 GDD）
  8: {
    crops: [],
    items: [],
    buildings: ['農地可擴充 10 → 12', '擴充費用：1800 金幣', '建築材料：無'],
  },
  // Lv10 - 食品工坊
  10: { crops: [], items: [], buildings: ['食品工坊'] },
};

/**
 * 公開 API：取得所有解鎖設定（供前端初始化）
 */
router.get('/level-unlocks', async (_req: Request, res: Response) => {
  try {
    // 取所有作物及其 required_level
    const cropResult = await db.execute(
      `SELECT id, name_zh_tw as name, required_level as requiredLevel FROM crops ORDER BY id`
    );

    // 取所有商店物品及其 required_level
    const itemResult = await db.execute(
      `SELECT id, name_zh_tw as name, item_type as itemType, required_level as requiredLevel FROM items ORDER BY id`
    );

    return res.json({
      success: true,
      crops: cropResult.rows || [],
      items: itemResult.rows || [],
      levelConfig: LEVEL_UNLOCKS,
    });
  } catch (error) {
    console.error('取得解鎖資料錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;
