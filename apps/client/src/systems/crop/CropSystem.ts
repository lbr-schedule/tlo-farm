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

// ══════════════════════════════════════════════════════════════
// WATER — M002.6
// ══════════════════════════════════════════════════════════════

const VALID_WATER_STATES = ['growing', 'seedling', 'seed', 'dry'];

export interface ValidateWaterResult {
  valid: true;
  originalState: TileData;
}

export interface ValidateWaterFailure {
  valid: false;
  reason: string;
}

export type WaterValidation = ValidateWaterResult | ValidateWaterFailure;

// ── validateCanWater ─────────────────────────────────────────

export function validateCanWater(
  farmState: Map<number, TileData>,
  index: number
): WaterValidation {
  const state = farmState.get(index);
  if (!state) {
    return { valid: false, reason: 'tile_not_found' };
  }
  if (!VALID_WATER_STATES.includes(state.cropState)) {
    return { valid: false, reason: 'invalid_crop_state' };
  }
  return { valid: true, originalState: state };
}

// ── createOptimisticWaterState ───────────────────────────────

export function createOptimisticWaterState(): Partial<TileData> {
  return {
    wateredAt: Date.now(),
    isWatered: true,
    cropStatus: 'healthy',
    soilState: 'watered',
  };
}

// ── applyOptimisticWater ────────────────────────────────────

export function applyOptimisticWater(
  farmState: Map<number, TileData>,
  index: number,
  optimisticState: Partial<TileData>
): void {
  const existing = farmState.get(index);
  if (!existing) return;
  farmState.set(index, { ...existing, ...optimisticState });
}

// ── rollbackWater ───────────────────────────────────────────

export function rollbackWater(
  farmState: Map<number, TileData>,
  index: number,
  originalState: TileData
): void {
  farmState.set(index, originalState);
}

// ══════════════════════════════════════════════════════════════
// FERTILIZE — M002.7
// ══════════════════════════════════════════════════════════════

const VALID_FERTILIZE_STATES = ['growing', 'seedling', 'seed', 'dry'];

export interface ValidateFertilizeResult {
  valid: true;
  originalState: TileData;
}

export interface ValidateFertilizeFailure {
  valid: false;
  reason: string;
}

export type FertilizeValidation = ValidateFertilizeResult | ValidateFertilizeFailure;

// ── validateCanFertilize ─────────────────────────────────────

export function validateCanFertilize(
  farmState: Map<number, TileData>,
  index: number
): FertilizeValidation {
  const state = farmState.get(index);
  if (!state) {
    return { valid: false, reason: 'tile_not_found' };
  }
  if (!VALID_FERTILIZE_STATES.includes(state.cropState)) {
    return { valid: false, reason: 'invalid_crop_state' };
  }
  if (state.isFertilized) {
    return { valid: false, reason: 'already_fertilized' };
  }
  return { valid: true, originalState: state };
}

// ══════════════════════════════════════════════════════════════
// HARVEST — M002.8
// ══════════════════════════════════════════════════════════════

export interface ValidateHarvestResult {
  valid: true;
}

export interface ValidateHarvestFailure {
  valid: false;
  reason: 'crop_is_withered' | 'crop_not_mature' | 'no_crop_id';
}

export type HarvestValidation = ValidateHarvestResult | ValidateHarvestFailure;

// ── validateCanHarvest ───────────────────────────────────────
// 純規則驗證，不觸碰 farmState / UI / API / Backpack
// 注意：dry 由呼叫端（FarmScene）先行處理，這裡不回傳 dry 相關 reason
export function validateCanHarvest(
  state: TileData
): HarvestValidation {
  if (state.cropState === 'withered') {
    return { valid: false, reason: 'crop_is_withered' };
  }
  if (state.cropState !== 'mature') {
    return { valid: false, reason: 'crop_not_mature' };
  }
  if (!state.cropId) {
    return { valid: false, reason: 'no_crop_id' };
  }
  return { valid: true };
}
