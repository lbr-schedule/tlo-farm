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
    // itemId=9 是舊雞蛋殘留，API 直接排除不回傳
    const itemsResult = await db.execute(
      `SELECT id, user_id as userId, item_type as itemType, item_id as itemId, amount FROM inventories WHERE user_id = ? AND NOT (item_type = 'livestock' AND item_id = 9)`,
      [userId]
    );

    let filteredItems = itemsResult.rows || [];
    
    // 過濾類型
    if (type && (type === 'seed' || type === 'crop' || type === 'item' || type === 'livestock' || type === 'fertilizer')) {
      filteredItems = filteredItems.filter((item: any) => item.itemType === type);
    }

    // 分頁
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const start = (pageNum - 1) * limitNum;
    const paginatedItems = filteredItems.slice(start, start + limitNum);

    // 取得詳細資料（根據類型查詢不同表格）
    const itemIds = paginatedItems.map((item: any) => item.itemId);
    let detailMap = new Map();
    
    if (itemIds.length > 0) {
      const placeholders = itemIds.map(() => '?').join(',');
      
      if (type === 'item' || type === 'fertilizer') {
        // 查詢 items 表格（道具和肥料都在 items 表）
        const itemResult = await db.execute(
          `SELECT id, name_zh_tw as nameZhTw, sell_price as sellPrice, sprite FROM items WHERE id IN (${placeholders})`,
          itemIds
        );
        const itemList = itemResult.rows || [];
        detailMap = new Map(itemList.map((i: any) => [i.id, i]));
      } else {
        // 查詢 crops 表格
        const cropResult = await db.execute(
          `SELECT id, name_zh_tw as nameZhTw, grow_time_sec as growTimeSec, sell_price as sellPrice, sprite FROM crops WHERE id IN (${placeholders})`,
          itemIds
        );
        const cropList = cropResult.rows || [];
        detailMap = new Map(cropList.map((c: any) => [c.id, c]));
      }
    }

    // 組合背包資料
    // 畜牧物品靜態資料
    const livestockItems: Record<number, { nameZhTw: string; sprite: string; sellPrice: number }> = {
      1: { nameZhTw: '雞蛋', sprite: 'egg.png', sellPrice: 5 },
      2: { nameZhTw: '普通飼料', sprite: 'feed_normal.png', sellPrice: 0 },
    };
    const inventoryWithDetails = paginatedItems.map((item: any) => {
      if (item.itemType === 'livestock') {
        const info = livestockItems[item.itemId] || { nameZhTw: '未知畜牧品', sprite: '', sellPrice: 0 };
        return {
          id: item.id,
          itemType: item.itemType,
          itemId: item.itemId,
          amount: item.amount,
          name: info.nameZhTw,
          sprite: info.sprite,
          sellPrice: info.sellPrice,
          growTimeSec: 0
        };
      }
      const detail = detailMap.get(item.itemId);
      return {
        id: item.id,
        itemType: item.itemType,
        itemId: item.itemId,
        amount: item.amount,
        name: detail?.nameZhTw || '未知物品',
        sprite: detail?.sprite || '',
        sellPrice: detail?.sellPrice || 0,
        growTimeSec: detail?.growTimeSec || 0
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