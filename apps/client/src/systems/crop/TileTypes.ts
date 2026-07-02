// ============================================================
// TileTypes.ts — Tile data types (M002.2)
// Extracted from FarmScene.ts
// Pure type definitions only — no game logic
// ============================================================

/**
 * Client-side tile state for FarmScene rendering.
 * Matches server TileData but includes computed client fields.
 */
export interface TileData {
  x: number;
  y: number;
  type: 'grass' | 'soil' | 'path' | 'tree';
  cropId?: number;
  plantedAt?: number;
  finishAt?: number;
  wateredAt?: number;       // 上次澆水時間(ms)
  isWatered: boolean;       // 是否在 30 分鐘內澆過水
  cropStatus: 'healthy' | 'needs_water';  // MVP 暫時只有這兩種
  state: 'empty' | 'seed' | 'seedling' | 'growing' | 'mature' | 'dry' | 'withered'; // 來自後端(兼容用)
  cropState: 'empty' | 'seed' | 'seedling' | 'growing' | 'mature' | 'dry' | 'withered'; // 計算後(dry/withered 優先)
  soilState: 'dry' | 'watered'; // 土地視覺狀態
  readyAnimated?: boolean;
  growingStartedAt?: number;
  isFertilized?: number;         // 0 或 1
  fertilizedAt?: number | null;
  fertilizerType?: string;
  fertilizerSpeedBonus?: number;
  dryStartedAt?: number | null;  // 進入乾燥狀態的時間戳(ms)
  careCheckAt?: number | null; // 播種後 10 秒才開始檢查照顧條件
}
