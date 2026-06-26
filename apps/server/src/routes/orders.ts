import { Router, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// 更新訂單任務進度的輔助函數
async function updateOrderTaskProgress(userId: number) {
  try {
    const today = new Date();
    // 計算今日時間戳範圍（台北時區 UTC+8）
    // 台北時區是 UTC+8，所以 00:00 台北時間 = 前一天 16:00 UTC
    const taipeiDateStr = today.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const [year, month, day] = taipeiDateStr.split('-').map(Number);
    const todayStart = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - (8 * 60 * 60 * 1000);
    const todayEnd = Date.UTC(year, month - 1, day, 0, 0, 0, 0) + (16 * 60 * 60 * 1000) - 1;
    const taskKey = 'complete_order';
    const target = 3;
    
    // 查詢目前進度（用 timestamp 範圍查詢）
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
        `INSERT INTO task_progress (user_id, task_key, progress, claimed, updated_at)
         VALUES (?, ?, 1, 0, ?)`,
        [userId, taskKey, Date.now()]
      );
    }
  } catch (e) {
    console.error('[updateOrderTaskProgress] error:', e);
  }
}

const NPC_NAMES = ['阿福', '小葵', '王太太', '王伯伯'];

// 作物資料：ID, 名稱, 售價
const CROPS = [
  { id: 1, name: '小麥', sellPrice: 10, requiredLevel: 1 },
  { id: 2, name: '玉米', sellPrice: 20, requiredLevel: 1 },
  { id: 3, name: '紅蘿蔔', sellPrice: 35, requiredLevel: 2 },
  { id: 4, name: '馬鈴薯', sellPrice: 55, requiredLevel: 3 },
  { id: 5, name: '甘蔗', sellPrice: 75, requiredLevel: 4 },
  { id: 6, name: '草莓', sellPrice: 90, requiredLevel: 5 },
  { id: 7, name: '番茄', sellPrice: 110, requiredLevel: 6 },
  { id: 8, name: '南瓜', sellPrice: 130, requiredLevel: 7 },
  { id: 9, name: '黃豆', sellPrice: 150, requiredLevel: 4 },
  { id: 10, name: '葡萄', sellPrice: 175, requiredLevel: 8 },
  { id: 11, name: '蘋果', sellPrice: 200, requiredLevel: 9 },
  { id: 12, name: '可可豆', sellPrice: 230, requiredLevel: 10 },
  { id: 13, name: '棉花', sellPrice: 260, requiredLevel: 11 },
  { id: 14, name: '咖啡豆', sellPrice: 290, requiredLevel: 12 },
  { id: 15, name: '茶葉', sellPrice: 320, requiredLevel: 13 },
];

// 訂單難度設定（測試階段）
const DIFFICULTY_CONFIG = {
  easy: {
    weight: 70,
    typeCount: [1, 2],      // 1-2 種需求
    quantityRange: [2, 4],   // 每種 2-4 個
    coinMultiplier: 1.0,
    expRange: [10, 20],
  },
  medium: {
    weight: 25,
    typeCount: [2, 2],       // 2 種需求
    quantityRange: [3, 5],  // 每種 3-5 個
    coinMultiplier: 1.2,
    expRange: [20, 35],
  },
  hard: {
    weight: 5,  // 困難降至 5%
    typeCount: [3, 3],       // 3 種需求
    quantityRange: [4, 6], // 每種 4-6 個
    coinMultiplier: 1.5,
    expRange: [35, 60],
  },
};

type Difficulty = 'easy' | 'medium' | 'hard';

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 根據權重隨機選擇難度
function randomDifficulty(): Difficulty {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const [diff, config] of Object.entries(DIFFICULTY_CONFIG)) {
    cumulative += config.weight;
    if (rand < cumulative) return diff as Difficulty;
  }
  return 'easy';
}

// 根據難度生成訂單
async function generateOrder(userId: number, playerLevel: number) {
  // 直接從 DB 查詢玩家已解鎖作物（使用真實 required_level）
  const cropsResult = await db.execute(
    `SELECT id, name_zh_tw as name, sell_price as sellPrice, required_level as requiredLevel FROM crops WHERE required_level <= ? ORDER BY id`,
    [playerLevel]
  );
  const unlockedCrops = cropsResult.rows || [];

  if (unlockedCrops.length === 0) {
    throw { status: 400, message: '尚無已解鎖的作物' };
  }

  const difficulty = randomDifficulty();
  const config = DIFFICULTY_CONFIG[difficulty];
  const npcName = randomPick(NPC_NAMES);

  // 決定需求種類數量
  const typeCount = randomInt(config.typeCount[0], config.typeCount[1]);

  // 只從玩家已解鎖的作物中抽取（unlockedCrops 已從 DB 查詢，無需 filter）
  const shuffledCrops = [...unlockedCrops].sort(() => Math.random() - 0.5);
  const selectedCrops = shuffledCrops.slice(0, Math.min(typeCount, unlockedCrops.length));

  // 生成需求並計算作物總價值
  const requirements = selectedCrops.map(crop => {
    const quantity = randomInt(config.quantityRange[0], config.quantityRange[1]);
    return {
      itemName: crop.name,
      quantity,
      totalValue: crop.sellPrice * quantity,
    };
  });

  console.log('[ORDER GENERATE DEBUG]', {
    userId,
    playerLevel,
    allowedCrops: unlockedCrops.map(c => ({ id: c.id, name: c.name, requiredLevel: c.requiredLevel })),
    generatedRequirements: requirements.map(r => ({ itemName: r.itemName, quantity: r.quantity })),
  });

  // 計算作物總價值
  const totalCropValue = requirements.reduce((sum, r) => sum + r.totalValue, 0);
  
  // 計算獎勵：作物總價值 × 倍率
  const coinReward = Math.round(totalCropValue * config.coinMultiplier);
  const expReward = randomInt(config.expRange[0], config.expRange[1]);

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 分鐘

  return {
    npcName,
    difficulty,
    requirements: JSON.stringify(requirements.map(r => ({ itemName: r.itemName, quantity: r.quantity }))),
    rewardCoins: coinReward,
    rewardExp: expReward,
    expiresAt,
  };
}

// 解析 requirements JSON
function parseRequirements(requirementsStr: string) {
  try {
    return JSON.parse(requirementsStr);
  } catch {
    return [];
  }
}

// 取得玩家所有訂單
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const ordersResult = await db.execute(
      `SELECT id, user_id as userId, npc_name as npcName, difficulty,
       requirements, reward_coins as rewardCoins, reward_exp as rewardExp,
       status, expires_at as expiresAt, created_at as createdAt
       FROM orders WHERE user_id = ? AND status IN ('active', 'delivering') ORDER BY created_at ASC`,
      [userId]
    );

    let orders = ordersResult.rows || [];

    // 取得玩家等級（用於過濾訂單作物）
    let playerLevel = 1;
    const userLevelResult = await db.execute(`SELECT level FROM users WHERE id = ?`, [userId]);
    if (userLevelResult.rows?.[0]?.level) {
      playerLevel = userLevelResult.rows[0].level;
    }

    // 標記過期的 active 訂單為 failed
    const now = new Date();
    for (const order of orders) {
      if (order.status === 'active' && new Date(order.expiresAt) < now) {
        await db.execute(
          `UPDATE orders SET status = 'failed' WHERE id = ?`,
          [order.id]
        );
        order.status = 'failed';
      }
    }

    // 過濾掉過期和配送中的，只保留 active，並限制 3 筆
    orders = orders.filter((o: any) => o.status === 'active').slice(0, 3);

    // 解析 requirements JSON
    orders = orders.map((o: any) => ({
      ...o,
      requirements: parseRequirements(o.requirements),
    }));

    // 補足 3 筆訂單
    while (orders.length < 3) {
      const orderData = await generateOrder(userId, playerLevel);
      const expiresAtStr = orderData.expiresAt.toISOString();
      const nowTimestamp = Date.now(); // 使用 Unix timestamp 確保唯一性
      await db.execute(
        `INSERT INTO orders (user_id, npc_name, difficulty, requirements, reward_coins, reward_exp, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        [userId, orderData.npcName, orderData.difficulty, orderData.requirements,
         orderData.rewardCoins, orderData.rewardExp, expiresAtStr, nowTimestamp]
      );
      // 查詢最新建立的訂單以取得 ID
      const newOrderResult = await db.execute(
        `SELECT id, npc_name as npcName, difficulty, requirements, reward_coins as rewardCoins, reward_exp as rewardExp, status, expires_at as expiresAt, created_at as createdAt
         FROM orders WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
        [userId]
      );
      const newOrder = newOrderResult.rows?.[0];
      if (newOrder) {
        orders.push({
          ...newOrder,
          userId,
          requirements: parseRequirements(newOrder.requirements),
          expiresAt: new Date(newOrder.expiresAt),
          createdAt: new Date(newOrder.createdAt),
        });
      }
    }

    return res.json({ success: true, orders });
  } catch (error) {
    console.error('取得訂單錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 開始配送
router.post('/:id/deliver', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const orderId = parseInt(req.params.id);

    // 取得訂單
    const orderResult = await db.execute(
      `SELECT id, status, expires_at as expiresAt, requirements FROM orders WHERE id = ? AND user_id = ?`,
      [orderId, userId]
    );
    const order = orderResult.rows?.[0];
    if (!order) {
      return res.status(404).json({ success: false, message: '訂單不存在' });
    }
    if (order.status !== 'active') {
      return res.status(400).json({ success: false, message: '訂單狀態無效' });
    }

    // 檢查是否過期
    if (new Date(order.expiresAt) < new Date()) {
      await db.execute(`UPDATE orders SET status = 'failed' WHERE id = ?`, [orderId]);
      return res.status(400).json({ success: false, message: '訂單已過期' });
    }

    // 檢查背包是否足夠
    const requirements = parseRequirements(order.requirements);
    const cropNameMap: Record<string, number> = {
      '小麥': 1, '玉米': 2, '紅蘿蔔': 3, '馬鈴薯': 4,
      '甘蔗': 5, '草莓': 6, '番茄': 7, '南瓜': 8,
      '黃豆': 9, '葡萄': 10, '蘋果': 11, '可可豆': 12,
      '棉花': 13, '咖啡豆': 14, '茶葉': 15,
    };

    const missingItems: string[] = [];
    const inventoryChecks: Record<string, { required: number; have: number }> = {};

    for (const req of requirements) {
      const cropId = cropNameMap[req.itemName];
      if (!cropId) {
        console.warn(`[ORDER DELIVER] unknown crop: ${req.itemName}`);
        return res.status(400).json({ success: false, message: `無法識別的作物：${req.itemName}` });
      }

      const invResult = await db.execute(
        `SELECT amount FROM inventories WHERE user_id = ? AND item_type = 'crop' AND item_id = ?`,
        [userId, cropId]
      );
      const invItem = invResult.rows?.[0];
      const have = invItem?.amount ?? 0;
      inventoryChecks[req.itemName] = { required: req.quantity, have };
      if (have < req.quantity) {
        missingItems.push(req.itemName);
      }
    }

    console.log('[ORDER DELIVER CHECK]', {
      orderId,
      userId,
      requirements: requirements.map(r => ({ itemName: r.itemName, quantity: r.quantity })),
      inventoryChecks,
    });

    if (missingItems.length > 0) {
      console.warn('[ORDER DELIVER BLOCKED]', { missingItems, orderId });
      return res.status(400).json({
        success: false,
        message: '物品不足'
      });
    }

    // 扣除背包物品
    for (const req of requirements) {
      const cropId = cropNameMap[req.itemName];
      if (!cropId) continue;

      const invResult = await db.execute(
        `SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = 'crop' AND item_id = ?`,
        [userId, cropId]
      );
      const invItem = invResult.rows?.[0];
      if (invItem.amount === req.quantity) {
        await db.execute(`DELETE FROM inventories WHERE id = ?`, [invItem.id]);
      } else {
        await db.execute(
          `UPDATE inventories SET amount = amount - ? WHERE id = ?`,
          [req.quantity, invItem.id]
        );
      }
    }

    // 改為 delivering 狀態
    await db.execute(
      `UPDATE orders SET status = 'delivering' WHERE id = ?`,
      [orderId]
    );

    return res.json({ success: true, message: '開始配送！' });
  } catch (error) {
    console.error('開始配送錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 完成配送
router.post('/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const orderId = parseInt(req.params.id);

    // 取得訂單
    const orderResult = await db.execute(
      `SELECT id, status, reward_coins as rewardCoins, reward_exp as rewardExp FROM orders WHERE id = ? AND user_id = ?`,
      [orderId, userId]
    );
    const order = orderResult.rows?.[0];
    if (!order) {
      return res.status(404).json({ success: false, message: '訂單不存在' });
    }
    if (order.status !== 'delivering') {
      return res.status(400).json({ success: false, message: '訂單尚未開始配送' });
    }

    // 發放獎勵（含升級計算，邏輯與 farm.ts harvest 一致）
    const beforeResult = await db.execute(
      `SELECT gold, exp, level FROM users WHERE id = ?`,
      [userId]
    );
    const before = beforeResult.rows?.[0];
    if (!before) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }
    const oldLevel = before.level;
    const oldExp = before.exp;
    const rewardExp = order.rewardExp;
    const newExp = oldExp + rewardExp;

    const expForLevel = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
    let newLevel = oldLevel;
    while (newLevel < expForLevel.length && newExp >= expForLevel[newLevel]) {
      newLevel++;
    }
    console.log('[ORDER LEVEL CHECK]', { userId, oldLevel, oldExp, rewardExp, newExp, newLevel });

    await db.execute(
      `UPDATE users SET gold = ?, exp = ?, level = ? WHERE id = ?`,
      [before.gold + order.rewardCoins, newExp, newLevel, userId]
    );
    console.log('[ORDER LEVEL UPDATED]', { userId, level: newLevel, exp: newExp });

    // 標記為完成
    await db.execute(
      `UPDATE orders SET status = 'completed' WHERE id = ?`,
      [orderId]
    );

    // 更新每日任務進度
    await updateOrderTaskProgress(userId);

    // 取得更新後的玩家資料
    const userResult = await db.execute(
      `SELECT gold, exp, level FROM users WHERE id = ?`,
      [userId]
    );
    const user = userResult.rows?.[0];

    return res.json({
      success: true,
      message: `訂單完成！獲得了 ${order.rewardCoins} 金幣與 ${order.rewardExp} EXP`,
      user: { gold: user?.gold, exp: user?.exp, level: user?.level }
    });
  } catch (error) {
    console.error('完成配送錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 刷新單筆過期訂單
router.post('/:id/refresh', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const orderId = parseInt(req.params.id);

    // 刪除該筆失敗訂單
    await db.execute(
      `DELETE FROM orders WHERE id = ? AND user_id = ? AND status = 'failed'`,
      [orderId, userId]
    );

    // 取得玩家等級
    let playerLevel = 1;
    const userLevelResult = await db.execute(`SELECT level FROM users WHERE id = ?`, [userId]);
    if (userLevelResult.rows?.[0]?.level) {
      playerLevel = userLevelResult.rows[0].level;
    }

    // 生成新訂單
    const orderData = await generateOrder(userId, playerLevel);
    const insertResult = await db.execute(
      `INSERT INTO orders (user_id, npc_name, difficulty, requirements, reward_coins, reward_exp, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'))`,
      [userId, orderData.npcName, orderData.difficulty, orderData.requirements,
       orderData.rewardCoins, orderData.rewardExp, orderData.expiresAt.toISOString()]
    );

    const newOrder = {
      id: Number(insertResult.lastInsertRowid),
      userId,
      npcName: orderData.npcName,
      difficulty: orderData.difficulty,
      requirements: parseRequirements(orderData.requirements),
      rewardCoins: orderData.rewardCoins,
      rewardExp: orderData.rewardExp,
      status: 'active',
      expiresAt: orderData.expiresAt,
      createdAt: new Date(),
    };

    return res.json({ success: true, order: newOrder });
  } catch (error) {
    console.error('刷新訂單錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;
