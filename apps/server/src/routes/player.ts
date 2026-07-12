import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '@tlo-farm/database';

const router: RouterType = Router();

// 中間層：驗證 JWT
function authMiddleware(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '未提供認證令牌' });
  }
  const token = authHeader.substring(7);
  const secret = process.env.JWT_SECRET || 'default-secret-change-me';
  try {
    const payload = jwt.verify(token, secret) as { userId: number; account: string };
    (req as any).userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ success: false, message: '無效的認證令牌' });
  }
}

// 更新個人資料（暱稱、農場名稱、簽名）
router.patch('/profile', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { nickname, farmName, signature }: { nickname?: string; farmName?: string; signature?: string } = req.body;

    const updates: string[] = [];
    const values: any[] = [];

    if (nickname !== undefined) {
      if (typeof nickname !== 'string' || nickname.trim().length < 1 || nickname.trim().length > 16) {
        return res.status(400).json({ success: false, message: '玩家名稱需為 1～16 字' });
      }
      // 禁止特殊符號（只允許中文、英文、數字、空格）
      if (!/^[a-zA-Z0-9\u4E00-\u9FFF\s]{1,16}$/.test(nickname.trim())) {
        return res.status(400).json({ success: false, message: '玩家名稱僅限中英文和數字' });
      }
      updates.push('nickname = ?');
      values.push(nickname.trim());
    }

    if (farmName !== undefined) {
      if (typeof farmName !== 'string' || farmName.trim().length < 2 || farmName.trim().length > 16) {
        return res.status(400).json({ success: false, message: '農場名稱需為 2～16 字' });
      }
      if (!/^[a-zA-Z0-9\u4E00-\u9FFF\s]{2,16}$/.test(farmName.trim())) {
        return res.status(400).json({ success: false, message: '農場名稱僅限中英文和數字' });
      }
      updates.push('farm_name = ?');
      values.push(farmName.trim());
    }

    if (signature !== undefined) {
      if (typeof signature !== 'string' || signature.length > 30) {
        return res.status(400).json({ success: false, message: '個人簽名最多 30 字' });
      }
      updates.push('signature = ?');
      values.push(signature);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '沒有要更新的欄位' });
    }

    values.push(userId);
    await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    // 取回更新後的資料
    const result = await db.execute(
      `SELECT id, account, nickname, level, exp, gold, player_code as playerCode,
       farm_name as farmName, invite_code as inviteCode, diamonds,
       friend_count as friendCount, friend_limit as friendLimit,
       farm_popularity as farmPopularity, avatar, title_id as titleId,
       signature, created_at as createdAt, last_login_at as lastLoginAt FROM users WHERE id = ?`,
      [userId]
    );

    const rows = result.rows as any[];
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    return res.json({ success: true, message: '更新成功', user });
  } catch (error) {
    console.error('更新個人資料錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤，請稍後再試' });
  }
});

// 上傳自訂頭像（base64 格式）
router.post('/avatar', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { imageData }: { imageData?: string } = req.body;

    if (!imageData || !imageData.startsWith('data:image/')) {
      return res.status(400).json({ success: false, message: '無效的圖片資料' });
    }

    // 從 data URL 解析格式
    const match = imageData.match(/^data:image\/(\w+);base64,/);
    if (!match) {
      return res.status(400).json({ success: false, message: '無效的圖片格式' });
    }
    const ext = match[1]; // png, jpeg, webp

    // 生成檔名
    const filename = `avatar_${userId}_${Date.now()}.${ext}`;
    const fs = require('fs');
    const path = require('path');
    const uploadDir = path.join(process.cwd(), '../client/public/uploads/avatars');
    const finalPath = path.join(uploadDir, filename);

    // 確保目錄存在
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 寫入檔案（去掉 data URL prefix）
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(finalPath, buffer);

    const avatarUrl = `/uploads/avatars/${filename}`;
    return res.json({ success: true, avatarUrl });
  } catch (error) {
    console.error('上傳頭像錯誤:', error);
    return res.status(500).json({ success: false, message: '上傳失敗' });
  }
});

// 更新頭像（選擇預設 or 自訂）
router.patch('/avatar', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { avatarUrl }: { avatarUrl?: string } = req.body;

    if (!avatarUrl) {
      return res.status(400).json({ success: false, message: '請提供頭像網址' });
    }

    await db.execute('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, userId]);

    return res.json({ success: true, message: '頭像更新成功' });
  } catch (error) {
    console.error('更新頭像錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤，請稍後再試' });
  }
});

export default router;
