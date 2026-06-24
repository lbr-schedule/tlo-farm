import { Router, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const CHICKEN_BABY_GROW_TIME = 60;       // seconds
const CHICKEN_PRODUCTION_TIME = 120;     // seconds
const CHICKEN_BUY_PRICE = 50;           // gold
const COOP_PRICE = 500;                 // gold
const CHICK_FEED_ITEM_ID = 2;           // feed_normal items.id
const EGG_CROP_ID = 9;                  // egg crop id
const MAX_CHICKEN_SLOTS = 4;

const router = Router();

// ============================================================
// Helper: 舊表 fallback（chicken_slots）— 永遠保留不刪
// ============================================================
async function ensureChickenData(userId: number) {
  const existing = await db.execute(
    `SELECT id FROM chicken_buildings WHERE user_id = ?`, [userId]
  );
  if (!existing.rows || existing.rows.length === 0) {
    await db.execute(
      `INSERT INTO chicken_buildings (user_id, unlocked_at) VALUES (?, ?)`,
      [userId, Date.now()]
    );
  }
  for (let i = 0; i < MAX_CHICKEN_SLOTS; i++) {
    const slotCheck = await db.execute(
      `SELECT id FROM chicken_slots WHERE user_id = ? AND slot_index = ?`, [userId, i]
    );
    if (!slotCheck.rows || slotCheck.rows.length === 0) {
      await db.execute(
        `INSERT INTO chicken_slots (user_id, slot_index, state) VALUES (?, ?, 'EMPTY')`,
        [userId, i]
      );
    }
  }
}

// ============================================================
// Helper: 確保 animal_slots 有資料（本次新增）
// 有舊 chicken_slots → 同步過來
// ============================================================
async function ensureAnimalSlots(userId: number) {
  // 確認 chicken_buildings 存在（取 area_id）
  const cbRows = await db.execute(
    `SELECT id FROM chicken_buildings WHERE user_id = ?`, [userId]
  );
  if (!cbRows.rows || cbRows.rows.length === 0) return;
  const areaId = cbRows.rows[0].id;

  for (let i = 0; i < MAX_CHICKEN_SLOTS; i++) {
    const existing = await db.execute(
      `SELECT id FROM animal_slots WHERE user_id = ? AND area_type = 'chicken_coop' AND slot_index = ?`,
      [userId, i]
    );
    if (existing.rows && existing.rows.length > 0) continue; // 已有，跳過

    // 查 chicken_slots 對應槽位
    const slotRows = await db.execute(
      `SELECT state FROM chicken_slots WHERE user_id = ? AND slot_index = ?`,
      [userId, i]
    );
    const slotState = slotRows.rows?.[0]?.state ?? 'EMPTY';
    const hasChicken = slotState !== 'EMPTY';

    if (hasChicken) {
      // 建立 animal
      const growthStage = (slotState === 'BABY') ? 'baby' : 'adult';
      const insertAnimal = await db.execute(
        `INSERT INTO animals (user_id, animal_type, animal_name, growth_stage, status, area_type, area_id, slot_index, feed_status, created_at, updated_at)
         VALUES (?, 'chicken', '小雞', ?, 'normal', 'chicken_coop', ?, ?, 'hungry', unixepoch(), unixepoch())`,
        [userId, growthStage, areaId, i]
      );
      const animalId = insertAnimal.lastInsertRowid;

      // 建立 animal_slots
      await db.execute(
        `INSERT INTO animal_slots (user_id, area_type, area_id, slot_index, animal_id, is_unlocked, created_at, updated_at)
         VALUES (?, 'chicken_coop', ?, ?, ?, 1, unixepoch(), unixepoch())`,
        [userId, areaId, i, animalId]
      );
    } else {
      // 空槽
      await db.execute(
        `INSERT INTO animal_slots (user_id, area_type, area_id, slot_index, animal_id, is_unlocked, created_at, updated_at)
         VALUES (?, 'chicken_coop', ?, ?, NULL, 1, unixepoch(), unixepoch())`,
        [userId, areaId, i]
      );
    }
  }
}

// ============================================================
// Helper: 從 animal_slots + animals 讀取雞舍狀態（帶舊表 fallback）
// ============================================================
async function getChickenSlotsNew(userId: number): Promise<any[]> {
  const now = Date.now();

  const rows = await db.execute(
    `SELECT als.id as alsId, als.slot_index as slotIndex, als.animal_id as animalId,
            a.id as aId, a.animal_name as animalName, a.growth_stage as growthStage,
            a.feed_status as feedStatus, a.last_fed_at as lastFedAt,
            a.production_ready_at as productionReadyAt, a.created_at as createdAt
     FROM animal_slots als
     LEFT JOIN animals a ON a.id = als.animal_id
     WHERE als.user_id = ? AND als.area_type = 'chicken_coop'
     ORDER BY als.slot_index`,
    [userId]
  );

  if (!rows.rows || rows.rows.length === 0) return [];

  return rows.rows.map((s: any) => {
    if (!s.animalId) {
      // 空槽
      return {
        index: s.slotIndex,
        state: 'EMPTY',
        feedAppliedAt: null,
        producedAt: null,
        animalName: null,
        growthStage: null,
        feedStatus: null,
        lastFedAt: null,
        productionReadyAt: null,
      };
    }

    // 從 animals 取狀態，計算舊版 state
    let state = 'READY_TO_FEED';
    if (s.growthStage === 'baby') {
      // 小雞成長中
      const createdAt = s.createdAt ? new Date(s.createdAt * 1000).getTime() : now;
      const elapsed = (now - createdAt) / 1000;
      if (elapsed < CHICKEN_BABY_GROW_TIME) {
        state = 'BABY';
      } else {
        state = 'READY_TO_FEED';
      }
    } else if (s.growthStage === 'adult') {
      if (s.feedStatus === 'producing') {
        // 餵食後倒數中
        const prodAt = s.lastFedAt ? new Date(s.lastFedAt * 1000).getTime() : now;
        const elapsed = (now - prodAt) / 1000;
        if (elapsed >= CHICKEN_PRODUCTION_TIME) {
          state = 'READY_TO_COLLECT';
        } else {
          state = 'PRODUCING';
        }
      } else {
        state = 'READY_TO_FEED';
      }
    }

    return {
      index: s.slotIndex,
      state,
      feedAppliedAt: s.lastFedAt ? new Date(s.lastFedAt * 1000).getTime() : null,
      producedAt: s.productionReadyAt ? new Date(s.productionReadyAt * 1000).getTime() : null,
      animalName: s.animalName,
      growthStage: s.growthStage,
      feedStatus: s.feedStatus,
      lastFedAt: s.lastFedAt ? new Date(s.lastFedAt * 1000).getTime() : null,
      productionReadyAt: s.productionReadyAt ? new Date(s.productionReadyAt * 1000).getTime() : null,
    };
  });
}

// Helper: 從舊 chicken_slots 讀取（fallback）
async function getChickenSlotsOld(userId: number): Promise<any[]> {
  const now = Date.now();
  const slotRows = await db.execute(
    `SELECT id, slot_index as slotIndex, state, feed_applied_at as feedAppliedAt,
            produced_at as producedAt, created_at as createdAt
     FROM chicken_slots WHERE user_id = ? ORDER BY slot_index`,
    [userId]
  );

  // 自動 state transition
  for (const s of (slotRows.rows || []) as any[]) {
    if (s.state === 'BABY') {
      const createdAt = s.createdAt ? new Date(s.createdAt * 1000).getTime() : now;
      const elapsed = (now - createdAt) / 1000;
      if (elapsed >= CHICKEN_BABY_GROW_TIME) {
        await db.execute(
          `UPDATE chicken_slots SET state = 'READY_TO_FEED', updated_at = ? WHERE id = ?`,
          [Math.floor(now / 1000), s.id]
        );
        s.state = 'READY_TO_FEED';
      }
    } else if (s.state === 'PRODUCING') {
      const feedAt = s.feedAppliedAt ? new Date(s.feedAppliedAt * 1000).getTime() : now;
      const elapsed = (now - feedAt) / 1000;
      if (elapsed >= CHICKEN_PRODUCTION_TIME) {
        await db.execute(
          `UPDATE chicken_slots SET state = 'READY_TO_COLLECT', produced_at = ?, updated_at = ? WHERE id = ?`,
          [Math.floor(now / 1000), Math.floor(now / 1000), s.id]
        );
        s.state = 'READY_TO_COLLECT';
      }
    }
  }

  return (slotRows.rows || []).map((s: any) => ({
    index: s.slotIndex,
    state: s.state,
    feedAppliedAt: s.feedAppliedAt ? new Date(s.feedAppliedAt).getTime() : null,
    producedAt: s.producedAt ? new Date(s.producedAt).getTime() : null,
  }));
}

// ============================================================
// GET /api/animals/chicken-coop
// ============================================================
router.get('/chicken-coop', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    await ensureChickenData(userId);
    await ensureAnimalSlots(userId);

    // 先嘗試新表
    let slots = await getChickenSlotsNew(userId);
    let usingNew = slots.length > 0;

    // fallback 舊表
    if (!usingNew) {
      slots = await getChickenSlotsOld(userId);
    }

    const buildingRows = await db.execute(
      `SELECT id, unlocked_at as unlockedAt, tile_x as tileX, tile_y as tileY, created_at as createdAt FROM chicken_buildings WHERE user_id = ?`,
      [userId]
    );
    const building = buildingRows.rows[0];

    const goldRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const currentGold = goldRows.rows[0]?.gold ?? 0;

    return res.json({ success: true, building, slots, gold: currentGold, usingNew });
  } catch (error) {
    console.error('[Chicken Coop] get error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ============================================================
// POST /api/animals/chicken-coop/place
// ============================================================
router.post('/chicken-coop/place', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { tileX, tileY } = req.body;
    if (tileX === undefined || tileY === undefined) {
      return res.status(400).json({ success: false, message: '缺少座標' });
    }

    await ensureChickenData(userId);
    await ensureAnimalSlots(userId);

    await db.execute(
      `UPDATE chicken_buildings SET tile_x = ?, tile_y = ?, updated_at = ? WHERE user_id = ?`,
      [tileX, tileY, Math.floor(Date.now() / 1000), userId]
    );

    return res.json({ success: true, message: '雞舍放置成功' });
  } catch (error) {
    console.error('[Chicken Coop] place error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ============================================================
// GET /api/animals/chicken-coop/status
// ============================================================
router.get('/chicken-coop/status', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    await ensureChickenData(userId);
    await ensureAnimalSlots(userId);

    let slots = await getChickenSlotsNew(userId);
    let usingNew = slots.length > 0;
    if (!usingNew) {
      slots = await getChickenSlotsOld(userId);
    }

    const buildingRows = await db.execute(
      `SELECT tile_x as tileX, tile_y as tileY FROM chicken_buildings WHERE user_id = ?`,
      [userId]
    );
    const building = buildingRows.rows[0];

    const goldRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const currentGold = goldRows.rows[0]?.gold ?? 0;

    return res.json({ success: true, building, slots, gold: currentGold, usingNew });
  } catch (error) {
    console.error('[Chicken Coop] status error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ============================================================
// POST /api/animals/chicken-coop/buy — 買小雞
// ============================================================
router.post('/chicken-coop/buy', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    await ensureChickenData(userId);
    await ensureAnimalSlots(userId);

    // ── 容量檢查：只看新表 animals ──────────────────────────────
    const animalCountRows = await db.execute(
      `SELECT COUNT(*) as cnt FROM animals WHERE user_id = ? AND area_type = 'chicken_coop'`,
      [userId]
    );
    const currentAnimalCount = animalCountRows.rows[0]?.cnt ?? 0;
    if (currentAnimalCount >= MAX_CHICKEN_SLOTS) {
      return res.status(400).json({ success: false, message: '雞舍已滿（4/4）' });
    }

    // 檢查 gold
    const goldRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const currentGold = goldRows.rows[0]?.gold ?? 0;
    if (currentGold < CHICKEN_BUY_PRICE) {
      return res.status(400).json({ success: false, message: '金幣不足' });
    }

    // ── 只從新表 animal_slots 找空槽 ─────────────────────────
    const slotRows = await db.execute(
      `SELECT als.id as alsId, als.slot_index as slotIndex
       FROM animal_slots als
       WHERE als.user_id = ? AND als.area_type = 'chicken_coop' AND als.animal_id IS NULL
       ORDER BY als.slot_index LIMIT 1`,
      [userId]
    );

    if (!slotRows.rows || slotRows.rows.length === 0) {
      return res.status(400).json({ success: false, message: '雞舍已滿（4/4）' });
    }

    const slot = slotRows.rows[0];
    const usingNew = true;

    // 扣金
    await db.execute(`UPDATE users SET gold = gold - ? WHERE id = ?`, [CHICKEN_BUY_PRICE, userId]);

    const now = Math.floor(Date.now() / 1000);

    // 寫新表 animals + animal_slots
    const areaRows = await db.execute(`SELECT id FROM chicken_buildings WHERE user_id = ?`, [userId]);
    const areaId = areaRows.rows[0].id;

    const insertAnimal = await db.execute(
      `INSERT INTO animals (user_id, animal_type, animal_name, growth_stage, status, area_type, area_id, slot_index, feed_status, created_at, updated_at)
       VALUES (?, 'chicken', '小雞', 'baby', 'normal', 'chicken_coop', ?, ?, 'hungry', ?, ?)`,
      [userId, areaId, slot.slotIndex, now, now]
    );
    const animalId = insertAnimal.lastInsertRowid;

    // 更新 animal_slots
    await db.execute(
      `UPDATE animal_slots SET animal_id = ?, updated_at = ? WHERE id = ?`,
      [animalId, now, slot.alsId]
    );

    // 同步寫舊表（維持相容）
    await db.execute(
      `UPDATE chicken_slots SET state = 'BABY', baby_born_at = ?, updated_at = ? WHERE user_id = ? AND slot_index = ?`,
      [now, now, userId, slot.slotIndex]
    );

    const newGold = currentGold - CHICKEN_BUY_PRICE;
    console.log(`[CHICKEN BUY] userId=${userId} slot=${slot.slotIndex} animalId=${animalId} usingNew=${usingNew}`);

    return res.json({
      success: true,
      message: '購買小雞成功！',
      slotIndex: slot.slotIndex,
      user: { gold: newGold },
      usingNew,
    });
  } catch (error) {
    console.error('[Chicken Coop] buy error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ============================================================
// POST /api/animals/chicken-coop/feed — 餵一隻雞
// ============================================================
router.post('/chicken-coop/feed', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { slotIndex } = req.body;
    if (slotIndex === undefined) {
      return res.status(400).json({ success: false, message: '缺少 slotIndex' });
    }

    // 檢查背包普通飼料
    const invRows = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'item' AND item_id = ?`,
      [userId, CHICK_FEED_ITEM_ID]
    );
    const inv = invRows.rows?.[0];
    if (!inv || inv.amount < 1) {
      return res.status(400).json({ success: false, message: '普通飼料不足！請先購買。' });
    }

    const now = Math.floor(Date.now() / 1000);

    // 優先更新新表 animals
    const animalRows = await db.execute(
      `SELECT a.id, a.growth_stage as growthStage, a.feed_status as feedStatus
       FROM animals a
       JOIN animal_slots als ON als.animal_id = a.id
       WHERE als.user_id = ? AND als.area_type = 'chicken_coop' AND als.slot_index = ?`,
      [userId, slotIndex]
    );
    let usingNew = !!(animalRows.rows && animalRows.rows.length > 0);

    if (usingNew) {
      const animal = animalRows.rows[0];
      if (animal.growthStage !== 'adult') {
        return res.status(400).json({ success: false, message: '雞還是小雞，無法餵食' });
      }
      if (animal.feedStatus === 'producing') {
        return res.status(400).json({ success: false, message: '這隻雞正在產蛋中' });
      }
      await db.execute(
        `UPDATE animals SET feed_status = 'producing', last_fed_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, animal.id]
      );
    }

    // 同步寫舊表
    const slotIdRows = await db.execute(
      `SELECT id FROM chicken_slots WHERE user_id = ? AND slot_index = ?`,
      [userId, slotIndex]
    );
    if (slotIdRows.rows && slotIdRows.rows.length > 0) {
      await db.execute(
        `UPDATE chicken_slots SET state = 'PRODUCING', feed_applied_at = ?, updated_at = ? WHERE id = ?`,
        [now * 1000, now, slotIdRows.rows[0].id]
      );
    }

    // 扣飼料
    if (inv.amount === 1) {
      await db.execute(`DELETE FROM inventories WHERE id = ?`, [inv.id]);
    } else {
      await db.execute(`UPDATE inventories SET amount = amount - 1 WHERE id = ?`, [inv.id]);
    }

    const goldRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    return res.json({
      success: true,
      message: '餵食成功！雞開始產蛋。',
      user: { gold: goldRows.rows[0]?.gold ?? 0 },
      usingNew,
    });
  } catch (error) {
    console.error('[Chicken Coop] feed error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ============================================================
// POST /api/animals/chicken-coop/feed-all
// ============================================================
router.post('/chicken-coop/feed-all', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    // 檢查背包普通飼料
    const invRows = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'item' AND item_id = ?`,
      [userId, CHICK_FEED_ITEM_ID]
    );
    const inv = invRows.rows?.[0];
    if (!inv || inv.amount < 1) {
      return res.status(400).json({ success: false, message: '普通飼料不足！請先購買。' });
    }

    const now = Math.floor(Date.now() / 1000);

    // ── 只從新表 animals 找 READY_TO_FEED 的雞 ─────────────
    const newRows = await db.execute(
      `SELECT a.id, als.slot_index as slotIndex
       FROM animals a
       JOIN animal_slots als ON als.animal_id = a.id
       WHERE als.user_id = ? AND als.area_type = 'chicken_coop'
         AND a.growth_stage = 'adult' AND a.feed_status = 'hungry'`,
      [userId]
    );

    if (!newRows.rows || newRows.rows.length === 0) {
      return res.status(400).json({ success: false, message: '沒有需要餵食的雞' });
    }

    // 更新所有 hungry 成雞
    for (const row of newRows.rows as any[]) {
      await db.execute(
        `UPDATE animals SET feed_status = 'producing', last_fed_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, row.id]
      );
    }

    // 扣飼料
    if (inv.amount === 1) {
      await db.execute(`DELETE FROM inventories WHERE id = ?`, [inv.id]);
    } else {
      await db.execute(`UPDATE inventories SET amount = amount - 1 WHERE id = ?`, [inv.id]);
    }

    const goldRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const fedCount = newRows.rows.length;
    return res.json({
      success: true,
      message: `一次餵完 ${fedCount} 隻成雞，消耗 1 個普通飼料`,
      user: { gold: goldRows.rows[0]?.gold ?? 0 },
      fedCount,
      usingNew: true,
    });
  } catch (error) {
    console.error('[Chicken Coop] feed-all error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ============================================================
// POST /api/animals/chicken-coop/collect — 收一格雞蛋
// ============================================================
router.post('/chicken-coop/collect', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { slotIndex } = req.body;
    if (slotIndex === undefined) {
      return res.status(400).json({ success: false, message: '缺少 slotIndex' });
    }

    // 確認可收（優先新表）
    const animalRows = await db.execute(
      `SELECT a.id
       FROM animals a
       JOIN animal_slots als ON als.animal_id = a.id
       WHERE als.user_id = ? AND als.area_type = 'chicken_coop' AND als.slot_index = ?`,
      [userId, slotIndex]
    );
    let usingNew = !!(animalRows.rows && animalRows.rows.length > 0);
    const now = Math.floor(Date.now() / 1000);

    if (usingNew) {
      const animal = animalRows.rows[0];
      await db.execute(
        `UPDATE animals SET feed_status = 'hungry', production_ready_at = NULL, updated_at = ? WHERE id = ?`,
        [now, animal.id]
      );
    }

    // 同步舊表
    const slotIdRows = await db.execute(
      `SELECT id FROM chicken_slots WHERE user_id = ? AND slot_index = ? AND state = 'READY_TO_COLLECT'`,
      [userId, slotIndex]
    );
    if (slotIdRows.rows && slotIdRows.rows.length > 0) {
      await db.execute(
        `UPDATE chicken_slots SET state = 'READY_TO_FEED', produced_at = NULL, updated_at = ? WHERE id = ?`,
        [now, slotIdRows.rows[0].id]
      );
    }

    // 雞蛋進背包（livestock type — 與 sell-livestock 一致）
    const eggRows = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'livestock' AND item_id = ?`,
      [userId, EGG_CROP_ID]
    );
    if (eggRows.rows && eggRows.rows.length > 0) {
      await db.execute(
        `UPDATE inventories SET amount = amount + 1 WHERE id = ?`,
        [eggRows.rows[0].id]
      );
    } else {
      await db.execute(
        `INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'livestock', ?, 1)`,
        [userId, EGG_CROP_ID]
      );
    }

    const goldRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    console.log(`[CHICKEN COLLECT] userId=${userId} slot=${slotIndex} usingNew=${usingNew}`);

    return res.json({
      success: true,
      message: '領取雞蛋成功！+1 雞蛋',
      user: { gold: goldRows.rows[0]?.gold ?? 0 },
      usingNew,
    });
  } catch (error) {
    console.error('[Chicken Coop] collect error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// ============================================================
// POST /api/animals/chicken-coop/collect-all
// ============================================================
router.post('/chicken-coop/collect-all', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const now = Math.floor(Date.now() / 1000);

    // ── 只從新表找 producing（等待收蛋）的雞 ──────────────
    const newRows = await db.execute(
      `SELECT a.id, als.slot_index as slotIndex
       FROM animals a
       JOIN animal_slots als ON als.animal_id = a.id
       WHERE als.user_id = ? AND als.area_type = 'chicken_coop'
         AND a.feed_status = 'producing'`,
      [userId]
    );

    if (!newRows.rows || newRows.rows.length === 0) {
      return res.status(400).json({ success: false, message: '還沒有雞蛋可收！' });
    }

    const count = newRows.rows.length;

    // 更新所有 producing → hungry
    for (const row of newRows.rows as any[]) {
      await db.execute(
        `UPDATE animals SET feed_status = 'hungry', production_ready_at = NULL, updated_at = ? WHERE id = ?`,
        [now, row.id]
      );
    }

    // 全部雞蛋進背包（livestock type — 與 sell-livestock 一致）
    for (let i = 0; i < count; i++) {
      const eggRows = await db.execute(
        `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'livestock' AND item_id = ?`,
        [userId, EGG_CROP_ID]
      );
      if (eggRows.rows && eggRows.rows.length > 0) {
        await db.execute(
          `UPDATE inventories SET amount = amount + 1 WHERE id = ?`,
          [eggRows.rows[0].id]
        );
      } else {
        await db.execute(
          `INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'livestock', ?, 1)`,
          [userId, EGG_CROP_ID]
        );
      }
    }

    const goldRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    return res.json({
      success: true,
      message: `一次領取 ${count} 個雞蛋！`,
      user: { gold: goldRows.rows[0]?.gold ?? 0 },
      collectedCount: count,
      usingNew: true,
    });
  } catch (error) {
    console.error('[Chicken Coop] collect-all error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;
