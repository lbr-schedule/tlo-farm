// ============================================================
// CropSystem.ts — Crop system facade (M002.5)
// Handles crop state: validate, optimistic plant, rollback
// No API, no UI, no events — only game state
// ============================================================

import type { TileData } from './TileTypes';
import { getCropDetails } from './CropConfig';

// ── Result Types ─────────────────────────────────────────────

export interface ValidatePlantResult {
  valid: true;
  originalState: TileData;
}

export interface ValidatePlantFailure {
  valid: false;
  reason: string;
}

export type PlantValidation = ValidatePlantResult | ValidatePlantFailure;

// ── validateCanPlant ─────────────────────────────────────────

export function validateCanPlant(
  farmState: Map<number, TileData>,
  index: number,
  cropId: number
): PlantValidation {
  const state = farmState.get(index);
  if (!state) {
    return { valid: false, reason: 'tile_not_found' };
  }
  if (state.cropState !== 'empty') {
    return { valid: false, reason: 'tile_not_empty' };
  }
  return { valid: true, originalState: state };
}

// ── createOptimisticPlantState ───────────────────────────────

export function createOptimisticPlantState(
  cropId: number,
  originalState: TileData
): Partial<TileData> {
  const now = Date.now();
  const cropInfo = getCropDetails(cropId);
  const growTimeMs = (cropInfo?.growTimeSec || 60) * 1000;

  return {
    cropId,
    plantedAt: now,
    finishAt: now + growTimeMs,
    wateredAt: undefined,
    isWatered: false,
    isFertilized: 0,
    fertilizedAt: undefined,
    cropStatus: 'needs_water' as const,
    state: 'growing' as const,
    cropState: 'growing' as const,
    soilState: 'dry' as const,
    dryStartedAt: undefined,
    careCheckAt: now + 10000,
  };
}

// ── applyOptimisticPlant ─────────────────────────────────────

export function applyOptimisticPlant(
  farmState: Map<number, TileData>,
  index: number,
  optimisticState: Partial<TileData>
): void {
  const existing = farmState.get(index);
  if (!existing) return;
  farmState.set(index, { ...existing, ...optimisticState });
}

// ── rollbackPlant ──────────────────────────────────────────

export function rollbackPlant(
  farmState: Map<number, TileData>,
  index: number,
  originalState: TileData
): void {
  farmState.set(index, originalState);
}
