import { Router, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// 取得商店作物清單
router.get('/items', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    // 取得玩家等級
    let playerLevel = 1;
    if (userId) {
      const userResult = await db.execute(
        `SELECT level FROM users WHERE id = ?`,
        [userId]
      );
      if (userResult.rows && userResult.rows.length > 0) {
        playerLevel = userResult.rows[0].level || 1;
      }
    }

    // MVP Phase 1：只取得四個核心作物（id 1-4）
    const cropsResult = await db.execute(
      `SELECT id, name_zh_tw as nameZhTw, grow_time_sec as growTimeSec, sell_price as sellPrice, buy_price as buyPrice, exp, sprite, required_level as requiredLevel FROM crops WHERE id IN (1, 2, 3, 4)`
    );
    const crops = cropsResult.rows || [];

    return res.json({
      success: true,
      message: '成功',
      crops: crops.map((crop: any) => ({
        id: crop.id,
        nameZhTw: crop.nameZhTw,
        growTimeSec: crop.growTimeSec,
        sellPrice: crop.sellPrice,
        buyPrice: crop.buyPrice,
        exp: crop.exp,
        sprite: crop.sprite,
        requiredLevel: crop.requiredLevel
      }))
    });
  } catch (error) {
    console.error('取得商店物品錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 購買種子
router.post('/buy', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { cropId, amount = 1 } = req.body;

    if (!cropId) {
      return res.status(400).json({ success: false, message: '請選擇要購買的種子' });
    }

    // 檢查作物是否存在
    const cropResult = await db.execute(
      `SELECT id, name_zh_tw as nameZhTw, buy_price as buyPrice, required_level as requiredLevel FROM crops WHERE id = ?`,
      [cropId]
    );
    const crop = cropResult.rows?.[0];
    if (!crop) {
      return res.status(404).json({ success: false, message: '作物不存在' });
    }

    // 檢查玩家資料
    const userResult = await db.execute(
      `SELECT id, gold, level FROM users WHERE id = ?`,
      [userId]
    );
    const user = userResult.rows?.[0];
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    if (user.level < crop.requiredLevel) {
      return res.status(400).json({
        success: false,
        message: `需要等級 ${crop.requiredLevel} 才能購買${crop.nameZhTw}`
      });
    }

    const totalCost = crop.buyPrice * amount;
    if (user.gold < totalCost) {
      return res.status(400).json({
        success: false,
        message: `金幣不足！需要 ${totalCost} 金幣，你只有 ${user.gold} 金幣`
      });
    }

    // 扣除金幣
    await db.execute(
      `UPDATE users SET gold = gold - ? WHERE id = ?`,
      [totalCost, userId]
    );

    // 增加種子到背包
    const existingResult = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'seed' AND item_id = ?`,
      [userId, cropId]
    );
    const existingSeed = existingResult.rows?.[0];

    if (existingSeed) {
      await db.execute(
        `UPDATE inventories SET amount = amount + ? WHERE id = ?`,
        [amount, existingSeed.id]
      );
    } else {
      await db.execute(
        `INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'seed', ?, ?)`,
        [userId, cropId, amount]
      );
    }

    // 取得更新後的金幣
    const updatedResult = await db.execute(
      `SELECT gold FROM users WHERE id = ?`,
      [userId]
    );
    const updatedGold = updatedResult.rows?.[0]?.gold || 0;

    return res.json({
      success: true,
      message: `購買成功！獲得了 ${amount} 顆${crop.nameZhTw}種子`,
      purchase: {
        cropId,
        cropName: crop.nameZhTw,
        amount,
        totalCost
      },
      user: {
        gold: updatedGold
      }
    });
  } catch (error) {
    console.error('購買錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 賣出作物
router.post('/sell', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { cropId, amount = 1 } = req.body;

    if (!cropId) {
      return res.status(400).json({ success: false, message: '請選擇要賣出的作物' });
    }

    // 檢查背包中的作物數量
    const inventoryResult = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'crop' AND item_id = ?`,
      [userId, cropId]
    );
    const inventoryItem = inventoryResult.rows?.[0];

    if (!inventoryItem || inventoryItem.amount < amount) {
      return res.status(400).json({
        success: false,
        message: '背包中沒有足夠的作物'
      });
    }

    // 取得作物資料
    const cropResult = await db.execute(
      `SELECT id, name_zh_tw as nameZhTw, sell_price as sellPrice FROM crops WHERE id = ?`,
      [cropId]
    );
    const crop = cropResult.rows?.[0];
    if (!crop) {
      return res.status(404).json({ success: false, message: '作物不存在' });
    }

    const totalPrice = crop.sellPrice * amount;

    // 增加金幣
    await db.execute(
      `UPDATE users SET gold = gold + ? WHERE id = ?`,
      [totalPrice, userId]
    );

    // 減少背包中的作物
    if (inventoryItem.amount === amount) {
      await db.execute(
        `DELETE FROM inventories WHERE id = ?`,
        [inventoryItem.id]
      );
    } else {
      await db.execute(
        `UPDATE inventories SET amount = amount - ? WHERE id = ?`,
        [amount, inventoryItem.id]
      );
    }

    // 取得更新後的金幣
    const updatedResult = await db.execute(
      `SELECT gold FROM users WHERE id = ?`,
      [userId]
    );
    const updatedGold = updatedResult.rows?.[0]?.gold || 0;

    return res.json({
      success: true,
      message: `賣出成功！獲得了 ${totalPrice} 金幣`,
      sale: {
        cropId,
        cropName: crop.nameZhTw,
        amount,
        totalPrice
      },
      user: {
        gold: updatedGold
      }
    });
  } catch (error) {
    console.error('賣出錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;