import { Router, type Router as RouterType, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const CHICKEN_BABY_GROW_TIME = 60;   // seconds
const CHICKEN_PRODUCTION_TIME = 900; // seconds
const CHICKEN_BUY_PRICE = 50;        // gold
const COOP_PRICE = 500;              // gold
const CHICK_FEED_ITEM_ID = 2;        // feed_normal items.id
const EGG_CROP_ID = 9;               // egg crop id
const MAX_CHICKEN_SLOTS = 4;

const router: RouterType = Router();

// Helper: ensure building + 4 slots exist for user
async function ensureChickenData(userId: number) {
  // Upsert building
  const existing = await db.execute(
    `SELECT id FROM chicken_buildings WHERE user_id = ?`, [userId]
  );
  if (!existing.rows || existing.rows.length === 0) {
    await db.execute(
      `INSERT INTO chicken_buildings (user_id, unlocked_at) VALUES (?, ?)`,
      [userId, Date.now()]
    );
  }

  // Ensure 4 slots exist
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

// GET /api/animals/chicken-coop — get coop status
router.get('/chicken-coop', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    await ensureChickenData(userId);

    const buildingRows = await db.execute(
      `SELECT id, unlocked_at as unlockedAt, tile_x as tileX, tile_y as tileY, created_at as createdAt FROM chicken_buildings WHERE user_id = ?`, [userId]
    );
    const building = buildingRows.rows[0];

    const slotRows = await db.execute(
      `SELECT id, slot_index as slotIndex, state, feed_applied_at as feedAppliedAt, produced_at as producedAt FROM chicken_slots WHERE user_id = ? ORDER BY slot_index`, [userId]
    );

    const slots = slotRows.rows.map((s: any) => ({
      index: s.slotIndex,
      state: s.state,
      feedAppliedAt: s.feedAppliedAt ? new Date(s.feedAppliedAt).getTime() : null,
      producedAt: s.producedAt ? new Date(s.producedAt).getTime() : null,
    }));

    // Get current gold
    const goldRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const currentGold = goldRows.rows[0]?.gold ?? 0;

    return res.json({ success: true, building, slots, gold: currentGold });
  } catch (error) {
    console.error('[Chicken Coop] get error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// POST /api/animals/chicken-coop/place — place chicken coop on farm
router.post('/chicken-coop/place', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { tileX, tileY } = req.body;
    if (tileX === undefined || tileY === undefined) {
      return res.status(400).json({ success: false, message: '缺少座標' });
    }

    // Validate tile bounds
    if (tileX < 0 || tileX >= 16 || tileY < 0 || tileY >= 16) {
      return res.status(400).json({ success: false, message: '無效的座標' });
    }

    // Check if building already placed
    const existingBuilding = await db.execute(
      `SELECT id, tile_x as tileX, tile_y as tileY FROM chicken_buildings WHERE user_id = ?`, [userId]
    );
    if (existingBuilding.rows && existingBuilding.rows.length > 0) {
      const b = existingBuilding.rows[0];
      // Already placed — return idempotent success with full state (no re-deduction)
      if (b.tileX !== 0 || b.tileY !== 0 || b.tileX != null) {
        // Get current gold
        const goldRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
        const currentGold = goldRows.rows[0]?.gold ?? 0;
        // Get chicken count
        const slotRows = await db.execute(
          `SELECT id FROM chicken_slots WHERE user_id = ? AND state != 'EMPTY'`,
          [userId]
        );
        const chickenCount = slotRows.rows?.length ?? 0;
        console.log(`[Chicken Coop] Already placed at (${b.tileX}, ${b.tileY}) — idempotent sync for user ${userId}`);
        return res.json({
          success: true,
          alreadyPlaced: true,
          message: '雞舍已經放置過了',
          building: { tileX: b.tileX, tileY: b.tileY },
          gold: currentGold,
          livestockState: {
            hasChickenCoop: true,
            pendingChickenCoop: false,
            placedChickenCoop: true,
            chickenCoopCapacity: 4,
            chickenCount,
          },
        });
      }
    }

    // Check no conflict with existing farmland tiles (3x2 grid at top-left corner of 16x16)
    // Farmland occupies x=0,1,2 and y=0,1 (3×2 grid)
    // Coop is 2×2, check all 4 cells don't overlap with farmland
    const farmlandCells = [
      [tileX, tileY], [tileX + 1, tileY],
      [tileX, tileY + 1], [tileX + 1, tileY + 1]
    ];
    for (const [cx, cy] of farmlandCells) {
      // farmland tiles are at x=0,1,2 and y=0,1
      if (cx >= 0 && cx <= 2 && cy >= 0 && cy <= 1) {
        return res.status(400).json({ success: false, message: '雞舍不能放在農地上' });
      }
    }

    // Check gold before deduction
    const goldBeforeRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const goldBefore = goldBeforeRows.rows[0]?.gold ?? 0;
    if (goldBefore < COOP_PRICE) {
      return res.status(400).json({ success: false, message: '金幣不足' });
    }

    // Deduct gold
    await db.execute(`UPDATE users SET gold = gold - ? WHERE id = ?`, [COOP_PRICE, userId]);

    // Upsert building with position
    await db.execute(
      `INSERT INTO chicken_buildings (user_id, tile_x, tile_y, unlocked_at, is_placed) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET tile_x = excluded.tile_x, tile_y = excluded.tile_y, is_placed = 1, updated_at = ?`,
      [userId, tileX, tileY, Date.now(), Date.now()]
    );

    const newGold = goldBefore - COOP_PRICE;
    console.log(`[Chicken Coop] Placed at (${tileX}, ${tileY}) for user ${userId} — gold ${goldBefore} → ${newGold}`);

    return res.json({
      success: true,
      message: `雞舍放置成功！`,
      building: { tileX, tileY },
      gold: newGold,
    });
  } catch (error) {
    console.error('[Chicken Coop] place error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// GET /api/animals/chicken-coop/status — live status with remaining times
router.get('/chicken-coop/status', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    await ensureChickenData(userId);

    const buildingRows = await db.execute(
      `SELECT tile_x as tileX, tile_y as tileY FROM chicken_buildings WHERE user_id = ?`, [userId]
    );
    const building = buildingRows.rows[0];

    const slotRows = await db.execute(
      `SELECT id, slot_index as slotIndex, state, feed_applied_at as feedAppliedAt, produced_at as producedAt, created_at as createdAt FROM chicken_slots WHERE user_id = ? ORDER BY slot_index`, [userId]
    );

    const now = Date.now();
    // Auto-transition states server-side
    for (const s of slotRows.rows as any[]) {
      if (s.state === 'BABY') {
        const createdAt = s.createdAt ? new Date(s.createdAt).getTime() : now;
        const elapsed = (now - createdAt) / 1000;
        if (elapsed >= CHICKEN_BABY_GROW_TIME) {
          await db.execute(
            `UPDATE chicken_slots SET state = 'READY_TO_FEED', updated_at = ? WHERE id = ?`,
            [now, s.id]
          );
          s.state = 'READY_TO_FEED';
        }
      } else if (s.state === 'PRODUCING') {
        const feedAt = s.feedAppliedAt ? new Date(s.feedAppliedAt).getTime() : now;
        const elapsed = (now - feedAt) / 1000;
        if (elapsed >= CHICKEN_PRODUCTION_TIME) {
          await db.execute(
            `UPDATE chicken_slots SET state = 'READY_TO_COLLECT', produced_at = ?, updated_at = ? WHERE id = ?`,
            [now, now, s.id]
          );
          s.state = 'READY_TO_COLLECT';
        }
      }
    }

    const slots = slotRows.rows.map((s: any) => {
      let remainingSec: number | null = null;
      let progress = 0;

      if (s.state === 'BABY') {
        const createdAt = s.createdAt ? new Date(s.createdAt).getTime() : now;
        const elapsed = (now - createdAt) / 1000;
        const total = CHICKEN_BABY_GROW_TIME;
        progress = Math.min(1, elapsed / total);
        remainingSec = Math.max(0, Math.ceil(total - elapsed));
      } else if (s.state === 'PRODUCING') {
        const feedAt = s.feedAppliedAt ? new Date(s.feedAppliedAt).getTime() : now;
        const elapsed = (now - feedAt) / 1000;
        const total = CHICKEN_PRODUCTION_TIME;
        progress = Math.min(1, elapsed / total);
        remainingSec = Math.max(0, Math.ceil(total - elapsed));
      } else if (s.state === 'READY_TO_FEED' || s.state === 'READY_TO_COLLECT') {
        progress = 1;
        remainingSec = 0;
      }

      return {
        index: s.slotIndex,
        state: s.state,
        progress,
        remainingSec,
        feedAppliedAt: s.feedAppliedAt ? new Date(s.feedAppliedAt).getTime() : null,
        producedAt: s.producedAt ? new Date(s.producedAt).getTime() : null,
      };
    });

    // Get current gold
    const goldRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const currentGold = goldRows.rows[0]?.gold ?? 0;

    return res.json({
      success: true,
      hasBuilding: !!(building && building.tileX != null && building.tileY != null),
      tileX: building?.tileX ?? null,
      tileY: building?.tileY ?? null,
      slots,
      gold: currentGold,
    });
  } catch (error) {
    console.error('[Chicken Coop] status error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// POST /api/animals/chicken-coop/buy — buy a baby chick
router.post('/chicken-coop/buy', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    await ensureChickenData(userId);

    // Check if building is placed
    const buildingRows = await db.execute(
      `SELECT tile_x as tileX, tile_y as tileY FROM chicken_buildings WHERE user_id = ?`, [userId]
    );
    const building = buildingRows.rows[0];
    if (!building || building.tileX == null || building.tileY == null) {
      return res.status(400).json({ success: false, message: '請先放置雞舍！' });
    }

    // Check user gold
    const userRows = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const user = userRows.rows[0];
    if (!user || user.gold < CHICKEN_BUY_PRICE) {
      return res.status(400).json({ success: false, message: `金幣不足！需要 ${CHICKEN_BUY_PRICE} 金幣` });
    }

    // Find first empty slot
    const emptySlots = await db.execute(
      `SELECT id, slot_index as slotIndex FROM chicken_slots WHERE user_id = ? AND state = 'EMPTY' ORDER BY slot_index LIMIT 1`,
      [userId]
    );
    if (!emptySlots.rows || emptySlots.rows.length === 0) {
      return res.status(400).json({ success: false, message: '雞舍已滿！最多容納 4 隻雞' });
    }
    const emptySlot = emptySlots.rows[0];

    // Deduct gold
    await db.execute(`UPDATE users SET gold = gold - ? WHERE id = ?`, [CHICKEN_BUY_PRICE, userId]);

    // Place chick
    await db.execute(
      `UPDATE chicken_slots SET state = 'BABY', baby_born_at = ?, updated_at = ? WHERE id = ?`,
      [Date.now(), Date.now(), emptySlot.id]
    );

    const updatedGold = user.gold - CHICKEN_BUY_PRICE;

    return res.json({
      success: true,
      message: `購買了小雞！花費 ${CHICKEN_BUY_PRICE} 金幣`,
      slot: { index: emptySlot.slotIndex, state: 'BABY' },
      gold: updatedGold,
    });
  } catch (error) {
    console.error('[Chicken Coop] buy error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// POST /api/animals/chicken-coop/feed — feed a chicken
router.post('/chicken-coop/feed', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { slotIndex } = req.body;
    if (slotIndex === undefined) {
      return res.status(400).json({ success: false, message: '缺少 slotIndex' });
    }

    // Check slot state
    const slotRows = await db.execute(
      `SELECT id, state FROM chicken_slots WHERE user_id = ? AND slot_index = ?`, [userId, slotIndex]
    );
    const slot = slotRows.rows[0];
    if (!slot) {
      return res.status(404).json({ success: false, message: '槽位不存在' });
    }
    if (slot.state !== 'READY_TO_FEED') {
      return res.status(400).json({ success: false, message: '這隻雞還不需要餵食' });
    }

    // Check feed inventory
    const invRows = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'item' AND item_id = ?`,
      [userId, CHICK_FEED_ITEM_ID]
    );
    const invItem = invRows.rows[0];
    if (!invItem || invItem.amount < 1) {
      return res.status(400).json({ success: false, message: '背包沒有普通飼料！' });
    }

    // Consume feed
    if (invItem.amount === 1) {
      await db.execute(`DELETE FROM inventories WHERE id = ?`, [invItem.id]);
    } else {
      await db.execute(`UPDATE inventories SET amount = amount - 1 WHERE id = ?`, [invItem.id]);
    }

    // Update slot to PRODUCING
    await db.execute(
      `UPDATE chicken_slots SET state = 'PRODUCING', feed_applied_at = ?, updated_at = ? WHERE id = ?`,
      [Date.now(), Date.now(), slot.id]
    );

    return res.json({ success: true, message: '餵食成功！雞開始生蛋了' });
  } catch (error) {
    console.error('[Chicken Coop] feed error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// POST /api/animals/chicken-coop/feed-all — 一次餵完所有 READY_TO_FEED 的雞
router.post('/chicken-coop/feed-all', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });
    console.log('[FEED-ALL ENTRY]', { userId, body: req.body });

    // 確保雞舍資料存在
    await ensureChickenData(userId);

    // 查出所有槽位狀態（debug 用）
    const allSlotsResult = await db.execute(
      `SELECT id, slot_index, state FROM chicken_slots WHERE user_id = ? ORDER BY slot_index`,
      [userId]
    );
    console.log('[FEED-ALL ALL SLOTS]', { userId, slots: allSlotsResult.rows });

    // 找出所有 READY_TO_FEED 的槽位
    const slotRows = await db.execute(
      `SELECT id, slot_index FROM chicken_slots WHERE user_id = ? AND state = 'READY_TO_FEED'`,
      [userId]
    );
    const slots = slotRows.rows as { id: number; slot_index: number }[];
    console.log('[FEED-ALL READY_SLOTS]', { userId, slotsFound: slots.length, slotIds: slots.map(s => s.id) });

    if (slots.length === 0) {
      return res.status(400).json({ success: false, message: '沒有雞需要餵食' });
    }

    // 檢查背包普通飼料數量是否足夠
    const invRows = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'item' AND item_id = ?`,
      [userId, CHICK_FEED_ITEM_ID]
    );
    const invItem = invRows.rows[0];
    const feedBefore = invItem?.amount ?? 0;
    console.log('[FEED-ALL DEBUG]', {
      userId,
      feedableSlots: slots.length,
      requiredFeed: slots.length,
      feedBefore,
      invItemId: invItem?.id,
      invItemType: invItem ? 'item' : 'none',
    });

    if (feedBefore < slots.length) {
      return res.status(400).json({
        success: false,
        message: `普通飼料不足！需要 ${slots.length} 包，背包有 ${feedBefore} 包`,
        debug: { feedBefore, slotsNeeded: slots.length }
      });
    }

    // 扣除所需飼料（一次扣 slots.length 份）
    const feedAfter = invItem.amount - slots.length;
    console.log('[FEED-ALL DEDUCT]', { feedBefore, feedAfter, deductAmount: slots.length, invId: invItem.id });
    if (invItem.amount === slots.length) {
      await db.execute(`DELETE FROM inventories WHERE id = ?`, [invItem.id]);
    } else {
      await db.execute(
        `UPDATE inventories SET amount = amount - ? WHERE id = ?`,
        [slots.length, invItem.id]
      );
    }

    // 對每個 READY_TO_FEED 槽位更新為 PRODUCING
    for (const slot of slots) {
      await db.execute(
        `UPDATE chicken_slots SET state = 'PRODUCING', feed_applied_at = ?, updated_at = ? WHERE id = ?`,
        [Date.now(), Date.now(), slot.id]
      );
    }

    // 查更新後的槽位狀態
    const updatedSlotsResult = await db.execute(
      `SELECT id, slot_index, state FROM chicken_slots WHERE user_id = ? ORDER BY slot_index`,
      [userId]
    );
    console.log('[FEED-ALL SUCCESS]', {
      userId,
      feedableSlots: slots.length,
      requiredFeed: slots.length,
      feedBefore,
      feedAfter,
      updatedSlots: updatedSlotsResult.rows,
    });

    return res.json({ success: true, message: `餵食成功！扣了 ${slots.length} 包普通飼料`, feedDeducted: slots.length, feedBefore, feedAfter, slotsUpdated: slots.length });
  } catch (error) {
    console.error('[Chicken Coop] feed-all error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// POST /api/animals/chicken-coop/collect — collect egg and reset to READY_TO_FEED
router.post('/chicken-coop/collect', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { slotIndex } = req.body;
    if (slotIndex === undefined) {
      return res.status(400).json({ success: false, message: '缺少 slotIndex' });
    }

    // Check slot state
    const slotRows = await db.execute(
      `SELECT id, state FROM chicken_slots WHERE user_id = ? AND slot_index = ?`, [userId, slotIndex]
    );
    const slot = slotRows.rows[0];
    if (!slot) {
      return res.status(404).json({ success: false, message: '槽位不存在' });
    }
    if (slot.state !== 'READY_TO_COLLECT') {
      return res.status(400).json({ success: false, message: '這隻雞還沒有生出蛋' });
    }

    // Add egg to inventory (livestock type, item_id = 1 — consistent with sell API)
    const EGG_ITEM_ID = 1;
    const eggInvRows = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'livestock' AND item_id = ?`,
      [userId, EGG_ITEM_ID]
    );
    const existingEgg = eggInvRows.rows[0];
    if (existingEgg) {
      await db.execute(`UPDATE inventories SET amount = amount + 1 WHERE id = ?`, [existingEgg.id]);
    } else {
      await db.execute(
        `INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'livestock', ?, 1)`,
        [userId, EGG_ITEM_ID]
      );
    }

    // Reset slot to READY_TO_FEED
    await db.execute(
      `UPDATE chicken_slots SET state = 'READY_TO_FEED', produced_at = NULL, updated_at = ? WHERE id = ?`,
      [Date.now(), slot.id]
    );

    return res.json({ success: true, message: '收取了 1 個雞蛋！', eggAdded: 1 });
  } catch (error) {
    console.error('[Chicken Coop] collect error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// POST /api/animals/chicken-coop/collect-all — 一次收集所有可收雞蛋
router.post('/chicken-coop/collect-all', async (req: AuthRequest, res: Response) => {
  try {
    console.log('[COLLECT-ALL ENTRY]', { userId: req.userId, body: req.body });
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { eggCount } = req.body;
    if (typeof eggCount !== 'number' || eggCount <= 0) {
      return res.status(400).json({ success: false, message: '沒有雞蛋可收取', debug: { eggCount, reason: 'eggCount not positive or not number' } });
    }

    // 確保雞舍資料存在
    await ensureChickenData(userId);

    // 查出所有槽位狀態（debug 用）
    const allSlotsResult = await db.execute(
      `SELECT id, slot_index, state FROM chicken_slots WHERE user_id = ? ORDER BY slot_index`,
      [userId]
    );
    console.log('[COLLECT-ALL ALL SLOTS]', { userId, slots: allSlotsResult.rows });

    // 找出所有 READY_TO_COLLECT 的槽位
    const slotRows = await db.execute(
      `SELECT id, slot_index, state, feed_applied_at, produced_at FROM chicken_slots WHERE user_id = ? AND state = 'READY_TO_COLLECT'`,
      [userId]
    );

    if (slotRows.rows.length === 0) {
      return res.status(400).json({ success: false, message: '沒有雞蛋可收取', debug: { userId, eggCount, reason: 'no READY_TO_COLLECT slots found' } });
    }

    const slots = slotRows.rows as { id: number; slot_index: number; state: string; feed_applied_at: number; produced_at: number }[];
    console.log('[COLLECT-ALL ENTRY]', {
      userId,
      bodyEggCount: eggCount,
      readySlots: slots.map(s => ({ id: s.id, slot_index: s.slot_index, state: s.state })),
    });

    // 檢查雞蛋庫存（用於 log）— 雞蛋 item_id = 1（與 sell API 一致）
    const EGG_ITEM_ID = 1;
    const eggInvRows = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'livestock' AND item_id = ?`,
      [userId, EGG_ITEM_ID]
    );
    const eggBefore = (eggInvRows.rows[0] as any)?.amount ?? 0;
    console.log('[COLLECT-ALL DEBUG]', {
      userId,
      eggCount,
      slotsFound: slots.length,
      slots: slots.map(s => ({ id: s.id, state: s.state, produced_at: s.produced_at })),
      eggBefore,
    });

    // 對每個 READY_TO_COLLECT 槽位：加雞蛋進庫存、重置槽位
    for (const slot of slots) {
      const eggInvRows2 = await db.execute(
        `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'livestock' AND item_id = ?`,
        [userId, EGG_ITEM_ID]
      );
      const existingEgg = eggInvRows2.rows[0];
      if (existingEgg) {
        await db.execute(`UPDATE inventories SET amount = amount + 1 WHERE id = ?`, [existingEgg.id]);
      } else {
        await db.execute(
          `INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'livestock', ?, 1)`,
          [userId, EGG_ITEM_ID]
        );
      }
      await db.execute(
        `UPDATE chicken_slots SET state = 'READY_TO_FEED', produced_at = NULL, updated_at = ? WHERE id = ?`,
        [Date.now(), slot.id]
      );
    }

    // 查更新後的庫存
    const eggAfterRows = await db.execute(
      `SELECT amount FROM inventories WHERE user_id = ? AND item_type = 'livestock' AND item_id = ?`,
      [userId, EGG_ITEM_ID]
    );
    const eggAfter = (eggAfterRows.rows[0] as any)?.amount ?? 0;
    console.log('[COLLECT-ALL SUCCESS]', { userId, slotsUpdated: slots.length, eggBefore, eggAfter, eggsAdded: slots.length });

    return res.json({ success: true, message: `收取了 ${slots.length} 個雞蛋！`, eggsAdded: slots.length, eggBefore, eggAfter });
  } catch (error) {
    console.error('[Chicken Coop] collect-all error:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;