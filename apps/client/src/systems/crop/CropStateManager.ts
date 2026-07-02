// ============================================================
// CropStateManager.ts — Crop state computation (M002.3)
// Extracted from FarmScene.ts
// Pure functions only — no game logic, no side effects
// ============================================================

import type { TileData } from './TileTypes';

/**
 * Compute client-side cropState from server tile data.
 * Pure function: same inputs always produce same output.
 */
export function computeCropState(
  cropId: number | undefined,
  finishAt: number | undefined,
  serverState: string
): TileData['cropState'] {
  if (!cropId || !finishAt) return 'empty';
  if (Date.now() >= finishAt) return 'mature';
  // 時間還沒到，用 serverState 或從 progress 推算
  if (serverState === 'seed') return 'seed';
  if (serverState === 'seedling') return 'seedling';
  return 'growing';
}
