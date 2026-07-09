/**
 * M003.3 — Farmland Placement Pure Rule System
 *
 * 純規則判斷：無 Phaser、無 API、無 DB、無副作用
 * 只需給定 tile 座標與遊戲狀態，即可判定是否可以放置農地
 */

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type FarmlandBlockedBy =
  | 'none'
  | 'out_of_bounds'
  | 'farmland'
  | 'chicken_coop'
  | 'not_adjacent';

export interface FarmlandPlacementParams {
  tileX: number;
  tileY: number;
  /** 目前已放置的所有農地 tile 座標 */
  farmTiles: Array<{ x: number; y: number }>;
  /** 雞舍資訊，null 表示尚未放置雞舍 */
  chickenCoop: {
    placed: boolean;
    tileX: number;
    tileY: number;
    width: number;   // 目前固定 2
    height: number;  // 目前固定 2
  } | null;
  /** 農地 tile 範圍邊界 */
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

export interface FarmlandPlacementResult {
  canPlace: boolean;
  blockedBy: FarmlandBlockedBy;
}

// ─────────────────────────────────────────
// Pure Rule Function
// ─────────────────────────────────────────

/**
 * 判定指定 tile 座標是否可以放置農地
 *
 * 規則：
 * 1. 邊界檢查 — 超出 bounds 範圍 → out_of_bounds
 * 2. 農地重疊檢查 — 與現有農地 tile 座標重疊 → farmland
 * 3. 雞舍衝突檢查 — 落入雞舍 2×2 區域 → chicken_coop
 * 4. 相鄰檢查 — 與任何現有農地上下左右相鄰 → ok
 *                                  未相鄰且已有農地存在 → not_adjacent
 */
export function validateCanPlaceFarmland(params: FarmlandPlacementParams): FarmlandPlacementResult {
  const { tileX, tileY, farmTiles, chickenCoop, bounds } = params;

  // 1. 邊界檢查
  if (tileX < bounds.minX || tileX > bounds.maxX || tileY < bounds.minY || tileY > bounds.maxY) {
    return { canPlace: false, blockedBy: 'out_of_bounds' };
  }

  // 2. 農地 tile 座標不重疊
  for (const tile of farmTiles) {
    if (tile.x === tileX && tile.y === tileY) {
      return { canPlace: false, blockedBy: 'farmland' };
    }
  }

  // 3. 雞舍 2×2 區域不重疊
  if (chickenCoop && chickenCoop.placed) {
    const { tileX: coopX, tileY: coopY, width: coopW, height: coopH } = chickenCoop;
    if (
      tileX >= coopX &&
      tileX < coopX + coopW &&
      tileY >= coopY &&
      tileY < coopY + coopH
    ) {
      return { canPlace: false, blockedBy: 'chicken_coop' };
    }
  }

  // 4. 必須與現有農地相鄰（上下左右至少一格）
  if (farmTiles.length > 0) {
    const hasNeighbor = farmTiles.some(tile =>
      (tile.x === tileX && (tile.y === tileY - 1 || tile.y === tileY + 1)) ||
      (tile.y === tileY && (tile.x === tileX - 1 || tile.x === tileX + 1))
    );
    if (!hasNeighbor) {
      return { canPlace: false, blockedBy: 'not_adjacent' };
    }
  }

  return { canPlace: true, blockedBy: 'none' };
}
