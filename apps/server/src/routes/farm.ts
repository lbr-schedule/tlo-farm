import { Router, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const DEBUG = false;

const router = Router();

// 更新任務進度的輔助函數
async function updateTaskProgress(userId: number, type: 'harvest' | 'complete_order', cropId?: number) {
  try {
    const today = new Date();
    const taipeiDateStr = today.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const [year, month, day] = taipeiDateStr.split('-').map(Number);
    const todayStart = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - (8 * 60 * 60 * 1000);
    const todayEnd = Date.UTC(year, month - 1, day, 0, 0, 0, 0) + (16 * 60 * 60 * 1000) - 1;

    const taskKeys: string[] = [];
    if (type === 'harvest') {
      taskKeys.push('harvest_any');
      if (cropId === 1) taskKeys.push('harvest_wheat');
    } else if (type === 'complete_order') {
      taskKeys.push('complete_order');
    }

    const taskTargets: Record<string, number> = {
      'harvest_wheat': 10,
      'harvest_any': 20,
      'complete_order': 3,
    };

    for (const taskKey of taskKeys) {
      const target = taskTargets[taskKey];
      if (!target) continue;

      const existingResult = await db.execute(
        `SELECT id, progress FROM task_progress
         WHERE user_id = ? AND task_key = ? AND updated_at >= ? AND updated_at <= ?`,
        [userId, taskKey, todayStart, todayEnd]
      );
      const existing = existingResult.rows?.[0];

      if (existing) {
        const newProgress = Math.min(existing.progress + 1, target);
        await db.execute(
          `UPDATE task_progress SET progress = ?, updated_at = ? WHERE id = ?`,
          [newProgress, Date.now(), existing.id]
        );
      } else {
        await db.execute(
          `INSERT INTO task_progress (user_id, task_key, progress, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
          [userId, taskKey, todayStart, todayEnd]
        );
      }
    }
  } catch (e) {
    console.error('[updateTaskProgress] error', e);
  }
}

// ============================================================
// 農地解鎖規則（來自 GDD 02_建築系統.xlsx 最新版）
// ============================================================
interface PlotUnlockRule {
  from: number;
  to: number;
  level: number;
  gold: number;
  materials: Record<string, number>; // material_name → amount
}

const PLOT_UNLOCK_RULES: PlotUnlockRule[] = [
  { from: 6,  to: 8,  level: 1,  gold: 200,    materials: {} },
  { from: 8,  to: 10, level: 3,  gold: 500,    materials: {} },
  { from: 10, to: 12, level: 8,  gold: 1800,   materials: {} },
  { from: 12, to: 14, level: 15, gold: 6500,   materials: { '木材': 3 } },
  { from: 14, to: 16, level: 25, gold: 19500,  materials: { '木材': 10, '石材': 3 } },
  { from: 16, to: 18, level: 35, gold: 40500,  materials: { '木板': 5, '鐵礦': 2 } },
  { from: 18, to: 20, level: 45, gold: 69500,  materials: { '木板': 10, '鐵釘': 3 } },
  { from: 20, to: 22, level: 55, gold: 117000, materials: { '工具包': 2, '螺絲組': 1 } },
  { from: 22, to: 24, level: 65, gold: 151500, materials: { '工具包': 3, '螺絲組': 2 } },
];

function getNextUnlockRule(plotCount: number): PlotUnlockRule | null {
  return PLOT_UNLOCK_RULES.find(r => r.from === plotCount) ?? null;
}

function getMaxPlotForLevel(level: number): number {
  let max = 6;
  for (const rule of PLOT_UNLOCK_RULES) {
    if (level >= rule.level) max = rule.to;
    else break;
  }
  return max;
}

// ============================================================
// GET /api/farm/plots
// ============================================================
router.get('/plots', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    // 確保 player_farm_plots 表存在（第一次呼叫時自動建立）
    await db.execute(
      `CREATE TABLE IF NOT EXISTS player_farm_plots (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL,
        slot_index  INTEGER NOT NULL,
        tile_x      INTEGER,
        tile_y      INTEGER,
        unlocked_at INTEGER NOT NULL,
        placed_at   INTEGER,
        UNIQUE(user_id, slot_index)
      )`
    );

    // 遷移該玩家的 farm_tiles（如尚未遷移）
    await migrateFarmTilesToPlots(userId);

    // 取得玩家資料
    const userResult = await db.execute(`SELECT level, gold, plot_count FROM users WHERE id = ?`, [userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ success: false, message: '玩家不存在' });

    const plotCount = user.plot_count ?? 6;
    const level = user.level ?? 1;
    const gold = user.gold ?? 0;
    const levelAllowedMax = getMaxPlotForLevel(level);
    // 回傳 actual level 方便前端顯示
    void level; // 已用於 levelAllowedMax
    const nextRule = getNextUnlockRule(plotCount);

    // 檢查材料是否足夠
    let hasEnoughMaterials = true;
    let materialList: { name: string; required: number; have: number }[] = [];
    if (nextRule && Object.keys(nextRule.materials).length > 0) {
      for (const [matName, required] of Object.entries(nextRule.materials)) {
        // 先用 item_key 或 name 查 items 表找 id，再查 inventories
        const itemResult = await db.execute(
          `SELECT id FROM items WHERE item_key = ? OR name_zh_tw = ? LIMIT 1`,
          [matName, matName]
        );
        const item = itemResult.rows[0];
        if (!item) { hasEnoughMaterials = false; break; }
        const invResult = await db.execute(
          `SELECT amount FROM inventories WHERE user_id = ? AND item_type = 'item' AND item_id = ?`,
          [userId, item.id]
        );
        const have = invResult.rows[0]?.amount ?? 0;
        materialList.push({ name: matName, required, have });
        if (have < required) hasEnoughMaterials = false;
      }
    }

    const canUnlock = !!nextRule && level >= nextRule.level && gold >= nextRule.gold && hasEnoughMaterials;

    // 取得所有農地槽位
    const plotsResult = await db.execute(
      `SELECT slot_index as slotIndex, tile_x as tileX, tile_y as tileY, placed_at as placedAt
       FROM player_farm_plots WHERE user_id = ? ORDER BY slot_index ASC`,
      [userId]
    );
    const plots = (plotsResult.rows || []).map((p: any) => ({
      slotIndex: p.slotIndex,
      tileX: p.tileX,
      tileY: p.tileY,
      placed: p.tileX !== null && p.tileY !== null,
    }));

    return res.json({
      success: true,
      level,
      plotCount,
      levelAllowedMax,
      gold,
      nextUnlockRule: nextRule ? {
        from: nextRule.from,
        to: nextRule.to,
        level: nextRule.level,
        gold: nextRule.gold,
        materials: nextRule.materials,
      } : null,
      canUnlock,
      materialList: materialList.length > 0 ? materialList : null,
      plots,
    });
  } catch (error) {
    console.error('[GET /plots] error', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ============================================================
// POST /api/farm/plots/unlock
// ============================================================
router.post('/plots/unlock', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const userResult = await db.execute(`SELECT level, gold, plot_count FROM users WHERE id = ?`, [userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ success: false, message: '玩家不存在' });

    const plotCount = user.plot_count ?? 6;
    const level = user.level ?? 1;
    const gold = user.gold ?? 0;
    const nextRule = getNextUnlockRule(plotCount);

    // 檢查是否已達上限
    if (!nextRule) {
      return res.json({ success: false, message: '已達農地最大數量上限' });
    }

    // 檢查等級
    if (level < nextRule.level) {
      return res.json({ success: false, message: `需要 Lv${nextRule.level} 才能解鎖` });
    }

    // 檢查金幣
    if (gold < nextRule.gold) {
      return res.json({ success: false, message: '金幣不足' });
    }

    // 檢查並扣建築材料
    if (Object.keys(nextRule.materials).length > 0) {
      for (const [matName, required] of Object.entries(nextRule.materials)) {
        const itemResult = await db.execute(
          `SELECT id FROM items WHERE item_key = ? OR name_zh_tw = ? LIMIT 1`,
          [matName, matName]
        );
        const item = itemResult.rows[0];
        if (!item) {
          return res.json({ success: false, message: `缺少建築材料：${matName}` });
        }
        const invResult = await db.execute(
          `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'item' AND item_id = ?`,
          [userId, item.id]
        );
        const inv = invResult.rows[0];
        if (!inv || inv.amount < required) {
          return res.json({ success: false, message: `材料不足：${matName} 需要 ${required}` });
        }
        // 扣材料
        await db.execute(
          `UPDATE inventories SET amount = amount - ? WHERE id = ?`,
          [required, inv.id]
        );
      }
    }

    // 扣金幣
    await db.execute(`UPDATE users SET gold = gold - ? WHERE id = ?`, [nextRule.gold, userId]);

    // 更新 plot_count
    await db.execute(`UPDATE users SET plot_count = ? WHERE id = ?`, [nextRule.to, userId]);

    // 新增農地槽位（已解鎖但未放置）
    const now = Date.now();
    for (let i = plotCount; i < nextRule.to; i++) {
      await db.execute(
        `INSERT OR IGNORE INTO player_farm_plots (user_id, slot_index, tile_x, tile_y, unlocked_at, placed_at)
         VALUES (?, ?, NULL, NULL, ?, NULL)`,
        [userId, i, now]
      );
    }

    // 回傳最新農地狀態
    const plotsResult = await db.execute(
      `SELECT slot_index as slotIndex, tile_x as tileX, tile_y as tileY, placed_at as placedAt
       FROM player_farm_plots WHERE user_id = ? ORDER BY slot_index ASC`,
      [userId]
    );
    const plots = (plotsResult.rows || []).map((p: any) => ({
      slotIndex: p.slotIndex,
      tileX: p.tileX,
      tileY: p.tileY,
      placed: p.tileX !== null && p.tileY !== null,
    }));

    const newUserResult = await db.execute(`SELECT gold, plot_count FROM users WHERE id = ?`, [userId]);
    const newUser = newUserResult.rows[0];

    return res.json({
      success: true,
      message: `農地已擴充至 ${nextRule.to} 塊`,
      plotCount: newUser.plot_count,
      gold: newUser.gold,
      plots,
    });
  } catch (error) {
    console.error('[POST /plots/unlock] error', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ============================================================
// POST /api/farm/plots/place
// ============================================================
router.post('/plots/place', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { slotIndex, tileX, tileY } = req.body;

    if (slotIndex === undefined || tileX === undefined || tileY === undefined) {
      return res.status(400).json({ success: false, message: '缺少必要參數' });
    }

    // 檢查 slot 是否屬於該玩家且已解鎖
    const slotResult = await db.execute(
      `SELECT slot_index, tile_x, tile_y FROM player_farm_plots WHERE user_id = ? AND slot_index = ?`,
      [userId, slotIndex]
    );
    const slot = slotResult.rows[0];
    if (!slot) {
      return res.json({ success: false, message: '農地槽位不存在' });
    }

    // 檢查是否已放置
    if (slot.tile_x !== null && slot.tile_y !== null) {
      return res.json({ success: false, message: '農地已放置' });
    }

    // 檢查範圍 16x16
    if (tileX < 0 || tileX > 15 || tileY < 0 || tileY > 15) {
      return res.json({ success: false, message: '座標超出農場範圍' });
    }

    // 檢查農地重疊（其他已放置的農地）
    const farmOverlap = await db.execute(
      `SELECT slot_index FROM player_farm_plots
       WHERE user_id = ? AND tile_x = ? AND tile_y = ? AND tile_x IS NOT NULL`,
      [userId, tileX, tileY]
    );
    if ((farmOverlap.rows || []).length > 0) {
      return res.json({ success: false, message: '此格已有農地' });
    }

    // 檢查雞舍重疊（雞舍是 2x2）
    // 雞舍佔用 (tile_x_placed, tile_y_placed) 到 (tile_x_placed+1, tile_y_placed+1)
    const coopResult = await db.execute(
      `SELECT id, tile_x_placed, tile_y_placed FROM chicken_buildings
       WHERE user_id = ? AND tile_x_placed IS NOT NULL`,
      [userId]
    );
    const coop = coopResult.rows[0];
    if (coop) {
      const cx = coop.tile_x_placed;
      const cy = coop.tile_y_placed;
      // 雞舍 2x2 的四格
      const coopTiles = [
        [cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]
      ];
      for (const [ox, oy] of coopTiles) {
        if (tileX === ox && tileY === oy) {
          return res.json({ success: false, message: '此格已有建築' });
        }
      }
    }

    // 通過所有檢查，放置農地
    const now = Date.now();
    await db.execute(
      `UPDATE player_farm_plots SET tile_x = ?, tile_y = ?, placed_at = ? WHERE user_id = ? AND slot_index = ?`,
      [tileX, tileY, now, userId, slotIndex]
    );

    return res.json({
      success: true,
      message: '農地放置成功',
      slotIndex,
      tileX,
      tileY,
    });
  } catch (error) {
    console.error('[POST /plots/place] error', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ============================================================
// 現有農地上下文（保持不變）====================================

const TILES_FIELDS = `id, user_id as userId, x, y, crop_id as cropId, state,
  planted_at as plantedAt, finish_at as finishAt, watered_at as wateredAt,
  is_fertilized as isFertilized, fertilized_at as fertilizedAt,
  dry_started_at as dryStartedAt, fertilizer_type as fertilizerType,
  fertilizer_speed_bonus as fertilizerSpeedBonus`;

// 初始化農地（保證有6格）
async function ensureFarmTiles(userId: number) {
  const existing = await db.execute(
    `SELECT id FROM farm_tiles WHERE user_id = ?`, [userId]
  );
  if ((existing.rows || []).length === 0) {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        await db.execute(
          `INSERT OR IGNORE INTO farm_tiles (user_id, x, y, state) VALUES (?, ?, ?, 'empty')`,
          [userId, x, y]
        );
      }
    }
  }
}

// 遷移現有 farm_tiles 到 player_farm_plots
async function migrateFarmTilesToPlots(userId: number) {
  // 檢查是否已有遷移記錄
  const existing = await db.execute(
    `SELECT COUNT(*) as cnt FROM player_farm_plots WHERE user_id = ?`, [userId]
  );
  if ((existing.rows?.[0]?.cnt ?? 0) > 0) return;

  const tiles = await db.execute(
    `SELECT x, y FROM farm_tiles WHERE user_id = ? ORDER BY y ASC, x ASC`, [userId]
  );
  const now = Date.now();
  for (const tile of tiles.rows || []) {
    await db.execute(
      `INSERT OR IGNORE INTO player_farm_plots (user_id, slot_index, tile_x, tile_y, unlocked_at, placed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, (tile.y * 3 + tile.x), tile.x, tile.y, now, now]
    );
  }
}

// ============================================================
// GET /api/farm/status — 給 FarmScene.syncFarmState() 回傳農地同步狀態
// ============================================================
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    await ensureFarmTiles(userId);
    await migrateFarmTilesToPlots(userId);

    const tilesResult = await db.execute(
      `SELECT ${TILES_FIELDS} FROM farm_tiles WHERE user_id = ?`, [userId]
    );

    return res.json({
      success: true,
      tiles: tilesResult.rows || [],
    });
  } catch (error) {
    console.error('[GET /status] error', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});
// 讀取農地狀態
router.get('/tiles', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    await ensureFarmTiles(userId);
    await migrateFarmTilesToPlots(userId);

    const tilesResult = await db.execute(
      `SELECT ${TILES_FIELDS} FROM farm_tiles WHERE user_id = ?`, [userId]
    );
    const plotsResult = await db.execute(
      `SELECT slot_index as slotIndex, tile_x as tileX, tile_y as tileY
       FROM player_farm_plots WHERE user_id = ? AND tile_x IS NOT NULL ORDER BY slot_index`,
      [userId]
    );

    return res.json({
      success: true,
      tiles: tilesResult.rows || [],
      plots: plotsResult.rows || [],
    });
  } catch (error) {
    console.error('[GET /tiles] error', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 種植
router.post('/plant', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { x, y, cropId } = req.body;
    if (x === undefined || y === undefined || !cropId) {
      return res.status(400).json({ success: false, message: '缺少參數' });
    }

    const tileRows = await db.execute(
      `SELECT id, state FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
    );
    if ((tileRows.rows || []).length === 0) {
      return res.status(404).json({ success: false, message: '土地不存在' });
    }
    const tile = tileRows.rows[0];
    if (tile.state !== 'empty') {
      return res.status(400).json({ success: false, message: '此地已有作物' });
    }

    const cropResult = await db.execute(
      `SELECT id, name_zh_tw as name FROM crops WHERE id = ?`, [cropId]
    );
    if ((cropResult.rows || []).length === 0) {
      return res.status(404).json({ success: false, message: '無效的作物' });
    }

    const now = Date.now();
    const growTimeSec = 120;
    const finishAt = now + growTimeSec * 1000;

    await db.execute(
      `UPDATE farm_tiles SET crop_id = ?, planted_at = ?, finish_at = ?, watered_at = ?, state = 'seed' WHERE id = ?`,
      [cropId, now, finishAt, now, tile.id]
    );

    return res.json({ success: true, message: '播種成功', finishAt });
  } catch (error) {
    console.error('[POST /plant] error', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 收成
router.post('/harvest', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { x, y } = req.body;
    if (x === undefined || y === undefined) {
      return res.status(400).json({ success: false, message: '缺少座標' });
    }

    const tileRows = await db.execute(
      `SELECT id, crop_id as cropId, state, finish_at as finishAt FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`,
      [userId, x, y]
    );
    if ((tileRows.rows || []).length === 0) {
      return res.status(404).json({ success: false, message: '土地不存在' });
    }
    const tile = tileRows.rows[0];

    if (!tile.cropId || tile.state === 'empty') {
      return res.status(400).json({ success: false, message: '此地無作物可收成' });
    }
    // 用 finish_at 到期判斷成熟，不用 state 欄位
    const isReadyByTime = tile.finishAt && Date.now() >= Number(tile.finishAt);
    if (!isReadyByTime) {
      return res.status(400).json({ success: false, message: '作物尚未成熟' });
    }

    const cropResult = await db.execute(
      `SELECT name_zh_tw as name, harvest_yield as harvestYield, exp FROM crops WHERE id = ?`, [tile.cropId]
    );
    const crop = cropResult.rows[0];

    const expReward = crop.exp ?? 0;
    const harvestYield = crop.harvestYield ?? 1;

    const beforeResult = await db.execute(`SELECT exp, level, gold FROM users WHERE id = ?`, [userId]);
    const before = beforeResult.rows[0];
    let newExp = before.exp + expReward;
    let newLevel = before.level;
    const expForLevel = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
    while (newLevel < expForLevel.length && newExp >= expForLevel[newLevel]) {
      newLevel++;
    }

    await db.execute(`UPDATE users SET exp = ?, level = ? WHERE id = ?`, [newExp, newLevel, userId]);

    const invResult = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'crop' AND item_id = ?`,
      [userId, tile.cropId]
    );
    if ((invResult.rows || []).length > 0) {
      await db.execute(`UPDATE inventories SET amount = amount + ? WHERE id = ?`, [harvestYield, invResult.rows[0].id]);
    } else {
      await db.execute(`INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'crop', ?, ?)`, [userId, tile.cropId, harvestYield]);
    }

    await db.execute(
      `UPDATE farm_tiles SET crop_id = NULL, planted_at = NULL, finish_at = NULL, watered_at = NULL,
       is_fertilized = 0, fertilized_at = NULL, dry_started_at = NULL,
       fertilizer_type = 'normal', fertilizer_speed_bonus = 20, state = 'empty' WHERE id = ?`,
      [tile.id]
    );

    await updateTaskProgress(userId, 'harvest', tile.cropId);

    return res.json({
      success: true,
      harvest: { cropName: crop.name, harvestYield, exp: expReward },
      exp: expReward,
      user: { level: newLevel, exp: newExp },
    });
  } catch (error) {
    console.error('[POST /harvest] error', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 澆水
router.post('/water', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { x, y } = req.body;
    if (x === undefined || y === undefined) {
      return res.status(400).json({ success: false, message: '缺少座標' });
    }

    const tileRows = await db.execute(
      `SELECT id, state, is_watered as isWatered FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`,
      [userId, x, y]
    );
    if ((tileRows.rows || []).length === 0) {
      return res.status(404).json({ success: false, message: '土地不存在' });
    }
    const tile = tileRows.rows[0];

    if (tile.state === 'empty') {
      return res.status(400).json({ success: false, message: '此地無作物' });
    }
    if (tile.isWatered) {
      return res.status(400).json({ success: false, message: '今日已澆水' });
    }

    await db.execute(
      `UPDATE farm_tiles SET watered_at = ?, is_watered = 1 WHERE user_id = ? AND x = ? AND y = ?`,
      [Date.now(), userId, x, y]
    );

    return res.json({ success: true, message: '澆水成功' });
  } catch (error) {
    console.error('[POST /water] error', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 更新 tile 狀態
router.post('/tile/update', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { x, y, state, dryStartedAt } = req.body;
    if (x === undefined || y === undefined) {
      return res.status(400).json({ success: false, message: '缺少座標' });
    }

    const tileRows = await db.execute(
      `SELECT id FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?`, [userId, x, y]
    );
    const tile = tileRows.rows[0];
    if (!tile) return res.status(404).json({ success: false, message: '土地不存在' });

    const updates: string[] = [];
    const values: any[] = [];
    if (state !== undefined) { updates.push('state = ?'); values.push(state); }
    if (dryStartedAt !== undefined) { updates.push('dry_started_at = ?'); values.push(dryStartedAt); }
    if (updates.length === 0) return res.status(400).json({ success: false, message: '沒有需要更新的欄位' });

    values.push(tile.id);
    await db.execute(`UPDATE farm_tiles SET ${updates.join(', ')} WHERE id = ?`, values);
    return res.json({ success: true });
  } catch (error) {
    console.error('[tile/update] error', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 重置農場
router.post('/reset', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });
    await db.execute(`DELETE FROM farm_tiles WHERE user_id = ?`, [userId]);
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
    console.error('[reset] error', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;