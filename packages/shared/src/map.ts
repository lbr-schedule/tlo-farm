// ============================================================
// World Grid
// ============================================================
export const MAP_GRID_WIDTH = 16;
export const MAP_GRID_HEIGHT = 16;
export const TILE_STEP = 90;

// ============================================================
// World Size
// ============================================================
export const WORLD_PIXEL_WIDTH =
  MAP_GRID_WIDTH * TILE_STEP;

export const WORLD_PIXEL_HEIGHT =
  MAP_GRID_HEIGHT * TILE_STEP;

// ============================================================
// Footprints
// ============================================================
export const FARMLAND_FOOTPRINT = 1;
export const CHICKEN_COOP_FOOTPRINT = 2;
export const FOOD_WORKSHOP_FOOTPRINT = 2;

// ============================================================
// World Bounds
// ============================================================
export const MAX_TILE_X_1X1 =
  MAP_GRID_WIDTH - FARMLAND_FOOTPRINT;

export const MAX_TILE_Y_1X1 =
  MAP_GRID_HEIGHT - FARMLAND_FOOTPRINT;

export const MAX_TILE_X_2X2 =
  MAP_GRID_WIDTH - CHICKEN_COOP_FOOTPRINT;

export const MAX_TILE_Y_2X2 =
  MAP_GRID_HEIGHT - CHICKEN_COOP_FOOTPRINT;

// ============================================================
// Types
// ============================================================
export interface TileCoordinate {
  tileX: number;
  tileY: number;
}

export interface WorldCoordinate {
  worldX: number;
  worldY: number;
}

// ============================================================
// Coordinate Conversion
// ============================================================
export function worldToTile(
  worldX: number,
  worldY: number
): TileCoordinate {
  return {
    tileX: Math.floor(worldX / TILE_STEP),
    tileY: Math.floor(worldY / TILE_STEP),
  };
}

export function tileToWorld(
  tileX: number,
  tileY: number
): WorldCoordinate {
  return {
    worldX: tileX * TILE_STEP,
    worldY: tileY * TILE_STEP,
  };
}

// ============================================================
// Boundary Validation
// ============================================================
export function isFootprintInsideMap(
  tileX: number,
  tileY: number,
  widthInTiles: number,
  heightInTiles: number = widthInTiles
): boolean {
  return (
    Number.isInteger(tileX) &&
    Number.isInteger(tileY) &&
    Number.isInteger(widthInTiles) &&
    Number.isInteger(heightInTiles) &&
    widthInTiles > 0 &&
    heightInTiles > 0 &&
    tileX >= 0 &&
    tileY >= 0 &&
    tileX + widthInTiles <= MAP_GRID_WIDTH &&
    tileY + heightInTiles <= MAP_GRID_HEIGHT
  );
}
