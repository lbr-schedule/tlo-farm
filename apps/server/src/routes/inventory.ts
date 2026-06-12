import { Router, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// 取得背包內容
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { type, page = 1, limit = 20 } = req.query;

    // 取得背包物品（使用 raw SQL）
    const itemsResult = await db.execute(
      `SELECT id, user_id as userId, item_type as itemType, item_id as itemId, amount FROM inventories WHERE user_id = ?`,
      [userId]
    );

    let filteredItems = itemsResult.rows || [];
    
    // 過濾類型
    if (type && (type === 'seed' || type === 'crop')) {
      filteredItems = filteredItems.filter((item: any) => item.itemType === type);
    }

    // 分頁
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const start = (pageNum - 1) * limitNum;
    const paginatedItems = filteredItems.slice(start, start + limitNum);

    // 取得作物詳細資料
    const cropIds = paginatedItems.map((item: any) => item.itemId);
    let cropList: any[] = [];
    if (cropIds.length > 0) {
      const placeholders = cropIds.map(() => '?').join(',');
      const cropResult = await db.execute(
        `SELECT id, name_zh_tw as nameZhTw, grow_time_sec as growTimeSec, sell_price as sellPrice, sprite FROM crops WHERE id IN (${placeholders})`,
        cropIds
      );
      cropList = cropResult.rows || [];
    }

    const cropMap = new Map(cropList.map((c: any) => [c.id, c]));

    // 組合背包資料
    const inventoryWithDetails = paginatedItems.map((item: any) => {
      const crop = cropMap.get(item.itemId);
      return {
        id: item.id,
        itemType: item.itemType,
        itemId: item.itemId,
        amount: item.amount,
        name: crop?.nameZhTw || '未知物品',
        sprite: crop?.sprite || '',
        sellPrice: crop?.sellPrice || 0,
        growTimeSec: crop?.growTimeSec || 0
      };
    });

    return res.json({
      success: true,
      message: '成功',
      inventory: inventoryWithDetails,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: filteredItems.length,
        totalPages: Math.ceil(filteredItems.length / limitNum)
      }
    });
  } catch (error) {
    console.error('取得背包錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 使用道具（種子在農場頁面使用）
router.post('/use', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { itemId, amount = 1 } = req.body;

    if (!itemId) {
      return res.status(400).json({ success: false, message: '請選擇要使用的道具' });
    }

    // 檢查背包中是否有這個道具（使用 raw SQL）
    const invResult = await db.execute(
      `SELECT id, user_id as userId, amount FROM inventories WHERE id = ?`,
      [itemId]
    );
    const inventoryItem = invResult.rows?.[0];

    if (!inventoryItem || inventoryItem.userId !== userId) {
      return res.status(404).json({ success: false, message: '背包中沒有這個道具' });
    }

    if (inventoryItem.amount < amount) {
      return res.status(400).json({ success: false, message: '道具數量不足' });
    }

    // 減少道具數量（使用 raw SQL）
    if (inventoryItem.amount === amount) {
      await db.execute(`DELETE FROM inventories WHERE id = ?`, [itemId]);
    } else {
      await db.execute(
        `UPDATE inventories SET amount = amount - ? WHERE id = ?`,
        [amount, itemId]
      );
    }

    return res.json({
      success: true,
      message: '道具已使用',
      used: {
        itemId,
        amount
      }
    });
  } catch (error) {
    console.error('使用道具錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;