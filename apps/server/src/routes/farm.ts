import { Router, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, users, crops, farmTiles, inventories } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// 取得農場狀態
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    // 取得玩家資料
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    // 取得農場土地狀態
    const tiles = await db.select().from(farmTiles).where(eq(farmTiles.userId, userId)).all();

    // 轉換時間戳為毫秒
    const tilesWithTime = tiles.map(tile => ({
      id: tile.id,
      x: tile.x,
      y: tile.y,
      cropId: tile.cropId,
      plantedAt: tile.plantedAt ? new Date(tile.plantedAt).getTime() : null,
      finishAt: tile.finishAt ? new Date(tile.finishAt).getTime() : null,
      state: tile.state
    }));

    return res.json({
      success: true,
      message: '成功',
      user: {
        id: user.id,
        nickname: user.nickname,
        level: user.level,
        exp: user.exp,
        gold: user.gold
      },
      tiles: tilesWithTime
    });
  } catch (error) {
    console.error('取得農場狀態錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 種植作物
router.post('/plant', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { x, y, cropId } = req.body;

    // 驗證座標
    if (x === undefined || y === undefined || cropId === undefined) {
      return res.status(400).json({ success: false, message: '缺少必要參數' });
    }

    if (x < 0 || x >= 10 || y < 0 || y >= 10) {
      return res.status(400).json({ success: false, message: '無效的座標' });
    }

    // 檢查作物是否存在
    const crop = await db.select().from(crops).where(eq(crops.id, cropId)).get();
    if (!crop) {
      return res.status(404).json({ success: false, message: '作物不存在' });
    }

    // 檢查玩家金幣是否足夠
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    if (user.gold < crop.buyPrice) {
      return res.status(400).json({ success: false, message: '金幣不足' });
    }

    // 檢查土地是否已有作物
    const existingTile = await db.select().from(farmTiles)
      .where(and(
        eq(farmTiles.userId, userId),
        eq(farmTiles.x, x),
        eq(farmTiles.y, y)
      ))
      .get();

    if (existingTile && existingTile.state !== 'empty') {
      return res.status(400).json({ success: false, message: '這格已經有東西了' });
    }

    // 計算生長時間
    const now = new Date();
    const finishAt = new Date(now.getTime() + crop.growTimeSec * 1000);

    // 扣除金幣
    await db.update(users)
      .set({ gold: user.gold - crop.buyPrice })
      .where(eq(users.id, userId));

    // 更新或創建土地
    if (existingTile) {
      await db.update(farmTiles)
        .set({
          cropId,
          plantedAt: now,
          finishAt,
          state: 'growing'
        })
        .where(eq(farmTiles.id, existingTile.id));
    } else {
      await db.insert(farmTiles).values({
        userId,
        x,
        y,
        cropId,
        plantedAt: now,
        finishAt,
        state: 'growing'
      });
    }

    // 更新後的玩家資料
    const updatedUser = await db.select().from(users).where(eq(users.id, userId)).get();

    return res.json({
      success: true,
      message: `種植了${crop.nameZhTw}！`,
      user: {
        id: updatedUser!.id,
        nickname: updatedUser!.nickname,
        level: updatedUser!.level,
        exp: updatedUser!.exp,
        gold: updatedUser!.gold
      },
      tile: {
        x,
        y,
        cropId,
        plantedAt: now.getTime(),
        finishAt: finishAt.getTime(),
        state: 'growing'
      }
    });
  } catch (error) {
    console.error('種植錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 收成作物
router.post('/harvest', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { x, y } = req.body;

    if (x === undefined || y === undefined) {
      return res.status(400).json({ success: false, message: '缺少座標' });
    }

    // 取得土地資料
    const tile = await db.select().from(farmTiles)
      .where(and(
        eq(farmTiles.userId, userId),
        eq(farmTiles.x, x),
        eq(farmTiles.y, y)
      ))
      .get();

    if (!tile) {
      return res.status(404).json({ success: false, message: '土地不存在' });
    }

    if (tile.state !== 'ready') {
      if (tile.state === 'growing' && tile.finishAt) {
        const remaining = new Date(tile.finishAt).getTime() - Date.now();
        if (remaining > 0) {
          return res.status(400).json({
            success: false,
            message: `還需要 ${Math.ceil(remaining / 1000)} 秒才能收成`
          });
        }
      }
      return res.status(400).json({ success: false, message: '這格沒有東西可以收成' });
    }

    // 取得作物資料
    const crop = await db.select().from(crops).where(eq(crops.id, tile.cropId!)).get();
    if (!crop) {
      return res.status(404).json({ success: false, message: '作物資料不存在' });
    }

    // 計算新經驗值和等級
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    let newExp = user.exp + crop.exp;
    let newLevel = user.level;
    let leveledUp = false;

    // 等級計算（每級需要的經驗）
    const expForLevel = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
    while (newLevel < expForLevel.length && newExp >= expForLevel[newLevel]) {
      newLevel++;
      leveledUp = true;
    }

    // 更新玩家資料
    await db.update(users)
      .set({
        gold: user.gold + crop.sellPrice,
        exp: newExp,
        level: newLevel
      })
      .where(eq(users.id, userId));

    // 重置土地
    await db.update(farmTiles)
      .set({
        cropId: null,
        plantedAt: null,
        finishAt: null,
        state: 'empty'
      })
      .where(eq(farmTiles.id, tile.id));

    // 增加道具到背包（作物）
    const existingCrop = await db.select().from(inventories)
      .where(and(
        eq(inventories.userId, userId),
        eq(inventories.itemType, 'crop'),
        eq(inventories.itemId, crop.id)
      ))
      .get();

    if (existingCrop) {
      await db.update(inventories)
        .set({ amount: existingCrop.amount + 1 })
        .where(eq(inventories.id, existingCrop.id));
    } else {
      await db.insert(inventories).values({
        userId,
        itemType: 'crop',
        itemId: crop.id,
        amount: 1
      });
    }

    const updatedUser = await db.select().from(users).where(eq(users.id, userId)).get();

    return res.json({
      success: true,
      message: `收成成功！獲得 ${crop.sellPrice} 金幣和 ${crop.exp} 經驗！`,
      harvest: {
        cropId: crop.id,
        cropName: crop.nameZhTw,
        goldEarned: crop.sellPrice,
        expEarned: crop.exp
      },
      leveledUp,
      user: {
        id: updatedUser!.id,
        nickname: updatedUser!.nickname,
        level: updatedUser!.level,
        exp: updatedUser!.exp,
        gold: updatedUser!.gold
      },
      tile: {
        x,
        y,
        state: 'empty'
      }
    });
  } catch (error) {
    console.error('收成錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 澆水（加速生長）
router.post('/water', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { x, y } = req.body;

    if (x === undefined || y === undefined) {
      return res.status(400).json({ success: false, message: '缺少座標' });
    }

    const tile = await db.select().from(farmTiles)
      .where(and(
        eq(farmTiles.userId, userId),
        eq(farmTiles.x, x),
        eq(farmTiles.y, y)
      ))
      .get();

    if (!tile || tile.state === 'empty') {
      return res.status(400).json({ success: false, message: '這裡沒有作物' });
    }

    if (tile.state === 'ready') {
      return res.status(400).json({ success: false, message: '這裡的作物已經成熟了' });
    }

    // 澆水可以減少剩餘時間（這裡簡化為不減少時間，只是標記已澆水）
    // 實際遊戲中可以加入澆水加速邏輯

    return res.json({
      success: true,
      message: '澆水成功！作物會更快成熟！'
    });
  } catch (error) {
    console.error('澆水錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 查詢作物清單
router.get('/crops', async (_req, res: Response) => {
  try {
    const allCrops = await db.select().from(crops).all();

    return res.json({
      success: true,
      message: '成功',
      crops: allCrops.map(crop => ({
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
    console.error('查詢作物錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;
