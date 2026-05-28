import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db, users, refreshTokens, type User } from '@tlo-farm/database';
import { LoginRequest, RegisterRequest, AuthResponse } from '@tlo-farm/shared';

const router = Router();

// 登入
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { account, password }: LoginRequest = req.body;

    // 驗證必填欄位
    if (!account || !password) {
      return res.status(400).json({
        success: false,
        message: '請填寫帳號和密碼'
      } as AuthResponse);
    }

    // 查詢用戶
    const user = await db.select().from(users).where(eq(users.account, account)).get();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '帳號或密碼錯誤'
      } as AuthResponse);
    }

    // 驗證密碼
    const passwordValid = await bcrypt.compare(password, user.passwordHash);

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: '帳號或密碼錯誤'
      } as AuthResponse);
    }

    // 更新最後登入時間
    await db.update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    // 產生 JWT
    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user.id);

    return res.json({
      success: true,
      message: '登入成功',
      user: {
        id: user.id,
        account: user.account,
        nickname: user.nickname,
        level: user.level,
        exp: user.exp,
        gold: user.gold
      },
      accessToken,
      refreshToken
    } as AuthResponse);
  } catch (error) {
    console.error('登入錯誤:', error);
    return res.status(500).json({
      success: false,
      message: '伺服器錯誤，請稍後再試'
    } as AuthResponse);
  }
});

// 註冊
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { account, password, nickname, email }: RegisterRequest = req.body;

    // 驗證必填欄位
    if (!account || !password || !nickname) {
      return res.status(400).json({
        success: false,
        message: '請填寫所有必填欄位'
      } as AuthResponse);
    }

    // 驗證帳號格式（4-20字，英文數字）
    if (!/^[a-zA-Z0-9]{4,20}$/.test(account)) {
      return res.status(400).json({
        success: false,
        message: '帳號需為4-20字，僅限英文和數字'
      } as AuthResponse);
    }

    // 驗證密碼長度
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: '密碼至少需要6個字元'
      } as AuthResponse);
    }

    // 檢查帳號是否已存在
    const existingUser = await db.select().from(users).where(eq(users.account, account)).get();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: '此帳號已被註冊'
      } as AuthResponse);
    }

    // 雜湊密碼
    const passwordHash = await bcrypt.hash(password, 10);

    // 建立新用戶
    const now = new Date();
    const result = await db.insert(users).values({
      account,
      passwordHash,
      nickname,
      email: email || null,
      level: 1,
      exp: 0,
      gold: 500,
      createdAt: now,
      lastLoginAt: now
    }).returning().get();

    // 產生 JWT
    const accessToken = generateAccessToken(result);
    const refreshToken = await generateRefreshToken(result.id);

    return res.status(201).json({
      success: true,
      message: '註冊成功',
      user: {
        id: result.id,
        account: result.account,
        nickname: result.nickname,
        level: result.level,
        exp: result.exp,
        gold: result.gold
      },
      accessToken,
      refreshToken
    } as AuthResponse);
  } catch (error) {
    console.error('註冊錯誤:', error);
    return res.status(500).json({
      success: false,
      message: '伺服器錯誤，請稍後再試'
    } as AuthResponse);
  }
});

// 刷新 Token
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: '請提供刷新令牌'
      } as AuthResponse);
    }

    // 查詢 refresh token
    const tokenRecord = await db.select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, refreshToken))
      .get();

    if (!tokenRecord) {
      return res.status(401).json({
        success: false,
        message: '無效的刷新令牌'
      } as AuthResponse);
    }

    // 檢查是否過期
    if (new Date() > tokenRecord.expiresAt) {
      // 刪除過期 token
      await db.delete(refreshTokens).where(eq(refreshTokens.id, tokenRecord.id));

      return res.status(401).json({
        success: false,
        message: '刷新令牌已過期，請重新登入'
      } as AuthResponse);
    }

    // 取得用戶資料
    const user = await db.select().from(users).where(eq(users.id, tokenRecord.userId)).get();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '用戶不存在'
      } as AuthResponse);
    }

    // 刪除舊的 refresh token
    await db.delete(refreshTokens).where(eq(refreshTokens.id, tokenRecord.id));

    // 產生新的 JWT
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = await generateRefreshToken(user.id);

    return res.json({
      success: true,
      message: '令牌已刷新',
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    } as AuthResponse);
  } catch (error) {
    console.error('刷新 Token 錯誤:', error);
    return res.status(500).json({
      success: false,
      message: '伺服器錯誤，請稍後再試'
    } as AuthResponse);
  }
});

// 登出
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // 刪除 refresh token
      await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken));
    }

    return res.json({
      success: true,
      message: '已登出'
    });
  } catch (error) {
    console.error('登出錯誤:', error);
    return res.status(500).json({
      success: false,
      message: '伺服器錯誤，請稍後再試'
    });
  }
});

// 取得當前用戶資料
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: '未提供認證令牌'
      });
    }

    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET || 'default-secret-change-me';

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, secret) as JwtPayload;
    } catch {
      return res.status(401).json({
        success: false,
        message: '無效的認證令牌'
      });
    }

    const user = await db.select().from(users).where(eq(users.id, payload.userId)).get();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用戶不存在'
      });
    }

    return res.json({
      success: true,
      message: '成功',
      user: {
        id: user.id,
        account: user.account,
        nickname: user.nickname,
        level: user.level,
        exp: user.exp,
        gold: user.gold
      }
    });
  } catch (error) {
    console.error('取得用戶資料錯誤:', error);
    return res.status(500).json({
      success: false,
      message: '伺服器錯誤，請稍後再試'
    });
  }
});

// 輔助函數
function generateAccessToken(user: User): string {
  const secret = process.env.JWT_SECRET || 'default-secret-change-me';
  const expiresIn = process.env.JWT_EXPIRES_IN || '15m';

  return jwt.sign(
    { userId: user.id, account: user.account },
    secret,
    { expiresIn }
  );
}

async function generateRefreshToken(userId: number): Promise<string> {
  const token = require('crypto').randomBytes(64).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 天過期

  await db.insert(refreshTokens).values({
    userId,
    token,
    expiresAt,
    createdAt: new Date()
  });

  return token;
}

interface JwtPayload {
  userId: number;
  account: string;
}

export default router;
