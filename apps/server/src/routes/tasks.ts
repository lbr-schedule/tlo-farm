import { Router, type Router as RouterType, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const router: RouterType = Router();

// 確保任務資料表存在
async function ensureTablesExist() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS task_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        task_key TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        claimed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);
  } catch (e) {
    // 忽略錯誤（表格可能已存在）
    console.log('[Tasks] Table check:', e);
  }
}

// 首次请求时初始化表格
let tablesInitialized = false;
async function initTables() {
  if (!tablesInitialized) {
    await ensureTablesExist();
    tablesInitialized = true;
  }
}

// 每日任務定義
const DAILY_TASKS = [
  {
    id: 1,
    key: 'login',
    title: '登入遊戲',
    description: '每天首次登入遊戲',
    target: 1,
    rewardCoins: 50,
    rewardExp: 10,
  },
  {
    id: 2,
    key: 'harvest_wheat',
    title: '收成小麥',
    description: '收成 10 個小麥',
    target: 10,
    rewardCoins: 100,
    rewardExp: 20,
  },
  {
    id: 3,
    key: 'harvest_any',
    title: '收成任意作物',
    description: '收成 20 個任意作物',
    target: 20,
    rewardCoins: 150,
    rewardExp: 30,
  },
  {
    id: 4,
    key: 'complete_order',
    title: '完成訂單',
    description: '完成 3 次訂單配送',
    target: 3,
    rewardCoins: 200,
    rewardExp: 40,
  },
];

// 取得當日任務（含進度）
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await initTables();
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    // 取得今日本地日期字串（用於過濾）- 使用當地時區
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`; // 'YYYY-MM-DD'
    
    // 計算今日時間戳範圍（台北時區 UTC+8）- 使用 toLocaleString 避免時區問題
    const taipeiDateStr = today.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const [ty, tm, td] = taipeiDateStr.split('-').map(Number);
    // 台北時區是 UTC+8，所以 00:00 台北時間 = 前一天 16:00 UTC
    const todayStart = Date.UTC(ty, tm - 1, td, 0, 0, 0, 0) - (8 * 60 * 60 * 1000);
    const todayEnd = Date.UTC(ty, tm - 1, td, 0, 0, 0, 0) + (16 * 60 * 60 * 1000) - 1;

    // 查詢今日進度（updated_at 存的是毫秒，用範圍查詢，取每個 task_key 最新的記錄）
    const progressResult = await db.execute(
      `SELECT tp.task_key as taskKey, tp.progress, tp.claimed, tp.updated_at as updatedAt
       FROM task_progress tp
       INNER JOIN (
         SELECT task_key, MAX(updated_at) as max_updated
         FROM task_progress
         WHERE user_id = ? AND updated_at >= ? AND updated_at <= ?
         GROUP BY task_key
       ) latest ON tp.task_key = latest.task_key AND tp.updated_at = latest.max_updated
       WHERE tp.user_id = ? AND tp.updated_at >= ? AND tp.updated_at <= ?`,
      [userId, todayStart, todayEnd, userId, todayStart, todayEnd]
    );

    console.warn('[GET TASKS DATE RANGE]', {
      userId,
      now: Date.now(),
      todayStart,
      todayEnd,
      todayStartISO: new Date(todayStart).toISOString(),
      todayEndISO: new Date(todayEnd).toISOString(),
    });
    console.warn('[GET TASKS DB ROWS]', {
      rows: progressResult.rows,
    });

    const progressMap: Record<string, { progress: number; claimed: boolean }> = {};
    for (const row of progressResult.rows || []) {
      progressMap[row.taskKey] = {
        progress: row.progress,
        claimed: !!row.claimed,
      };
    }

    // 組合任務資料
    const tasks = DAILY_TASKS.map(task => {
      const p = progressMap[task.key] || { progress: 0, claimed: false };
      return {
        ...task,
        progress: p.progress,
        claimed: p.claimed,
      };
    });

    return res.json({ success: true, tasks });
  } catch (error) {
    console.error('取得任務錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 更新進度（收成、完成訂單）
router.post('/progress', async (req: AuthRequest, res: Response) => {
  try {
    await initTables();
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const { type, cropId } = req.body;
    // type: 'harvest' | 'complete_order'
    // cropId: 1=小麥, 2=玉米, 3=紅蘿蔔, 4=馬鈴薯

    if (!type) {
      return res.status(400).json({ success: false, message: '缺少 type 參數' });
    }

    const today = new Date();
    // 計算今日時間戳範圍（台北時區 UTC+8）- 使用 toLocaleString 避免時區問題
    const taipeiDateStr = today.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const [ty, tm, td] = taipeiDateStr.split('-').map(Number);
    // 台北時區是 UTC+8，所以 00:00 台北時間 = 前一天 16:00 UTC
    const todayStart = Date.UTC(ty, tm - 1, td, 0, 0, 0, 0) - (8 * 60 * 60 * 1000);
    const todayEnd = Date.UTC(ty, tm - 1, td, 0, 0, 0, 0) + (16 * 60 * 60 * 1000) - 1;

    // 確定要更新的 task keys
    const taskKeys: string[] = [];

    if (type === 'harvest') {
      // 收成任意作物
      taskKeys.push('harvest_any');
      // 如果是小麥 (cropId=1)，也更新收成小麥
      if (cropId === 1) {
        taskKeys.push('harvest_wheat');
      }
    } else if (type === 'complete_order') {
      taskKeys.push('complete_order');
    } else {
      return res.status(400).json({ success: false, message: '無效的 type' });
    }

    console.log(`[TASKS API POST /progress] type=${type} cropId=${cropId} taskKeys=${JSON.stringify(taskKeys)} todayStart=${todayStart} todayEnd=${todayEnd}`);

    // 更新每個任務的進度
    for (const taskKey of taskKeys) {
      const task = DAILY_TASKS.find(t => t.key === taskKey);
      if (!task) continue;

      // 查詢目前進度（用 timestamp 範圍查詢，按 updated_at 降序排列取第一筆）
      const existingResult = await db.execute(
        `SELECT id, progress FROM task_progress
         WHERE user_id = ? AND task_key = ? AND updated_at >= ? AND updated_at <= ?
         ORDER BY updated_at DESC LIMIT 1`,
        [userId, taskKey, todayStart, todayEnd]
      );
      const existing = existingResult.rows?.[0];

      if (existing) {
        // 已存在，只增加 progress（不超過 target）
        const newProgress = Math.min(existing.progress + 1, task.target);
        await db.execute(
          `UPDATE task_progress SET progress = ?, updated_at = ? WHERE id = ?`,
          [newProgress, Date.now(), existing.id]
        );
        console.log(`[TASKS API] UPDATE task_progress SET progress=${newProgress} WHERE id=${existing.id}`);
      } else {
        // 不存在，建立新記錄
        await db.execute(
          `INSERT INTO task_progress (user_id, task_key, progress, claimed, updated_at)
           VALUES (?, ?, 1, 0, ?)`,
          [userId, taskKey, Date.now()]
        );
        console.log(`[TASKS API] INSERT task_progress userId=${userId} taskKey=${taskKey} progress=1 updated_at=${Date.now()}`);
      }
    }

    // 取得更新後的進度（用 timestamp 範圍查詢，取每個 task_key 最新的記錄）
    const updatedResult = await db.execute(
      `SELECT tp.task_key as taskKey, tp.progress, tp.claimed
       FROM task_progress tp
       INNER JOIN (
         SELECT task_key, MAX(updated_at) as max_updated
         FROM task_progress
         WHERE user_id = ? AND updated_at >= ? AND updated_at <= ?
         GROUP BY task_key
       ) latest ON tp.task_key = latest.task_key AND tp.updated_at = latest.max_updated
       WHERE tp.user_id = ? AND tp.updated_at >= ? AND tp.updated_at <= ?`,
      [userId, todayStart, todayEnd, userId, todayStart, todayEnd]
    );

    const progressMap: Record<string, { progress: number; claimed: boolean }> = {};
    for (const row of updatedResult.rows || []) {
      progressMap[row.taskKey] = {
        progress: row.progress,
        claimed: !!row.claimed,
      };
    }

    const tasks = DAILY_TASKS.map(task => {
      const p = progressMap[task.key] || { progress: 0, claimed: false };
      return {
        ...task,
        progress: p.progress,
        claimed: p.claimed,
      };
    });

    return res.json({ success: true, tasks });
  } catch (error) {
    console.error('更新進度錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 標記登入任務完成
router.post('/login', async (req: AuthRequest, res: Response) => {
  try {
    await initTables();
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const today = new Date();
    // 計算今日時間戳範圍（台北時區 UTC+8）- 使用 toLocaleString 避免時區問題
    const taipeiDateStr = today.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const [ty, tm, td] = taipeiDateStr.split('-').map(Number);
    // 台北時區是 UTC+8，所以 00:00 台北時間 = 前一天 16:00 UTC
    const todayStart = Date.UTC(ty, tm - 1, td, 0, 0, 0, 0) - (8 * 60 * 60 * 1000);
    const todayEnd = Date.UTC(ty, tm - 1, td, 0, 0, 0, 0) + (16 * 60 * 60 * 1000) - 1;
    const taskKey = 'login';

    // 查詢是否已有記錄
    const existingResult = await db.execute(
      `SELECT id, progress, claimed FROM task_progress
       WHERE user_id = ? AND task_key = ? AND updated_at >= ? AND updated_at <= ?`,
      [userId, taskKey, todayStart, todayEnd]
    );
    const existing = existingResult.rows?.[0];

    if (existing) {
      // 已有記錄，不要覆蓋
      return res.json({ success: true, message: '登入任務已完成' });
    }

    // 建立登入任務進度（直接完成）
    const task = DAILY_TASKS.find(t => t.key === 'login');
    if (task) {
      await db.execute(
        `INSERT INTO task_progress (user_id, task_key, progress, claimed, updated_at)
         VALUES (?, ?, ?, 0, ?)`,
        [userId, taskKey, task.target, Date.now()]
      );
    }

    return res.json({ success: true, message: '登入任務已記錄' });
  } catch (error) {
    console.error('登入任務錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 領取獎勵
router.post('/:id/claim', async (req: AuthRequest, res: Response) => {
  try {
    await initTables();
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }

    const taskId = parseInt(req.params.id);
    const task = DAILY_TASKS.find(t => t.id === taskId);

    if (!task) {
      return res.status(404).json({ success: false, message: '任務不存在' });
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    // 計算今日時間戳範圍（台北時區 UTC+8）- 使用 toLocaleString 避免時區問題
    const taipeiDateStr = today.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const [ty, tm, td] = taipeiDateStr.split('-').map(Number);
    // 台北時區是 UTC+8，所以 00:00 台北時間 = 前一天 16:00 UTC
    const todayStart = Date.UTC(ty, tm - 1, td, 0, 0, 0, 0) - (8 * 60 * 60 * 1000);
    const todayEnd = Date.UTC(ty, tm - 1, td, 0, 0, 0, 0) + (16 * 60 * 60 * 1000) - 1;

    // 查詢進度（取最新的記錄）
    const progressResult = await db.execute(
      `SELECT id, progress, claimed FROM task_progress
       WHERE user_id = ? AND task_key = ? AND updated_at >= ? AND updated_at <= ?
       ORDER BY updated_at DESC LIMIT 1`,
      [userId, task.key, todayStart, todayEnd]
    );
    const progress = progressResult.rows?.[0];

    if (!progress) {
      return res.status(400).json({ success: false, message: '任務尚未開始' });
    }

    if (progress.claimed) {
      return res.status(400).json({ success: false, message: '獎勵已領取' });
    }

    if (progress.progress < task.target) {
      return res.status(400).json({ success: false, message: '任務尚未完成' });
    }

    // 發放獎勵
    await db.execute(
      `UPDATE users SET gold = gold + ?, exp = exp + ? WHERE id = ?`,
      [task.rewardCoins, task.rewardExp, userId]
    );

    // 標記為已領取
    await db.execute(
      `UPDATE task_progress SET claimed = 1 WHERE id = ?`,
      [progress.id]
    );

    // 取得更新後的玩家資料
    const userResult = await db.execute(
      `SELECT gold, exp, level FROM users WHERE id = ?`,
      [userId]
    );
    const user = userResult.rows?.[0];

    return res.json({
      success: true,
      message: '任務完成！',
      reward: { coins: task.rewardCoins, exp: task.rewardExp },
      user: { gold: user?.gold, exp: user?.exp, level: user?.level },
    });
  } catch (error) {
    console.error('領取獎勵錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// DEBUG endpoint - 直接查 task_progress，無需 auth
router.get('/debug-progress', async (req: AuthRequest, res: Response) => {
  try {
    const userId = 35;
    const today = new Date();
    const taipeiDateStr = today.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const [ty, tm, td] = taipeiDateStr.split('-').map(Number);
    const todayStart = Date.UTC(ty, tm - 1, td, 0, 0, 0, 0) - (8 * 60 * 60 * 1000);
    const todayEnd = Date.UTC(ty, tm - 1, td, 0, 0, 0, 0) + (16 * 60 * 60 * 1000) - 1;

    const allRows = await db.execute(
      `SELECT * FROM task_progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20`,
      [userId]
    );
    const rangedRows = await db.execute(
      `SELECT * FROM task_progress WHERE user_id = ? AND updated_at >= ? AND updated_at <= ? ORDER BY updated_at DESC`,
      [userId, todayStart, todayEnd]
    );
    const harvestRows = await db.execute(
      `SELECT *, typeof(updated_at) as updated_at_type FROM task_progress WHERE user_id = ? AND task_key IN ('harvest_wheat', 'harvest_any', 'complete_order', 'login') ORDER BY updated_at DESC`,
      [userId]
    );

    res.json({
      debug: true,
      params: { userId, todayStart, todayEnd, todayStartISO: new Date(todayStart).toISOString(), todayEndISO: new Date(todayEnd).toISOString() },
      allRows: allRows.rows,
      rangedRows: rangedRows.rows,
      harvestRows: harvestRows.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
