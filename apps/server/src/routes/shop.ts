import { Router, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, users, crops, inventories } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// 取得商店作物清單
router.get('/items', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    // 取得玩家等級
    let playerLevel = 1;
    if (userId) {
      const user = await db.select().from(users).where(eq(users.id, userId)).get();
      playerLevel = user?.level || 1;
    }

    // 取得所有作物（根據等級過濾）
    const allCrops = await db.select().from(crops).all();

    const availableCrops = allCrops.filter(crop => crop.requiredLevel <= playerLevel);
    const lockedCrops = allCrops.filter(crop => crop.requiredLevel > playerLevel);

    return res.json({
      success: true,
      message: '成功',
      crops: availableCrops.map(crop => ({
        id: crop.id,
        nameZhTw: crop.nameZhTw,
        growTimeSec: crop.growTimeSec,
        sellPrice: crop.sellPrice,
        buyPrice: crop.buyPrice,
        exp: crop.exp,
        sprite: crop.sprite,
        requiredLevel: crop.requiredLevel
      })),
      locked: lockedCrops.map(crop => ({
        id: crop.id,
        nameZhTw: crop.nameZhTw,
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
    const crop = await db.select().from(crops).where(eq(crops.id, cropId)).get();
    if (!crop) {
      return res.status(404).json({ success: false, message: '作物不存在' });
    }

    // 檢查玩家等級
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
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
    await db.update(users)
      .set({ gold: user.gold - totalCost })
      .where(eq(users.id, userId));

    // 增加種子到背包
    const existingSeed = await db.select().from(inventories)
      .where(and(
        eq(inventories.userId, userId),
        eq(inventories.itemType, 'seed'),
        eq(inventories.itemId, cropId)
      ))
      .get();

    if (existingSeed) {
      await db.update(inventories)
        .set({ amount: existingSeed.amount + amount })
        .where(eq(inventories.id, existingSeed.id));
    } else {
      await db.insert(inventories).values({
        userId,
        itemType: 'seed',
        itemId: cropId,
        amount
      });
    }

    const updatedUser = await db.select().from(users).where(eq(users.id, userId)).get();

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
        gold: updatedUser!.gold
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
    const inventoryItem = await db.select().from(inventories)
      .where(and(
        eq(inventories.userId, userId),
        eq(inventories.itemType, 'crop'),
        eq(inventories.itemId, cropId)
      ))
      .get();

    if (!inventoryItem || inventoryItem.amount < amount) {
      return res.status(400).json({
        success: false,
        message: '背包中沒有足夠的作物'
      });
    }

    // 取得作物資料
    const crop = await db.select().from(crops).where(eq(crops.id, cropId)).get();
    if (!crop) {
      return res.status(404).json({ success: false, message: '作物不存在' });
    }

    const totalPrice = crop.sellPrice * amount;

    // 增加金幣
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    await db.update(users)
      .set({ gold: user.gold + totalPrice })
      .where(eq(users.id, userId));

    // 減少背包中的作物
    if (inventoryItem.amount === amount) {
      await db.delete(inventories).where(eq(inventories.id, inventoryItem.id));
    } else {
      await db.update(inventories)
        .set({ amount: inventoryItem.amount - amount })
        .where(eq(inventories.id, inventoryItem.id));
    }

    const updatedUser = await db.select().from(users).where(eq(users.id, userId)).get();

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
        gold: updatedUser!.gold
      }
    });
  } catch (error) {
    console.error('賣出錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;
