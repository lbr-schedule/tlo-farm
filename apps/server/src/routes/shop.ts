import { Router, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// 畜牧商品定義
const LIVESTOCK_ITEMS = [
  { id: 'chicken_coop', nameZhTw: '雞舍', buyPrice: 500, requiredLevel: 5, sprite: 'chicken_coop.png', itemType: 'building', description: '解鎖雞舍建築，可養殖小雞生雞蛋' },
  { id: 'chick', nameZhTw: '小雞', buyPrice: 50, requiredLevel: 5, sprite: 'chick_baby.png', itemType: 'livestock', description: '購買小雞放入雞舍養殖' },
  { id: 'feed_normal', nameZhTw: '普通飼料', buyPrice: 10, requiredLevel: 1, sprite: 'feed_normal.png', itemType: 'consumable', description: '雞的飼料，用於餵養小雞與成雞' },
];

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

    // 讀取道具（包括普通肥料）
    const itemsResult = await db.execute(
      `SELECT id, name_zh_tw as nameZhTw, item_type as itemType, item_key as itemKey, buy_price as buyPrice, sell_price as sellPrice, sprite, effect_type as effectType, effect_value as effectValue, required_level as requiredLevel FROM items`
    );
    const items = itemsResult.rows || [];

    // Filter livestock items by player level
    const livestockItems = LIVESTOCK_ITEMS.map(item => ({
      ...item,
      requiredLevel: item.requiredLevel
    }));

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
      })),
      items: items.map((item: any) => ({
        id: item.id,
        nameZhTw: item.nameZhTw,
        itemType: item.itemType,
        itemKey: item.itemKey,
        buyPrice: item.buyPrice,
        sellPrice: item.sellPrice,
        sprite: item.sprite,
        effectType: item.effectType,
        effectValue: item.effectValue,
        requiredLevel: item.requiredLevel
      })),
      livestock: livestockItems
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
    const inventoryBefore = existingSeed ? existingSeed.amount : 0;

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

    // 取得購買後的庫存
    const afterResult = await db.execute(
      `SELECT amount FROM inventories WHERE user_id = ? AND item_type = 'seed' AND item_id = ?`,
      [userId, cropId]
    );
    const inventoryAfter = afterResult.rows?.[0]?.amount || 0;
    console.log(`[BUY SUCCESS] userId=${userId} cropId=${cropId} buyAmount=${amount} inventoryBefore=${inventoryBefore} inventoryAfter=${inventoryAfter}`);

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

// 購買道具（普通肥料等）
router.post('/buy-item', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { itemId, amount = 1 } = req.body;
    console.log('[BUY-ITEM SERVER DEBUG]', { itemId, amount, body: req.body });

    if (!itemId) {
      return res.status(400).json({ success: false, message: '請選擇要購買的道具' });
    }

    // 檢查道具是否存在
    const itemResult = await db.execute(
      `SELECT id, name_zh_tw as nameZhTw, buy_price as buyPrice, sell_price as sellPrice, required_level as requiredLevel FROM items WHERE id = ?`,
      [itemId]
    );
    const item = itemResult.rows?.[0];
    console.log('[BUY-ITEM SERVER items TABLE]', { itemId, item });

    // 普通飼料（itemId=2）：使用 LIVESTOCK_ITEMS 的靜態價格，不走 items table
    const FEED_ITEM_ID = 2;
    const LIVESTOCK_ITEM_PRICE: Record<number, { price: number; level: number }> = {
      2: { price: 10, level: 1 }, // 普通飼料
    };
    let buyPrice = item?.buyPrice;
    let requiredLevel = item?.requiredLevel ?? 1;
    let itemName = item?.nameZhTw ?? '未知物品';
    if (Number(itemId) === FEED_ITEM_ID && LIVESTOCK_ITEM_PRICE[FEED_ITEM_ID]) {
      buyPrice = LIVESTOCK_ITEM_PRICE[FEED_ITEM_ID].price;
      requiredLevel = LIVESTOCK_ITEM_PRICE[FEED_ITEM_ID].level;
      itemName = '普通飼料';
    }
    console.log('[BUY-ITEM PRICE OVERRIDE]', { itemId, buyPrice, requiredLevel, itemName });
    if (!item) {
      return res.status(404).json({ success: false, message: '道具不存在' });
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

    if (user.level < requiredLevel) {
      return res.status(400).json({
        success: false,
        message: `需要等級 ${requiredLevel} 才能購買${itemName}`
      });
    }

    const totalCost = buyPrice * amount;
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

    // 增加道具到背包（upsert）
    const existingResult = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'item' AND item_id = ?`,
      [userId, itemId]
    );
    const existingItem = existingResult.rows?.[0];
    const beforeAmount = existingItem?.amount ?? 0;
    console.log('[BUY-ITEM INVENTORY UPSERT]', {
      userId, itemId, itemType: 'item',
      before_quantity: beforeAmount,
      totalCost, gold_before: user.gold, gold_after: user.gold - totalCost,
    });

    if (existingItem) {
      await db.execute(
        `UPDATE inventories SET amount = amount + ? WHERE id = ?`,
        [amount, existingItem.id]
      );
    } else {
      await db.execute(
        `INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'item', ?, ?)`,
        [userId, itemId, amount]
      );
    }

    // 取得更新後的庫存
    const afterResult = await db.execute(
      `SELECT id, user_id as userId, item_type as itemType, item_id as itemId, amount FROM inventories WHERE user_id = ? AND item_type = 'item' AND item_id = ?`,
      [userId, itemId]
    );
    const updatedInventoryRow = afterResult.rows?.[0] ?? null;
    const afterAmount = updatedInventoryRow?.amount ?? beforeAmount + amount;
    console.log('[BUY-ITEM AFTER]', { beforeAmount, afterAmount, updatedInventoryRow });

    // 取得更新後的金幣
    const updatedResult = await db.execute(
      `SELECT gold FROM users WHERE id = ?`,
      [userId]
    );
    const updatedGold = updatedResult.rows?.[0]?.gold || 0;

    return res.json({
      success: true,
      message: `購買成功！獲得了 ${amount} 個${itemName}`,
      purchase: {
        itemId,
        itemName,
        amount,
        totalCost
      },
      user: {
        gold: updatedGold
      },
      beforeAmount,
      afterAmount,
      updatedInventoryRow
    });
  } catch (error) {
    console.error('購買道具錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 購買畜牧商品（雞舍、小雞、普通飼料）
router.post('/buy-livestock', async (req: AuthRequest, res: Response) => {
  console.log('[BUY LIVESTOCK API HIT] req.body =', JSON.stringify(req.body));
  console.log('[BUY LIVESTOCK API HIT] Content-Type =', req.headers['content-type']);

  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { livestockKey, amount = 1 } = req.body;
    console.log(`[BUY LIVESTOCK] userId=${userId} livestockKey=${livestockKey} amount=${amount}`);

    if (!livestockKey) {
      console.log(`[BUY LIVESTOCK] FAIL: missing livestockKey`);
      return res.status(400).json({ success: false, message: '請選擇要購買的商品' });
    }

    const item = LIVESTOCK_ITEMS.find(i => i.id === livestockKey);
    if (!item) {
      console.log(`[BUY LIVESTOCK] FAIL: item not found for livestockKey=${livestockKey}`);
      return res.status(404).json({ success: false, message: `商品不存在：${livestockKey}` });
    }
    console.log(`[BUY LIVESTOCK] item found: ${item.nameZhTw} price=${item.buyPrice}`);

    // 檢查玩家資料
    const userResult = await db.execute(
      `SELECT id, gold, level FROM users WHERE id = ?`,
      [userId]
    );
    const user = userResult.rows?.[0];
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    if (user.level < item.requiredLevel) {
      console.log(`[BUY LIVESTOCK] FAIL: level too low user.level=${user.level} required=${item.requiredLevel}`);
      return res.status(400).json({
        success: false,
        message: `需要等級 ${item.requiredLevel} 才能購買${item.nameZhTw}（你目前 Lv.${user.level}）`
      });
    }

    const totalCost = item.buyPrice * amount;
    if (user.gold < totalCost) {
      console.log(`[BUY LIVESTOCK] FAIL: not enough gold have=${user.gold} need=${totalCost}`);
      return res.status(400).json({
        success: false,
        message: `金幣不足！需要 ${totalCost} 金幣，你只有 ${user.gold} 金幣`
      });
    }
    console.log(`[BUY LIVESTOCK] checks passed: gold=${user.gold} level=${user.level}`);

    // ── 雞舍：扣除金幣，進入放置模式 ──
    if (item.itemType === 'building') {
      // 檢查是否已經有雞舍記錄
      const coopRows = await db.execute(
        `SELECT tile_x as tileX, tile_y as tileY FROM chicken_buildings WHERE user_id = ?`,
        [userId]
      );
      const existingCoop = coopRows.rows?.[0];
      if (existingCoop && (existingCoop.tileX > 0 || existingCoop.tileY > 0)) {
        return res.status(400).json({ success: false, message: '雞舍已經放置過了' });
      }

      // 預扣金幣
      await db.execute(`UPDATE users SET gold = gold - ? WHERE id = ?`, [totalCost, userId]);

      // 確保 chicken_buildings 記錄存在
      await db.execute(
        `INSERT INTO chicken_buildings (user_id, tile_x, tile_y, unlocked_at) VALUES (?, 0, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET tile_x = 0, tile_y = 0, updated_at = ?`,
        [userId, Date.now(), Date.now()]
      );

      const updatedResult = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
      const updatedGold = updatedResult.rows?.[0]?.gold || 0;

      return res.json({
        success: true,
        action: 'PLACE_BUILDING',
        message: `購買成功！點擊農場放置雞舍`,
        purchase: { itemKey: livestockKey, itemName: item.nameZhTw, amount, totalCost },
        user: { gold: updatedGold }
      });
    }

    // ── 小雞：呼叫 animals API 購買 ──
    if (item.itemType === 'livestock') {
      // 先扣除金幣
      await db.execute(`UPDATE users SET gold = gold - ? WHERE id = ?`, [totalCost, userId]);

      // 確認雞舍已放置
      const coopRows = await db.execute(
        `SELECT tile_x as tileX, tile_y as tileY FROM chicken_buildings WHERE user_id = ?`,
        [userId]
      );
      const existingCoop = coopRows.rows?.[0];
      if (!existingCoop || existingCoop.tileX == null || existingCoop.tileX === 0) {
        // 退還金幣
        await db.execute(`UPDATE users SET gold = gold + ? WHERE id = ?`, [totalCost, userId]);
        return res.status(400).json({ success: false, message: '請先購買並放置雞舍！' });
      }

      // 找第一個空位
      const emptySlots = await db.execute(
        `SELECT id, slot_index as slotIndex FROM chicken_slots WHERE user_id = ? AND state = 'EMPTY' ORDER BY slot_index LIMIT 1`,
        [userId]
      );
      if (!emptySlots.rows || emptySlots.rows.length === 0) {
        await db.execute(`UPDATE users SET gold = gold + ? WHERE id = ?`, [totalCost, userId]);
        return res.status(400).json({ success: false, message: '雞舍已滿！最多容納 4 隻雞' });
      }
      const emptySlot = emptySlots.rows[0];

      // 放小雞
      await db.execute(
        `UPDATE chicken_slots SET state = 'BABY', baby_born_at = ?, updated_at = ? WHERE id = ?`,
        [Date.now(), Date.now(), emptySlot.id]
      );

      const updatedResult = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
      const updatedGold = updatedResult.rows?.[0]?.gold || 0;

      return res.json({
        success: true,
        action: 'BUY_CHICK',
        message: `購買了小雞！花費 ${totalCost} 金幣`,
        purchase: { itemKey: livestockKey, itemName: item.nameZhTw, amount, totalCost },
        slot: { index: emptySlot.slotIndex, state: 'BABY' },
        user: { gold: updatedGold }
      });
    }

    // ── 普通飼料：加到背包（寫入 livestock inventory） ──
    if (item.itemType === 'consumable') {
      const FEED_ITEM_ID = 2; // 普通飼料 items.id
      await db.execute(`UPDATE users SET gold = gold - ? WHERE id = ?`, [totalCost, userId]);

      const existingResult = await db.execute(
        `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'livestock' AND item_id = ?`,
        [userId, FEED_ITEM_ID]
      );
      const existingItem = existingResult.rows?.[0];
      if (existingItem) {
        await db.execute(`UPDATE inventories SET amount = amount + ? WHERE id = ?`, [amount, existingItem.id]);
      } else {
        await db.execute(
          `INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, 'livestock', ?, ?)`,
          [userId, FEED_ITEM_ID, amount]
        );
      }

      const updatedResult = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
      const updatedGold = updatedResult.rows?.[0]?.gold || 0;

      return res.json({
        success: true,
        action: 'ADD_TO_INVENTORY',
        message: `購買成功！獲得了 ${amount} 個${item.nameZhTw}`,
        purchase: { itemKey: livestockKey, itemName: item.nameZhTw, amount, totalCost },
        user: { gold: updatedGold }
      });
    }

    return res.status(400).json({ success: false, message: '不支援的商品類型' });
  } catch (error) {
    console.error('購買畜牧商品錯誤:', error);
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

    const { cropId, itemId, itemType, amount = 1 } = req.body;
    console.log('[SELL API DEBUG]', { cropId, itemId, itemType, amount, EGG_ITEM_ID: 9 });

    // ── 畜牧產品（雞蛋）出售 ──
    // 雞蛋在 inventories 表中是 item_id=1（collect-all 寫入的）
    if (itemType === 'livestock' && itemId) {
      const EGG_ITEM_ID = 1;
      const EGG_SELL_PRICE = 30;

      console.log('[SELL LIVESTOCK DEBUG]', {
        received_itemId: itemId,
        received_itemId_type: typeof itemId,
        Number_itemId: Number(itemId),
        EGG_ITEM_ID,
        will_match: Number(itemId) === EGG_ITEM_ID,
        inventory_check_query: `SELECT id, amount FROM inventories WHERE user_id=${userId} AND item_type='livestock' AND item_id=${itemId}`,
      });

      if (Number(itemId) !== EGG_ITEM_ID) {
        return res.status(400).json({ success: false, message: '不支援出售此畜牧產品（僅支援雞蛋）' });
      }

      const invResult = await db.execute(
        `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'livestock' AND item_id = ?`,
        [userId, itemId]
      );
      const invItem = invResult.rows?.[0];
      console.log('[SELL LIVESTOCK INVENTORY CHECK]', {
        userId,
        itemId,
        invResult_rows: invResult.rows,
        invItem,
        amount,
        will_pass_check: invItem && invItem.amount >= amount,
      });
      if (!invItem || invItem.amount < amount) {
        return res.status(400).json({ success: false, message: '背包中沒有足夠的雞蛋' });
      }

      const totalPrice = EGG_SELL_PRICE * amount;
      await db.execute(`UPDATE users SET gold = gold + ? WHERE id = ?`, [totalPrice, userId]);

      if (invItem.amount === amount) {
        await db.execute(`DELETE FROM inventories WHERE id = ?`, [invItem.id]);
      } else {
        await db.execute(`UPDATE inventories SET amount = amount - ? WHERE id = ?`, [amount, invItem.id]);
      }

      const updatedResult = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
      const updatedGold = updatedResult.rows?.[0]?.gold || 0;

      return res.json({
        success: true,
        message: `賣出成功！獲得了 ${totalPrice} 金幣`,
        sale: { itemId, itemType: 'livestock', itemName: '雞蛋', amount, totalPrice },
        user: { gold: updatedGold },
      });
    }

    // ── 作物出售 ──
    if (!cropId) {
      return res.status(400).json({ success: false, message: '請選擇要賣出的作物' });
    }

    const inventoryResult = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'crop' AND item_id = ?`,
      [userId, cropId]
    );
    const inventoryItem = inventoryResult.rows?.[0];

    if (!inventoryItem || inventoryItem.amount < amount) {
      return res.status(400).json({ success: false, message: '背包中沒有足夠的作物' });
    }

    const cropResult = await db.execute(
      `SELECT id, name_zh_tw as nameZhTw, sell_price as sellPrice FROM crops WHERE id = ?`,
      [cropId]
    );
    const crop = cropResult.rows?.[0];
    if (!crop) {
      return res.status(404).json({ success: false, message: '作物不存在' });
    }

    const totalPrice = crop.sellPrice * amount;
    await db.execute(`UPDATE users SET gold = gold + ? WHERE id = ?`, [totalPrice, userId]);

    if (inventoryItem.amount === amount) {
      await db.execute(`DELETE FROM inventories WHERE id = ?`, [inventoryItem.id]);
    } else {
      await db.execute(`UPDATE inventories SET amount = amount - ? WHERE id = ?`, [amount, inventoryItem.id]);
    }

    const updatedResult = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const updatedGold = updatedResult.rows?.[0]?.gold || 0;

    return res.json({
      success: true,
      message: `賣出成功！獲得了 ${totalPrice} 金幣`,
      sale: { cropId, cropName: crop.nameZhTw, amount, totalPrice },
      user: { gold: updatedGold },
    });
  } catch (error) {
    console.error('賣出錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// POST /api/shop/sell-livestock — 賣出畜牧產物
router.post('/sell-livestock', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, message: '未授權' });

    const { itemId, amount = 1 } = req.body;
    if (!itemId) return res.status(400).json({ success: false, message: '請選擇要賣出的物品' });

    // 畜牧物品靜態資料
    const livestockItems: Record<number, { nameZhTw: string; sellPrice: number }> = {
      1: { nameZhTw: '雞蛋', sellPrice: 5 },
    };
    const info = livestockItems[itemId];
    if (!info) return res.status(404).json({ success: false, message: '畜牧物品不存在' });

    // 檢查背包中的物品數量
    const inventoryResult = await db.execute(
      `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'livestock' AND item_id = ?`,
      [userId, itemId]
    );
    const inventoryItem = inventoryResult.rows?.[0];
    if (!inventoryItem || inventoryItem.amount < amount) {
      return res.status(400).json({ success: false, message: '背包中沒有足夠的物品' });
    }

    const totalPrice = info.sellPrice * amount;

    // 增加金幣
    await db.execute(`UPDATE users SET gold = gold + ? WHERE id = ?`, [totalPrice, userId]);

    // 減少背包中的物品
    if (inventoryItem.amount === amount) {
      await db.execute(`DELETE FROM inventories WHERE id = ?`, [inventoryItem.id]);
    } else {
      await db.execute(`UPDATE inventories SET amount = amount - ? WHERE id = ?`, [amount, inventoryItem.id]);
    }

    // 取得更新後的金幣
    const updatedResult = await db.execute(`SELECT gold FROM users WHERE id = ?`, [userId]);
    const updatedGold = updatedResult.rows?.[0]?.gold || 0;

    return res.json({
      success: true,
      message: `賣出成功！獲得了 ${totalPrice} 金幣`,
      sale: { itemId, itemName: info.nameZhTw, amount, totalPrice },
      user: { gold: updatedGold },
    });
  } catch (error) {
    console.error('賣出畜牧錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 修正肥料資料（一次性）
router.post('/fix-fertilizer', async (req, res) => {
  try {
    await db.execute(
      `UPDATE items SET buy_price = 10, effect_type = 'prevent_dry', effect_value = 0 WHERE item_key = 'normal_fertilizer'`
    );
    return res.json({ success: true, message: '肥料已修正' });
  } catch (error) {
    console.error('修正肥料錯誤:', error);
    return res.status(500).json({ success: false, message: '修正失敗' });
  }
});

export default router;