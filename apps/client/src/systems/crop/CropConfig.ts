// ============================================================
// CropConfig — 作物相關純設定資料
// 
// 搬移自 FarmScene.ts
// 目的：CropSystem 重構 Tier 0 — 純資料分離
//
// 【重要】getCropDetails() 需要 loadCropDetails() 初始化 cropDetailsCache
// 初始化由 FarmScene.loadCropDetails() 呼叫 cropConfig.setupCropCache()
// ============================================================

// ─────────────────────────────────────────
//  Tile Types（土地類型）
// ─────────────────────────────────────────
export const TILE_SIZE = 32;
export const GRID_WIDTH = 16;
export const GRID_HEIGHT = 16;

export const TILE_TYPES = {
  GRASS: 'grass',
  SOIL: 'soil',
  PATH: 'path',
  TREE: 'tree'
} as const;

// ─────────────────────────────────────────
//  Crop Data（作物資料型別）
// ─────────────────────────────────────────
export interface CropData {
  id: number;
  nameZhTw: string;
  growTimeSec: number;
  sellPrice: number;
  buyPrice: number;
  exp: number;
  sprite: string;
}

// ─────────────────────────────────────────
//  Growth Stage（生長階段）
// ─────────────────────────────────────────
export type GrowthStage = 'seed' | 'seedling' | 'growing' | 'mature' | 'dry' | 'withered';

// ─────────────────────────────────────────
//  Crop Sprites（作物 Sprite Key 映射）
// ─────────────────────────────────────────
export const CROP_SPRITES: Record<string, Record<GrowthStage, string>> = {
  wheat: {
    seed: 'crop_wheat_seed',
    seedling: 'crop_wheat_seedling',
    growing: 'crop_wheat_growing',
    mature: 'crop_wheat_mature',
    dry: 'crop_wheat_dry',
    withered: 'crop_wheat_withered',
  },
  corn: {
    seed: 'crop_corn_seed',
    seedling: 'crop_corn_seedling',
    growing: 'crop_corn_growing',
    mature: 'crop_corn_mature',
    dry: 'crop_corn_dry',
    withered: 'crop_corn_withered',
  },
  carrot: {
    seed: 'crop_carrot_seed',
    seedling: 'crop_carrot_seedling',
    growing: 'crop_carrot_growing',
    mature: 'crop_carrot_mature',
    dry: 'crop_carrot_dry',
    withered: 'crop_carrot_withered',
  },
  potato: {
    seed: 'crop_potato_seed',
    seedling: 'crop_potato_seedling',
    growing: 'crop_potato_growing',
    mature: 'crop_potato_mature',
    dry: 'crop_potato_dry',
    withered: 'crop_potato_withered',
  },
  sugarcane: {
    seed: 'crop_sugarcane_seed',
    seedling: 'crop_sugarcane_seedling',
    growing: 'crop_sugarcane_growing',
    mature: 'crop_sugarcane_mature',
    dry: 'crop_sugarcane_dry',
    withered: 'crop_sugarcane_withered',
  },
  strawberry: {
    seed: 'crop_strawberry_seed',
    seedling: 'crop_strawberry_seedling',
    growing: 'crop_strawberry_growing',
    mature: 'crop_strawberry_mature',
    dry: 'crop_strawberry_dry',
    withered: 'crop_strawberry_withered',
  },
  tomato: {
    seed: 'crop_tomato_seed',
    seedling: 'crop_tomato_seedling',
    growing: 'crop_tomato_growing',
    mature: 'crop_tomato_mature',
    dry: 'crop_tomato_dry',
    withered: 'crop_tomato_withered',
  },
  pumpkin: {
    seed: 'crop_pumpkin_seed',
    seedling: 'crop_pumpkin_seedling',
    growing: 'crop_pumpkin_growing',
    mature: 'crop_pumpkin_mature',
    dry: 'crop_pumpkin_dry',
    withered: 'crop_pumpkin_withered',
  },
  soybean: {
    seed: 'crop_soybean_seed',
    seedling: 'crop_soybean_seedling',
    growing: 'crop_soybean_growing',
    mature: 'crop_soybean_mature',
    dry: 'crop_soybean_dry',
    withered: 'crop_soybean_withered',
  },
  grape: {
    seed: 'crop_grape_seed',
    seedling: 'crop_grape_seedling',
    growing: 'crop_grape_growing',
    mature: 'crop_grape_mature',
    dry: 'crop_grape_dry',
    withered: 'crop_grape_withered',
  },
  apple: {
    seed: 'crop_apple_seed',
    seedling: 'crop_apple_seedling',
    growing: 'crop_apple_growing',
    mature: 'crop_apple_mature',
    dry: 'crop_apple_dry',
    withered: 'crop_apple_withered',
  },
  cocoa: {
    seed: 'crop_cocoa_seed',
    seedling: 'crop_cocoa_seedling',
    growing: 'crop_cocoa_growing',
    mature: 'crop_cocoa_mature',
    dry: 'crop_cocoa_dry',
    withered: 'crop_cocoa_withered',
  },
  cotton: {
    seed: 'crop_cotton_seed',
    seedling: 'crop_cotton_seedling',
    growing: 'crop_cotton_growing',
    mature: 'crop_cotton_mature',
    dry: 'crop_cotton_dry',
    withered: 'crop_cotton_withered',
  },
  coffee: {
    seed: 'crop_coffee_seed',
    seedling: 'crop_coffee_seedling',
    growing: 'crop_coffee_growing',
    mature: 'crop_coffee_mature',
    dry: 'crop_coffee_dry',
    withered: 'crop_coffee_withered',
  },
  tea: {
    seed: 'crop_tea_seed',
    seedling: 'crop_tea_seedling',
    growing: 'crop_tea_growing',
    mature: 'crop_tea_mature',
    dry: 'crop_tea_dry',
    withered: 'crop_tea_withered',
  },
};

// ─────────────────────────────────────────
//  Crop Stage Visual Offset（土堆錨點偏移）
// ─────────────────────────────────────────
export const CROP_STAGE_VISUAL_OFFSET: Record<string, Record<GrowthStage, { x: number; y: number }>> = {
  wheat: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  corn: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 19 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  carrot: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 12 },
    mature: { x: 0, y: 25 },
    dry: { x: 0, y: 12 },
    withered: { x: 0, y: 5 },
  },
  potato: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  sugarcane: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  strawberry: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 15 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  tomato: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  pumpkin: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  soybean: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 15 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  grape: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  apple: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  cocoa: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  cotton: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  coffee: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
  tea: {
    seed: { x: 0, y: 5 },
    seedling: { x: 0, y: 5 },
    growing: { x: 0, y: 10 },
    mature: { x: 0, y: 20 },
    dry: { x: 0, y: 10 },
    withered: { x: 0, y: 5 },
  },
};

// ─────────────────────────────────────────
//  Crop ID ↔ Key Mappings
// ─────────────────────────────────────────
export const CROP_ID_TO_KEY: Record<number, string> = {
  1: 'wheat',
  2: 'corn',
  3: 'carrot',
  4: 'potato',
  5: 'sugarcane',
  6: 'strawberry',
  7: 'tomato',
  8: 'pumpkin',
  9: 'soybean',
  10: 'grape',
  11: 'apple',
  12: 'cocoa',
  13: 'cotton',
  14: 'coffee',
  15: 'tea',
};

export const CROP_KEY_TO_ID: Record<string, number> = {
  wheat: 1,
  corn: 2,
  carrot: 3,
  potato: 4,
  sugarcane: 5,
  strawberry: 6,
  tomato: 7,
  pumpkin: 8,
  soybean: 9,
  grape: 10,
  apple: 11,
  cocoa: 12,
  cotton: 13,
  coffee: 14,
  tea: 15,
};

// ─────────────────────────────────────────
//  Crop Details Cache（作物詳細資料快取）
// ─────────────────────────────────────────
let cropDetailsCache: CropData[] = [];

export function getCropDetails(cropId: number): CropData | undefined {
  return cropDetailsCache.find(c => c.id === cropId);
}

export function getAllCropDetails(): CropData[] {
  return cropDetailsCache;
}

// 供 FarmScene.loadCropDetails() 初始化使用
export function setupCropCache(crops: CropData[]): void {
  cropDetailsCache = crops;
}
