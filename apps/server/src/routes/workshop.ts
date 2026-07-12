import { Router, type Router as RouterType, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const router: RouterType = Router();

// ============================================================
// 加工廠配方靜態設定（PR001 only）
// ============================================================
const WORKSHOP_RECIPES: Record<string, {
  productId: string;
  productName: string;
  workshopType: string;
  requiredLevel: number;
  durationSec: number;
  expReward: number;
  sellPrice: number;
  ingredients: { itemId: number; itemName: string; itemType: string; amount: number }[];
}> = {
  PR001: {
    productId: 'PR001',
    productName: '精緻麵粉',
    workshopType: 'P001',
    requiredLevel: 10,
    durationSec: 300,
    expReward: 3,
    sellPrice: 30,
    ingredients: [{ itemId: 1, itemName: '小麥', itemType: 'crop', amount: 2 }],
  },
};

// 小麥 crop id = 1（見 GDD C001）
const WHEAT_CROP_ID = 1;
// 精緻麵粉當作 items 表 id = 100（加工品專用區間）
const FLOUR_ITEM_ID = 100;

// ============================================================
// POST /api/workshop/place
// 放置加工廠
// ============================================================
router.post('/place', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { workshopType, tileX, tileY } = req.body;
    if (!workshopType || tileX === undefined || tileY === undefined) {
      return res.status(400).json({ success: false, message: '缺少參數' });
    }

    // 確認 processing_workshops 有記錄但未放置
    const wsRows = await db.execute(
      `SELECT id, is_placed as isPlaced FROM processing_workshops WHERE user_id = ? AND workshop_type = ?`,
      [userId, workshopType]
    );
    const ws = wsRows.rows?.[0];
    if (!ws) return res.status(404).json({ success: false, message: '找不到加工廠記錄，請先購買' });
    if (ws.isPlaced) return res.status(400).json({ success: false, message: '加工廠已經放置過了' });

    const now = Date.now();
    await db.execute(
      `UPDATE processing_workshops SET tile_x = ?, tile_y = ?, is_placed = 1, updated_at = ? WHERE id = ?`,
      [tileX, tileY, now, ws.id]
    );

    console.log(`[WORKSHOP PLACE] userId=${userId} workshopType=${workshopType} tileX=${tileX} tileY=${tileY}`);

    res.json({
      success: true,
      message: '加工廠放置成功',
      workshop: {
        id: ws.id,
        workshopType,
        tileX,
        tileY,
        isPlaced: 1,
      },
    });
  } catch (err: any) {
    console.error('[WORKSHOP PLACE ERROR]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// GET /api/workshop/status
// 取得玩家加工廠狀態
// ============================================================
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    // 取得玩家的加工廠
    const workshopRows = await db.execute(
      `SELECT id, workshop_type as workshopType, workshop_name as workshopName,
              level, tile_x as tileX, tile_y as tileY, is_placed as isPlaced,
              created_at as createdAt
       FROM processing_workshops WHERE user_id = ?`,
      [userId]
    );
    const workshops = workshopRows.rows || [];

    // 取得所有加工中/完成的 jobs
    const jobRows = await db.execute(
      `SELECT id, workshop_id as workshopId, product_id as productId,
              product_name as productName, status, slot_index as slotIndex,
              started_at as startedAt, finish_at as finishAt,
              collected_at as collectedAt
       FROM processing_jobs WHERE user_id = ? AND status != 'idle'`,
      [userId]
    );
    const jobs = jobRows.rows || [];

    // 取得背包中小麥數量
    const invRows = await db.execute(
      `SELECT amount FROM inventories WHERE user_id = ? AND item_type = 'crop' AND item_id = ?`,
      [userId, WHEAT_CROP_ID]
    );
    const wheatAmount = invRows.rows?.[0]?.amount ?? 0;

    // 精緻麵粉庫存
    const flourRows = await db.execute(
      `SELECT amount FROM inventories WHERE user_id = ? AND item_type = 'processed' AND item_id = ?`,
      [userId, FLOUR_ITEM_ID]
    );
    const flourAmount = flourRows.rows?.[0]?.amount ?? 0;

    res.json({
      success: true,
      workshops,
      jobs,
      inventory: {
        wheat: wheatAmount,
        flour: flourAmount,
      },
      recipes: WORKSHOP_RECIPES,
    });
  } catch (err: any) {
    console.error('[WORKSHOP STATUS ERROR]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// POST /api/workshop/start
// 開始加工
// ============================================================
router.post('/start', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { workshopId, productId } = req.body;
    if (!workshopId || !productId) {
      return res.status(400).json({ success: false, message: '缺少參數' });
    }

    const recipe = WORKSHOP_RECIPES[productId];
    if (!recipe) {
      return res.status(404).json({ success: false, message: '查無此配方' });
    }

    // 檢查玩家等級
    const userRows = await db.execute(`SELECT level FROM users WHERE id = ?`, [userId]);
    const userLevel = userRows.rows?.[0]?.level ?? 1;
    if (userLevel < recipe.requiredLevel) {
      return res.status(400).json({
        success: false,
        message: `需要等級 ${recipe.requiredLevel} 才能製作（目前 Lv.${userLevel}）`,
      });
    }

    // 檢查加工廠是否存在且已放置
    const wsRows = await db.execute(
      `SELECT id, level, is_placed as isPlaced FROM processing_workshops WHERE id = ? AND user_id = ?`,
      [workshopId, userId]
    );
    const ws = wsRows.rows?.[0];
    if (!ws) return res.status(404).json({ success: false, message: '加工廠不存在' });
    if (!ws.isPlaced) return res.status(400).json({ success: false, message: '請先放置加工廠' });

    // 檢查有多少個加工槽可用（Lv1 = 2槽）
    const queueCount = ws.level === 1 ? 2 : ws.level === 2 ? 3 : ws.level === 3 ? 4 : 2;

    // 檢查目前加工中/完成的 jobs 數量
    const activeJobsRows = await db.execute(
      `SELECT COUNT(*) as cnt FROM processing_jobs WHERE user_id = ? AND workshop_id = ? AND status IN ('processing', 'completed')`,
      [userId, workshopId]
    );
    const activeCount = activeJobsRows.rows?.[0]?.cnt ?? 0;
    if (activeCount >= queueCount) {
      return res.status(400).json({ success: false, message: '加工佇列已滿' });
    }

    // 找空的 slot_index
    const usedSlotsRows = await db.execute(
      `SELECT slot_index FROM processing_jobs WHERE user_id = ? AND workshop_id = ? AND status IN ('processing', 'completed')`,
      [userId, workshopId]
    );
    const usedSlots = new Set((usedSlotsRows.rows || []).map((r: any) => r.slot_index));
    const slotIndex = [0, 1].find(s => !usedSlots.has(s));
    if (slotIndex === undefined) {
      return res.status(400).json({ success: false, message: '沒有空閒的加工槽' });
    }

    // 檢查原料是否足夠（只檢查小麥）
    const ingredient = recipe.ingredients[0];
    const invRows = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = ? AND item_id = ?`,
      [userId, ingredient.itemType, ingredient.itemId]
    );
    const currentAmount = invRows.rows?.[0]?.amount ?? 0;
    if (currentAmount < ingredient.amount) {
      return res.status(400).json({
        success: false,
        message: `${ingredient.itemName}不足！需要 ${ingredient.amount} 個，背包有 ${currentAmount} 個`,
      });
    }

    // 扣原料
    const invRecord = invRows.rows[0];
    if (currentAmount === ingredient.amount) {
      await db.execute(`DELETE FROM inventories WHERE id = ?`, [invRecord.id]);
    } else {
      await db.execute(
        `UPDATE inventories SET amount = amount - ? WHERE id = ?`,
        [ingredient.amount, invRecord.id]
      );
    }

    // 建立加工 job
    const now = Date.now();
    const finishAt = now + recipe.durationSec * 1000;
    await db.execute(
      `INSERT INTO processing_jobs (user_id, workshop_id, product_id, product_name, status, slot_index, started_at, finish_at)
       VALUES (?, ?, ?, ?, 'processing', ?, ?, ?)`,
      [userId, workshopId, productId, recipe.productName, slotIndex, now, finishAt]
    );

    // 更新 workshop updated_at
    await db.execute(`UPDATE processing_workshops SET updated_at = ? WHERE id = ?`, [now, workshopId]);

    // 回傳更新後的原料數量
    const afterInvRows = await db.execute(
      `SELECT amount FROM inventories WHERE user_id = ? AND item_type = ? AND item_id = ?`,
      [userId, ingredient.itemType, ingredient.itemId]
    );
    const remainingWheat = afterInvRows.rows?.[0]?.amount ?? 0;

    console.log(`[WORKSHOP START] userId=${userId} workshopId=${workshopId} productId=${productId} slot=${slotIndex}`);

    res.json({
      success: true,
      message: `開始製作「${recipe.productName}」！`,
      job: {
        productId,
        productName: recipe.productName,
        status: 'processing',
        slotIndex,
        startedAt: now,
        finishAt,
        remainingWheat,
      },
    });
  } catch (err: any) {
    console.error('[WORKSHOP START ERROR]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// POST /api/workshop/collect
// 領取加工完成品
// ============================================================
router.post('/collect', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ success: false, message: '缺少 jobId' });

    // 取得 job
    const jobRows = await db.execute(
      `SELECT id, workshop_id as workshopId, product_id as productId,
              product_name as productName, status, slot_index as slotIndex,
              started_at as startedAt, finish_at as finishAt
       FROM processing_jobs WHERE id = ? AND user_id = ?`,
      [jobId, userId]
    );
    const job = jobRows.rows?.[0];
    if (!job) return res.status(404).json({ success: false, message: '找不到加工記錄' });

    const now = Date.now();
    if (job.status !== 'completed') {
      if (now < job.finishAt) {
        const remaining = Math.ceil((job.finishAt - now) / 1000);
        return res.status(400).json({
          success: false,
          message: `尚未完成！還需 ${Math.floor(remaining / 60)} 分 ${remaining % 60} 秒`,
        });
      }
    }

    const recipe = WORKSHOP_RECIPES[job.productId];
    if (!recipe) return res.status(404).json({ success: false, message: '配方不存在' });

    // 產物進背包（processed 類型，item_id 用 FLOUR_ITEM_ID）
    const existingProcessedRows = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'processed' AND item_id = ?`,
      [userId, FLOUR_ITEM_ID]
    );
    if (existingProcessedRows.rows?.[0]) {
      await db.execute(
        `UPDATE inventories SET amount = amount + 1 WHERE id = ?`,
        [existingProcessedRows.rows[0].id]
      );
    } else {
      await db.execute(
        `INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'processed', ?, 1)`,
        [userId, FLOUR_ITEM_ID]
      );
    }

    // 更新 job 為已領取
    await db.execute(
      `UPDATE processing_jobs SET status = 'collected', collected_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, jobId]
    );

    // 給予經驗值（如果有）
    let newExp = 0;
    let newLevel = 0;
    let leveledUp = false;
    if (recipe.expReward > 0) {
      const userRows2 = await db.execute(`SELECT exp, level FROM users WHERE id = ?`, [userId]);
      const user = userRows2.rows?.[0];
      if (user) {
        newExp = user.exp + recipe.expReward;
        newLevel = user.level;
        // 等級曲線：使用 GDD 01_核心數值.xlsx 等級表
        const expTable = [0, 100, 220, 360, 520, 700, 900, 1120, 1360, 1620, 1920, 2260, 2640, 3060, 3520, 4020, 4570, 5170, 5820, 6520, 7320, 8220, 9220, 10320, 11520, 12820, 14220, 15720, 17320, 19020];
        while (newLevel < expTable.length - 1 && newExp >= expTable[newLevel]) {
          newLevel++;
          leveledUp = true;
        }
        await db.execute(`UPDATE users SET exp = ?, level = ? WHERE id = ?`, [newExp, newLevel, userId]);
      }
    }

    // 更新 workshop updated_at
    await db.execute(`UPDATE processing_workshops SET updated_at = ? WHERE id = ?`, [now, job.workshopId]);

    console.log(`[WORKSHOP COLLECT] userId=${userId} jobId=${jobId} product=${job.productName}`);

    res.json({
      success: true,
      message: `領取「${job.productName}」成功！${recipe.expReward > 0 ? ` +${recipe.expReward} 經驗` : ''}`,
      collected: { productId: job.productId, productName: job.productName },
      expReward: recipe.expReward,
      leveledUp,
      user: leveledUp ? { level: newLevel, exp: newExp } : undefined,
    });
  } catch (err: any) {
    console.error('[WORKSHOP COLLECT ERROR]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
