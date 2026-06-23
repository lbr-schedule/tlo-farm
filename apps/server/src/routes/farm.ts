import { Router, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const DEBUG = false;

const router = Router();

// 更新任務進度的輔助函數
async function updateTaskProgress(userId: number, type: 'harvest' | 'complete_order', cropId?: number) {
  try {
    const today = new Date();
    // 計算今日時間戳範圍（台北時區 UTC+8）
    // 台北時區是 UTC+8，所以 00:00 台北時間 = 前一天 16:00 UTC
    const taipeiDateStr = today.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const [year, month, day] = taipeiDateStr.split('-').map(Number);
    const todayStart = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - (8 * 60 * 60 * 1000);
    const todayEnd = Date.UTC(year, month - 1, day, 0, 0, 0, 0) + (16 * 60 * 60 * 1000) - 1;
    
    // 確定要更新的 task keys
    const taskKeys: string[] = [];
    if (type === 'harvest') {
      taskKeys.push('harvest_any');
      if (cropId === 1) {
        taskKeys.push('harvest_wheat');
      }
    } else if (type === 'complete_order') {
      taskKeys.push('complete_order');
    }
    
    console.log(`[QUEST PROGRESS UPDATE REQUEST] userId=${userId} type=${type} cropId=${cropId} taskKeys=${JSON.stringify(taskKeys)}`);
    
    // 每日任務定義（需與 tasks.ts 同步）
    const taskTargets: Record<string, number> = {
      'harvest_wheat': 10,
      'harvest_any': 20,
      'complete_order': 3,
    };
    
    for (const taskKey of taskKeys) {
      const target = taskTargets[taskKey];
      if (!target) continue;
      
      // 查詢目前進度（用 timestamp 範圍查詢）
      const existingResult = await db.execute(
        `SELECT id, progress FROM task_progress
         WHERE user_id = ? AND task_key = ? AND updated_at >= ? AND updated_at <= ?`,
        [userId, taskKey, todayStart, todayEnd]
      );
      const existing = existingResult.rows?.[0];
      const beforeProgress = existing?.progress ?? 0;
      
      if (existing) {
        // 已存在，增加 progress（不超過 target）
        const newProgress = Math.min(existing.progress + 1, target);
        await db.execute(
          `UPDATE task_progress SET progress = ?, updated_at = ? WHERE id = ?`,
          [newProgress, Date.now(), existing.id]
        );
        console.log(`[QUEST PROGRESS UPDATED] taskKey=${taskKey} before=${beforeProgress} after=${newProgress}`);
      } else {
        // 不存在，建立新記錄
        await db.execute(
          `INSERT INTO task_progress (user_id, task_key, progress, claimed, updated_at)
           VALUES (?, ?, 1, 0, ?)`,
          [userId, taskKey, Date.now()]
        );
        console.log(`[QUEST PROGRESS UPDATED] taskKey=${taskKey} before=0 after=1 (new record)`);
      }
    }
  } catch (e) {
    console.error('[updateTaskProgress] error:', e);
  }
}

// 欄位名稱對應（資料庫底層底線命名）
const USERS_FIELDS = 'id, account, nickname, email, level, exp, gold, backpack_capacity as backpackCapacity, created_at as createdAt, last_login_at as lastLoginAt';
const TILES_FIELDS = 'id, user_id as userId, x, y, crop_id as cropId, planted_at as plantedAt, finish_at as finishAt, watered_at as wateredAt, is_fertilized as isFertilized, fertilized_at as fertilizedAt, fertilizer_type as fertilizerType, fertilizer_speed_bonus as fertilizerSpeedBonus, dry_started_at as dryStartedAt, state';

// 應用層級鎖：防止同一玩家的併發播種請求
const plantLocks = new Map<number, Promise<any>>();

// 農地狀態校正：確保資料一致性
function normalizeFarmTile(tile: any): any {
  if (!tile) return tile;
  // 如果有 cropId，finishAt 必須存在，否則視為壞資料直接清空
  if (tile.cropId != null) {
    const finishMs = tile.finishAt
      ? (typeof tile.finishAt === 'number' ? tile.finishAt : new Date(tile.finishAt).getTime())
      : null;
    if (finishMs === null) {
      // 損壞資料：cropId 有值但 finishAt 為空，直接重置為 empty
      console.warn(`[normalizeFarmTile] 修復損壞農地: x=${tile.x} y=${tile.y} cropId=${tile.cropId} finishAt=null → 重置為 empty`);
      return {
        ...tile,
        cropId: null,
        plantedAt: null,
        finishAt: null,
        wateredAt: null,
        isFertilized: 0,
        fertilizedAt: null,
        dryStartedAt: null,
        state: 'empty'
      };
    }
    return tile;
  }
  // cropId == null：全部重置為 empty 預設值
  return {
    ...tile,
    plantedAt: null,
    finishAt: null,
    wateredAt: null,
    isFertilized: 0,
    fertilizedAt: null,
    dryStartedAt: null,
    state: 'empty'
  };
}


function acquirePlantLock(userId: number, operation: () => Promise<any>): Promise<any> {
  // 如果已有鎖，排入佇列等待
  const existingLock = plantLocks.get(userId);
  const newLock = (existingLock || Promise.resolve())
    .then(() => operation())
    .finally(() => {
      if (plantLocks.get(userId) === newLock) {
        plantLocks.delete(userId);
      }
    });
  plantLocks.set(userId, newLock);
  return newLock;
}

// 應用層級鎖：防止同一玩家的併發收成請求
const harvestLocks = new Map<number, Promise<any>>();

function acquireHarvestLock(userId: number, operation: () => Promise<any>): Promise<any> {
  const existingLock = harvestLocks.get(userId);
  const newLock = (existingLock || Promise.resolve())
    .then(() => operation())
    .finally(() => {
      if (harvestLocks.get(userId) === newLock) {
        harvestLocks.delete(userId);
      }
    });
  harvestLocks.set(userId, newLock);
  return newLock;
}

// 取得農場狀態
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const userRows = await db.execute(
      `SELECT ${USERS_FIELDS} FROM users WHERE id = ?`, [userId]
    );
    const user = userRows.rows[0];
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

        const tileRows = await db.execute(
      `SELECT ${TILES_FIELDS} FROM farm_tiles WHERE user_id = ?`, [userId]
    );
    console.log(`[Status] userId=${userId} tilesCount=${tileRows.rows.length}`, tileRows.rows.map((t: any) => `(${t.x},${t.y}:${t.state})`).join(', '));

    // 如果沒有農地，自動初始化 6 塊（3x2）
    if (tileRows.rows.length === 0) {
      const GRID_COLS = 3;
      const GRID_ROWS = 2;
      for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
          await db.execute(
            `INSERT INTO farm_tiles (user_id, x, y, state) VALUES (?, ?, ?, 'empty')`,
            [userId, x, y]
          );
        }
      }
      // 重新取得
      const newTileRows = await db.execute(
        `SELECT ${TILES_FIELDS} FROM farm_tiles WHERE user_id = ?`, [userId]
      );
      console.log(`[Status] After INSERT, tiles re-fetched: count=${newTileRows.rows.length}`);
      tileRows.rows = newTileRows.rows;
    }

    // 狀態校正：修復損壞的農地資料
    const normalizedTiles = tileRows.rows.map((tile: any) => normalizeFarmTile(tile));

    // 寫回修復後的 empty 狀態（損壞的 tile 直接清空）
    for (const tile of normalizedTiles) {
      if (tile.cropId === null && tile.state !== 'empty') {
        await db.execute(
          `UPDATE farm_tiles SET crop_id = NULL, planted_at = NULL, finish_at = NULL, watered_at = NULL, is_fertilized = 0, fertilized_at = NULL, dry_started_at = NULL, state = 'empty' WHERE id = ?`,
          [tile.id]
        );
      }
    }

    const tilesWithTime = normalizedTiles.map((tile: any) => ({
      id: tile.id,
      x: tile.x,
      y: tile.y,
      cropId: tile.cropId,
      plantedAt: tile.plantedAt ? new Date(tile.plantedAt).getTime() : null,
      finishAt: tile.finishAt ? new Date(tile.finishAt).getTime() : null,
      wateredAt: tile.wateredAt ? new Date(tile.wateredAt).getTime() : null,
      isFertilized: tile.isFertilized ?? 0,
      fertilizedAt: tile.fertilizedAt ? new Date(tile.fertilizedAt).getTime() : null,
      fertilizerType: tile.fertilizerType ?? 'normal',
      fertilizerSpeedBonus: tile.fertilizerSpeedBonus ?? 20,
      state: tile.state,
      dryStartedAt: tile.dryStartedAt ? new Date(tile.dryStartedAt).getTime() : null,
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

    if (x === undefined || y === undefined || cropId === undefined) {
      return res.status(400).json({ success: false, message: '缺少必要參數' });
    }

    if (x < 0 || x >= 16 || y < 0 || y >= 16) {
      return res.status(400).json({ success: false, message: '無效的座標' });
    }

    // 檢查作物是否存在
    const cropRows = await db.execute(
      `SELECT id, name_zh_tw as nameZhTw, grow_time_sec as growTimeSec, sell_price as sellPrice, buy_price as buyPrice, exp FROM crops WHERE id = ?`, [cropId]
    );
    const crop = cropRows.rows[0];
    if (!crop) {
      return res.status(404).json({ success: false, message: '作物不存在' });
    }

    // 使用應用層級鎖確保同一玩家的播種請求序列化
    const plantResult = await acquirePlantLock(userId, async () => {
      // 檢查玩家是否有足夠的種子
      const seedInvRows = await db.execute(
        `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'seed' AND item_id = ?`,
        [userId, cropId]
      );
      const seedItem = seedInvRows.rows[0];
      const seedBefore = seedItem ? seedItem.amount : 0;
      console.log(`[PLANT START] userId=${userId} cropId=${cropId} tileX=${x} tileY=${y}`);
      console.log(`[SEED BEFORE PLANT] userId=${userId} cropId=${cropId} seedQuantity=${seedBefore}`);
      if (!seedItem || seedItem.amount < 1) {
        throw new Error('背包沒有這個種子');
      }

      // 檢查土地是否已有作物
      const existingRows = await db.execute(
        `SELECT id, state FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
      );
      const existingTile = existingRows.rows[0];

      if (existingTile && existingTile.state !== 'empty') {
        throw new Error('這格已經有東西了');
      }

      const now = Date.now();
      const finishAt = now + crop.growTimeSec * 1000;


      // 扣除背包中的種子（不扣金幣）
      const seedDeleted = seedItem.amount === 1;
      if (seedDeleted) {
        await db.execute(`DELETE FROM inventories WHERE id = ?`, [seedItem.id]);
      } else {
        await db.execute(`UPDATE inventories SET amount = amount - 1 WHERE id = ?`, [seedItem.id]);
      }

      // 取得扣除後的庫存
      const afterResult = await db.execute(
        `SELECT amount FROM inventories WHERE user_id = ? AND item_type = 'seed' AND item_id = ?`,
        [userId, cropId]
      );
      const seedAfter = afterResult.rows?.[0]?.amount || 0;
      console.log(`[SEED AFTER PLANT] userId=${userId} cropId=${cropId} seedQuantity=${seedAfter}`);

      // 更新或創建土地（播種後需要澆水+施肥，初始為生長中狀態，但客戶端會根據條件顯示乾燥）- 如果失敗則補償種子
      try {
        if (existingTile) {
          await db.execute(
            `UPDATE farm_tiles SET crop_id = ?, planted_at = ?, finish_at = ?, watered_at = ?, is_fertilized = ?, fertilized_at = ?, dry_started_at = ?, state = ? WHERE id = ?`,
            [cropId, now, finishAt, null, 0, null, null, 'growing', existingTile.id]
          );
        } else {
          await db.execute(
            `INSERT INTO farm_tiles (user_id, x, y, crop_id, planted_at, finish_at, watered_at, is_fertilized, fertilized_at, dry_started_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, x, y, cropId, now, finishAt, null, 0, null, null, 'growing']
          );
        }
      } catch (tileErr) {
        // 補償：恢復種子
        if (seedDeleted) {
          await db.execute(
            `INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'seed', ?, 1)`,
            [userId, cropId]
          );
        } else {
          await db.execute(`UPDATE inventories SET amount = amount + 1 WHERE id = ?`, [seedItem.id]);
        }
        throw tileErr;
      }

      console.log(`[Plant] ✅ seed deducted for userId=${userId} x=${x} y=${y} cropId=${cropId}`);
      return { plantedAt: now, finishAt };
    });

    // 更新後的玩家資料（在 transaction 外）
    const updatedRows = await db.execute(
      `SELECT ${USERS_FIELDS} FROM users WHERE id = ?`, [userId]
    );
    const updatedUser = updatedRows.rows[0];

    return res.json({
      success: true,
      message: `種植了${crop.nameZhTw}！`,
      user: {
        id: updatedUser.id,
        nickname: updatedUser.nickname,
        level: updatedUser.level,
        exp: updatedUser.exp,
        gold: updatedUser.gold
      },
      tile: {
        x,
        y,
        cropId,
        plantedAt: plantResult.plantedAt,
        finishAt: plantResult.finishAt,
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

    // 使用應用層級鎖確保同一玩家的收成請求序列化
    const harvestData = await acquireHarvestLock(userId, async () => {
      const now = Date.now();
      console.log('[HARVEST API REQUEST]', { userId, body: req.body });

      const tileRows = await db.execute(
        `SELECT ${TILES_FIELDS} FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
      );
      const rawTile = tileRows.rows[0];

      if (!rawTile) {
        console.warn('[HARVEST API REJECT]', { reason: 'tile not found', userId, x, y, now });
        throw { status: 404, message: '土地不存在' };
      }

      // ── 狀態校正（防止損壞資料）──
      const tile = normalizeFarmTile(rawTile);
      console.log('[HARVEST API TILE]', {
        tileId: tile.id, x: tile.x, y: tile.y,
        cropId: tile.cropId, state: tile.state,
        finishAt: tile.finishAt, now,
      });

      // ── 基本合法性檢查 ──
      if (!tile.cropId || tile.cropId == null) {
        console.warn('[HARVEST API REJECT]', {
          reason: 'no cropId', cropId: tile.cropId,
          state: tile.state, finishAt: tile.finishAt, now,
        });
        throw { status: 400, message: '這格沒有東西可以收成' };
      }

      // finishAt 為空 = 損壞資料，拒絕收成
      const finishMs = tile.finishAt
        ? (typeof tile.finishAt === 'number' ? tile.finishAt : new Date(tile.finishAt).getTime())
        : null;
      if (finishMs === null) {
        console.warn('[HARVEST API REJECT]', {
          reason: 'finishAt null', cropId: tile.cropId,
          state: tile.state, finishAt: tile.finishAt, now,
        });
        throw { status: 400, message: '這格沒有東西可以收成' };
      }

      // ── 判斷是否可收成：state=mature/ready 或 finishAt 時間已到（任何狀態）──
      const isTimeUp = finishMs <= now;
      const canHarvest = tile.state === 'mature' || tile.state === 'ready' || isTimeUp;

      if (!canHarvest) {
        const remaining = finishMs - now;
        console.warn('[HARVEST API REJECT]', {
          reason: `not mature, remaining=${Math.ceil(remaining / 1000)}s`,
          cropId: tile.cropId, state: tile.state,
          finishAt: tile.finishAt, now, isTimeUp, remainingMs: remaining,
        });
        if (remaining > 0) {
          throw { status: 400, message: `還需要 ${Math.ceil(remaining / 1000)} 秒才能收成` };
        }
        throw { status: 400, message: '這格沒有東西可以收成' };
      }

      console.log('[HARVEST API SUCCESS]', {
        tileId: tile.id, x: tile.x, y: tile.y,
        cropId: tile.cropId, state: tile.state, isTimeUp,
      });

      const cropRows = await db.execute(
        `SELECT id, name_zh_tw as nameZhTw, sell_price as sellPrice, exp FROM crops WHERE id = ?`, [tile.cropId]
      );
      const crop = cropRows.rows[0];
      if (!crop) {
        throw { status: 404, message: '作物資料不存在' };
      }

      const userRows = await db.execute(
        `SELECT ${USERS_FIELDS} FROM users WHERE id = ?`, [userId]
      );
      const user = userRows.rows[0];
      if (!user) {
        throw { status: 404, message: '用戶不存在' };
      }

      let newExp = user.exp + crop.exp;
      let newLevel = user.level;
      let leveledUp = false;


      const expForLevel = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
      while (newLevel < expForLevel.length && newExp >= expForLevel[newLevel]) {
        newLevel++;
        leveledUp = true;
      }

      await db.execute(
        `UPDATE users SET exp = ?, level = ? WHERE id = ?`,
        [newExp, newLevel, userId]
      );

      await db.execute(
        `UPDATE farm_tiles SET crop_id = NULL, planted_at = NULL, finish_at = NULL, watered_at = NULL, is_fertilized = 0, fertilized_at = NULL, dry_started_at = NULL, fertilizer_type = 'normal', fertilizer_speed_bonus = 20, state = 'empty' WHERE id = ?`,
        [tile.id]
      );

      // 增加道具到背包
      const invRows = await db.execute(
        `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'crop' AND item_id = ?`,
        [userId, crop.id]
      );
      const existingInv = invRows.rows[0];

      if (existingInv) {
        await db.execute(
          `UPDATE inventories SET amount = amount + 1 WHERE id = ?`, [existingInv.id]
        );
      } else {
        await db.execute(
          `INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'crop', ?, 1)`,
          [userId, crop.id]
        );
      }

      const updatedRows = await db.execute(
        `SELECT ${USERS_FIELDS} FROM users WHERE id = ?`, [userId]
      );
      const updatedUser = updatedRows.rows[0];
      console.log(`[HARVEST SUCCESS] userId=${userId} x=${x} y=${y} cropId=${crop.id}`);

      // 更新每日任務進度
      await updateTaskProgress(userId, 'harvest', crop.id);

      return {
        success: true,
        message: `收成成功！獲得 ${crop.exp} 經驗！`,
        harvest: {
          cropId: crop.id,
          cropName: crop.nameZhTw,
          goldEarned: 0,
          expEarned: crop.exp
        },
        leveledUp,
        user: {
          id: updatedUser.id,
          nickname: updatedUser.nickname,
          level: updatedUser.level,
          exp: updatedUser.exp,
          gold: updatedUser.gold
        },
        tile: {
          x,
          y,
          state: 'empty'
        }
      };
    });

    return res.json(harvestData);
  } catch (error) {
    console.error('收成錯誤:', error);
    if (error && error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
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

    const tileRows = await db.execute(
      `SELECT id, state, crop_id as cropId, is_fertilized as isFertilized, watered_at as wateredAt FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
    );
    const tile = tileRows.rows[0];
    console.log(`[Water] userId=${userId} x=${x} y=${y} tile=${JSON.stringify(tile)}`);

    if (!tile) {
      return res.status(400).json({ success: false, message: `找不到 tile (userId=${userId}, x=${x}, y=${y})` });
    }
    if (tile.state === 'empty') {
      return res.status(400).json({ success: false, message: ` tile state=empty (cropId=${tile.cropId})` });
    }
    if (tile.state === 'mature') {
      return res.status(400).json({ success: false, message: '這裡的作物已經成熟了' });
    }
    if (tile.state === 'withered') {
      return res.status(400).json({ success: false, message: '枯萎的作物無法澆水' });
    }

    const now = Date.now();

    // ── DRY 恢復邏輯 ──
    let newState = tile.state;
    let newDryStartedAt = tile.dryStartedAt;
    if (tile.state === 'dry') {
      newState = 'growing';
      newDryStartedAt = null;
      console.log(`[Water] DRY RECOVER: x=${x} y=${y} dry→growing`);
    }

    await db.execute(
      `UPDATE farm_tiles SET watered_at = ?, state = ?, dry_started_at = ? WHERE user_id = ? AND x = ? AND y = ?`,
      [now, newState, newDryStartedAt, userId, x, y]
    );

    console.log(`[Water SUCCESS] x=${x} y=${y} stateBefore=${tile.state} stateAfter=${newState} wateredAt=${now}`);
    return res.json({
      success: true,
      message: newState === 'growing' ? '澆水成功！作物已恢復成長' : '澆水成功！',
      wateredAt: now,
      state: newState,
      dryStartedAt: newDryStartedAt
    });
  } catch (error) {
    console.error('澆水錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 施肥（普通肥料：必要照顧，非加速道具）
router.post('/fertilize', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { x, y } = req.body;

    if (x === undefined || y === undefined) {
      return res.status(400).json({ success: false, message: '缺少座標' });
    }

    const tileRows = await db.execute(
      `SELECT ${TILES_FIELDS} FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
    );
    const tile = tileRows.rows[0];
    console.log(`[Fertilize] userId=${userId} x=${x} y=${y} tile=${JSON.stringify(tile)}`);

    if (!tile) {
      return res.status(404).json({ success: false, message: '土地不存在' });
    }

    if (!tile.cropId) {
      return res.status(400).json({ success: false, message: '這格沒有作物' });
    }

    if (tile.isFertilized === 1) {
      return res.status(400).json({ success: false, message: '本作物已施肥' });
    }

    if (tile.state === 'mature') {
      return res.status(400).json({ success: false, message: '成熟作物無需施肥' });
    }

    if (tile.state === 'withered') {
      return res.status(400).json({ success: false, message: '枯萎作物無法施肥' });
    }

    if (tile.state !== 'growing' && tile.state !== 'dry') {
      return res.status(400).json({ success: false, message: '只有成長中或營養不良的作物才能施肥' });
    }

    // 檢查金幣是否足夠（普通肥料：10 金幣）
    const userRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const user = userRows.rows[0];
    if (!user || user.gold < 10) {
      return res.status(400).json({ success: false, message: '金幣不足！需要 10 金幣' });
    }

    const now = Date.now();

    // ── DRY 恢復邏輯 ──
    let newState = tile.state;
    let newDryStartedAt = tile.dryStartedAt;
    if (tile.state === 'dry') {
      newState = 'growing';
      newDryStartedAt = null;
      console.log(`[Fertilize] DRY RECOVER: x=${x} y=${y} dry→growing`);
    }

    // ── 檢查並扣除肥料道具庫存 ──
    const FERTILIZER_ITEM_ID = 1; // 普通肥料的 items.id
    const invBeforeRows = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'item' AND item_id = ?`,
      [userId, FERTILIZER_ITEM_ID]
    );
    const invBefore = invBeforeRows.rows[0];
    const amountBefore = invBefore ? invBefore.amount : 0;
    if (DEBUG) { console.log('[FERTILIZE API BEFORE INVENTORY]', {
      userId, fertilizerItemId: FERTILIZER_ITEM_ID, amountBefore,
    }); }

    if (!invBefore || invBefore.amount < 1) {
      throw { status: 400, message: '背包沒有普通肥料！' };
    }

    // 扣除 10 金幣
    await db.execute(`UPDATE users SET gold = gold - 10 WHERE id = ?`, [userId]);

    // 扣除 1 個肥料道具
    if (invBefore.amount === 1) {
      await db.execute(
        `DELETE FROM inventories WHERE id = ?`,
        [invBefore.id]
      );
    } else {
      await db.execute(
        `UPDATE inventories SET amount = amount - 1 WHERE id = ?`,
        [invBefore.id]
      );
    }
    const amountAfter = amountBefore - 1;
    if (DEBUG) { console.log('[FERTILIZE API AFTER INVENTORY]', {
      userId, fertilizerItemId: FERTILIZER_ITEM_ID, amountAfter,
    }); }

    // 更新農地施肥狀態 + 狀態
    await db.execute(
      `UPDATE farm_tiles SET is_fertilized = 1, fertilized_at = ?, fertilizer_type = 'normal', fertilizer_speed_bonus = 20, state = ?, dry_started_at = ? WHERE user_id = ? AND x = ? AND y = ?`,
      [now, newState, newDryStartedAt, userId, x, y]
    );

    console.log(`[Fertilize SUCCESS] x=${x} y=${y} stateBefore=${tile.state} stateAfter=${newState} fertilizedAt=${now}`);
    return res.json({
      success: true,
      tile: {
        x,
        y,
        cropId: tile.cropId,
        isFertilized: 1,
        state: newState,
        dryStartedAt: newDryStartedAt
      },
      gold: user.gold - 10,
      message: newState === 'growing' ? '施肥成功！作物已恢復成長' : '施肥成功！',
      state: newState,
      dryStartedAt: newDryStartedAt
    });
  } catch (error) {
    console.error('施肥錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 清除枯萎作物
router.post('/clear-withered', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { x, y } = req.body;

    if (x === undefined || y === undefined) {
      return res.status(400).json({ success: false, message: '缺少座標' });
    }

    const tileRows = await db.execute(
      `SELECT id, state FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
    );
    const tile = tileRows.rows[0];

    if (!tile) {
      return res.status(404).json({ success: false, message: '土地不存在' });
    }

    if (tile.state !== 'withered') {
      return res.status(400).json({ success: false, message: '只能清除枯萎的作物' });
    }

    // 清除農地狀態
    await db.execute(
      `UPDATE farm_tiles SET crop_id = NULL, planted_at = NULL, finish_at = NULL, watered_at = NULL, is_fertilized = 0, fertilized_at = NULL, dry_started_at = NULL, fertilizer_type = 'normal', fertilizer_speed_bonus = 20, state = 'empty' WHERE id = ?`,
      [tile.id]
    );

    return res.json({
      success: true,
      message: '已清除枯萎的作物'
    });
  } catch (error) {
    console.error('清除枯萎錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 查詢作物清單
router.get('/crops', async (_req, res: Response) => {
  try {
    const cropRows = await db.execute(
      `SELECT id, name_zh_tw as nameZhTw, grow_time_sec as growTimeSec, sell_price as sellPrice, buy_price as buyPrice, exp, sprite, required_level as requiredLevel FROM crops`
    );

    return res.json({
      success: true,
      message: '成功',
      crops: cropRows.rows
    });
  } catch (error) {
    console.error('查詢作物錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 更新 tile 狀態（供客戶端同步 dry/withered 等狀態）
router.post('/tile/update', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { x, y, state, dryStartedAt } = req.body;

    if (x === undefined || y === undefined) {
      return res.status(400).json({ success: false, message: '缺少座標' });
    }

    const tileRows = await db.execute(
      `SELECT id FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
    );
    const tile = tileRows.rows[0];
    if (!tile) {
      return res.status(404).json({ success: false, message: '土地不存在' });
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (state !== undefined) {
      updates.push('state = ?');
      values.push(state);
    }
    if (dryStartedAt !== undefined) {
      updates.push('dry_started_at = ?');
      values.push(dryStartedAt);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '沒有需要更新的欄位' });
    }

    values.push(tile.id);
    await db.execute(
      `UPDATE farm_tiles SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('tile/update 錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ── 重置農場（除錯用：刪除所有 tile，讓用戶重新開始）──
router.post('/reset', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    await db.execute(`DELETE FROM farm_tiles WHERE user_id = ?`, [userId]);

    // 重新初始化 6 格空地
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        await db.execute(
          `INSERT OR IGNORE INTO farm_tiles (user_id, x, y, state) VALUES (?, ?, ?, 'empty')`,
          [userId, x, y]
        );
      }
    }

    return res.json({ success: true, message: '農場已重置' });
  } catch (error) {
    console.error('重置錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;