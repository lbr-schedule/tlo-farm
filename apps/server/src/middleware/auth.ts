import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: number;
  userAccount?: string;
}

export interface JwtPayload {
  userId: number;
  account: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: '未提供認證令牌',
      error: 'NO_TOKEN'
    });
  }

  const token = authHeader.substring(7);

  try {
    const secret = process.env.JWT_SECRET || 'default-secret-change-me';
    const payload = jwt.verify(token, secret) as JwtPayload;

    req.userId = payload.userId;
    req.userAccount = payload.account;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        success: false,
        message: '認證令牌已過期，請重新登入',
        error: 'TOKEN_EXPIRED'
      });
    }

    return res.status(401).json({
      success: false,
      message: '無效的認證令牌',
      error: 'INVALID_TOKEN'
    });
  }
}
