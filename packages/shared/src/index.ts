// 共用類型
export interface User {
  id: number;
  account: string;
  nickname: string;
  level: number;
  exp: number;
  gold: number;
  createdAt: number;
  lastLoginAt: number;
}

export interface UserProfile {
  id: number;
  account: string;
  nickname: string;
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
  avatar: string | null;
  titleId: string | null;
  signature: string;
  createdAt: number;
  lastLoginAt: number;
}

// API 请求/回應類型
export interface LoginRequest {
  account: string;
  password: string;
}

export interface RegisterRequest {
  account: string;
  password: string;
  nickname: string;
  email?: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  user?: UserProfile;
  accessToken?: string;
  refreshToken?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

// 等級與經驗值常數
export const LEVEL_EXP_REQUIREMENTS = [
  0, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000
] as const;

export const MAX_LEVEL = LEVEL_EXP_REQUIREMENTS.length - 1;

export function getExpForNextLevel(level: number): number {
  if (level >= MAX_LEVEL) return Infinity;
  return LEVEL_EXP_REQUIREMENTS[level + 1];
}

export function getLevelProgress(exp: number, level: number): { current: number; required: number; percentage: number } {
  const currentLevelExp = level > 0 ? LEVEL_EXP_REQUIREMENTS[level] : 0;
  const nextLevelExp = getExpForNextLevel(level);
  const current = exp - currentLevelExp;
  const required = nextLevelExp - currentLevelExp;
  return {
    current,
    required,
    percentage: Math.min(100, (current / required) * 100)
  };
}

// 預設金幣/經驗值
export const INITIAL_GOLD = 500;
export const INITIAL_EXP = 0;
export const INITIAL_LEVEL = 1;
