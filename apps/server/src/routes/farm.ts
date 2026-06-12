import { Router, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// 欄位名稱對應（資料庫底層底線命名）
const USERS_FIELDS = 'id, account, nickname, email, level, exp, gold, created_at as createdAt, last_login_at as lastLoginAt';
const TILES_FIELDS = 'id, user_id as userId, x, y, crop_id as cropId, planted_at as plantedAt, finish_at as finishAt, watered_at as wateredAt, state';

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
      tileRows.rows = newTileRows.rows;
    }

    const tilesWithTime = tileRows.rows.map((tile: any) => ({
      id: tile.id,
      x: tile.x,
      y: tile.y,
      cropId: tile.cropId,
      plantedAt: tile.plantedAt ? new Date(tile.plantedAt).getTime() : null,
      finishAt: tile.finishAt ? new Date(tile.finishAt).getTime() : null,
      wateredAt: tile.wateredAt ? new Date(tile.wateredAt).getTime() : null,
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

    // 檢查玩家金幣是否足夠
    const userRows = await db.execute(
      `SELECT id, gold FROM users WHERE id = ?`, [userId]
    );
    const user = userRows.rows[0];
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    if (user.gold < crop.buyPrice) {
      return res.status(400).json({ success: false, message: '金幣不足' });
    }

    // 檢查土地是否已有作物
    const existingRows = await db.execute(
      `SELECT id, state FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
    );
    const existingTile = existingRows.rows[0];

    if (existingTile && existingTile.state !== 'empty') {
      return res.status(400).json({ success: false, message: '這格已經有東西了' });
    }

    const now = Date.now();
    const finishAt = now + crop.growTimeSec * 1000;

    // 扣除金幣
    await db.execute(
      `UPDATE users SET gold = gold - ? WHERE id = ?`, [crop.buyPrice, userId]
    );

    // 更新或創建土地（播種後視為未澆水）
    if (existingTile) {
      await db.execute(
        `UPDATE farm_tiles SET crop_id = ?, planted_at = ?, finish_at = ?, watered_at = NULL, state = 'growing' WHERE id = ?`,
        [cropId, now, finishAt, existingTile.id]
      );
      console.log(`[Plant] UPDATE tile id=${existingTile.id} x=${x} y=${y} cropId=${cropId}`);
    } else {
      await db.execute(
        `INSERT INTO farm_tiles (user_id, x, y, crop_id, planted_at, finish_at, watered_at, state) VALUES (?, ?, ?, ?, ?, ?, NULL, 'growing')`,
        [userId, x, y, cropId, now, finishAt]
      );
      console.log(`[Plant] INSERT tile userId=${userId} x=${x} y=${y} cropId=${cropId} now=${now} finishAt=${finishAt}`);
    }

    // 更新後的玩家資料
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
        plantedAt: now,
        finishAt,
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

    const tileRows = await db.execute(
      `SELECT ${TILES_FIELDS} FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
    );
    const tile = tileRows.rows[0];

    if (!tile) {
      return res.status(404).json({ success: false, message: '土地不存在' });
    }

    // ── 判斷是否可收成：state=mature/ready 或 時間已到 ──
    const now = Date.now();
    const finishMs = tile.finishAt ? (typeof tile.finishAt === 'number' ? tile.finishAt : new Date(tile.finishAt).getTime()) : null;
    const isTimeUp = finishMs !== null && finishMs <= now;
    const canHarvest = tile.state === 'mature' || tile.state === 'ready' || tile.state === 'growing' && isTimeUp;

    if (!canHarvest) {
      if ((tile.state === 'growing' || tile.state === 'seedling') && finishMs) {
        const remaining = finishMs - now;
        if (remaining > 0) {
          return res.status(400).json({
            success: false,
            message: `還需要 ${Math.ceil(remaining / 1000)} 秒才能收成`
          });
        }
      }
      return res.status(400).json({ success: false, message: '這格沒有東西可以收成' });
    }

    const cropRows = await db.execute(
      `SELECT id, name_zh_tw as nameZhTw, sell_price as sellPrice, exp FROM crops WHERE id = ?`, [tile.cropId]
    );
    const crop = cropRows.rows[0];
    if (!crop) {
      return res.status(404).json({ success: false, message: '作物資料不存在' });
    }

    const userRows = await db.execute(
      `SELECT ${USERS_FIELDS} FROM users WHERE id = ?`, [userId]
    );
    const user = userRows.rows[0];
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
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
      `UPDATE users SET gold = gold + ?, exp = ?, level = ? WHERE id = ?`,
      [crop.sellPrice, newExp, newLevel, userId]
    );

    await db.execute(
      `UPDATE farm_tiles SET crop_id = NULL, planted_at = NULL, finish_at = NULL, watered_at = NULL, state = 'empty' WHERE id = ?`,
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

    const tileRows = await db.execute(
      `SELECT id, state, crop_id as cropId FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
    );
    const tile = tileRows.rows[0];
    console.log(`[Water] userId=${userId} x=${x} y=${y} tileRows=${JSON.stringify(tileRows.rows)} tile=${JSON.stringify(tile)}`);

    if (!tile) {
      return res.status(400).json({ success: false, message: `找不到 tile (userId=${userId}, x=${x}, y=${y})` });
    }
    if (tile.state === 'empty') {
      return res.status(400).json({ success: false, message: ` tile state=empty (cropId=${tile.cropId})` });
    }

    if (tile.state === 'ready') {
      return res.status(400).json({ success: false, message: '這裡的作物已經成熟了' });
    }

    // ── 寫入澆水時間 ──
    await db.execute(
      `UPDATE farm_tiles SET watered_at = ? WHERE user_id = ? AND x = ? AND y = ?`,
      [Date.now(), userId, x, y]
    );

    return res.json({
      success: true,
      message: '澆水成功！作物會更快成熟！',
      wateredAt: Date.now()
    });
  } catch (error) {
    console.error('澆水錯誤:', error);
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