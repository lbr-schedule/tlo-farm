import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '@tlo-farm/database';

const router = Router();

interface User {
  id: number;
  account: string;
  passwordHash: string;
  nickname: string;
  email: string | null;
  level: number;
  exp: number;
  gold: number;
  playerCode: string;
  farmName: string;
  inviteCode: string;
  diamonds: number;
  friendCount: number;
  friendLimit: number;
  farmPopularity: number;
  avatar: string;
  titleId: string;
  signature: string;
  createdAt: number;
  lastLoginAt: number;
}

function userToJson(user: User) {
  return {
    id: user.id,
    account: user.account,
    nickname: user.nickname,
    level: user.level,
    exp: user.exp,
    gold: user.gold,
    playerCode: user.playerCode,
    farmName: user.farmName,
    inviteCode: user.inviteCode,
    diamonds: user.diamonds,
    friendCount: user.friendCount,
    friendLimit: user.friendLimit,
    farmPopularity: user.farmPopularity,
    avatar: user.avatar,
    titleId: user.titleId,
    signature: user.signature,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

const USER_SELECT = `SELECT id, account, password_hash as passwordHash, nickname, email, level, exp, gold,
  player_code as playerCode, farm_name as farmName, invite_code as inviteCode,
  diamonds, friend_count as friendCount, friend_limit as friendLimit,
  farm_popularity as farmPopularity, avatar, title_id as titleId,
  signature, created_at as createdAt, last_login_at as lastLoginAt FROM users`;

// Debug endpoint
router.get('/debug-env', (req: Request, res: Response) => {
  res.json({
    farmDbUrl: process.env.FARM_DATABASE_URL || 'NOT_SET',
    hasFarmToken: !!process.env.FARM_DATABASE_AUTH_TOKEN,
    farmTokenPrefix: (process.env.FARM_DATABASE_AUTH_TOKEN || '').substring(0, 30),
    fallbackDbUrl: process.env.DATABASE_URL || 'NOT_SET',
    hasFallbackToken: !!process.env.DATABASE_AUTH_TOKEN
  });
});

// 登入
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { account, password }: { account?: string; password?: string } = req.body;

    if (!account || !password) {
      return res.status(400).json({ success: false, message: '請填寫帳號和密碼' });
    }

    const result = await db.execute(`${USER_SELECT} WHERE account = ?`, [account]);
    const rows = result.rows as User[];
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
    }

    await db.execute('UPDATE users SET last_login_at = ? WHERE id = ?', [Date.now(), user.id]);

    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user.id);

    return res.json({
      success: true,
      message: '登入成功',
      user: userToJson(user),
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('登入錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤，請稍後再試' });
  }
});

// 註冊
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { account, password, nickname, email, inviteCode }: { account?: string; password?: string; nickname?: string; email?: string; inviteCode?: string } = req.body;

    if (!account || !password || !nickname) {
      return res.status(400).json({ success: false, message: '請填寫所有必填欄位' });
    }

    if (!/^[a-zA-Z0-9]{4,20}$/.test(account)) {
      return res.status(400).json({ success: false, message: '帳號需為4-20字，僅限英文和數字' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: '密碼至少需要6個字元' });
    }

    const existing = await db.execute('SELECT id FROM users WHERE account = ?', [account]);
    if ((existing.rows as User[]).length > 0) {
      return res.status(409).json({ success: false, message: '此帳號已被註冊' });
    }

    const now = Date.now();
    const passwordHash = await bcrypt.hash(password, 10);
    function genPlayerCode() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let r = ''; for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
      return 'TLO-' + r;
    }
    const playerCode = genPlayerCode();
    const farmName = nickname + '的農場';
    const signature = '歡迎來我的農場！';

    const insertResult = await db.execute(
      `INSERT INTO users (account, password_hash, nickname, email, level, exp, gold, player_code, farm_name, invite_code, signature, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [account, passwordHash, nickname, email || null, 1, 0, 500, playerCode, farmName, account, signature, now, now]
    );

    if (!insertResult.rowsAffected) {
      return res.status(500).json({ success: false, message: '創建用戶失敗' });
    }

    const userRows = await db.execute(`${USER_SELECT} WHERE id = last_insert_rowid()`);
    const newUser = (userRows.rows as User[])[0];

    if (!newUser) {
      return res.status(500).json({ success: false, message: '創建用戶失敗' });
    }

    const accessToken = generateAccessToken(newUser);
    const refreshToken = await generateRefreshToken(newUser.id);

    return res.status(201).json({
      success: true,
      message: '註冊成功',
      user: userToJson(newUser),
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('註冊錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤，請稍後再試' });
  }
});

// 刷新 Token
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken }: { refreshToken?: string } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: '請提供刷新令牌' });
    }

    const tokenResult = await db.execute('SELECT * FROM refresh_tokens WHERE token = ?', [refreshToken]);
    const tokenRows = tokenResult.rows as { id: number; user_id: number; expires_at: number }[];
    const tokenRecord = tokenRows[0];

    if (!tokenRecord) {
      return res.status(401).json({ success: false, message: '無效的刷新令牌' });
    }

    if (Date.now() > tokenRecord.expires_at) {
      await db.execute('DELETE FROM refresh_tokens WHERE id = ?', [tokenRecord.id]);
      return res.status(401).json({ success: false, message: '刷新令牌已過期，請重新登入' });
    }

    const userResult = await db.execute(`${USER_SELECT} WHERE id = ?`, [tokenRecord.user_id]);
    const userRows = userResult.rows as User[];
    const user = userRows[0];

    if (!user) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    await db.execute('DELETE FROM refresh_tokens WHERE id = ?', [tokenRecord.id]);
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = await generateRefreshToken(user.id);

    return res.json({
      success: true,
      message: '令牌已刷新',
      user: userToJson(user),
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    console.error('刷新 Token 錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤，請稍後再試' });
  }
});

// 登出
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { refreshToken }: { refreshToken?: string } = req.body;
    if (refreshToken) {
      await db.execute('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    }
    return res.json({ success: true, message: '已登出' });
  } catch (error) {
    console.error('登出錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤，請稍後再試' });
  }
});

// 取得當前用戶資料
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未提供認證令牌' });
    }

    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET || 'default-secret-change-me';

    let payload: { userId: number; account: string };
    try {
      payload = jwt.verify(token, secret) as { userId: number; account: string };
    } catch {
      return res.status(401).json({ success: false, message: '無效的認證令牌' });
    }

    const result = await db.execute(`${USER_SELECT} WHERE id = ?`, [payload.userId]);
    const rows = result.rows as User[];
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    return res.json({ success: true, message: '成功', user: userToJson(user) });
  } catch (error) {
    console.error('取得用戶資料錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤，請稍後再試' });
  }
});

function generateAccessToken(user: { id: number; account: string }): string {
  const secret = process.env.JWT_SECRET || 'default-secret-change-me';
  const expiresIn = process.env.JWT_EXPIRES_IN || '15m';
  return jwt.sign({ userId: user.id, account: user.account }, secret, { expiresIn });
}

async function generateRefreshToken(userId: number): Promise<string> {
  const token = require('crypto').randomBytes(64).toString('hex');
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await db.execute('INSERT INTO refresh_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)', [userId, token, expiresAt, Date.now()]);
  return token;
}

export default router;
