import { Router, Response } from 'express';
import { db } from '@tlo-farm/database';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// Daily reward definitions
const DAILY_REWARDS = [
  { day: 1, type: 'gold', itemId: null, amount: 100, label: '金幣 ×100' },
  { day: 2, type: 'seed', itemId: 1, amount: 5, label: '小麥種子 ×5' },
  { day: 3, type: 'seed', itemId: 2, amount: 5, label: '玉米種子 ×5' },
  { day: 4, type: 'gold', itemId: null, amount: 150, label: '金幣 ×150' },
  { day: 5, type: 'seed', itemId: 3, amount: 5, label: '紅蘿蔔種子 ×5' },
  { day: 6, type: 'seed', itemId: 4, amount: 5, label: '馬鈴薯種子 ×5' },
  { day: 7, type: 'diamond', itemId: null, amount: 1, label: '鑽石 ×1' },
];

// Helper: get today's date string
function getTodayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Helper: get yesterday's date string
function getYesterdayStr(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// GET /api/events/daily-login - Get current daily login status
router.get('/daily-login', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登入' });
    }

    const todayStr = getTodayStr();
    const yesterdayStr = getYesterdayStr();

    // Get or create daily_login_rewards record
    let result = await db.execute(
      'SELECT * FROM daily_login_rewards WHERE user_id = ?',
      [userId]
    );
    let record = result.rows && result.rows.length > 0 ? result.rows[0] : null;

    if (!record) {
      // First time - create new record
      await db.execute(
        `INSERT INTO daily_login_rewards (user_id, current_day, last_login_date, streak_days, total_login_days, today_claimed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, 1, todayStr, 1, 1, 0, Date.now(), Date.now()]
      );
      record = {
        id: 0,
        user_id: userId,
        current_day: 1,
        last_login_date: todayStr,
        streak_days: 1,
        total_login_days: 1,
        today_claimed: 0
      };
    } else {
      // Check if we need to update for a new day
      const lastLoginDate = record.last_login_date;

      if (lastLoginDate !== todayStr) {
        let newStreakDays = record.streak_days;
        let newTotalDays = record.total_login_days;
        let newCurrentDay = record.current_day;
        let newTodayClaimed = 0;

        if (lastLoginDate === yesterdayStr) {
          // Consecutive day - increment streak
          newStreakDays = record.streak_days + 1;
          newTotalDays = record.total_login_days + 1;
          newCurrentDay = (record.current_day % 7) + 1;
        } else {
          // Missed a day or first day - reset streak
          newStreakDays = 1;
          newTotalDays = record.total_login_days + 1;
          newCurrentDay = 1;
        }

        await db.execute(
          `UPDATE daily_login_rewards SET current_day = ?, last_login_date = ?, streak_days = ?, total_login_days = ?, today_claimed = ?, updated_at = ? WHERE user_id = ?`,
          [newCurrentDay, todayStr, newStreakDays, newTotalDays, newTodayClaimed, Date.now(), userId]
        );

        record = {
          ...record,
          current_day: newCurrentDay,
          last_login_date: todayStr,
          streak_days: newStreakDays,
          total_login_days: newTotalDays,
          today_claimed: newTodayClaimed
        };
      }
    }

    const currentDay = record.current_day as number;
    const todayClaimed = !!record.today_claimed;

    // Build rewards list with status
    const rewards = DAILY_REWARDS.map(reward => {
      let status: 'claimed' | 'claimable' | 'locked';
      if (reward.day < currentDay) {
        status = 'claimed';
      } else if (reward.day === currentDay && !todayClaimed) {
        status = 'claimable';
      } else if (reward.day === currentDay && todayClaimed) {
        status = 'claimed';
      } else {
        status = 'locked';
      }
      return {
        day: reward.day,
        label: reward.label,
        status
      };
    });

    return res.json({
      success: true,
      data: {
        currentDay,
        streakDays: record.streak_days,
        totalLoginDays: record.total_login_days,
        todayClaimed,
        rewards
      }
    });
  } catch (error) {
    console.error('取得每日登入狀態錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// POST /api/events/daily-login/claim - Claim today's reward
router.post('/daily-login/claim', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登入' });
    }

    const todayStr = getTodayStr();

    // Get current record
    const result = await db.execute(
      'SELECT * FROM daily_login_rewards WHERE user_id = ?',
      [userId]
    );
    const record = result.rows && result.rows.length > 0 ? result.rows[0] : null;

    if (!record) {
      return res.status(400).json({ success: false, message: '請先取得每日登入狀態' });
    }

    if (record.last_login_date !== todayStr) {
      return res.status(400).json({ success: false, message: '請先刷新每日登入狀態' });
    }

    if (record.today_claimed) {
      return res.status(400).json({ success: false, message: '今日已領取過獎勵' });
    }

    const currentDay = record.current_day as number;
    const reward = DAILY_REWARDS[currentDay - 1];
    if (!reward) {
      return res.status(500).json({ success: false, message: '獎勵資料錯誤' });
    }

    // Award the reward
    if (reward.type === 'gold') {
      // Add gold to user
      await db.execute(
        'UPDATE users SET gold = gold + ? WHERE id = ?',
        [reward.amount, userId]
      );
    } else if (reward.type === 'diamond') {
      // Add diamond to user
      await db.execute(
        'UPDATE users SET diamonds = diamonds + ? WHERE id = ?',
        [reward.amount, userId]
      );
    } else if (reward.type === 'seed' && reward.itemId) {
      // Add seeds to inventory
      // Check if user already has this seed
      const invResult = await db.execute(
        'SELECT id, amount FROM inventories WHERE user_id = ? AND item_type = ? AND item_id = ?',
        [userId, 'seed', reward.itemId]
      );
      const existingInv = invResult.rows && invResult.rows.length > 0 ? invResult.rows[0] : null;

      if (existingInv) {
        await db.execute(
          'UPDATE inventories SET amount = amount + ? WHERE id = ?',
          [reward.amount, existingInv.id]
        );
      } else {
        await db.execute(
          'INSERT INTO inventories (user_id, item_type, item_id, amount) VALUES (?, ?, ?, ?)',
          [userId, 'seed', reward.itemId, reward.amount]
        );
      }
    }

    // Mark as claimed
    await db.execute(
      'UPDATE daily_login_rewards SET today_claimed = 1, updated_at = ? WHERE user_id = ?',
      [Date.now(), userId]
    );

    // Get updated user data for gold/diamond
    let updatedUser: any = null;
    if (reward.type === 'gold' || reward.type === 'diamond') {
      const userResult = await db.execute(
        'SELECT gold, diamonds FROM users WHERE id = ?',
        [userId]
      );
      if (userResult.rows && userResult.rows.length > 0) {
        updatedUser = userResult.rows[0];
      }
    }

    return res.json({
      success: true,
      message: `領取成功！獲得 ${reward.label}`,
      reward: reward.label,
      updatedUser
    });
  } catch (error) {
    console.error('領取每日登入獎勵錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;
