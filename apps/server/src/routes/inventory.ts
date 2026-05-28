import { Router, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, inventories, crops } from '@tlo-farm/database';
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

    // 取得背包物品
    let query = db.select().from(inventories).where(eq(inventories.userId, userId));

    const items = await query.all();

    // 過濾類型
    let filteredItems = items;
    if (type && (type === 'seed' || type === 'crop')) {
      filteredItems = items.filter(item => item.itemType === type);
    }

    // 分頁
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const start = (pageNum - 1) * limitNum;
    const paginatedItems = filteredItems.slice(start, start + limitNum);

    // 取得作物詳細資料
    const cropIds = paginatedItems.map(item => item.itemId);
    const cropList = cropIds.length > 0
      ? await db.select().from(crops).all()
      : [];

    const cropMap = new Map(cropList.map(c => [c.id, c]));

    // 組合背包資料
    const inventoryWithDetails = paginatedItems.map(item => {
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

    // 檢查背包中是否有這個道具
    const inventoryItem = await db.select().from(inventories)
      .where(eq(inventories.id, itemId))
      .get();

    if (!inventoryItem || inventoryItem.userId !== userId) {
      return res.status(404).json({ success: false, message: '背包中沒有這個道具' });
    }

    if (inventoryItem.amount < amount) {
      return res.status(400).json({ success: false, message: '道具數量不足' });
    }

    // 減少道具數量
    if (inventoryItem.amount === amount) {
      await db.delete(inventories).where(eq(inventories.id, itemId));
    } else {
      await db.update(inventories)
        .set({ amount: inventoryItem.amount - amount })
        .where(eq(inventories.id, itemId));
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
