import Phaser from 'phaser';
import { backpackSystem } from '../systems/BackpackSystem';
import { authFetch } from '../utils/api';
import {
  TILE_SIZE,
  GRID_WIDTH,
  GRID_HEIGHT,
  TILE_TYPES,
  GrowthStage,
  CROP_SPRITES,
  CROP_STAGE_VISUAL_OFFSET,
  CROP_ID_TO_KEY,
  CROP_KEY_TO_ID,
  CropData,
  getCropDetails,
  getAllCropDetails,
  setupCropCache,
} from '../systems/crop/CropConfig';
import type { TileData } from '../systems/crop/TileTypes';
import { computeCropState } from '../systems/crop/CropStateManager';
import {
  validateCanPlant,
  createOptimisticPlantState,
  applyOptimisticPlant,
  rollbackPlant,
  validateCanWater,
  createOptimisticWaterState,
  applyOptimisticWater,
  rollbackWater,
  validateCanFertilize,
  calcWaterStatus,
  computeSoilState,
  getGrowthSpeedMultiplier,
  validateCanHarvest,
  recalculateCropState,
  shouldTransitionToDry,
  shouldTransitionToWithered,
} from '../systems/crop/CropSystem';
import { INITIAL_FARM_COLS, INITIAL_FARM_ROWS, INITIAL_FARM_PLOT_COUNT } from '../systems/farm/FarmConfig';

// Re-export so existing importers still work
// TODO: migrate importers to import from CropConfig directly
export { TILE_SIZE, GRID_WIDTH, GRID_HEIGHT, TILE_TYPES, CROP_SPRITES, CROP_STAGE_VISUAL_OFFSET, CROP_ID_TO_KEY, CROP_KEY_TO_ID, getCropDetails };
export type { CropData, GrowthStage };

const DEBUG = false;
const DEBUG_FARM = false;
const DEBUG_COOP = false;


// 開發模式：跳過產蛋倒計時（測試完改 false）
const DEBUG_SKIP_EGG_TIMER = false;

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default class FarmScene extends Phaser.Scene {
  private tiles: Map<string, Phaser.GameObjects.Container> = new Map();
  private selectedTile: Phaser.GameObjects.Container | null = null;
  private actionMenu: Phaser.GameObjects.Container | null = null;
  private isFarmActionMenuOpen: boolean = false;
  private seedPopup: Phaser.GameObjects.Container | null = null;
  private seedPopupOverlay: Phaser.GameObjects.Graphics | null = null;
  private seedHighlight: Phaser.GameObjects.Graphics | null = null;

  private _frameCount: number = 0;
  private FARM_SIZE = 180;
  private FARM_GAP = 0;
  private CANVAS_W = 0;
  private CANVAS_H = 0;

  // ── 雞舍狀態 ──
  private chickenCoopPlaced = false;
  private chickenCoopTileX = 0;
  private chickenCoopTileY = 0;
  private chickenCoopSprite: Phaser.GameObjects.Sprite | null = null;
  private chickenCoopHitZone: Phaser.GameObjects.Zone | null = null;

  // ── 雞舍放置模式 ──
  // ── 農地位置(instance variable 供 placement system 使用)──
  private farmStartX = 0;
  private farmStartY = 0;

  // ── 雞舍放置模式 ──
  private coopPlacementMode = false;
  private coopPlacementPreview: Phaser.GameObjects.Graphics | null = null;
  private placementStartedAt = 0; // 防止 UI 點擊冒泡的 100ms 延遲

  // ── M003.2.3 農地放置模式 ──
  private farmlandPlacementMode = false;
  private farmlandPlacementSlotIndex: number | null = null;
  private farmlandPlacementPreview: Phaser.GameObjects.Graphics | null = null;
  private farmlandPlacementCursorTileX = 0;
  private farmlandPlacementCursorTileY = 0;
  private farmlandPlacementStartedAt = 0;
  private farmlandPlacementCanPlace = false;
  private coopPlacementValid = false;
  private coopPlacementTileX = 0;
  private coopPlacementTileY = 0;
  private coopChickenStatus: any = null;  // 來自 /api/animals/chicken-coop/status
  private coopChickenPollTimer: Phaser.Time.TimerEvent | null = null;
  private _startCoopPlacement = () => {};
  private _coopPlacementListenerRegistered = false;
  private farmlandObjects: Phaser.GameObjects.Container[] = [];
  private debugGraphics: Phaser.GameObjects.Graphics | null = null;
  private placementMouseMoveHandler?: (event: MouseEvent) => void;
  private placementClickHandler?: (event: MouseEvent) => void;
  private _domClickHandledPlacement = false;
  private placementDebugTimer?: number;
  // 記錄 preview 最後一次繪製的 farmland-pixel 座標(直接使用,不重新計算)
  private currentPlacementX = 0;
  private currentPlacementY = 0;
  private currentPlacementCanPlace = false;


  // ── 澆水有效期:30 分鐘 ──
  private WATER_INTERVAL_MS = 30 * 60 * 1000;

  // ── 計算生長速度倍率(根據澆水狀態)──
  // 已澆水:1x,未澆水:0.5x (MVP 規則)
  // 委託 CropSystem.calcWaterStatus，避免遊戲規則重複
  private selectedSeed: number | null = null;
  private farmState: Map<number, TileData> = new Map();
  // ── tile 座標映射（中間方案）──
  private coordinateToIndex: Map<string, number> = new Map();
  private indexToCoordinate: Map<number, { x: number; y: number }> = new Map();
  private farmInputEnabled = true;
  private progressBars: Map<number, Phaser.GameObjects.Container> = new Map();
  private matureIndicators: Map<number, Phaser.GameObjects.Container> = new Map();
private dryIndicators: Map<number, Phaser.GameObjects.Container> = new Map();
  private witheredIndicators: Map<number, Phaser.GameObjects.Container> = new Map();
  private witheringTimers: Map<number, Phaser.Time.TimerEvent> = new Map();

  constructor() {
    super({ key: 'FarmScene' });
  }

  preload() {
this.load.image('grass_bg', '/assets/tile/grass_tiles/grass_00_00.png');
    this.load.image('tile_soil', '/assets/tile/農地_初始狀態_32x32.png');
    this.load.image('tile_soil_wet', '/assets/tile/農地_澆水狀態_32x32.png');
    this.load.image('crop_wheat_seed', '/assets/crops/小麥種子.png');
    this.load.image('crop_wheat_seedling', '/assets/crops/小麥幼苗.png');
    this.load.image('crop_wheat_growing', '/assets/crops/小麥成長中.png');
    this.load.image('crop_wheat_mature', '/assets/crops/小麥成熟.png');
    this.load.image('crop_wheat_dry', '/assets/crops/小麥營養不良.png');
    this.load.image('crop_wheat_withered', '/assets/crops/小麥枯萎.png');
    this.load.image('crop_corn_seed', '/assets/crops/玉米種子.png');
    this.load.image('crop_corn_seedling', '/assets/crops/玉米幼苗.png');
    this.load.image('crop_corn_growing', '/assets/crops/玉米成長中.png');
    this.load.image('crop_corn_mature', '/assets/crops/玉米成熟.png');
    this.load.image('crop_corn_dry', '/assets/crops/玉米營養不良.png');
    this.load.image('crop_corn_withered', '/assets/crops/玉米枯萎.png');
    this.load.image('crop_carrot_seed', '/assets/crops/紅蘿蔔種子.png');
    this.load.image('crop_carrot_seedling', '/assets/crops/紅蘿蔔幼苗.png');
    this.load.image('crop_carrot_growing', '/assets/crops/紅蘿蔔成長中.png');
    this.load.image('crop_carrot_mature', '/assets/crops/紅蘿蔔成熟.png');
    this.load.image('crop_carrot_dry', '/assets/crops/紅蘿蔔營養不良.png');
    this.load.image('crop_carrot_withered', '/assets/crops/紅蘿蔔枯萎.png');
    this.load.image('crop_potato_seed', '/assets/crops/馬鈴薯種子.png');
    this.load.image('crop_potato_seedling', '/assets/crops/馬鈴薯幼苗.png');
    this.load.image('crop_potato_growing', '/assets/crops/馬鈴薯成長中.png');
    this.load.image('crop_potato_mature', '/assets/crops/馬鈴薯成熟.png');
    this.load.image('crop_potato_dry', '/assets/crops/馬鈴薯營養不良.png');
    this.load.image('crop_potato_withered', '/assets/crops/馬鈴薯枯萎.png');
    // 5 甘蔗
    this.load.image('crop_sugarcane_seed', '/assets/crops/甘蔗種子.png');
    this.load.image('crop_sugarcane_seedling', '/assets/crops/甘蔗幼苗.png');
    this.load.image('crop_sugarcane_growing', '/assets/crops/甘蔗果實.png');
    this.load.image('crop_sugarcane_mature', '/assets/crops/甘蔗成熟.png');
    this.load.image('crop_sugarcane_dry', '/assets/crops/甘蔗營養不良.png');
    this.load.image('crop_sugarcane_withered', '/assets/crops/甘蔗枯萎.png');
    // 6 草莓
    this.load.image('crop_strawberry_seed', '/assets/crops/草莓種子.png');
    this.load.image('crop_strawberry_seedling', '/assets/crops/草莓幼苗.png');
    this.load.image('crop_strawberry_growing', '/assets/crops/草莓成長中.png');
    this.load.image('crop_strawberry_mature', '/assets/crops/草莓成熟.png');
    this.load.image('crop_strawberry_dry', '/assets/crops/草莓營養不良.png');
    this.load.image('crop_strawberry_withered', '/assets/crops/草莓枯萎.png');
    // 7 番茄
    this.load.image('crop_tomato_seed', '/assets/crops/番茄種子.png');
    this.load.image('crop_tomato_seedling', '/assets/crops/番茄幼苗.png');
    this.load.image('crop_tomato_growing', '/assets/crops/番茄成熟.png');
    this.load.image('crop_tomato_mature', '/assets/crops/番茄果實.png');
    this.load.image('crop_tomato_dry', '/assets/crops/番茄營養不良.png');
    this.load.image('crop_tomato_withered', '/assets/crops/番茄枯萎.png');
    // 8 南瓜
    this.load.image('crop_pumpkin_seed', '/assets/crops/南瓜種子.png');
    this.load.image('crop_pumpkin_seedling', '/assets/crops/南瓜幼苗.png');
    this.load.image('crop_pumpkin_growing', '/assets/crops/南瓜成長中.png');
    this.load.image('crop_pumpkin_mature', '/assets/crops/南瓜成熟.png');
    this.load.image('crop_pumpkin_dry', '/assets/crops/南瓜營養不良.png');
    this.load.image('crop_pumpkin_withered', '/assets/crops/南瓜枯萎.png');
    // 9 黃豆
    this.load.image('crop_soybean_seed', '/assets/crops/黃豆種子.png');
    this.load.image('crop_soybean_seedling', '/assets/crops/黃豆幼苗.png');
    this.load.image('crop_soybean_growing', '/assets/crops/黃豆成長中.png');
    this.load.image('crop_soybean_mature', '/assets/crops/黃豆成熟.png');
    this.load.image('crop_soybean_dry', '/assets/crops/黃豆營養不良.png');
    this.load.image('crop_soybean_withered', '/assets/crops/黃豆枯萎.png');
    // 10 葡萄
    this.load.image('crop_grape_seed', '/assets/crops/葡萄種子.png');
    this.load.image('crop_grape_seedling', '/assets/crops/葡萄幼苗.png');
    this.load.image('crop_grape_growing', '/assets/crops/葡萄成長中.png');
    this.load.image('crop_grape_mature', '/assets/crops/葡萄成熟.png');
    this.load.image('crop_grape_dry', '/assets/crops/葡萄營養不良.png');
    this.load.image('crop_grape_withered', '/assets/crops/葡萄枯萎.png');
    // 11 蘋果
    this.load.image('crop_apple_seed', '/assets/crops/蘋果種子.png');
    this.load.image('crop_apple_seedling', '/assets/crops/蘋果幼苗.png');
    this.load.image('crop_apple_growing', '/assets/crops/蘋果成長中.png');
    this.load.image('crop_apple_mature', '/assets/crops/蘋果成熟.png');
    this.load.image('crop_apple_dry', '/assets/crops/蘋果營養不良.png');
    this.load.image('crop_apple_withered', '/assets/crops/蘋果枯萎.png');
    // 12 可可豆
    this.load.image('crop_cocoa_seed', '/assets/crops/可可豆種子.png');
    this.load.image('crop_cocoa_seedling', '/assets/crops/可可豆幼苗.png');
    this.load.image('crop_cocoa_growing', '/assets/crops/可可豆成熟.png');
    this.load.image('crop_cocoa_mature', '/assets/crops/可可豆果實.png');
    this.load.image('crop_cocoa_dry', '/assets/crops/可可豆營養不良.png');
    this.load.image('crop_cocoa_withered', '/assets/crops/可可豆枯萎.png');
    // 13 棉花
    this.load.image('crop_cotton_seed', '/assets/crops/棉花種子.png');
    this.load.image('crop_cotton_seedling', '/assets/crops/棉花幼苗.png');
    this.load.image('crop_cotton_growing', '/assets/crops/棉花成長中.png');
    this.load.image('crop_cotton_mature', '/assets/crops/棉花成熟.png');
    this.load.image('crop_cotton_dry', '/assets/crops/棉花營養不良.png');
    this.load.image('crop_cotton_withered', '/assets/crops/棉花枯萎.png');
    // 14 咖啡豆
    this.load.image('crop_coffee_seed', '/assets/crops/咖啡豆種子.png');
    this.load.image('crop_coffee_seedling', '/assets/crops/咖啡豆幼苗.png');
    this.load.image('crop_coffee_growing', '/assets/crops/咖啡豆成長中.png');
    this.load.image('crop_coffee_mature', '/assets/crops/咖啡豆成熟.png');
    this.load.image('crop_coffee_dry', '/assets/crops/咖啡豆營養不良.png');
    this.load.image('crop_coffee_withered', '/assets/crops/咖啡豆枯萎.png');
    // 15 茶葉
    this.load.image('crop_tea_seed', '/assets/crops/茶葉種子.png');
    this.load.image('crop_tea_seedling', '/assets/crops/茶葉幼苗.png');
    this.load.image('crop_tea_growing', '/assets/crops/茶葉成長中.png');
    this.load.image('crop_tea_mature', '/assets/crops/茶葉成熟.png');
    this.load.image('crop_tea_dry', '/assets/crops/茶葉營養不良.png');
    this.load.image('crop_tea_withered', '/assets/crops/茶葉枯萎.png');

    this.load.image('icon_seed', '/assets/icon/icon_seed.png.png');
    this.load.image('icon_watering', '/assets/icon/icon_watering.png.png');
    this.load.image('icon_fertilizer', '/assets/icon/icon_fertilizer.png.png');
    this.load.image('icon_harvest', '/assets/icon/icon_harvest.png.png');
    this.load.image('chicken_coop', '/assets/buildings/chicken_coop.png');
    this.load.image('chick_baby', '/assets/animals/chick_baby.png');
    this.load.image('chicken_adult', '/assets/animals/chicken_adult.png');
  }

  create() {
    if (DEBUG_COOP) console.log('[FARMSCENE CREATE]');
    // 雞舍位置統一由 API 驅動，不再從 localStorage 建立 sprite
    // localStorage 只作被動快取，sprite 由 renderChickenCoop() 統一管理
    const parent = this.sys.game.canvas.parentElement;
    if (parent) {
      this.CANVAS_W = parent.clientWidth;
      this.CANVAS_H = parent.clientHeight;
    } else {
      this.CANVAS_W = this.sys.game.canvas.width;
      this.CANVAS_H = this.sys.game.canvas.height;
    }



    // 背景透明,讓 React 層的草地背景顯示
    // 草地背景由 React 層提供,Phaser 層保持透明

    const COLS = INITIAL_FARM_COLS;
    const ROWS = INITIAL_FARM_ROWS;
    const FARM_BASE_SIZE = 120;
    const FARM_SCALE = 0.75;
    const FARM_TILE_SIZE = FARM_BASE_SIZE * FARM_SCALE; // 90，每塊農地視覺尺寸
    this.FARM_SIZE = FARM_TILE_SIZE; // 農地用 90px
    this.FARM_GAP = 0;  // 農地彼此緊貼,無間距

    const totalFarmW = COLS * this.FARM_SIZE + (COLS - 1) * this.FARM_GAP;
    const totalFarmH = ROWS * this.FARM_SIZE + (ROWS - 1) * this.FARM_GAP;
    // 農地置於畫布中央
    this.farmStartX = (this.CANVAS_W - totalFarmW) / 2;
    this.farmStartY = (this.CANVAS_H - totalFarmH) / 2;
    const farmStartX = this.farmStartX;
    const farmStartY = this.farmStartY;

    //全部初始化為空(無硬編碼假資料)
    for (let i = 0; i < INITIAL_FARM_PLOT_COUNT; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const px = farmStartX + col * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;
      const py = farmStartY + row * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;

      const farmContainer = this.add.container(px, py);
      farmContainer.setSize(this.FARM_SIZE, this.FARM_SIZE);
      farmContainer.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, this.FARM_SIZE, this.FARM_SIZE),
        Phaser.Geom.Rectangle.Contains
      );
      farmContainer.setData('index', i);

      const soilImg = this.add.image(0, 0, 'tile_soil');
      soilImg.setDisplaySize(this.FARM_SIZE, this.FARM_SIZE);
      soilImg.setOrigin(0.5, 0.5); // 農地圖片置中
      farmContainer.add(soilImg);

      this.farmState.set(i, {
        x: i % COLS,
        y: Math.floor(i / COLS),
        type: 'soil',
        state: 'empty',
        cropState: 'empty',
        soilState: 'dry',
        cropId: undefined,
        plantedAt: undefined,
        finishAt: undefined,
        wateredAt: undefined,
        isWatered: false,
        cropStatus: 'needs_water',
      });

      farmContainer.on('pointerdown', () => this.onFarmClick(i, px, py));

      this.tiles.set(`${i}`, farmContainer);
      this.farmlandObjects.push(farmContainer);
      this.registerTileCoordinate(i, col, row);
    }

    this.loadCropDetails();
    backpackSystem.fetchAll();
    this.syncFarmState();
    // 只註冊一次
    if (!this._coopPlacementListenerRegistered) {
      this._coopPlacementListenerRegistered = true;
      this._startCoopPlacement = () => {
        console.log('[START COOP PLACEMENT EVENT RECEIVED]');
        // 防重入:如果已在放置模式,跳過
        if (this.coopPlacementMode) {
          console.log('[START COOP PLACEMENT IGNORED] already in placement mode');
          return;
        }
        this.startCoopPlacementMode();
      };
      window.addEventListener('startCoopPlacement', this._startCoopPlacement);
      window.addEventListener('startFarmlandPlacement', () => this.enterFarmlandPlacement());
    }

    this.input.keyboard?.on('keydown-ESC', () => {
      this.clearAllPopups();
      if (this.coopPlacementMode) {
        this.cancelCoopPlacement('esc_cancel');
      }
      if (this.farmlandPlacementMode) {
        this.cancelFarmlandPlacement();
      }
    });

    // ── 全域 pointermove(只在 placement mode 使用,永遠只綁一次)──
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.coopPlacementMode || !this.coopPlacementPreview) return;
      this.updatePlacementPreview(pointer);
    });
//     console.log('[PLACEMENT POINTERMOVE BOUND]');
    console.log('[PLACEMENT POINTERMOVE BOUND]');

    // ── 全域 pointerdown(只在 placement mode 使用,永遠只綁一次)──
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.coopPlacementMode) return;
      // 300ms 內的點擊不處理(防止 UI 冒泡)
      if (Date.now() - this.placementStartedAt < 300) {
        console.log('[PLACEMENT POINTERDOWN IGNORED] just started');
        return;
      }
      this.onBuildingPlacementPointerDown(pointer);
    });
//     console.log('[PLACEMENT POINTERDOWN BOUND]');
    console.log('[PLACEMENT POINTERDOWN BOUND]');

    // 監聽 Phaser resize 事件
    // 注意:resize 時不呼叫 layoutFarmlands(),否則農地會被重新定位
    // 農地與雞舍都使用世界座標,window resize 只應改變 camera viewport,不應移動世界物件
    this.scale.on('resize', (gameSize: { width: number; height: number }) => {
      this.CANVAS_W = gameSize.width;
      this.CANVAS_H = gameSize.height;
      // 不再呼叫 layoutFarmlands():農地位置在建立時已固定,resize 不應移動它們
      if (DEBUG_COOP) console.log('[RESIZE] CANVAS updated', this.CANVAS_W, this.CANVAS_H);
    });

    // ── Phase2: load 在 sync 之前(確保本地 sprite 先被保護)──
    this.loadChickenCoopLocalState();
    // restore sprite 後，立即從 API 取狀態，讓 coopChickenStatus 有 slots
    // renderChickenCoop 已被 guard 保護，不會覆蓋已存在的 sprite
    this.syncChickenCoopStatus();

    // ── Phase4: 監聽商店購買小雞後的更新事件 ──
    window.addEventListener('chicken-coop-animals-updated', () => {
      console.log('[EVENT] chicken-coop-animals-updated received, syncing with API');
      this.syncChickenCoopStatus();
    });

    // ── 監聽背包更新事件(讓雞舍操作後同步背包)──
    window.addEventListener('inventory-updated', () => {
      console.log('[EVENT] inventory-updated received, refetching backpack');
      backpackSystem.fetchAll();
    });

  }

  // 重新排農地(resize 時呼叫)
  private layoutFarmlands() {
    const COLS = INITIAL_FARM_COLS;
    const ROWS = INITIAL_FARM_ROWS;

    const totalFarmW = COLS * this.FARM_SIZE + (COLS - 1) * this.FARM_GAP;
    const totalFarmH = ROWS * this.FARM_SIZE + (ROWS - 1) * this.FARM_GAP;
    const farmStartX = (this.CANVAS_W - totalFarmW) / 2;
    const farmStartY = (this.CANVAS_H - totalFarmH) / 2;


    for (let i = 0; i < INITIAL_FARM_PLOT_COUNT; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const px = farmStartX + col * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;
      const py = farmStartY + row * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;

      const container = this.tiles.get(String(i));
      if (container) {
        container.setPosition(px, py);
      } else {
        console.warn('[Farmland Missing Container] index:', i);
      }
    }
  }

  // ============================================================
  // 載入作物詳細資料(公開 API)
  // ============================================================
  private async loadCropDetails() {
    try {
      const res = await fetch('/api/farm/crops');
      if (!res.ok) {
        console.warn('[FarmScene] 載入作物資料失敗 HTTP', res.status);
        return;
      }
      const data = await res.json();
      if (data.success && data.crops) {
        setupCropCache(data.crops);
              }
    } catch (err) {
      console.warn('[FarmScene] 載入作物資料失敗', err);
    }
  }

  // ============================================================
  // tile 座標 helper（中間方案）
  // ============================================================
  private getTileKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private getTileCoordinate(index: number): { x: number; y: number } | null {
    return this.indexToCoordinate.get(index) ?? null;
  }

  private registerTileCoordinate(index: number, x: number, y: number): void {
    const key = this.getTileKey(x, y);
    this.coordinateToIndex.set(key, index);
    this.indexToCoordinate.set(index, { x, y });
  }

  private ensureFarmlandObject(index: number, x: number, y: number): void {
    if (this.farmlandObjects[index]) return;
    const px = this.farmStartX + x * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;
    const py = this.farmStartY + y * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;
    const container = this.add.container(px, py);
    container.setSize(this.FARM_SIZE, this.FARM_SIZE);
    container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, this.FARM_SIZE, this.FARM_SIZE),
      Phaser.Geom.Rectangle.Contains
    );
    container.setData('index', index);
    const soilImg = this.add.image(0, 0, 'tile_soil');
    soilImg.setDisplaySize(this.FARM_SIZE, this.FARM_SIZE);
    soilImg.setOrigin(0.5, 0.5);
    container.add(soilImg);
    container.on('pointerdown', () => this.onFarmClick(index, px, py));
    this.farmlandObjects[index] = container;
    this.tiles.set(String(index), container);
    if (!this.farmState.has(index)) {
      this.farmState.set(index, {
        x, y,
        type: 'soil', state: 'empty', cropState: 'empty', soilState: 'dry',
        cropId: undefined, plantedAt: undefined, finishAt: undefined,
        wateredAt: undefined, isWatered: false, cropStatus: 'needs_water',
      });
    }
    this.registerTileCoordinate(index, x, y);
  }

  // ============================================================
  // 從伺服器同步農場狀態
  // ============================================================
  // 同步農場狀態
  // ============================================================
  private async syncFarmState() {
    try {
      const res = await authFetch('/api/farm/status');
      const data = await res.json();

      if (data.success && data.tiles) {
        for (const tile of data.tiles) {
          const tileKey = this.getTileKey(tile.x, tile.y);
          let index: number;
          if (this.coordinateToIndex.has(tileKey)) {
            index = this.coordinateToIndex.get(tileKey)!;
          } else {
            index = this.farmlandObjects.length;
            this.registerTileCoordinate(index, tile.x, tile.y);
            this.ensureFarmlandObject(index, tile.x, tile.y);
          }
          if (this.farmState.has(index)) {
            const existing = this.farmState.get(index)!;
            // ── 保留後端的 dry/withered 狀態,其他由 recalcState 計算 ──
            // 如果客戶端已經是 growing(樂觀更新),但後端仍是 dry:不要覆蓋
            // (代表用戶剛澆水,還缺肥,後端狀態尚未更新)
            const rawState = tile.state as string;
            const clientIsRecovered = existing.cropState === 'growing';
            const isDryOrWithered = (rawState === 'dry' || rawState === 'withered') && !clientIsRecovered;
            const computedState = isDryOrWithered
              ? rawState as any
              : recalculateCropState(tile.cropId, tile.finishAt, tile.wateredAt, tile.state);
            const { isWatered, cropStatus } = calcWaterStatus(tile.wateredAt);
            const cropState = isDryOrWithered
              ? rawState as any
              : (clientIsRecovered ? 'growing' : computeCropState(tile.cropId, tile.finishAt, tile.state));
            // 空農地一定顯示乾農地,不受 wateredAt 殘留值影響
            const soilState = (!tile.cropId || tile.state === 'empty') ? 'dry' : computeSoilState(tile.wateredAt);
            // 對於已種植的作物,設定照顧檢查時間(播種後 10 秒)
            // 如果沒有 dryStartedAt(代表還沒進入乾燥),給予 10 秒寬限期
            let careCheckAt = (tile as any).careCheckAt ?? null;
            if (careCheckAt === null && tile.cropId && tile.plantedAt) {
              careCheckAt = (typeof tile.plantedAt === 'number' ? tile.plantedAt : new Date(tile.plantedAt).getTime()) + 10000;
            }

            this.farmState.set(index, {
              ...existing,
              cropId: tile.cropId,
              plantedAt: tile.plantedAt,
              finishAt: tile.finishAt,
              wateredAt: tile.wateredAt,
              isWatered,
              cropStatus,
              state: computedState,
              cropState,
              soilState,
              isFertilized: tile.isFertilized ?? 0,
              fertilizedAt: tile.fertilizedAt ?? null,
              fertilizerType: tile.fertilizerType ?? 'normal',
              fertilizerSpeedBonus: tile.fertilizerSpeedBonus ?? 20,
              dryStartedAt: (tile as any).dryStartedAt ?? null,
              careCheckAt,
            });
            this.updateFarmTileVisual(index, 'syncFarmState');
            this.renderFarmland(index);

            // 重建 UI(根據狀態)
            if (computedState === 'growing' || computedState === 'seedling') {
              this.hideProgressBar(index); // 先清除舊的
              this.hideMatureIndicator(index);
              this.hideDryIndicator(index);
              this.showProgressBar(index);
            } else if (computedState === 'mature') {
              this.hideProgressBar(index);
              this.hideMatureIndicator(index);
              this.hideDryIndicator(index);
              this.showMatureIndicator(index);
            } else if (computedState === 'dry') {
              this.hideProgressBar(index);
              this.hideMatureIndicator(index);
              this.showDryIndicator(index);
            } else if (computedState === 'withered') {
              this.hideProgressBar(index);
              this.hideMatureIndicator(index);
              this.hideDryIndicator(index);
              this.showWitheredIndicator(index);
            } else {
              // empty 的情況
              this.hideProgressBar(index);
              this.hideMatureIndicator(index);
              this.hideDryIndicator(index);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[FarmScene] 同步農場狀態失敗', err);
    }
  }

  // ============================================================
  // 渲染農地土地貼圖(根據 soilState)- 只管土地,不碰作物
  // ============================================================
  private renderFarmland(index: number) {
    const container = this.tiles.get(`${index}`);
    if (!container) return;
    const state = this.farmState.get(index);
    if (!state) return;

    // 找土壤圖片
    const soilImg = container.list.find(
      (child) => child instanceof Phaser.GameObjects.Image &&
        ((child as Phaser.GameObjects.Image).texture.key === 'tile_soil' ||
         (child as Phaser.GameObjects.Image).texture.key === 'tile_soil_wet')
    ) as Phaser.GameObjects.Image | undefined;

    if (!soilImg) return;

    const targetTexture = state.soilState === 'watered' ? 'tile_soil_wet' : 'tile_soil';
    if (soilImg.texture.key !== targetTexture) {
      soilImg.setTexture(targetTexture);
      soilImg.setDisplaySize(this.FARM_SIZE, this.FARM_SIZE);
    }
  }

  // ============================================================
  // 渲染作物圖(根據當前 cropState 和時間重新計算階段)
  // soilState 不影響是否顯示作物
  // ============================================================
  // ============================================================
  // 統一作物渲染座標:土堆中心對齊農地中心
  // ============================================================
  private getCropRenderPosition(index: number, cropId: number, stage: GrowthStage): { x: number; y: number } | null {
    const tileCenter = this.getTileCenter(index);
    if (!tileCenter) return null;
    const cropKey = CROP_ID_TO_KEY[cropId];
    if (!cropKey) return null;
    const offset = CROP_STAGE_VISUAL_OFFSET[cropKey]?.[stage] ?? { x: 0, y: 0 };
    return { x: tileCenter.x + offset.x, y: tileCenter.y + offset.y };
  }

  // ============================================================
  // 統一座標系統:每塊農地的唯一中心點
  // tileCenter = farmlandSprite 中心(container-local = 0,0)
  // 所有 UI 元素(作物、進度條、可收成標示)都必須用此函式定位
  // ============================================================
  private getTileCenter(index: number): { x: number; y: number } | null {
    const container = this.tiles.get(`${index}`);
    if (!container) return null;
    // 農地圖片 key 可能是 'tile_soil' 或 'tile_soil_wet'
    const farmlandSprite = container.list.find(
      (child) => child instanceof Phaser.GameObjects.Image &&
        ((child as Phaser.GameObjects.Image).texture.key === 'tile_soil' ||
         (child as Phaser.GameObjects.Image).texture.key === 'tile_soil_wet')
    ) as Phaser.GameObjects.Image | undefined;
    if (!farmlandSprite) {
      // fallback:找不到農地圖片,用 container 自己的座標
      console.warn(`[FarmScene] getTileCenter fallback for index=${index}, container pos=(${container.x},${container.y})`);
      return { x: 0, y: 0 };
    }
    return { x: farmlandSprite.x, y: farmlandSprite.y };
  }

  private renderCrop(index: number, source: string = 'unknown') {
    const container = this.tiles.get(`${index}`);
    if (!container) return;
    const state = this.farmState.get(index);
    if (!state) return;

    // 移除舊作物圖(不碰農地土地圖)
    const toRemove: Phaser.GameObjects.GameObject[] = [];
    container.each((child) => {
      if (child instanceof Phaser.GameObjects.Image && child.texture.key.startsWith('crop_')) {
        toRemove.push(child);
      }
    });
    toRemove.forEach((c) => c.destroy());

    // 無作物或空地:不加載新作物
    if (!state.cropId || state.cropState === 'empty') return;

    const cropKey = CROP_ID_TO_KEY[state.cropId];
    if (!cropKey) return;

    const stage = this.getGrowthStage(state);
    const rawSpriteKey = CROP_SPRITES[cropKey]?.[stage];
    const spriteKey = rawSpriteKey || CROP_SPRITES[cropKey]?.growing;
    const textureExists = !!rawSpriteKey;
        if (!textureExists) {
      console.warn(`[Missing dry/growing texture] cropKey=${cropKey} stage=${stage} available stages:`, Object.keys(CROP_SPRITES[cropKey] || {}));
    }
    if (!spriteKey) return;

    // 使用統一座標系統
    const pos = this.getCropRenderPosition(index, state.cropId, stage);
    if (!pos) return;

    // 作物固定置於農地中央再套用 visual offset
    const cropImg = this.add.image(pos.x, pos.y, spriteKey);
    const scale = (stage === 'seedling') ? 0.8 : 1.0;
    cropImg.setDisplaySize(100 * scale, 100 * scale);
    cropImg.setOrigin(0.5, 1);
    container.add(cropImg);
  }

  // ============================================================
  // 更新農地視覺
  // ============================================================
  // 更新農地視覺(作物部分)- 委託 renderCrop
  // ============================================================
  private updateFarmTileVisual(index: number, source: string = 'updateFarmTileVisual') {
    this.renderCrop(index, source);
  }

  // ============================================================
  // 計算生長階段
  // ============================================================
  private getGrowthStage(state: TileData): GrowthStage {
    // 損壞資料防呆:finishAt 為空且有 cropId → 觸發同步
    if (state.cropId && !state.finishAt) {
      console.warn('[FarmScene] 損壞農地資料,觸發同步');
      this.syncFarmState();
      return 'seedling';
    }

    const now = Date.now();

    // dry 狀態:只要 cropState === 'dry' 就顯示乾燥素材(優先級最高)
    if (state.cropState === 'dry') {
      const result = 'dry';
            return result;
    }

    // 枯萎
    if (state.cropState === 'withered') return 'withered';

    // 已成熟(時間到)
    if (state.plantedAt && state.finishAt && now >= state.finishAt) return 'mature';

    // 成長進度判斷
    if (!state.plantedAt || !state.finishAt) return 'seedling';
    const total = state.finishAt - state.plantedAt;
    const elapsed = now - state.plantedAt;
    const ratio = Math.min(1, Math.max(0, elapsed / total));
    if (ratio < 0.5) return 'seedling';
    return 'growing';
  }

  // ============================================================
  // 點擊農地 - 核心分發
  // ============================================================
  private onFarmClick(index: number, x: number, y: number) {
    if (!this.farmInputEnabled) {
            return;
    }

    // ── 雞舍放置模式 ──
    if (this.coopPlacementMode) {
      this.confirmCoopPlacement(this.coopPlacementTileX, this.coopPlacementTileY);
      return;
    }


    const state = this.farmState.get(index);
    if (!state) return;


    // 清除舊選單
    this.clearAllPopups();

    // ── 狀態分支(用 cropState)──
    if (state.cropState === 'empty') {
      // 空地 →顯示播種選單
      // 直接從 farmState 的 x,y 計算 tile 世界座標（不用 closure capture 的 px/py）
      const tileWorldX = this.farmStartX + state.x * this.FARM_SIZE + this.FARM_SIZE / 2;
      const tileWorldY = this.farmStartY + state.y * this.FARM_SIZE + this.FARM_SIZE / 2;
      this.showSeedPopup(index, tileWorldX, tileWorldY);
      return;
    }

    if (state.cropState === 'mature') {
      // 成熟 → 直接收成
            this.harvestCrop(index);
      return;
    }

    // 成長中 → 顯示操作選單(澆水/施肥)
        this.showActionMenu(index, x, y - this.FARM_SIZE / 2 - 10, state);
  }

  // ============================================================
  // 顯示播種視窗(SeedSelectModal)- MVP 固定置中版
  // ============================================================
  private showSeedPopup(index: number, _x: number, _y: number) {
    if (this.seedPopup) {
      this.seedPopup.destroy();
      this.seedPopup = null;
    }

    // ── 先刷新背包資料 ──
    backpackSystem.fetchAll();

    // ── 取得背包中各作物的種子數量 ──
    const seeds = backpackSystem.getState().seeds;
    const seedCountMap: Record<number, number> = {};
    seeds.forEach(s => { seedCountMap[s.itemId] = s.amount; });

    // ── 只顯示前4種作物:小麥、玉米、紅蘿蔔、馬鈴薯 ──
    const displayCrops = getAllCropDetails().slice(0, 4);
    if (displayCrops.length === 0) return;

    // ── 小型浮動面板: 220x(依內容), 跟隨點擊農地 ──
    const POPUP_W = 220;
    const ROW_H = 44;
    const TITLE_H = 36;
    const CLOSE_H = 28;
    const PADDING = 8;
    // 動態高度: 標題+關閉+種子列(最多4筆)+padding
    const MAX_SHOW = 4;
    const seedsWithAmount = seeds.filter((s: any) => s.amount > 0);
    const displaySeeds = seedsWithAmount
      .map((seed: any) => getAllCropDetails().find((c: any) => c.id === seed.itemId))
      .filter((c: any) => c !== undefined);
    const visibleCount = Math.min(displaySeeds.length, MAX_SHOW);
    const POPUP_H = TITLE_H + CLOSE_H + PADDING + visibleCount * ROW_H + PADDING;
    const LIST_Y = TITLE_H;

    const canvasWidth = this.scale.width;
    const canvasHeight = this.scale.height;

    // ── 選中農地高亮框（直接加到 scene，world coordinates）──
    this.seedHighlight = this.add.graphics();
    this.seedHighlight.lineStyle(3, 0xFFD700, 1);
    this.seedHighlight.strokeRect(_x - this.FARM_SIZE / 2, _y - this.FARM_SIZE / 2, this.FARM_SIZE, this.FARM_SIZE);
    this.seedHighlight.setDepth(4999);
//     console.log('[SEED HIGHLIGHT DEBUG]', {
    console.log('[SEED HIGHLIGHT DEBUG]', {
      tileIndex: index,
      tileWorldX: _x,
      tileWorldY: _y,
      highlightParent: 'scene',
      farmStartX: this.farmStartX,
      farmStartY: this.farmStartY,
      FARM_SIZE: this.FARM_SIZE,
    });

    // ── 跟隨農地位置，避開雞舍，永遠高於建築 ──
    const MARGIN = 12;
    const SIDE_GAP = 12;

    // 雞舍範圍（真實 sprite bounds）
    const coopBounds = this.chickenCoopSprite?.getBounds();

    // 優先放農地右側
    let popupX = _x + this.FARM_SIZE / 2 + SIDE_GAP;
    let popupY = _y - POPUP_H / 2;

    const popupRight = popupX + POPUP_W;
    const popupBottom = popupY + POPUP_H;
    const coopOverlaps = coopBounds &&
      popupX < coopBounds.right && popupRight > coopBounds.left &&
      popupY < coopBounds.bottom && popupBottom > coopBounds.top;

    // 右側超出 或 與雞舍重疊 → 改放左側
    if (popupRight > canvasWidth - MARGIN || coopOverlaps) {
      popupX = _x - this.FARM_SIZE / 2 - POPUP_W - SIDE_GAP;
    }

    // clamp 確保在畫面內
    popupX = Math.max(MARGIN, Math.min(popupX, canvasWidth - POPUP_W - MARGIN));
    popupY = Math.max(MARGIN, Math.min(popupY, canvasHeight - POPUP_H - MARGIN));

    // ── 背景 + 透明互動層（depth 10000，永高於建築）──
    const bg = this.add.graphics();
    bg.fillStyle(0x3d2518, 0.88);
    bg.fillRoundedRect(0, 0, POPUP_W, POPUP_H, 8);
    bg.lineStyle(2, 0x8B4513, 1);
    bg.strokeRoundedRect(0, 0, POPUP_W, POPUP_H, 8);
    bg.setDepth(10000);

    const popupHit = this.add.graphics();
    popupHit.fillStyle(0x000000, 0);
    popupHit.fillRect(0, 0, POPUP_W, POPUP_H);
    popupHit.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, POPUP_W, POPUP_H),
      Phaser.Geom.Rectangle.Contains
    );
    popupHit.on('pointerdown', (e: any) => { e.stopPropagation?.(); });
    popupHit.setDepth(10001);

    this.seedPopup = this.add.container(popupX, popupY);
    this.seedPopup.setDepth(10000);
    this.seedPopup.add(bg);
    this.seedPopup.add(popupHit);

    // ── 標題 ──
    const title = this.add.text(POPUP_W / 2, 8, '選擇種子播種', {
      fontSize: '13px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#FFD700',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5, 0);
    title.setDepth(10002);
    this.seedPopup.add(title);

    // ── X 關閉按鈕 ──
    const closeBtn = this.add.graphics();
    closeBtn.fillStyle(0xC0392B, 1);
    closeBtn.fillRoundedRect(POPUP_W - 26, 6, 18, 18, 3);
    closeBtn.setInteractive(
      new Phaser.Geom.Rectangle(POPUP_W - 26, 6, 18, 18),
      Phaser.Geom.Rectangle.Contains
    );
    closeBtn.on('pointerdown', (e: any) => { e.stopPropagation?.(); this.clearAllPopups(); });
    closeBtn.setDepth(10003);
    this.seedPopup.add(closeBtn);

    const closeText = this.add.text(POPUP_W - 17, 15, 'X', {
      fontSize: '12px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    closeText.setOrigin(0.5, 0.5);
    closeText.setDepth(10002);
    this.seedPopup.add(closeText);

    // ── 作物清單（最多4筆）──
    const visibleSeeds = displaySeeds.slice(0, MAX_SHOW);
//     console.log('[SEED SELECT INVENTORY]', { seedItems: JSON.parse(JSON.stringify(seedsWithAmount)) });
    console.log('[SEED SELECT INVENTORY]', { seedItems: JSON.parse(JSON.stringify(seedsWithAmount)) });
//     console.log('[SEED SELECT DISPLAY]', { displaySeeds: visibleSeeds.map((c: any) => ({ id: c.id, name: c.nameZhTw })) });
    console.log('[SEED SELECT DISPLAY]', { displaySeeds: visibleSeeds.map((c: any) => ({ id: c.id, name: c.nameZhTw })) });

    visibleSeeds.forEach((crop: any, i: number) => {
      const rowY = LIST_Y + PADDING + i * ROW_H;
      const amount = seedCountMap[crop.id] || 0;
      const disabled = amount <= 0;
      const growTime = crop.growTimeSec || 0;
      const alpha = disabled ? 0.4 : 1;

      // Row 背景
      const rowBg = this.add.graphics();
      rowBg.fillStyle(disabled ? 0x333333 : 0x5C3D2E, disabled ? 0.5 : 0.85);
      rowBg.fillRoundedRect(6, rowY, POPUP_W - 12, ROW_H - 4, 4);
      rowBg.setAlpha(alpha);
      rowBg.setDepth(10001);
      this.seedPopup.add(rowBg);

      // 種子圖示（維持大小 36x36）
      const iconKey = crop.icon || getAllCropDetails().find((c: any) => c.id === crop.id)?.icon || '';
      if (iconKey) {
        const icon = this.add.image(22, rowY + ROW_H / 2, iconKey);
        icon.setDisplaySize(36, 36);
        icon.setOrigin(0.5, 0.5);
        icon.setAlpha(alpha);
        icon.setDepth(10002);
        this.seedPopup.add(icon);
      }

      // 種子名稱
      const nameText = this.add.text(14, rowY + ROW_H / 2, crop.nameZhTw, {
        fontSize: '13px',
        fontFamily: "'Cubic 11', sans-serif",
        color: disabled ? '#888888' : '#FFFFFF',
        align: 'left',
      });
      nameText.setOrigin(0, 0.5);
      nameText.setAlpha(alpha);
      nameText.setDepth(10002);
      this.seedPopup.add(nameText);

      // 時間+數量（右側）
      const infoText = this.add.text(POPUP_W - 10, rowY + ROW_H / 2, `${formatTime(growTime)} x${amount}`, {
        fontSize: '11px',
        fontFamily: "'Cubic 11', sans-serif",
        color: disabled ? '#666666' : '#FFD700',
      });
      infoText.setOrigin(1, 0.5);
      infoText.setAlpha(alpha);
      infoText.setDepth(10002);
      this.seedPopup.add(infoText);

      // 點擊區域
      if (disabled) return;
      const hitArea = this.add.graphics();
      hitArea.fillStyle(0x000000, 0);
      hitArea.fillRect(6, rowY, POPUP_W - 12, ROW_H - 4);
      hitArea.setInteractive(
        new Phaser.Geom.Rectangle(6, rowY, POPUP_W - 12, ROW_H - 4),
        Phaser.Geom.Rectangle.Contains
      );
      hitArea.on('pointerdown', (e: any) => {
        e.stopPropagation?.();
        this.clearAllPopups();
        this.plantCrop(index, crop.id);
      });
      hitArea.setDepth(10003);
      this.seedPopup.add(hitArea);
    });
  }

  // 顯示提示訊息
  // ============================================================
  private showHintPopup(x: number, y: number, message: string) {
    const hint = this.add.container(x, y);
    hint.setDepth(300);

    const lines = message.split('\n');
    const POPUP_W = 200;
    const POPUP_H = 30 + lines.length * 22;

    const bg = this.add.graphics();
    bg.fillStyle(0x8B0000, 0.9);
    bg.fillRoundedRect(-POPUP_W / 2, 0, POPUP_W, POPUP_H, 8);
    hint.add(bg);

    const text = this.add.text(0, POPUP_H / 2, message, {
      fontSize: '13px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#FFFFFF',
      align: 'center',
      lineSpacing: 4,
    });
    text.setOrigin(0.5, 0.5);
    hint.add(text);

    this.time.delayedCall(1500, () => hint.destroy());
  }

  // ============================================================
  // 播種(含樂觀更新) — M002.5: 狀態邏輯委托 CropSystem
  // ============================================================
  private async plantCrop(index: number, cropId: number) {
    // 驗證
    const validation = validateCanPlant(this.farmState, index, cropId);
    if (!validation.valid) return;
    const originalState = validation.originalState;

    // 建立並寫入樂觀狀態
    const optimisticState = createOptimisticPlantState(cropId, originalState);
    applyOptimisticPlant(this.farmState, index, optimisticState);

    // UI 更新（FarmScene 自行處理）
    this.updateFarmTileVisual(index, 'plantCrop');
    this.showProgressBar(index);

    // 扣除背包（FarmScene 自行處理）
    backpackSystem.deductItem('seed', cropId);

    // ── 伺服器同步 ──
    try {
      const res = await authFetch('/api/farm/plant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: this.getTileCoordinate(index)!.x, y: this.getTileCoordinate(index)!.y, cropId }),
      });
      const data = await res.json();
      if (data.success) {
        const plantedAt = typeof data.tile.plantedAt === 'number' ? data.tile.plantedAt : new Date(data.tile.plantedAt).getTime();
        // 同步 server tile（FarmScene 自行更新）
        this.farmState.set(index, {
          ...this.farmState.get(index)!,
          plantedAt,
          finishAt: data.tile.finishAt,
          careCheckAt: plantedAt + 10000,
        });
        this.events.emit('goldChanged', data.user.gold);
        this.events.emit('userUpdated', data.user);
      } else {
        console.warn('[FarmScene] 播種失敗:', data.message);
        // 回滾（CropSystem）+ UI 恢復（FarmScene）
        rollbackPlant(this.farmState, index, originalState);
        this.hideProgressBar(index);
        this.updateFarmTileVisual(index);
        // 補償:恢復背包種子
        backpackSystem.addItem('seed', cropId);
      }
    } catch (err) {
      console.error('[FarmScene] 播種錯誤', err);
      // 網路錯誤:回滾並補償
      rollbackPlant(this.farmState, index, originalState);
      this.hideProgressBar(index);
      this.updateFarmTileVisual(index);
      backpackSystem.addItem('seed', cropId);
    }
  }

  // ============================================================
  // 顯示進度條 + 計時器
  // ============================================================
  private showProgressBar(index: number) {
    this.hideProgressBar(index);

    const container = this.tiles.get(`${index}`);
    if (!container) return;

    // uiContainer 使用 container local 座標系統，以農地中心 (0,0) 為基準
    // 上方固定 -80px (local)，不再混用 world 座標
    const UI_OFFSET_Y = -80;
    const BAR_W = 70;
    const BAR_H = 6;
    const BAR_Y = UI_OFFSET_Y;  // local to uiContainer, which is at container center

    const uiContainer = this.add.container(0, 0);
    uiContainer.setDepth(50);
    container.add(uiContainer);
    this.progressBars.set(index, uiContainer);

    const barBg = this.add.graphics();
    barBg.fillStyle(0x2D1B00, 1);
    barBg.fillRect(-BAR_W / 2, BAR_Y, BAR_W, BAR_H);
    barBg.lineStyle(1, 0x5C3D00, 1);
    barBg.strokeRect(-BAR_W / 2, BAR_Y, BAR_W, BAR_H);
    uiContainer.add(barBg);

    const timerText = this.add.text(0, BAR_Y - 12, '00:00', {
      fontSize: '11px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    timerText.setOrigin(0.5, 1);
    timerText.setStroke('#3D2500', 3);
    uiContainer.add(timerText);

    (uiContainer as any)._timerText = timerText;
    (uiContainer as any)._barFill = this.add.graphics();
    uiContainer.add((uiContainer as any)._barFill);
  }

  // ============================================================
  // 更新進度條
  // ============================================================
  private updateProgressBar(index: number) {
    const uiContainer = this.progressBars.get(index);
    if (!uiContainer) return;

    const state = this.farmState.get(index);
    if (!state || !state.plantedAt || !state.finishAt) {
      this.hideProgressBar(index);
      return;
    }

    const now = Date.now();
    const total = state.finishAt - state.plantedAt;
    const elapsed = now - state.plantedAt;
    const progress = Math.min(1, Math.max(0, elapsed / total));

    if (progress >= 1) {
      this.hideProgressBar(index);
      this.showMatureIndicator(index);
      return;
    }

    const tileCenter = this.getTileCenter(index);
    if (!tileCenter) return;

    const BAR_W = 70;
    const BAR_H = 6;
    const BAR_Y = tileCenter.y - 80;

    const remainingMs = Math.max(0, total - elapsed);
    const remainingSec = remainingMs / 1000;

    const timerText = (uiContainer as any)._timerText as Phaser.GameObjects.Text;
    if (timerText) {
      timerText.setText(formatTime(remainingSec));
      timerText.setColor('#FFFFEE');
    }

    const barFill = (uiContainer as any)._barFill as Phaser.GameObjects.Graphics;
    if (barFill) {
      barFill.clear();
      const fillW = Math.round(BAR_W * progress);
      const color = progress < 0.5 ? 0xFFCC00 : 0x88CC00;
      barFill.fillStyle(color, 1);
      barFill.fillRect(-BAR_W / 2, BAR_Y, fillW, BAR_H);
    }
  }

  private hideProgressBar(index: number) {
    const ui = this.progressBars.get(index);
    if (ui) { ui.destroy(); this.progressBars.delete(index); }
  }

  // ============================================================
  // 顯示成熟指示
  // ============================================================
  private showMatureIndicator(index: number) {
    this.hideMatureIndicator(index);
    const container = this.tiles.get(`${index}`);
    if (!container) return;

    const tileCenter = this.getTileCenter(index);
    if (!tileCenter) return;

    // 可收成文字:固定在 tileCenter 上方 -105px(使用統一座標系統)
    const indicator = this.add.container(tileCenter.x, tileCenter.y - 105);
    indicator.setDepth(60);
    container.add(indicator);
    this.matureIndicators.set(index, indicator);

    const sparkles = this.add.text(0, 0, '可收成', {
      fontSize: '14px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#FFD54A',
      fontStyle: 'bold',
      stroke: '#6B3A00',
      strokeThickness: 2,
    });
    sparkles.setOrigin(0.5, 0.5);
    indicator.add(sparkles);

    // ── 讓整個 indicator 可點擊,點了直接收成 ──
    indicator.setInteractive(
      new Phaser.Geom.Rectangle(-40, -12, 80, 24),
      Phaser.Geom.Rectangle.Contains
    );
    indicator.on('pointerdown', (e: any) => {
      e.stopPropagation?.();
      this.clearAllPopups();
      this.harvestCrop(index);
    });

    this.tweens.add({
      targets: indicator,
      y: indicator.y - 6,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private hideMatureIndicator(index: number) {
    const ind = this.matureIndicators.get(index);
    if (ind) { ind.destroy(); this.matureIndicators.delete(index); }
  }

  // ============================================================
  // 顯示營養不良指示
  // ============================================================
  private showDryIndicator(index: number) {
    this.hideDryIndicator(index);
    const container = this.tiles.get(`${index}`);
    if (!container) return;
    const tileCenter = this.getTileCenter(index);
    if (!tileCenter) return;

    const indicator = this.add.container(tileCenter.x, tileCenter.y - 100);
    indicator.setDepth(60);
    container.add(indicator);
    this.dryIndicators.set(index, indicator);

    const text = this.add.text(0, 0, '營養不良', {
      fontSize: '12px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#FF8C00',
      fontStyle: 'bold',
      stroke: '#5a3000',
      strokeThickness: 2,
    });
    text.setOrigin(0.5, 0.5);
    indicator.add(text);

    this.tweens.add({
      targets: indicator,
      alpha: 0.6,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private hideDryIndicator(index: number) {
    const ind = this.dryIndicators.get(index);
    if (ind) { ind.destroy(); this.dryIndicators.delete(index); }
  }

  // ============================================================
  // 顯示枯萎指示
  // ============================================================
  private showWitheredIndicator(index: number) {
    this.hideWitheredIndicator(index);
    const container = this.tiles.get(`${index}`);
    if (!container) return;
    const tileCenter = this.getTileCenter(index);
    if (!tileCenter) return;

    const indicator = this.add.container(tileCenter.x, tileCenter.y - 100);
    indicator.setDepth(60);
    container.add(indicator);
    this.witheredIndicators.set(index, indicator);

    const text = this.add.text(0, 0, '已枯萎', {
      fontSize: '13px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#8B0000',
      fontStyle: 'bold',
      stroke: '#3d0000',
      strokeThickness: 2,
    });
    text.setOrigin(0.5, 0.5);
    indicator.add(text);
  }

  private hideWitheredIndicator(index: number) {
    const ind = this.witheredIndicators.get(index);
    if (ind) { ind.destroy(); this.witheredIndicators.delete(index); }
  }

  // ============================================================
  // 收成飄字
  // ============================================================
  // ============================================================
  // 收成飄字(使用統一座標系統 getTileCenter)
  // ============================================================
  private showHarvestFloatingText(index: number, cropName: string, harvestYield: number, expEarned: number) {
    const container = this.tiles.get(`${index}`);
    if (!container) return;

    const tileCenter = this.getTileCenter(index);
    if (!tileCenter) return;

    // 飄字容器:置於 tileCenter 上方(world coords since farmland container is at world pos)
    const worldX = container.x + tileCenter.x;
    const worldY = container.y + tileCenter.y - 50;

    const floatContainer = this.add.container(worldX, worldY);
    floatContainer.setDepth(300);

    const cropText = this.add.text(0, 0, `${cropName} +${harvestYield}`, {
      fontSize: '16px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#88cc00',
      fontStyle: 'bold',
      stroke: '#2d5000',
      strokeThickness: 3,
    });
    cropText.setOrigin(0.5, 1);
    floatContainer.add(cropText);

    const expText = this.add.text(0, -22, `+${expEarned} EXP`, {
      fontSize: '14px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#ffd700',
      fontStyle: 'bold',
      stroke: '#5a3000',
      strokeThickness: 3,
    });
    expText.setOrigin(0.5, 1);
    floatContainer.add(expText);

    this.tweens.add({
      targets: floatContainer,
      y: worldY - 60,
      alpha: 0,
      duration: 800,
      ease: 'Quad.easeOut',
      onComplete: () => floatContainer.destroy(),
    });
  }

  // ============================================================
  // 收成(安全:只允許 cropState === 'mature')
  // ============================================================
  private async harvestCrop(index: number) {
    const state = this.farmState.get(index);
    if (!state) return;

    // ── 安全檢查:只用 cropState 判斷是否成熟 ──
    if (state.cropState === 'dry') {
      // 顯示提示:營養不良需先照顧
      const container = this.tiles.get(`${index}`);
      if (container) {
        const tileCenter = this.getTileCenter(index);
        if (tileCenter) {
          const msg = this.add.text(tileCenter.x, tileCenter.y - 110, '作物營養不良,請先照顧', {
            fontSize: '12px',
            fontFamily: "'Cubic 11', sans-serif",
            color: '#FF8C00',
            fontStyle: 'bold',
            stroke: '#5a3000',
            strokeThickness: 2,
          });
          msg.setOrigin(0.5, 0.5);
          msg.setDepth(200);
          container.add(msg);
          this.tweens.add({
            targets: msg,
            alpha: 0,
            delay: 2000,
            duration: 400,
            onComplete: () => msg.destroy(),
          });
        }
      }
      console.warn(`[FarmScene] blocked harvest: cropState=dry`);
      return;
    }
    const validation = validateCanHarvest(state);
    if (!validation.valid) {
      return;
    }

        if (DEBUG) { console.log('[HARVEST FRONTEND REQUEST]', {
      index,
      tileId: state.id,
      x: this.getTileCoordinate(index)?.x ?? 0,
      y: this.getTileCoordinate(index)?.y ?? 0,
      cropId: state.cropId,
      state: state.state,
      cropState: state.cropState,
      finishAt: state.finishAt,
      now: Date.now(),
    }); }

    // ── 先從快取拿 cropName / exp(用於即時顯示飄字)──
    const cropInfo = getCropDetails(state.cropId);
    const cropName = cropInfo?.nameZhTw ?? '作物';
    const expReward = cropInfo?.exp ?? 1;

    // ── 飄字改在 API 回傳後顯示（攜帶正確 harvestYield）──

    // ── Optimistic Update:立即清除 UI ──
    this.clearAllPopups();
    this.hideMatureIndicator(index);
    this.hideProgressBar(index);

    // ── 先更新狀態(這樣 updateFarmTileVisual 不會重新加載作物)──
    this.farmState.set(index, {
      ...state,
      cropId: undefined,
      plantedAt: undefined,
      finishAt: undefined,
      wateredAt: undefined,
      isWatered: false,
      cropStatus: 'needs_water',
      state: 'empty',
      cropState: 'empty',
      soilState: 'dry',
      isFertilized: 0,
      fertilizedAt: undefined,
      fertilizerType: 'normal',
      fertilizerSpeedBonus: 20,
    });

    // ── 土地變乾燥 + 作物已由 farmState=empty + renderCrop=noop 自動清除 ──
    this.renderFarmland(index);
    this.renderCrop(index);

    // ── 背景呼叫 API ──
    try {
      const res = await authFetch('/api/farm/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: this.getTileCoordinate(index)!.x, y: this.getTileCoordinate(index)!.y }),
      });
      const data = await res.json();
      if (data.success) {
        console.log('[HARVEST FLOATING TEXT SHOWN]', {
          cropName: data.harvest.cropName,
          harvestYield: data.harvest.harvestYield,
          exp: expReward,
        });
        // ── 第一時間顯示飄字（不等背景同步）──
        this.showHarvestFloatingText(index, data.harvest.cropName, data.harvest.harvestYield, expReward);

        // ── 背景同步（不等飄字完成）──
        console.log('[HARVEST BACKGROUND SYNC START]');
        // 刷新背包
        backpackSystem.fetchAll();
        // userUpdated 事件
        this.events.emit('userUpdated', data.user);
        this.events.emit('harvest', {
          gold: data.exp ?? expReward,
          exp: data.harvest?.exp ?? expReward,
          cropId: data.cropId ?? state.cropId,
          cropName: data.cropName ?? state.cropId,
          harvestYield: data.harvest?.harvestYield ?? 1,
        });
        console.log('[HARVEST BACKGROUND SYNC DONE]');
      } else {
        console.warn('[FarmScene] 收成失敗,回滾:', data.message);
        // API 失敗:重新讀取農場狀態
        this.syncFarmState();
      }
    } catch (err) {
      console.error('[FarmScene] 收成錯誤,回滾:', err);
      this.syncFarmState();
    }
  }

  // ============================================================
  // 進入營養不良狀態(dry)
  // ============================================================
  private transitionToDry(index: number) {
    const state = this.farmState.get(index);
    if (!state) return;
    // 只有 growing/seed/seedling 可以進入 dry
    if (!shouldTransitionToDry(state)) return;

    const now = Date.now();
    this.farmState.set(index, {
      ...state,
      state: 'dry',
      cropState: 'dry',
      dryStartedAt: now,
    });

    this.updateFarmTileVisual(index);
    this.hideProgressBar(index);
    if (this.actionMenu) { this.actionMenu.destroy(); this.actionMenu = null; }
    this.isFarmActionMenuOpen = false;
//     if (DEBUG) { console.log('[DRY STATE ENTER]', {
    if (DEBUG) { console.log('[DRY STATE ENTER]', {
      index,
      state: 'dry',
      dryStartedAt: now,
      wateredAt: state.wateredAt,
      isFertilized: state.isFertilized,
    }); }

    // 同步到後端
    this.syncTileStateToBackend(index, { state: 'dry', dryStartedAt: now });
  }

  // ============================================================
  // 進入枯萎狀態(withered)
  // ============================================================
  private transitionToWithered(index: number) {
    const state = this.farmState.get(index);
    if (!state) return;
    if (!shouldTransitionToWithered(state)) return;

    this.farmState.set(index, {
      ...state,
      state: 'withered',
      cropState: 'withered',
    });

    this.updateFarmTileVisual(index);
    this.hideProgressBar(index);
    this.hideDryIndicator(index);
    if (this.actionMenu) { this.actionMenu.destroy(); this.actionMenu = null; }
    this.isFarmActionMenuOpen = false;

    // 同步到後端
    this.syncTileStateToBackend(index, { state: 'withered' });
  }

  // ============================================================
  // DRY 恢復:dry → growing(澆水或施肥後)
  // ============================================================
  private recoverDryTile(index: number) {
    const state = this.farmState.get(index);
    if (!state) return;

//     if (DEBUG) { console.log('[DRY RECOVER CHECK]', {
    if (DEBUG) { console.log('[DRY RECOVER CHECK]', {
      index,
      state: state.state,
      cropState: state.cropState,
      finishAt: state.finishAt,
      wateredAt: state.wateredAt,
      fertilizedAt: state.fertilizedAt,
      dryStartedAt: state.dryStartedAt,
      isFertilized: state.isFertilized,
    }); }

    // 取消枯萎計時器(如果有的話)
    const timer = this.witheringTimers.get(index);
    if (timer) {
      timer.destroy();
      this.witheringTimers.delete(index);
    }

    // 恢復狀態
    this.farmState.set(index, {
      ...state,
      state: 'growing',
      cropState: 'growing',
      dryStartedAt: undefined,
      witherAt: undefined,
    });

    // 清除 dry 狀態 UI
    this.hideDryIndicator(index);
    if (this.actionMenu) { this.actionMenu.destroy(); this.actionMenu = null; }
    this.isFarmActionMenuOpen = false;

    // 重建作物與進度條
    this.updateFarmTileVisual(index);
    this.renderCrop(index);

    // 進度條:只有 finishAt 存在時才顯示
    if (state.finishAt) {
      this.showProgressBar(index);
    }

//     if (DEBUG) { console.log('[DRY RECOVER SUCCESS]', {
    if (DEBUG) { console.log('[DRY RECOVER SUCCESS]', {
      index,
      state: 'growing',
      finishAt: state.finishAt,
      dryStartedAt: null,
      progressBarExists: !!this.progressBars.get(index),
    }); }
  }

  // ============================================================
  // 同步 tile 狀態到後端(通用)
  // ============================================================
  private async syncTileStateToBackend(index: number, updates: Record<string, any>) {
    try {
      const coord = this.getTileCoordinate(index);
      if (!coord) return;
      await authFetch('/api/farm/tile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: coord.x, y: coord.y, ...updates }),
      });
    } catch (err) {
      console.warn('[FarmScene] syncTileStateToBackend 失敗:', err);
    }
  }

  // ============================================================
  // 清除枯萎作物
  // ============================================================
  private async clearWitheredCrop(index: number) {
    const state = this.farmState.get(index);
    if (!state) return;
    if (state.cropState !== 'withered') {
      console.warn('[FarmScene] 只能清除枯萎的作物');
      return;
    }


    // 樂觀更新:馬上清除
    const now = Date.now();
    this.farmState.set(index, {
      ...state,
      cropId: undefined,
      plantedAt: undefined,
      finishAt: undefined,
      wateredAt: undefined,
      isWatered: false,
      cropStatus: 'needs_water',
      state: 'empty',
      cropState: 'empty',
      soilState: 'dry',
      isFertilized: 0,
      fertilizedAt: undefined,
      dryStartedAt: undefined,
    });
    this.hideWitheredIndicator(index);
    this.hideProgressBar(index);
    this.renderCrop(index);
    this.renderFarmland(index);
    // 取消枯萎計時器
    const timer = this.witheringTimers.get(index);
    if (timer) { timer.destroy(); this.witheringTimers.delete(index); }

    try {
      const res = await authFetch('/api/farm/clear-withered', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: this.getTileCoordinate(index)!.x, y: this.getTileCoordinate(index)!.y }),
      });
      const data = await res.json();
      if (!data.success) {
        console.warn('[FarmScene] 清除失敗:', data.message);
        this.syncFarmState();
      }
    } catch (err) {
      console.error('[FarmScene] 清除錯誤:', err);
      this.syncFarmState();
    }
  }

  // ============================================================
  // 澆水
  // ============================================================
  private async waterCrop(index: number) {
    // ── 驗證（CropSystem）──
    const validation = validateCanWater(this.farmState, index);
    if (!validation.valid) return;
    const originalState = validation.originalState;

    const container = this.tiles.get(`${index}`);
    if (!container) return;

    const dropY = -this.FARM_SIZE / 2;
    const drop = this.add.text(0, dropY, '+', { fontSize: '20px' });
    drop.setOrigin(0.5, 1);
    drop.setDepth(80);
    container.add(drop);

    this.tweens.add({
      targets: drop,
      y: dropY - 50,
      alpha: 0,
      duration: 800,
      ease: 'Quad.easeOut',
      onComplete: () => drop.destroy(),
    });

    const wateredText = this.add.text(0, -this.FARM_SIZE / 2 - 30, '已澆水', {
      fontSize: '12px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#87CEEB',
      fontStyle: 'bold',
    });
    wateredText.setOrigin(0.5, 1);
    wateredText.setDepth(80);
    container.add(wateredText);

    this.tweens.add({
      targets: wateredText,
      alpha: 0,
      delay: 1200,
      duration: 400,
      onComplete: () => wateredText.destroy(),
    });

    // ── 樂觀更新（CropSystem）──
    const optimisticState = createOptimisticWaterState();
    applyOptimisticWater(this.farmState, index, optimisticState);

    // ── 立刻更新土地貼圖 + 重建作物 ──
    this.renderFarmland(index);
    this.renderCrop(index);

    try {
      const res = await authFetch('/api/farm/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: this.getTileCoordinate(index)!.x, y: this.getTileCoordinate(index)!.y }),
      });
      const data = await res.json();
      if (!data.success) {
        console.warn('[FarmScene] 澆水 API 失敗:', data.message);
        // 回滾（CropSystem）
        rollbackWater(this.farmState, index, originalState);
        this.renderFarmland(index);
        this.renderCrop(index);
      } else {
        // 使用伺服器返回的狀態(可能調整了 finish_at 和 state)
        const prevCropState = this.farmState.get(index)?.cropState;
        if (data.state !== undefined) {
          this.farmState.set(index, {
            ...this.farmState.get(index),
            wateredAt: data.wateredAt,
            state: data.state,
            cropState: data.state,
            finishAt: data.finishAt || this.farmState.get(index)?.finishAt,
            dryStartedAt: data.state === 'growing' ? undefined : this.farmState.get(index)?.dryStartedAt,
          });
          this.renderCrop(index);
        }
        if (DEBUG) { console.log('[WATER SUCCESS]', {
          index,
          stateBefore: prevCropState,
          stateAfter: data.state,
          wateredAt: data.wateredAt,
        }); }
        // ── DRY 恢復檢查 ──
        if (data.state === 'growing' && prevCropState === 'dry') {
                    this.recoverDryTile(index);
        }
      }
    } catch (err) {
      console.warn('[FarmScene] 澆水 API 錯誤', err);
      // 回滾（CropSystem）
      rollbackWater(this.farmState, index, originalState);
      this.renderFarmland(index);
      this.renderCrop(index);
    }
  }

  // ============================================================
  // 施肥
  // ============================================================
  private async fertilizeCrop(index: number) {
    // ── 驗證（CropSystem）──
    const validation = validateCanFertilize(this.farmState, index);
    if (!validation.valid) return;
    const state = validation.originalState;

    const container = this.tiles.get(`${index}`);
    if (!container) return;

    // 顯示「使用肥料中...」
    const fertilizerText = this.add.text(0, -this.FARM_SIZE / 2 - 30, '使用肥料中...', {
      fontSize: '12px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#AAFF88',
      fontStyle: 'bold',
    });
    fertilizerText.setOrigin(0.5, 1);
    fertilizerText.setDepth(80);
    container.add(fertilizerText);

    try {
      const res = await authFetch('/api/farm/fertilize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: this.getTileCoordinate(index)!.x, y: this.getTileCoordinate(index)!.y }),
      });
      const data = await res.json();

      fertilizerText.destroy();

      if (data.success) {
        // 刷新背包
        backpackSystem.fetchAll();

        // ── 診斷日誌：先看清楚 server 實際回傳格式 ──
        console.log('[FERTILIZE RAW RESPONSE]', JSON.stringify(data, null, 2));

        // 支援多層 response 格式：data.tile / data.data.tile / data.result.tile
        const responseTile =
          data?.tile ??
          (data?.data ? (data.data.tile ?? null) : null) ??
          (data?.result ? (data.result.tile ?? null) : null);

        const prevCropState = state.cropState;
        const now = Date.now();

        // responseTile 存在：優先用 server tile 狀態
        if (responseTile) {
          const newStateFromServer = responseTile.state ?? 'growing';
          this.farmState.set(index, {
            ...state,
            isFertilized: 1,
            fertilizedAt: responseTile.fertilizedAt ?? now,
            fertilizerType: 'normal',
            fertilizerSpeedBonus: 20,
            state: newStateFromServer,
            cropState: newStateFromServer,
            dryStartedAt: undefined,   // server 回 growing 就清除
            witherAt: undefined,
          });
          console.log('[FERTILIZE CLIENT APPLY TILE]', {
            index,
            beforeFarmState: prevCropState,
            responseTileState: responseTile.state,
            afterFarmState: this.farmState.get(index)?.cropState,
          });

          // ── 無論之前是不是 dry，server 回 growing 就完整恢復 ──
          if (newStateFromServer === 'growing') {
            this.recoverDryTile(index);
          } else {
            this.hideDryIndicator(index);
            this.updateFarmTileVisual(index);
            this.renderCrop(index);
          }
        } else {
          // responseTile 是 undefined：server 格式異常，仍當成功處理（防呆）
          console.error('[FERTILIZE] tile undefined，採用 fallback。response:', data);
          this.farmState.set(index, {
            ...state,
            isFertilized: 1,
            fertilizedAt: now,
            fertilizerType: 'normal',
            fertilizerSpeedBonus: 20,
            state: 'growing',
            cropState: 'growing',
            dryStartedAt: undefined,
            witherAt: undefined,
          });
          console.log('[FERTILIZE CLIENT FALLBACK]', {
            index,
            beforeFarmState: prevCropState,
            afterFarmState: 'growing',
          });
          this.recoverDryTile(index);
        }
        // 更新金幣顯示
        if (data.gold !== undefined) {
          this.events.emit('goldChanged', data.gold);
        }
        this.showFertilizeSuccess(index);
      } else {
        fertilizerText.destroy();
        const msg = data.message || '';
        const toastMsg = (msg.includes('肥料不足') || msg.includes('沒有足夠的肥料'))
          ? '肥料不足，請先購買普通肥料'
          : (data.message || '施肥失敗');
        console.log('[FERTILIZE ERROR MESSAGE]', toastMsg);
        console.log('[TOAST METHOD USED]', 'window.dispatchEvent(CustomEvent)');
        console.log('[TOAST DISPATCHED]', toastMsg);
        window.dispatchEvent(new CustomEvent('game-toast', { detail: { message: toastMsg } }));
      }
    } catch (err: any) {
      console.error('[FarmScene] 施肥錯誤', err);
      let msg = '施肥失敗，請稍後再試';
      if (err?.message) msg = err.message;
      else if (err?.body?.message) msg = err.body.message;
      else if (typeof err === 'string') msg = err;
      console.log('[FERTILIZE ERROR MESSAGE]', msg);
      console.log('[TOAST METHOD USED]', 'window.dispatchEvent(CustomEvent)');
      console.log('[TOAST DISPATCHED]', msg);
      window.dispatchEvent(new CustomEvent('game-toast', { detail: { message: msg } }));
    }
  }

  // ============================================================
  // 施肥成功飄字
  // ============================================================
  private showFertilizeSuccess(index: number) {
    const container = this.tiles.get(`${index}`);
    if (!container) return;

    const tileCenter = this.getTileCenter(index);
    if (!tileCenter) return;

    const successText = this.add.text(tileCenter.x, tileCenter.y - this.FARM_SIZE / 2 - 30, '施肥成功', {
      fontSize: '13px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#88FF44',
      fontStyle: 'bold',
      stroke: '#2d5000',
      strokeThickness: 2,
    });
    successText.setOrigin(0.5, 1);
    successText.setDepth(90);
    container.add(successText);

    this.tweens.add({
      targets: successText,
      alpha: 0,
      y: successText.y - 40,
      delay: 1000,
      duration: 400,
      onComplete: () => successText.destroy(),
    });
  }

  // ============================================================
  // 顯示操作選單(根據狀態動態生成按鈕)
  // ============================================================
  private showActionMenu(index: number, x: number, y: number, state: TileData) {
    if (this.actionMenu) {
      this.actionMenu.destroy();
      this.actionMenu = null;
      this.isFarmActionMenuOpen = false;
    }

    // ── 成長中(seed/seedling/growing/dry):總是顯示澆水+施肥 ──
    const activeStates = ['seed', 'seedling', 'growing', 'dry'];
    const isActive = activeStates.includes(state.cropState);
    const isMature = state.cropState === 'mature';
    const isWithered = state.cropState === 'withered';

    if (!isActive && !isMature && !isWithered) return;
    this.isFarmActionMenuOpen = true;

    // ── 決定按鈕清單 ──
    // 結構:{ label, icon, action, disabled }
    // disabled=true → opacity 0.4 + 不可點擊
    const btns: { label: string; icon: string; action: string; disabled: boolean }[] = [];

    if (isActive) {
      // 澆水按鈕:已澆水(wateredAt != null)→ disabled
      const waterDone = !!state.wateredAt;
      btns.push({ label: '澆水', icon: 'icon_watering', action: 'water', disabled: waterDone });

      // 施肥按鈕:已施肥(isFertilized == 1)→ disabled
      const fertDone = !!state.isFertilized;
      btns.push({ label: '施肥', icon: 'icon_fertilizer', action: 'fertilize', disabled: fertDone });

          } else if (isMature) {
      btns.push({ label: '收成', icon: 'icon_harvest', action: 'harvest', disabled: false });
    } else if (isWithered) {
      btns.push({ label: '清除', icon: 'icon_harvest', action: 'clear', disabled: false });
    }

    if (btns.length === 0) return;

    const btnCount = btns.length;
    const btnW = 56;
    const btnH = 56;
    const menuW = btnCount * btnW + (btnCount + 1) * 10;
    const menuH = 90;

    this.actionMenu = this.add.container(x - menuW / 2, y - menuH);
    this.actionMenu.setDepth(9000);

    const menuBg = this.add.graphics();
    menuBg.fillStyle(0x3d2518, 0.9);
    menuBg.fillRoundedRect(0, 0, menuW, menuH, 8);
    menuBg.lineStyle(2, 0x8B4513, 1);
    menuBg.strokeRoundedRect(0, 0, menuW, menuH, 8);
    this.actionMenu.add(menuBg);

    btns.forEach((btn, i) => {
      const btnX = 10 + i * (btnW + 10);
      const btnY = (menuH - btnH) / 2;

      const btnContainer = this.add.container(btnX, btnY);
      btnContainer.setDepth(9001);
      if (btn.disabled) {
        btnContainer.setAlpha(0.4);
      }

      const btnBg = this.add.graphics();
      btnBg.fillStyle(0x8B4513, 1);
      btnBg.fillRoundedRect(0, 0, btnW, btnH, 6);
      btnContainer.add(btnBg);

      const iconImg = this.add.image(btnW / 2, btnH / 2 - 6, btn.icon);
      iconImg.setDisplaySize(36, 36);
      if (btn.disabled) iconImg.setAlpha(0.5);
      btnContainer.add(iconImg);

      const btnText = this.add.text(btnW / 2, btnH - 8, btn.label, {
        fontSize: '12px',
        fontFamily: "'Cubic 11', sans-serif",
        color: btn.disabled ? '#AAAAAA' : '#FFFFFF',
        fontStyle: 'bold',
      });
      btnText.setOrigin(0.5, 1);
      btnContainer.add(btnText);

      // disabled 時不給互動
      if (!btn.disabled) {
        btnContainer.setInteractive(
          new Phaser.Geom.Rectangle(0, 0, btnW, btnH),
          Phaser.Geom.Rectangle.Contains
        );
        btnContainer.on('pointerdown', (e: any) => {
          e.stopPropagation?.();
                    this.clearAllPopups();
          if (btn.action === 'water') this.waterCrop(index);
          else if (btn.action === 'harvest') this.harvestCrop(index);
          else if (btn.action === 'fertilize') this.fertilizeCrop(index);
          else if (btn.action === 'clear') this.clearWitheredCrop(index);
        });
      }

      this.actionMenu!.add(btnContainer);
    });
  }

  // ============================================================
  // 雞舍:同步狀態
  // ============================================================
  private async syncChickenCoopStatus() {
    try {
      const res = await authFetch('/api/animals/chicken-coop/status');
      const data = await res.json();
      console.log('[COOP STATUS FROM API]', {
        success: data.success,
        hasBuilding: data.hasBuilding,
        tileX: data.tileX,
        tileY: data.tileY,
        slots: data.slots?.length,
        slotStates: data.slots?.map((s: any) => s.state),
      });
      if (data.success) {
        this.coopChickenStatus = data;
        this.coopChickenStatus.gold = data.gold;

        if (data.hasBuilding && data.tileX !== null && data.tileY !== null) {
          this.chickenCoopPlaced = true;
          this.chickenCoopTileX = data.tileX;
          this.chickenCoopTileY = data.tileY;
          // 無條件以 API tileX/tileY 為準：摧毀舊 sprite，依 API 資料重建
          if (this.chickenCoopSprite) {
            console.log('[SYNC] destroying existing chickenCoopSprite to re-render at API position');
            this.chickenCoopSprite.destroy();
            this.chickenCoopSprite = null;
          }
          this.renderChickenCoop();
          // API 回傳後立即用 server slots 渲染小雞（與商店狀態同步）
          console.log('[SYNC hasBuilding=true] calling renderChicksInCoop');
          this.renderChicksInCoop();
        } else {
          this.chickenCoopPlaced = false;
          if (this.chickenCoopSprite) {
            // sprite 已存在但 API 認為未放置（可能 tile_x=0 的邊界問題）
            // 仍更新 coopChickenStatus，讓 renderChicksInCoop() 能拿到 slots
            if (DEBUG_COOP) console.log('[SYNC] hasBuilding=false but sprite exists, still updating slots');
            // 即使 hasBuilding=false，仍用 API slots 渲染雞（開場就要能看到雞）
            console.log('[SYNC hasBuilding=false] calling renderChicksInCoop');
            this.renderChicksInCoop();
          }
        }
      }
    } catch (err) {
      console.warn('[FarmScene] syncChickenCoopStatus failed', err);
    }
  }

  // ── 雞舍:啟動輪詢 ──
  private startChickenPoll() {
    if (this.coopChickenPollTimer) {
      this.coopChickenPollTimer.destroy();
    }
    this.coopChickenPollTimer = this.time.addEvent({
      delay: 5000,
      callback: () => {
        this.syncChickenCoopStatus();
      },
      loop: true,
    });
  }

  // ── 雞舍:停止輪詢 ──
  private stopChickenPoll() {
    if (this.coopChickenPollTimer) {
      this.coopChickenPollTimer.destroy();
      this.coopChickenPollTimer = null;
    }
  }

  // ============================================================
  // 雞舍:渲染已放置的雞舍(2×2)
  // ============================================================
  private renderChickenCoop() {
    // 摧毀舊 hitZone
    if (this.chickenCoopHitZone) {
      this.chickenCoopHitZone.destroy();
      this.chickenCoopHitZone = null;
    }
    if (this.chickenCoopSprite) {
      this.chickenCoopSprite.destroy();
      this.chickenCoopSprite = null;
    }
    if (!this.chickenCoopPlaced) return;

    // 農地處於畫布中央,3×2 農地 (360×240) + 間隔
    const COLS = INITIAL_FARM_COLS;
    const ROWS = INITIAL_FARM_ROWS;
    const totalFarmW = COLS * this.FARM_SIZE + (COLS - 1) * this.FARM_GAP;
    const totalFarmH = ROWS * this.FARM_SIZE + (ROWS - 1) * this.FARM_GAP;
    const farmStartX = (this.CANVAS_W - totalFarmW) / 2;
    const farmStartY = (this.CANVAS_H - totalFarmH) / 2;

    // 雞舍位於農地右側 (x=3, y=0),使用左上角定位（origin=0,0）
    const coopPixelX = farmStartX + this.chickenCoopTileX * this.FARM_SIZE;
    const coopPixelY = farmStartY + this.chickenCoopTileY * this.FARM_SIZE;

    const coopSprite = this.add.sprite(coopPixelX, coopPixelY, 'chicken_coop');
    // 288×288，與原本 placeChickenCoopLocal() 一致
    coopSprite.setDisplaySize(288, 288);
    coopSprite.setOrigin(0, 0);
    coopSprite.setDepth(5000);

    this.chickenCoopSprite = coopSprite;

    // 透明互動區，專門吃點擊
    const hitZone = this.add.zone(coopPixelX, coopPixelY, 288, 288);
    hitZone.setOrigin(0, 0);
    hitZone.setDepth(6000);
    hitZone.setInteractive({ useHandCursor: true });
    hitZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      console.log('[COOP POINTERDOWN]');
      pointer.event.stopPropagation();
      if (!this.farmInputEnabled) return;
      this.openChickenCoopPanel();
    });

    this.chickenCoopHitZone = hitZone;
  }

  // ============================================================
  // 雞舍:進入放置模式
  // ============================================================
  private _coopPointerMoveHandler: (pointer: Phaser.Input.Pointer) => void = () => {};
  private _coopPointerDownHandler: () => void = () => {};

  // ============================================================
  // 建築放置系統(通用)
  // ============================================================

  // ── 進入放置模式 ──
  // ── M003.2.3 農地放置模式 ──

  // 進入農地放置模式（取第一個未放置 slot）
  private async enterFarmlandPlacement() {
    if (this.farmlandPlacementMode) return;

    try {
      const res = await authFetch('/api/farm/plots');
      const data = await res.json();
      if (!data.success || !data.plots) {
        this.events.emit('game-toast', '讀取農地狀態失敗');
        return;
      }
      // 找第一個未放置的 slot
      const unplaced = (data.plots as any[]).filter((p: any) => !p.placed);
      if (unplaced.length === 0) {
        this.events.emit('game-toast', '沒有可放置的農地');
        return;
      }
      const slotIndex = unplaced[0].slotIndex;
      this.farmlandPlacementSlotIndex = slotIndex;
      this.farmlandPlacementMode = true;
      this.farmInputEnabled = true;
      this.clearAllPopups();

      // 建立預覽 Graphics
      if (this.farmlandPlacementPreview) {
        this.farmlandPlacementPreview.destroy();
      }
      this.farmlandPlacementPreview = this.add.graphics();
      this.farmlandPlacementPreview.setDepth(999999);

      this.farmlandPlacementStartedAt = Date.now();

      // 預設放到第一個合法位置
      const firstValid = this.findFirstValidFarmlandPosition(1, 1);
      if (firstValid) {
        const TILE_STEP = this.FARM_SIZE + this.FARM_GAP;
        this.farmlandPlacementCursorTileX = Math.floor(firstValid.x / TILE_STEP);
        this.farmlandPlacementCursorTileY = Math.floor(firstValid.y / TILE_STEP);
        this.farmlandPlacementCanPlace = this.canPlaceFarmland(this.farmlandPlacementCursorTileX, this.farmlandPlacementCursorTileY).canPlace;
        this.updateFarmlandPlacementPreview();
      }

      // M003.2.3 農地放置：使用 Scene Input Plugin 全域監聽（官方 Placement Mode 標準做法）
      this.input.on('pointermove', this._farmlandPlacementPointerMoveHandler);
      this.input.on('pointerdown', this._farmlandPlacementPointerDownHandler);
      this.events.emit('game-toast', '請選擇要放置農地的位置');
    } catch (err) {

      this.events.emit('game-toast', '進入放置模式失敗');
    }
  }

  // M003.2.3 農地放置：使用 Scene Input Plugin 全域監聽（符合 Phaser 官方 Placement Mode 標準做法）
  private _farmlandPlacementPointerDownHandler: (pointer: Phaser.Input.Pointer) => void = (pointer) => {
    if (!this.farmlandPlacementMode) return;
    if (Date.now() - this.farmlandPlacementStartedAt < 300) return;
    const TILE_STEP = this.FARM_SIZE + this.FARM_GAP;
    const tileX = this.farmlandPlacementCursorTileX;
    const tileY = this.farmlandPlacementCursorTileY;
    if (tileX < 0 || tileX > 15 || tileY < 0 || tileY > 15) return;
    const check = this.canPlaceFarmland(tileX, tileY);
    if (!check.canPlace) return;
    this.confirmFarmlandPlacement(tileX, tileY);
  };

  private _farmlandPlacementPointerMoveHandler: (pointer: Phaser.Input.Pointer) => void = (pointer) => {
    if (!this.farmlandPlacementMode || !this.farmlandPlacementPreview) return;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const TILE_STEP = this.FARM_SIZE + this.FARM_GAP;
    const tileX = Math.floor((worldPoint.x - this.farmStartX) / TILE_STEP);
    const tileY = Math.floor((worldPoint.y - this.farmStartY) / TILE_STEP);
    if (tileX < 0 || tileX > 15 || tileY < 0 || tileY > 15) return;
    this.farmlandPlacementCursorTileX = tileX;
    this.farmlandPlacementCursorTileY = tileY;
    const check = this.canPlaceFarmland(tileX, tileY);
    this.farmlandPlacementCanPlace = check.canPlace;
    this.updateFarmlandPlacementPreview();
  };

  // 繪製 1x1 農地預覽
  private updateFarmlandPlacementPreview() {
    if (!this.farmlandPlacementPreview) return;
    this.farmlandPlacementPreview.clear();
    const TILE_STEP = this.FARM_SIZE + this.FARM_GAP;
    const px = this.farmStartX + this.farmlandPlacementCursorTileX * TILE_STEP;
    const py = this.farmStartY + this.farmlandPlacementCursorTileY * TILE_STEP;
    const color = this.farmlandPlacementCanPlace ? 0x00ff00 : 0xff0000;
    this.farmlandPlacementPreview.fillStyle(color, 0.4);
    this.farmlandPlacementPreview.lineStyle(3, color, 1);
    this.farmlandPlacementPreview.fillRect(px, py, this.FARM_SIZE, this.FARM_SIZE);
    this.farmlandPlacementPreview.strokeRect(px, py, this.FARM_SIZE, this.FARM_SIZE);
  }

  // 檢查某 tile 是否可放置農地（無重疊、不在雞舍範圍、不超出邊界）
  private canPlaceFarmland(tileX: number, tileY: number): { canPlace: boolean; blockedBy: string } {
    // 1. 邊界檢查
    if (tileX < 0 || tileX > 15 || tileY < 0 || tileY > 15) {
      return { canPlace: false, blockedBy: 'out_of_bounds' };
    }
    // 2. 農地座標不重疊（用 tile 座標判斷，1x1 tile）
    for (const [idx, state] of this.farmState.entries()) {
      if (state.x === tileX && state.y === tileY) {
        return { canPlace: false, blockedBy: 'farmland' };
      }
    }
    // 3. 雞舍 2x2 區域不重疊（用 tile 座標判斷）
    const COOP_W = 2;
    const COOP_H = 2;
    if (
      this.chickenCoopPlaced &&
      tileX >= this.chickenCoopTileX &&
      tileX < this.chickenCoopTileX + COOP_W &&
      tileY >= this.chickenCoopTileY &&
      tileY < this.chickenCoopTileY + COOP_H
    ) {
      return { canPlace: false, blockedBy: 'chicken_coop' };
    }
    // 4. 必須與現有農地相鄰（上/下/左/右至少一格）
    if (this.farmState.size > 0) {
      const hasNeighbor = Array.from(this.farmState.values()).some(state =>
        (state.x === tileX && (state.y === tileY - 1 || state.y === tileY + 1)) ||
        (state.y === tileY && (state.x === tileX - 1 || state.x === tileX + 1))
      );
      if (!hasNeighbor) {
        return { canPlace: false, blockedBy: 'not_adjacent' };
      }
    }
    return { canPlace: true, blockedBy: 'none' };
  }

  // 找第一個可放置農地的位置
  private findFirstValidFarmlandPosition(wTiles: number, hTiles: number): { x: number; y: number } | null {
    for (let gy = 0; gy < 16; gy++) {
      for (let gx = 0; gx < 16; gx++) {
        if (this.canPlaceFarmland(gx, gy).canPlace) {
          return { x: gx * (this.FARM_SIZE + this.FARM_GAP), y: gy * (this.FARM_SIZE + this.FARM_GAP) };
        }
      }
    }
    return null;
  }

  // 點擊地圖時確認放置農地
  private onFarmlandPlacementPointerDown() {
    if (!this.farmlandPlacementMode) return;
    if (Date.now() - this.farmlandPlacementStartedAt < 300) return;
    if (!this.farmlandPlacementCanPlace) {
      this.events.emit('game-toast', '這裡不能放置農地');
      return;
    }
    this.confirmFarmlandPlacement(this.farmlandPlacementCursorTileX, this.farmlandPlacementCursorTileY);
  }

  private async confirmFarmlandPlacement(tileX: number, tileY: number) {
    const slotIndex = this.farmlandPlacementSlotIndex;
    if (slotIndex === null) return;

    try {
      const res = await authFetch('/api/farm/plots/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotIndex, tileX, tileY }),
      });
      const data = await res.json();
      if (!data.success) {
        this.events.emit('game-toast', data.message || '放置失敗');
        return;
      }
      // 成功：關閉放置模式
      this.exitFarmlandPlacement();
      // 同步農地狀態
      this.syncFarmState();
      this.events.emit('game-toast', '農地放置成功');
    } catch (err) {

      this.events.emit('game-toast', '放置失敗，請稍後再試');
    }
  }

  private exitFarmlandPlacement() {
    if (this.farmlandPlacementPreview) {
      this.farmlandPlacementPreview.destroy();
      this.farmlandPlacementPreview = null;
    }
    this.farmlandPlacementMode = false;
    this.farmlandPlacementSlotIndex = null;
    this.input.off('pointermove', this._farmlandPlacementPointerMoveHandler);
    this.input.off('pointerdown', this._farmlandPlacementPointerDownHandler);
  }

  // ESC 取消農地放置
  private cancelFarmlandPlacement() {
    this.exitFarmlandPlacement();
    this.events.emit('game-toast', '已取消放置');
  }

  // ── DEV 鈕：農地放置（供外部呼叫做測試）──
  private handleDevPlaceFarmland() {
    this.enterFarmlandPlacement();
  }

  private enterBuildingPlacement(buildingType: string) {
    // 防重入:已在放置模式就跳過
    if (this.coopPlacementMode) {
      console.log('[ENTER BUILDING MODE SKIPPED] already placing', buildingType);
      return;
    }

    console.log('[ENTER BUILDING MODE]', buildingType);
    this.farmInputEnabled = true;

    // 先 clearAllPopups(coopPlacementMode 此時還是 false,不會觸發 cancelCoopPlacement)
    this.clearAllPopups();

    // 摧毀舊 preview
    if (this.coopPlacementPreview) {
      this.coopPlacementPreview.destroy();
      this.coopPlacementPreview = null;
    }

    // 清除完成後才設為 true(避免 clearAllPopups 內的 cancelCoopPlacement 提前觸發)
    this.coopPlacementMode = true;

    // 用 Graphics 畫預覽(避免 Rectangle 中心點定位問題)
    this.coopPlacementPreview = this.add.graphics();
    this.coopPlacementPreview.setDepth(999999);

    // ── Debug:畫出所有農地邊界(藍色)──
    this.debugGraphics = this.add.graphics();
    this.debugGraphics.setDepth(999998);
    for (const farmland of this.farmlandObjects) {
      const b = farmland.getBounds();
      this.debugGraphics.lineStyle(2, 0x0000ff, 1); // 藍色
      this.debugGraphics.strokeRect(b.x, b.y, b.width, b.height);
    }
//     console.log('[DEBUG FARM LAND BOUNDS]', {
    console.log('[DEBUG FARM LAND BOUNDS]', {
      farmlandCount: this.farmlandObjects.length,
      bounds: this.farmlandObjects.map((f, i) => {
        const b = f.getBounds();
        return { index: i, x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
      }),
    });

//     console.log('[PREVIEW CREATED]');
    console.log('[PREVIEW CREATED]');

    // 建立後立刻放到第一個合法位置(不在農地上)
    const firstValid = this.findFirstValidBuildingPosition(2, 2);

    if (firstValid) {
      this.coopPlacementTileX = Math.floor(firstValid.x / this.FARM_SIZE);
      this.coopPlacementTileY = Math.floor(firstValid.y / this.FARM_SIZE);
      this.coopPlacementValid = this.canPlaceBuilding(firstValid.x, firstValid.y, 2, 2).canPlace;
      this.drawPlacementPreview(firstValid.x, firstValid.y);
      console.log('[PREVIEW INITIAL POSITION]', {
        farmlandPx: firstValid.x,
        farmlandPy: firstValid.y,
        tileX: this.coopPlacementTileX,
        tileY: this.coopPlacementTileY,
        canPlace: this.coopPlacementValid,
      });
    } else {
      console.log('[PREVIEW INITIAL POSITION] no valid position found');
      this.coopPlacementTileX = 0;
      this.coopPlacementTileY = 0;
      this.coopPlacementValid = false;
      // 畫在 (0,0) 湊合用
      this.drawPlacementPreview(0, 0);
    }

    // 300ms 延遲:避免購買按鈕 click 冒泡觸發放置
    this.placementStartedAt = Date.now();

    // ── DOM click fallback(capture phase,避免 React overlay 擋掉 pointerdown)──
    this.placementClickHandler = (event: MouseEvent) => {
      console.log('[DOM PLACEMENT CLICK RAW]', {
        clientX: event.clientX,
        clientY: event.clientY,
        isPlacingBuilding: this.coopPlacementMode,
        hasPreview: !!this.coopPlacementPreview,
      });
      if (!this.coopPlacementMode || !this.coopPlacementPreview) return;
      if (Date.now() - this.placementStartedAt < 500) {
        console.log('[DOM PLACEMENT CLICK IGNORED] just started');
        return;
      }
      if (!this.currentPlacementCanPlace) {
        this.events.emit('placementFailed', '這裡不能放置');
        return;
      }
      // Phase1:本地 sprite creation
      this.createChickenCoopSprite(this.currentPlacementX, this.currentPlacementY);
      this.exitBuildingPlacement('local_success');
    };
    document.addEventListener('click', this.placementClickHandler, true);
    console.log('[DOM PLACEMENT CLICK LISTENER ADDED]');

    // ── DOM mousemove:強制跟隨滑鼠(capture phase,避免 React overlay 擋掉)──
    this.placementMouseMoveHandler = (event: MouseEvent) => {
      // 第一行就印 RAW log
      console.log('[DOM MOUSEMOVE RAW]', {
        clientX: event.clientX,
        clientY: event.clientY,
        isPlacingBuilding: this.coopPlacementMode,
        hasPreview: !!this.coopPlacementPreview,
      });

      if (!this.coopPlacementMode) {
        console.log('[DOM MOUSEMOVE RETURN] not placing');
        return;
      }

      if (!this.coopPlacementPreview) {
        console.log('[DOM MOUSEMOVE RETURN] no preview');
        return;
      }

      this.updatePlacementPreviewFromDomEvent(event);
    };

    window.addEventListener('mousemove', this.placementMouseMoveHandler, true);
    console.log('[DOM MOUSEMOVE BOUND] (capture=true)');

    // ── 診斷 tick:每秒確認狀態是否活著 ──
    this.placementDebugTimer = window.setInterval(() => {
      console.log('[PLACEMENT STATE TICK]', {
        isPlacingBuilding: this.coopPlacementMode,
        hasPreview: !!this.coopPlacementPreview,
        previewType: this.coopPlacementPreview?.type,
      });
    }, 1000);

    // 最終確認狀態
    console.log('[PLACEMENT STATE AFTER ENTER]', {
      isPlacingBuilding: this.coopPlacementMode,
      hasPreview: !!this.coopPlacementPreview,
      previewType: this.coopPlacementPreview?.type,
    });
  }

  // ── 退出放置模式 ──
  private exitBuildingPlacement(reason: string) {
    console.warn('[EXIT BUILDING PLACEMENT]', {
      reason,
      isPlacingBuilding: this.coopPlacementMode,
      hasPreview: !!this.coopPlacementPreview,
      stack: new Error().stack,
    });

    this.coopPlacementMode = false;

    if (this.placementDebugTimer) {
      clearInterval(this.placementDebugTimer);
      this.placementDebugTimer = undefined;
    }

    if (this.placementMouseMoveHandler) {
      window.removeEventListener('mousemove', this.placementMouseMoveHandler, true);
      this.placementMouseMoveHandler = undefined;
    }
    if (this.placementClickHandler) {
      document.removeEventListener('click', this.placementClickHandler, true);
      this.placementClickHandler = undefined;
      console.log('[DOM PLACEMENT CLICK REMOVED]');
    }
    if (this.coopPlacementPreview) {
      this.coopPlacementPreview.destroy();
      this.coopPlacementPreview = null;
    }
    if (this.debugGraphics) {
      this.debugGraphics.destroy();
      this.debugGraphics = null;
    }
  }

  // ── DOM mousemove 處理(使用 boundingClientRect 換算座標)──
  private updatePlacementPreviewFromDomEvent(event: MouseEvent) {
    console.log('[DOM UPDATE ENTER]');

    const canvas = this.game.canvas;
    console.log('[DOM CANVAS]', {
      exists: !!canvas,
      width: canvas?.width,
      height: canvas?.height,
    });

    const rect = canvas.getBoundingClientRect();
    console.log('[DOM CANVAS RECT]', {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });

    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    console.log('[DOM CANVAS POS]', {
      canvasX,
      canvasY,
    });

    // 忽略不在 canvas 內的滑鼠位置
    if (canvasX < 0 || canvasY < 0 || canvasX > rect.width || canvasY > rect.height) {
      console.log('[DOM UPDATE RETURN] mouse outside canvas', {
        canvasX,
        canvasY,
        rectWidth: rect.width,
        rectHeight: rect.height,
      });
      return;
    }

    const cam = this.cameras.main;
    const worldPoint = cam.getWorldPoint(canvasX, canvasY);
    const worldX = worldPoint.x;
    const worldY = worldPoint.y;

    const farmTileSize = this.FARM_SIZE;
    const tileX = Math.floor(worldX / farmTileSize);
    const tileY = Math.floor(worldY / farmTileSize);
    const farmlandPx = tileX * farmTileSize;
    const farmlandPy = tileY * farmTileSize;

    // 更新狀態
    this.coopPlacementTileX = tileX;
    this.coopPlacementTileY = tileY;
    this.coopPlacementValid = this.canPlaceBuilding(farmlandPx, farmlandPy, 2, 2).canPlace;

    console.log('[DOM PLACEMENT MOVE]', {
      clientX: event.clientX,
      clientY: event.clientY,
      canvasX: Math.round(canvasX),
      canvasY: Math.round(canvasY),
      worldX: Math.round(worldX),
      worldY: Math.round(worldY),
      tileX,
      tileY,
      farmlandPx,
      farmlandPy,
      farmTileSize,
      canPlace: this.coopPlacementValid,
    });

    this.drawPlacementPreview(farmlandPx, farmlandPy, 2, 2);
  }

  // ── 檢查是否可以放置(傳入 farmland-pixel 座標,w/h 為 farmland tile 數)──
  // farmland-pixel 單位 = FARM_SIZE = 120px
  // farmland 佔用 [0, 360) x [0, 240)(3×2 farmland tiles)
  // ── 碰撞檢測結果 ──
  private canPlaceBuilding(farmlandPx: number, farmlandPy: number, wTiles: number, hTiles: number): { canPlace: boolean; blockedBy: string } {
    const farmTileSize = this.FARM_SIZE;
    const bw = wTiles * farmTileSize;
    const bh = hTiles * farmTileSize;

    // 1. 不可超出地圖邊界(canvas 負座標)
    if (farmlandPx < 0 || farmlandPy < 0) {
      console.log('[CAN PLACE BOUNDS CHECK] out of bounds negative', { farmlandPx, farmlandPy });
      return { canPlace: false, blockedBy: 'out_of_bounds' };
    }

    // 2. 用實際 farmland container bounds 檢測碰撞
    // buildingBounds 的 x/y 是左上角(Graphics fillRect  convention)
    const buildingBounds = new Phaser.Geom.Rectangle(
      farmlandPx,
      farmlandPy,
      bw,
      bh
    );

    const farmlandBoundsList = this.farmlandObjects.map((f: Phaser.GameObjects.Container) => {
      return f.getBounds();
    });

    for (let i = 0; i < this.farmlandObjects.length; i++) {
      const farmlandBounds = farmlandBoundsList[i];
      if (Phaser.Geom.Intersects.RectangleToRectangle(buildingBounds, farmlandBounds)) {
        console.log('[CAN PLACE BOUNDS CHECK]', {
          buildingBounds: { x: buildingBounds.x, y: buildingBounds.y, width: buildingBounds.width, height: buildingBounds.height },
          farmlandBounds: { x: farmlandBounds.x, y: farmlandBounds.y, width: farmlandBounds.width, height: farmlandBounds.height },
          farmlandIndex: i,
          blockedBy: 'farmland',
          canPlace: false,
        });
        return { canPlace: false, blockedBy: 'farmland' };
      }
    }

    console.log('[CAN PLACE BOUNDS CHECK]', {
      buildingBounds: { x: buildingBounds.x, y: buildingBounds.y, width: buildingBounds.width, height: buildingBounds.height },
      farmlandBoundsList: farmlandBoundsList.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) })),
      blockedBy: 'none',
      canPlace: true,
    });

    return { canPlace: true, blockedBy: 'none' };
  }

  // ── 找第一個合法放置位置(傳入 tile 數)──
  private findFirstValidBuildingPosition(widthTiles: number, heightTiles: number): { x: number; y: number } | null {
    const farmTileSize = this.FARM_SIZE;
    // 農地範圍:0~360(x) × 0~240(y),用 farmland-pixel 座標搜尋
    // 搜尋範圍:足夠覆蓋農地周圍
    const searchRange = 8; // farmland-pixel grid 數(每格 = FARM_SIZE)

    for (let gy = 0; gy < searchRange; gy++) {
      for (let gx = 0; gx < searchRange; gx++) {
        const farmlandPx = gx * farmTileSize;
        const farmlandPy = gy * farmTileSize;
        if (this.canPlaceBuilding(farmlandPx, farmlandPy, widthTiles, heightTiles).canPlace) {
          console.log('[FIND VALID POSITION]', { gx, gy, farmlandPx, farmlandPy, widthTiles, heightTiles });
          return { x: farmlandPx, y: farmlandPy };
        }
      }
    }
    return null;
  }

  // ── 繪製 placement preview(使用 Graphics,farmland-pixel 座標)──
  private drawPlacementPreview(farmlandPx: number, farmlandPy: number, widthTiles = 2, heightTiles = 2) {
    if (!this.coopPlacementPreview) return;
    this.coopPlacementPreview.clear();

    const farmTileSize = this.FARM_SIZE;
    const buildingWidth = farmTileSize * widthTiles;
    const buildingHeight = farmTileSize * heightTiles;
    const result = this.canPlaceBuilding(farmlandPx, farmlandPy, widthTiles, heightTiles);
    const canPlace = result.canPlace;

    const color = canPlace ? 0x00ff00 : 0xff0000;
    this.coopPlacementPreview.fillStyle(color, 0.35);
    this.coopPlacementPreview.lineStyle(4, canPlace ? 0xffff00 : color, 1);
    this.coopPlacementPreview.fillRect(farmlandPx, farmlandPy, buildingWidth, buildingHeight);
    this.coopPlacementPreview.strokeRect(farmlandPx, farmlandPy, buildingWidth, buildingHeight);

    console.log('[PREVIEW DRAW GRAPHICS]', {
      farmlandPx,
      farmlandPy,
      farmTileSize,
      widthTiles,
      heightTiles,
      buildingWidth,
      buildingHeight,
      canPlace,
      blockedBy: result.blockedBy,
    });

    // 記錄最後位置(click 時直接使用,不重新計算)
    this.currentPlacementX = farmlandPx;
    this.currentPlacementY = farmlandPy;
    this.currentPlacementCanPlace = canPlace;
  }

  // ── 更新放置預覽(傳入 pointer)──
  private updatePlacementPreview(pointer: Phaser.Input.Pointer) {
    console.log('[PLACEMENT MOVE ENTER]', {
      isPlacingBuilding: this.coopPlacementMode,
      hasPreview: !!this.coopPlacementPreview,
    });
    if (!this.coopPlacementMode || !this.coopPlacementPreview) return;

    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const worldX = worldPoint.x;
    const worldY = worldPoint.y;

    // 轉換為 farmland-pixel 座標(1 unit = FARM_SIZE = 120px)
    const farmTileSize = this.FARM_SIZE;
    const farmlandPx = Math.floor(worldX / farmTileSize) * farmTileSize;
    const farmlandPy = Math.floor(worldY / farmTileSize) * farmTileSize;

    // 記錄 tile 座標(用於放置確認)
    this.coopPlacementTileX = Math.floor(worldX / farmTileSize);
    this.coopPlacementTileY = Math.floor(worldY / farmTileSize);
    this.coopPlacementValid = this.canPlaceBuilding(farmlandPx, farmlandPy, 2, 2).canPlace;

    console.log('[PLACEMENT MOVE]', {
      pointerX: pointer.x,
      pointerY: pointer.y,
      worldX: Math.round(worldX),
      worldY: Math.round(worldY),
      farmlandPx,
      farmlandPy,
      canPlace: this.coopPlacementValid,
    });

    this.drawPlacementPreview(farmlandPx, farmlandPy, 2, 2);
  }

  // ── 點擊放置(pointerdown handler)──
  // ── Phaser pointerdown handler ──
  private onBuildingPlacementPointerDown(pointer: Phaser.Input.Pointer) {
    console.log('[POINTERDOWN RAW]', {
      isPlacingBuilding: this.coopPlacementMode,
      canPlace: this.currentPlacementCanPlace,
      x: this.currentPlacementX,
      y: this.currentPlacementY,
    });
    if (!this.coopPlacementMode) return;
    if (Date.now() - this.placementStartedAt < 500) {
      console.log('[POINTERDOWN IGNORED] just started');
      return;
    }
    if (!this.currentPlacementCanPlace) {
      this.events.emit('placementFailed', '這裡不能放置');
      return;
    }
    // Phase1:本地 sprite creation
    this.createChickenCoopSprite(this.currentPlacementX, this.currentPlacementY);
    this.exitBuildingPlacement('local_success');
  }

  // ── 建立雞舍 sprite(純本地,無 API)──
  // ── Phase1 封裝:本地放置雞舍(無 API、不可拖曳)──
  // options.save: 是否要寫入 localStorage(restore 時應傳 false,避免覆蓋 animals)
  // options.animals: 要保存的 animals 陣列(restore 時傳入,否則用空陣列)
  private placeChickenCoopLocal(x: number, y: number, options: { save?: boolean; animals?: unknown[] } = {}) {
    // Sprite 建立已停用。雞舍 sprite 統一由 renderChickenCoop() 管理。
    // 此函式只負責寫入 localStorage（購買流程需要）。
    // API 同步後 renderChickenCoop() 會以 tileX/tileY 為準建立正確的 sprite。
    if (DEBUG_COOP) console.log('[PLACE LOCAL COOP — sprite creation disabled]', { x, y, options });
    const shouldSave = options.save !== false;
    const animalsToSave = options.animals ?? [];
    if (shouldSave) {
      console.log('[SAVE CHICKEN COOP LOCAL]', { x, y, animalsCount: animalsToSave.length });
      localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify({ type: 'chicken_coop', x, y, widthTiles: 2, heightTiles: 2, level: 1, capacity: 4, animals: animalsToSave }));
    }
  }

  // ── Phase2: localStorage 持久化 ──
  private saveChickenCoopLocalState(state: { type: string; x: number; y: number; widthTiles: number; heightTiles: number; level: number; capacity: number; animals: unknown[] }) {
    try {
      localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify(state));
      if (DEBUG_COOP) console.log('[LOCAL STORAGE SAVE]', state);
    } catch(e) {
      console.error('[LOCAL STORAGE SAVE ERROR]', e);
    }
  }

  private loadChickenCoopLocalState() {
    // 此函式已停用。雞舍 sprite 建立統一由 renderChickenCoop() 處理，
    // 位置統一由 API tileX/tileY 驅動，localStorage 不再作為位置來源。
    // 僅保留函式簽名以避免其他 call site 錯誤。
  }

  // ── 向後相容:delegate 給 placeChickenCoopLocal ──
  private createChickenCoopSprite(x: number, y: number) {
    console.log('[CREATE CHICKEN COOP SPRITE]', { x, y });
    this.placeChickenCoopLocal(x, y);
  }

  // ── 開啟雞舍管理面板(純本地 DOM)──
  private _coopBackdropEl?: HTMLDivElement;
  private _chickSprites: Phaser.GameObjects.Image[] = [];
  private _coopPanelTimer: Phaser.Time.TimerEvent | null = null;

  // ── 循環制:檢查雞舍計時器(面板內倒數 + 到期處理)──
  private _coopCountdownInterval: number | null = null;
  // 雞舍倒計時顯示用（避免 scope 問題）
  private _coopCountdownRemaining: number | null = null;

  // ── 取得當前 PRODUCING slot 的最短 remainingSec ──
  private getCoopMinRemainingSec(): number | null {
    const slots = this.coopChickenStatus?.slots ?? [];
    const producingSlots = slots.filter((s: any) => s.state === 'PRODUCING' && typeof s.remainingSec === 'number');
    if (producingSlots.length === 0) return null;
    return Math.max(0, Math.min(...producingSlots.map((s: any) => s.remainingSec as number)));
  }

  // ── 雞舍倒計時計時器（統一管理，避免重複 timer）──
  // 麵板關閉時及 refresh 時都會先清除，外部只負責叫用這個 method 啟動計時器
  private startCoopCountdownTimer() {
    // 先清除舊計時器
    if (this._coopCountdownInterval !== null) {
      clearInterval(this._coopCountdownInterval);
      this._coopCountdownInterval = null;
    }
    this._coopCountdownRemaining = this.getCoopMinRemainingSec();
    console.log('[COOP TIMER INIT]', {
      remainingSec: this._coopCountdownRemaining,
      countdownElExists: !!(this._coopPanelEl?.querySelector('#coop-countdown-text')),
      panelInDoc: this._coopPanelEl && document.body.contains(this._coopPanelEl),
    });
    // 沒有 PRODUCING slot 不啟動計時器
    if (this._coopCountdownRemaining === null || this._coopCountdownRemaining <= 0) return;

    this._coopCountdownInterval = window.setInterval(() => {
      try {
        if (this._coopCountdownRemaining === null || this._coopCountdownRemaining <= 1) {
          console.log('[COOP TIMER DONE SYNC]', { previousRemaining: this._coopCountdownRemaining });
          this._coopCountdownRemaining = null;
          if (this._coopCountdownInterval !== null) {
            clearInterval(this._coopCountdownInterval);
            this._coopCountdownInterval = null;
          }
          this.syncChickenCoopStatus().then(() => {
            this.refreshCoopPanelStatus(this._coopPanelEl!);
          });
          return;
        }
        if (this._coopCountdownRemaining !== null && this._coopCountdownRemaining > 0) {
          this._coopCountdownRemaining--;
          const panelEl = this._coopPanelEl;
          const tickEl = panelEl?.querySelector('#coop-countdown-text') as HTMLDivElement | null;
          const textBefore = tickEl?.textContent ?? 'NOT FOUND';
          if (tickEl) {
            const mins = Math.floor(this._coopCountdownRemaining / 60);
            const secs = this._coopCountdownRemaining % 60;
            tickEl.textContent = `收蛋倒數：${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
            console.log('[COOP TIMER TICK]', { remainingSec: this._coopCountdownRemaining, textBefore, textAfter: tickEl.textContent });
          } else {
            console.warn('[COOP TIMER DOM MISSING]', { panelInDoc: panelEl && document.body.contains(panelEl), textBefore });
          }
        }
      } catch(e) {}
    }, 1000);
  }
  private _coopListenersInitialized: boolean = false;
  // 用於存 panel DOM 引用，讓 class method 也能呼叫 re-binding
  private _coopPanelEl: HTMLDivElement | null = null;
  private _coopEscHandler: ((e: KeyboardEvent) => void) | null = null;
  private _coopPanelClickHandler: ((e: MouseEvent) => void) | null = null;
  // 防止 backdrop/esc 在 panel 建立期間（同一 event loop）觸發 close
  private _coopOpening: boolean = false;

  // ── 直接綁定每顆按鈕 onclick（innerHTML 重建後需再次呼叫）──
  private bindChickenCoopPanelEvents() {
    const panel = this._coopPanelEl;
    if (!panel) { console.warn('[COOP BIND] no panel'); return; }

    const closeBtn = panel.querySelector('#coop-panel-close-btn') as HTMLButtonElement | null;
    const collectBtn = panel.querySelector('#coop-collect-eggs-btn') as HTMLButtonElement | null;
    const feedBtn = panel.querySelector('#coop-feed-btn') as HTMLButtonElement | null;

    console.log('[COOP BIND] closeBtn=' + !!closeBtn + ' collectBtn=' + !!collectBtn + ' feedBtn=' + !!feedBtn);

    if (closeBtn) {
      closeBtn.onclick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[COOP CLOSE BUTTON DIRECT CLICK]');
        this.closeChickenCoopPanel('close-button');
      };
    } else {
      console.warn('[COOP BIND] closeBtn not found');
    }

    if (collectBtn) {
      collectBtn.onclick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[COOP COLLECT BUTTON DIRECT CLICK]');
        this.handleCollectEggs();
      };
    } else {
      console.warn('[COOP BIND] collectBtn not found');
    }

    if (feedBtn) {
      feedBtn.onclick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[COOP FEED BUTTON DIRECT CLICK]');
        this.handleFeedChickenCoop();
      };
    } else {
      console.warn('[COOP BIND] feedBtn not found');
    }
  }

  // ── 餵食按鈕 handler ──
  private async handleFeedChickenCoop() {
    console.log('[FEED BUTTON CLICKED]');
    // 第一幀立即更新按鈕狀態（同步）
    const feedBtn = document.getElementById('coop-feed-btn');
    if (feedBtn) { feedBtn.disabled = true; feedBtn.textContent = '餵食中...'; }

    try {
      // 用 API slots 確認是否有雞可以餵
      const slots = this.coopChickenStatus?.slots ?? [];
      const hasReadyToFeed = slots.some((s: any) => s.state === 'READY_TO_FEED');
      const hasReadyToCollect = slots.some((s: any) => s.state === 'READY_TO_COLLECT');
      if (!hasReadyToFeed) {
        if (hasReadyToCollect) {
          this.events.emit('game-toast', '請先收蛋！');
        } else {
          this.events.emit('game-toast', '沒有雞需要餵食');
        }
        return;
      }

      console.log('[FEED API REQUEST] /api/animals/chicken-coop/feed-all');
      const res = await authFetch('/api/animals/chicken-coop/feed-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await res.json();
      console.log('[FEED API RESPONSE]', result);
      if (!result.success) {
        console.warn('[FEED-ALL API FAIL]', result);
        const msg = result.message || '';
        if (msg.includes('飼料不足') || msg.includes('沒有足夠的普通飼料') || msg.includes('feed not enough')) {
          this.events.emit('game-toast', '飼料不足，請先購買普通飼料');
        } else if (result.message) {
          this.events.emit('game-toast', result.message);
        } else {
          this.events.emit('game-toast', '餵食失敗，請稍後再試');
        }
        return;
      }
      // 成功：同步狀態
      this.events.emit('game-toast', '餵食成功！');
      console.log('[FEED AFTER SYNC] calling syncChickenCoopStatus');
      await this.syncChickenCoopStatus();
      console.log('[FEED BACKPACK REFRESHED] calling backpackSystem.fetchAll');
      backpackSystem.fetchAll();
      window.dispatchEvent(new Event('inventory-updated'));
      // 檢查背包飼料是否已扣
      const backpackState = backpackSystem.getState();
      const feedItem = [...backpackState.items].find((i: any) => Number(i.itemId) === 2);
      console.log('[FEED INVENTORY CHECK]', {
        feedBefore: result.feedBefore,
        feedAfter: result.feedAfter,
        backpackFeedItemId: feedItem?.itemId,
        backpackFeedAmount: feedItem?.quantity ?? feedItem?.amount ?? feedItem?.count,
      });
    } catch (err) {
      console.warn('[FEED-ALL API ERROR]', err);
      this.events.emit('game-toast', '餵食失敗，請稍後再試');
    } finally {
      // 最後一步：重建面板（按鈕狀態會被 refreshCoopPanelStatus 正確還原）
      this.refreshCoopPanelStatus();
      // 重新計算倒計時並啟動（餵食後 slot 已變 PRODUCING）
      this.startCoopCountdownTimer();
    }
  }

  // ── 收雞蛋按鈕 handler ──
  private async handleCollectEggs() {
    console.log('[COLLECT BUTTON CLICKED]');
    // 第一幀立即更新按鈕狀態（同步）
    const collectBtn = document.getElementById('coop-collect-eggs-btn');
    if (collectBtn) { collectBtn.disabled = true; collectBtn.textContent = '收集中...'; }

    // 用 API slots 確認是否有蛋可收
    const slots = this.coopChickenStatus?.slots ?? [];
    const readySlots = slots.filter((s: any) => s.state === 'READY_TO_COLLECT');
    if (readySlots.length === 0) {
      if (collectBtn) { collectBtn.disabled = false; collectBtn.textContent = '收雞蛋'; }
      this.events.emit('game-toast', '目前沒有可收雞蛋');
      return;
    }

    try {
      console.log('[COLLECT API REQUEST] /api/animals/chicken-coop/collect-all', { eggCount: readySlots.length });
      const res = await authFetch('/api/animals/chicken-coop/collect-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eggCount: readySlots.length }),
      });
      const result = await res.json();
      console.log('[COLLECT API RESPONSE]', result);
      if (!result.success) {
        console.warn('[COLLECT-ALL API FAIL]', result);
        if (result.message) this.events.emit('game-toast', result.message);
        return;
      }
      // 成功：同步狀態
      this.events.emit('game-toast', result.message || '收蛋成功！');
      console.log('[COLLECT AFTER SYNC] calling syncChickenCoopStatus');
      await this.syncChickenCoopStatus();
      console.log('[COLLECT BACKPACK REFRESHED] calling backpackSystem.fetchAll');
      backpackSystem.fetchAll();
      window.dispatchEvent(new Event('inventory-updated'));
      // 檢查背包雞蛋是否入庫
      const backpackState = backpackSystem.getState();
      const eggItem = [...backpackState.livestock].find((i: any) => Number(i.itemId) === 1);
      const feedItem = [...backpackState.items].find((i: any) => Number(i.itemId) === 2);
      console.log('[COLLECT INVENTORY CHECK]', {
        eggItemId: eggItem?.itemId,
        eggAmount: eggItem?.quantity ?? eggItem?.amount ?? eggItem?.count,
        feedItemId: feedItem?.itemId,
        feedAmount: feedItem?.quantity ?? feedItem?.amount ?? feedItem?.count,
        resultEggBefore: result.eggBefore,
        resultEggAfter: result.eggAfter,
      });
    } catch (err) {
      console.warn('[COLLECT-ALL API ERROR]', err);
      this.events.emit('game-toast', '收蛋失敗，請稍後再試');
    } finally {
      // 最後一步：重建面板（按鈕狀態會被 refreshCoopPanelStatus 正確還原）
      this.refreshCoopPanelStatus();
    }
  }

  // ── DEV 立即產蛋 handler ──
  private handleDevInstantEgg() {
    const raw = localStorage.getItem('tlo_farm_chicken_coop');
    if (!raw) return;
    const data = JSON.parse(raw);
    const adultCount = (data.animals ?? []).filter((a: any) => a.stage === 'adult').length;
    if (adultCount <= 0) { this.events.emit('game-toast', '沒有成雞，無法測試產蛋'); return; }
    data.eggCount = adultCount;
    data.feedingStatus = 'none';
    data.lastFedAt = null;
    localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify(data));
    this.refreshCoopPanelStatus();
    this.events.emit('game-toast', `測試產生 ${adultCount} 顆雞蛋`);
  }

  // ── 重新整理雞舍面板狀態（DOM 重建後重新 binding）──
  // _panelElArg 忽略，統一用 this._coopPanelEl（杜絕閉包殘留）
  private refreshCoopPanelStatus(_panelElArg?: HTMLDivElement) {
    const panelEl = this._coopPanelEl;
    if (!panelEl) return;
    if (!document.body.contains(panelEl)) {
      console.log('[PANEL REFRESH] skipped — panelEl not in DOM');
      if (this._coopCountdownInterval !== null) {
        clearInterval(this._coopCountdownInterval);
        this._coopCountdownInterval = null;
      }
      this._coopCountdownRemaining = null;
      this._coopListenersInitialized = false;
      return;
    }
    try {
      const slots = this.coopChickenStatus?.slots ?? [];
      const animalCount = slots.filter((s: any) => s.state !== 'EMPTY').length;
      const babyCount = slots.filter((s: any) => s.state === 'BABY').length;
      const adultCount = animalCount - babyCount;
      const collectableEggs = slots.filter((s: any) => s.state === 'READY_TO_COLLECT').length;
      const hasReadyToFeed = slots.some((s: any) => s.state === 'READY_TO_FEED');
      const hasReadyToCollect = slots.some((s: any) => s.state === 'READY_TO_COLLECT');
      const hasProducing = slots.some((s: any) => s.state === 'PRODUCING');
      const minRemainingSec = this.getCoopMinRemainingSec();
      const canFeed = hasReadyToFeed && animalCount > 0;
      const feedBtnLabel = !hasReadyToFeed && hasReadyToCollect ? '請先收蛋' : (animalCount === 0 ? '無雞' : '餵食');
      const canCollect = collectableEggs > 0;
      const feedStatus: 'none' | 'fed' = 'none';
      const lastFedAt: number | null = null;
      const eggCount = collectableEggs;
      const capacity = slots.length || 4;

      const container = panelEl.querySelector('#coop-status-container');
      if (!container) { console.warn('[PANEL REFRESH] container not found'); return; }
      // 重新渲染狀態文字
      const html = this.buildCoopStatusHtml({ animalCount, babyCount, adultCount, feedStatus, lastFedAt, eggCount, capacity, canFeed, feedBtnLabel, canCollect, hasReadyToCollect, hasProducing, minRemainingSec });
      container.innerHTML = html;
      // DOM 重建後必須重新 binding
      this.bindChickenCoopPanelEvents();
    } catch(e) { console.warn('[PANEL REFRESH] error', e); }
  }

  // ── 雞舍狀態區塊 HTML（供 refreshCoopPanelStatus 重複呼叫）──
  // canFeed / feedBtnLabel 由外部根據 slots state 計算後傳入
  private buildCoopStatusHtml(state: { animalCount: number; babyCount: number; adultCount: number; feedStatus: 'fed' | 'none'; lastFedAt: number | null; eggCount: number; capacity: number; canFeed: boolean; feedBtnLabel: string; canCollect: boolean; hasReadyToCollect: boolean; hasProducing: boolean; minRemainingSec: number | null }) {
    const { animalCount, babyCount, adultCount, feedStatus, lastFedAt, eggCount, capacity, canFeed, feedBtnLabel, canCollect, hasReadyToCollect, hasProducing, minRemainingSec } = state;
    const feedBtnDisabled = !canFeed || animalCount === 0;
    // 飼料狀態文字：PRODUCING > 可收蛋 > 已餵食 > 未餵食
    const feedStatusLabel = hasProducing ? '生產中' : (hasReadyToCollect ? '可收蛋' : (feedStatus === 'fed' ? '已餵食' : '未餵食'));
    const feedStatusColor = hasProducing ? '#1565C0' : (hasReadyToCollect ? '#E8A020' : (feedStatus === 'fed' ? '#2E7D32' : '#C0392B'));
    let countdownHtml = '';
    // PRODUCING 時顯示 server 回傳的 remainingSec 倒計時
    if (hasProducing && minRemainingSec !== null && minRemainingSec > 0) {
      const mins = Math.floor(minRemainingSec / 60);
      const secs = minRemainingSec % 60;
      countdownHtml = `<div id="coop-countdown-text" style="font-size:12px;color:#1565C0;">收蛋倒數：${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}</div>`;
    } else if (feedStatus === 'fed' && lastFedAt) {
      // BABY 成長倒計時（保留既有邏輯）
      const BABY_GROW_MS = 10 * 60 * 1000;
      const ADULT_EGG_MS = 15 * 60 * 1000;
      const elapsed = Date.now() - lastFedAt;
      const adultRemaining = adultCount > 0 ? Math.max(0, ADULT_EGG_MS - elapsed) : 0;
      const babyRemaining = babyCount > 0 ? Math.max(0, BABY_GROW_MS - elapsed) : 0;
      const next = babyCount > 0 ? babyRemaining : adultRemaining;
      const mins = Math.floor(next / 60000);
      const secs = Math.floor((next % 60000) / 1000);
      countdownHtml = `<div style="font-size:12px;color:#888;">冷卻:${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}</div>`;
    }
    return `
      <div style="font-size: 18px; font-weight: 700; margin-bottom: 10px; color: #3B2412;">雞舍 Lv1</div>
      <div style="font-size: 14px; margin-bottom: 6px;">容量:<strong>${animalCount} / ${capacity}</strong></div>
      <div style="font-size: 13px; margin-bottom: 6px;">小雞:${babyCount} 隻 成雞:${adultCount} 隻</div>
      <div style="border-top: 2px dashed #E8C84A; padding-top: 8px; margin-top: 4px;">
        <div style="font-size: 13px; font-weight: 700; color: #7A6A59; margin-bottom: 4px;">飼料狀態</div>
        <div style="font-size: 15px; font-weight: 700; color: ${feedStatusColor};">${feedStatusLabel}</div>
        ${countdownHtml}
        <button id="coop-feed-btn" data-action="feed" style="width:100%;padding:8px 16px;background:${feedBtnDisabled?'#ccc':'#6DB33F'};color:${feedBtnDisabled?'#999':'#fff'};border:3px solid ${feedBtnDisabled?'#999':'#4A7C2F'};border-radius:6px;font-size:14px;font-weight:700;cursor:${feedBtnDisabled?'not-allowed':'pointer'};font-family:'Cubic 11',sans-serif;margin-top:6px;margin-bottom:6px;">${feedBtnLabel}</button>
        <div style="font-size:13px;color:#7A6A59;margin-bottom:6px;">可收雞蛋:<strong id="coop-egg-count">${eggCount}</strong> 顆</div>
        <button id="coop-collect-eggs-btn" data-action="collect-eggs" style="width:100%;padding:8px 16px;background:${canCollect?'#E8A020':'#ccc'};color:${canCollect?'#3B2412':'#999'};border:3px solid ${canCollect?'#5A3418':'#999'};border-radius:6px;font-size:14px;font-weight:700;cursor:${canCollect?'pointer':'not-allowed'};font-family:'Cubic 11',sans-serif;margin-bottom:8px;">收雞蛋</button>
      </div>`;
  }

  // 點雞舍開面板：必須先從 API 取最新狀態，再 render
  private async openChickenCoopPanel() {
    console.log('[COOP PANEL OPEN]');
    // ── flag 設在所有 async/DOM 操作完成前，防止 backdrop/esc 在建立期間觸發 close ──
    this._coopOpening = true;
    // ── 有舊面板才清（避免重複開啟）──
    if (this._coopPanelEl) {
      this._forceCloseCoopPanel();
    }

    // 記錄點擊前雞舍 sprite 狀態
    if (this.chickenCoopSprite) {
      const s = this.chickenCoopSprite;
      console.log('[COOP BEFORE CLICK]', {
        x: s.x, y: s.y,
        scaleX: s.scaleX, scaleY: s.scaleY,
        originX: s.originX, originY: s.originY,
        displayWidth: s.displayWidth, displayHeight: s.displayHeight,
        depth: s.depth,
        FARM_SIZE: this.FARM_SIZE,
      });
    }

    // ── 先取得 API 狀態（同步 coopChickenStatus）──
    await this.syncChickenCoopStatus();

    // 確認 sync 後雞舍 sprite 狀態
    if (this.chickenCoopSprite) {
      const s = this.chickenCoopSprite;
      console.log('[COOP AFTER SYNC]', {
        x: s.x, y: s.y,
        scaleX: s.scaleX, scaleY: s.scaleY,
        originX: s.originX, originY: s.originY,
        displayWidth: s.displayWidth, displayHeight: s.displayHeight,
        depth: s.depth,
      });
    }

    // ── 從 API slots 讀取雞舍狀態 ──
    const slots = this.coopChickenStatus?.slots ?? [];
    const apiAnimalCount = slots.filter((s: any) => s.state !== 'EMPTY').length;
    const apiCapacity = slots.length || 4;
    // 從 API 推算生長階段：READY_TO_COLLECT / PRODUCING / READY_TO_FEED / BABY
    const apiBabyCount = slots.filter((s: any) => s.state === 'BABY').length;
    const apiAdultCount = apiAnimalCount - apiBabyCount;
    // 餵食判斷：只有 READY_TO_FEED 狀態才能餵，其他狀態（READY_TO_COLLECT/PRODUCING/BABY）不行
    const hasReadyToFeed = slots.some((s: any) => s.state === 'READY_TO_FEED');
    const hasReadyToCollect = slots.some((s: any) => s.state === 'READY_TO_COLLECT');
    const hasProducing = slots.some((s: any) => s.state === 'PRODUCING');
    const collectableEggs = slots.filter((s: any) => s.state === 'READY_TO_COLLECT').length;
    const canFeed = hasReadyToFeed && apiAnimalCount > 0;
    const feedBtnLabel = !hasReadyToFeed && hasReadyToCollect ? '請先收蛋' : (apiAnimalCount === 0 ? '無雞' : '餵食');
    const canCollect = collectableEggs > 0;
    // feedStatus / lastFedAt：READY_TO_COLLECT 視為未餵食（餵食狀態由 slot state 決定）
    const feedStatus: 'none' | 'fed' = 'none';
    const lastFedAt: number | null = null;
    const eggCount = collectableEggs;

    console.log('[OPEN COOP PANEL] from API — animalCount:', apiAnimalCount, 'babyCount:', apiBabyCount, 'adultCount:', apiAdultCount, 'capacity:', apiCapacity, 'slots:', slots.length);

    // 背景遮罩
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 9998;
      background: rgba(0,0,0,0.3);
      pointer-events: auto;
    `;
    backdrop.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      // 只在點到純 backdrop（不是 panel）時關閉
      if (e.target !== backdrop) { console.log('[COOP BACKDROP IGNORED] not backdrop target'); return; }
      if (this._coopOpening) { console.warn('[COOP BACKDROP IGNORED] opening'); return; }
      if (!this._coopPanelEl || !document.body.contains(this._coopPanelEl)) { console.warn('[COOP BACKDROP IGNORED] no panel'); return; }
      this.closeChickenCoopPanel('backdrop');
    });
    backdrop.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    backdrop.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });

    // 面板本體
    const panel = document.createElement('div');
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #FFF3D5;
      border: 4px solid #5A3418;
      border-radius: 8px;
      padding: 20px 24px;
      min-width: 260px;
      font-family: 'Cubic 11', sans-serif;
      color: #3B2412;
      z-index: 9999;
      box-shadow: 4px 4px 0 rgba(0,0,0,0.2);
      pointer-events: auto;
    `;
    // panel 的 click 進到 bindChickenCoopPanelEvents 的 delegation handler
    // 這裡只阻止事件穿透到 Phaser canvas，不攔截按鈕
    panel.addEventListener('click', (e) => { e.stopPropagation(); });
    panel.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    panel.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });

    // ── 狀態區塊容器 + 按鈕容器（只建立一次）──
    const statusContainer = document.createElement('div');
    statusContainer.id = 'coop-status-container';
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:10px;';
    buttonContainer.innerHTML = `
      <button id="coop-panel-close-btn" data-action="close" style="width:100%;padding:8px 16px;background:#5A3418;color:#FFF3D5;border:3px solid #3B2412;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;font-family:'Cubic 11',sans-serif;">關閉</button>
    `;

    panel.innerHTML = '';
    panel.appendChild(statusContainer);
    panel.appendChild(buttonContainer);

    // ── 首次建立面板：使用 API slots 渲染狀態──
    // animalCount / capacity / babyCount / adultCount 全都來自 this.coopChickenStatus.slots
    statusContainer.innerHTML = this.buildCoopStatusHtml({
      animalCount: apiAnimalCount,
      babyCount: apiBabyCount,
      adultCount: apiAdultCount,
      feedStatus,
      lastFedAt,
      eggCount,
      capacity: apiCapacity,
      canFeed,
      feedBtnLabel,
      canCollect,
      hasReadyToCollect,
      hasProducing,
      minRemainingSec: this.getCoopMinRemainingSec(),
    });
    // ── 移除舊 Esc listener，再註冊新的（防止重複累積）──
    if (this._coopEscHandler) {
      document.removeEventListener('keydown', this._coopEscHandler);
      this._coopEscHandler = null;
    }
    const escHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (this._coopOpening) { console.warn('[COOP ESC IGNORED] opening'); return; }
      if (!this._coopPanelEl || !document.body.contains(this._coopPanelEl)) { console.warn('[COOP ESC IGNORED] no panel'); return; }
      console.log('[COOP PANEL ESC]');
      this.closeChickenCoopPanel('esc');
    };
    this._coopEscHandler = escHandler;
    document.addEventListener('keydown', escHandler);
    // 面板 DOM 建立完成後，用統一計時器啟動倒計時
    this.startCoopCountdownTimer();
    this._coopListenersInitialized = true;

    // ── 確保面板進 DOM ──
    const container = this.game.canvas.parentElement;
    if (container) {
      container.style.position = 'relative';
      container.appendChild(backdrop);
      this._coopBackdropEl = backdrop;
      container.appendChild(panel);
    }
    this._coopPanelEl = panel;
    // ── 確認 panel 已進 DOM 之後，再 bind 按鈕事件 ──
    const panelForBind = document.getElementById('coop-panel');
    console.log('[COOP PANEL EXISTS]', !!panelForBind);
    this.bindChickenCoopPanelEvents();
    // 面板進 DOM 之後，印出 DOM 狀態供驗證
    console.log('[COOP PANEL DOM CHECK]', {
      panelInDocument: panel ? document.body.contains(panel) : false,
      backdropZIndex: backdrop.style.zIndex,
      panelZIndex: panel.style.zIndex,
      backdropInBody: backdrop ? document.body.contains(backdrop) : false,
      buttons: panel
        ? [...panel.querySelectorAll('button')].map(btn => ({
            text: btn.textContent?.trim(),
            action: btn.dataset.action,
            disabled: btn.disabled,
            id: btn.id,
          }))
        : [],
    });
    this._coopOpening = false;
  }

  // ── Phase5: 取得雞舍內可活動區域(小雞走路範圍)──
  // 與 renderChicksInCoop 的 inner area 完全一致，確保雞不會走出泥土地
  private getChickenCoopWalkArea() {
    if (!this.chickenCoopSprite) return null;
    const bounds = this.chickenCoopSprite.getBounds();
    return {
      x: bounds.x + bounds.width * 0.35,
      y: bounds.y + bounds.height * 0.48,
      width: bounds.width * 0.33,
      height: bounds.height * 0.24,
    };
  }

  // ── Phase5: 小雞在雞舍內隨機移動(Tween)──
  private startChickMovement(chick: Phaser.GameObjects.Image, area: { x: number; y: number; width: number; height: number }) {
    const move = () => {
      if (!chick.active) return;
      // 雞的位置是絕對座標，area 的 x/y 是 walk area 左上角絕對座標
      const minX = area.x;
      const maxX = area.x + area.width;
      const minY = area.y;
      const maxY = area.y + area.height;
      const randomX = minX + Math.random() * (maxX - minX);
      const randomY = minY + Math.random() * (maxY - minY);
      this.tweens.add({
        targets: chick,
        x: randomX,
        y: randomY,
        duration: 800,
        ease: 'Linear',
        onUpdate: () => {
          chick.setDepth(5050 + chick.y);
        },
        onComplete: () => {
          // 2~4 秒後再次移動
          this.time.delayedCall(2000 + Math.random() * 2000, move);
        },
      });
    };
    // 初始延遲後開始
    this.time.delayedCall(1000 + Math.random() * 2000, move);
  }

  // ── Phase4: 渲染雞舍內的小雞 sprites ──
  // 渲染雞舍內的小雞 sprites
  // 使用 this.coopChickenStatus.slots（來自 /api/animals/chicken-coop/status）
  // 若 slot.state !== 'EMPTY' 表示該格有雞
  private renderChicksInCoop() {
    console.log('[INIT COOP CHICKS RENDER START] spriteReady:', !!this.chickenCoopSprite, 'hasBuilding:', this.coopChickenStatus?.hasBuilding, 'slotsLength:', this.coopChickenStatus?.slots?.length ?? 'undefined');
    if (!this.chickenCoopSprite) {
      console.log('[RENDER CHICKS] chickenCoopSprite not ready, skipping');
      return;
    }

    // 優先用 API slots，其次 fallback 讀 localStorage
    const slots = this.coopChickenStatus?.slots;
    let animals: any[] = [];
    if (slots && slots.length > 0) {
      animals = slots.filter((s: any) => s.state !== 'EMPTY');
      console.log('[RENDER CHICKS FROM API] slots count:', slots.length, 'non-empty:', animals.length, 'states:', slots.map((s: any) => s.state));
    } else {
      const raw = localStorage.getItem('tlo_farm_chicken_coop');
      const coop = raw ? JSON.parse(raw) : null;
      animals = coop?.animals ?? [];
      console.log('[RENDER CHICKS FROM LOCAL] animals count:', animals.length);
    }

    this._chickSprites?.forEach(sprite => sprite.destroy());
    this._chickSprites = [];

    // 用 getBounds() 取得雞舍實際畫面範圍（origin 可能是 0,0）
    const bounds = this.chickenCoopSprite.getBounds();
//     console.log('[COOP SPRITE BOUNDS]', {
    console.log('[COOP SPRITE BOUNDS]', {
      spriteX: this.chickenCoopSprite.x,
      spriteY: this.chickenCoopSprite.y,
      originX: this.chickenCoopSprite.originX,
      originY: this.chickenCoopSprite.originY,
      scaleX: this.chickenCoopSprite.scaleX,
      scaleY: this.chickenCoopSprite.scaleY,
      displayWidth: this.chickenCoopSprite.displayWidth,
      displayHeight: this.chickenCoopSprite.displayHeight,
      boundsX: bounds.x,
      boundsY: bounds.y,
      boundsWidth: bounds.width,
      boundsHeight: bounds.height,
      boundsRight: bounds.right,
      boundsBottom: bounds.bottom,
    });

    // 用 bounds 算雞舍內部泥土地活動區域（只在雞舍圍欄內的空地）
    const innerMinX = bounds.x + bounds.width * 0.35;
    const innerMaxX = bounds.x + bounds.width * 0.68;
    const innerMinY = bounds.y + bounds.height * 0.48;
    const innerMaxY = bounds.y + bounds.height * 0.72;
//     console.log('[CHICK INNER AREA]', { innerMinX, innerMaxX, innerMinY, innerMaxY });
    console.log('[CHICK INNER AREA]', { innerMinX, innerMaxX, innerMinY, innerMaxY });

    // 4 隻雞隨機落在 inner area，4 個象限分散（不重疊、不站角落）
    const quadrants = [
      { minX: innerMinX, maxX: (innerMinX + innerMaxX) / 2, minY: innerMinY, maxY: (innerMinY + innerMaxY) / 2 },
      { minX: (innerMinX + innerMaxX) / 2, maxX: innerMaxX, minY: innerMinY, maxY: (innerMinY + innerMaxY) / 2 },
      { minX: innerMinX, maxX: (innerMinX + innerMaxX) / 2, minY: (innerMinY + innerMaxY) / 2, maxY: innerMaxY },
      { minX: (innerMinX + innerMaxX) / 2, maxX: innerMaxX, minY: (innerMinY + innerMaxY) / 2, maxY: innerMaxY },
    ];
    const positions = animals.slice(0, 4).map((_: any, i: number) => ({
      x: Phaser.Math.Between(quadrants[i].minX, quadrants[i].maxX),
      y: Phaser.Math.Between(quadrants[i].minY, quadrants[i].maxY),
    }));
//     console.log('[CHICK SPAWN POSITIONS]', positions.map((p: any, i: number) => ({ slot: i, x: p.x, y: p.y })));
    console.log('[CHICK SPAWN POSITIONS]', positions.map((p: any, i: number) => ({ slot: i, x: p.x, y: p.y })));

    // 雞的活動範圍侷限在 inner bounds 內（與 spawn 一致）
    const area = {
      x: innerMinX,
      y: innerMinY,
      width: innerMaxX - innerMinX,
      height: innerMaxY - innerMinY,
    };

    animals.slice(0, 4).forEach((animal: any, index: number) => {
      const pos = positions[index];
      if (!pos) return;

      // 從 API slots：依 state 判斷生長階段；從 localStorage：依 stage 判斷
      let spriteKey = 'chick_baby';
      let displaySize = 30;
      if (slots && slots.length > 0) {
        // API 模式：根據 growthStage / state 判斷
        const growthStage = animal.growthStage ?? animal.stage;
        const state = animal.state;
        if (growthStage === 'adult' || state === 'READY_TO_FEED' || state === 'PRODUCING' || state === 'READY_TO_COLLECT') {
          spriteKey = 'chicken_adult';
          displaySize = 40;
        } else {
          spriteKey = 'chick_baby';
          displaySize = 30;
        }
      } else {
        // localStorage fallback
        spriteKey = animal.stage === 'adult' ? 'chicken_adult' : 'chick_baby';
        displaySize = animal.stage === 'adult' ? 40 : 30;
      }

      const chick = this.add.image(pos.x, pos.y, spriteKey);
      chick.setOrigin(0.5, 1);
      chick.setDisplaySize(displaySize, displaySize);
      chick.setDepth(5050 + chick.y);

      this._chickSprites.push(chick);

      // 啟動小範圍隨機移動(2~4 秒一次)
      this.startChickMovement(chick, area);
    });

    console.log('[RENDER CHICKS IN COOP] renderedChickSprites.length:', this._chickSprites.length, 'animals count:', animals.length);
    console.log('[INIT COOP CHICKS RENDER DONE] renderedChickSprites.length:', this._chickSprites.length);
    if (DEBUG_COOP) console.log('[RENDER CHICKS IN COOP]', { count: animals.length, source: slots && slots.length > 0 ? 'api' : 'localStorage' });
  }

  // ── Phase4: 新增小雞(本地) ──
  private addChickenToCoop() {
    try {
      const raw = localStorage.getItem('tlo_farm_chicken_coop');
      if (!raw) {
        console.log('[ADD CHICKEN] no coop data found');
        return;
      }
      const data = JSON.parse(raw);
      const capacity = data.capacity ?? 4;
      if (!data.animals) data.animals = [];
      if (data.animals.length >= capacity) {
        console.log('[ADD CHICKEN] at max capacity:', data.animals.length);
        return;
      }
      data.animals.push({
        id: 'chick_' + Date.now(),
        type: 'chick',
        stage: 'baby',
        status: 'idle',
      });
      localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify(data));
      console.log('[ADD CHICKEN SUCCESS]', { count: data.animals.length, capacity });
      if (DEBUG_COOP) console.log('[VERIFY AFTER ADD]', localStorage.getItem('tlo_farm_chicken_coop'));
      // 保存成功後渲染小雞
      this.renderChicksInCoop();
    } catch(e) {
      console.error('[ADD CHICKEN ERROR]', e);
    }
  }

  // ── 實際執行面板關閉（不碰 _coopOpening flag）──
  private _forceCloseCoopPanel() {
    if (this._coopCountdownInterval !== null) {
      clearInterval(this._coopCountdownInterval);
      this._coopCountdownInterval = null;
    }
    this._coopCountdownRemaining = null;
    this._coopListenersInitialized = false;
    if (this._coopPanelEl) {
      this._coopPanelEl.remove();
      this._coopPanelEl = undefined;
    }
    if (this._coopBackdropEl) {
      this._coopBackdropEl.remove();
      this._coopBackdropEl = undefined;
    }
    if (this._coopEscHandler) {
      document.removeEventListener('keydown', this._coopEscHandler);
      this._coopEscHandler = null;
    }
  }

  // ── 關閉雞舍管理面板（給外部 caller 用）──
  private closeChickenCoopPanel(reason = 'unknown') {
    console.warn('[COOP PANEL CLOSE EXECUTE]', { reason });
    this._forceCloseCoopPanel();
    this._coopOpening = false;
  }

  // ── 共用 API 放置處理(DOM click 與 Phaser pointerdown 共用)──
  private handleCoopPlacementApi() {
    const x = this.currentPlacementX;
    const y = this.currentPlacementY;
    const tileX = Math.floor(x / this.FARM_SIZE);
    const tileY = Math.floor(y / this.FARM_SIZE);

//     console.log('[PLACE API REQUEST]', { x, y, tileX, tileY });
    console.log('[PLACE API REQUEST]', { x, y, tileX, tileY });

    authFetch('/api/animals/chicken-coop/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tileX, tileY }),
    }).then(async (res) => {
      const data = await res.json();
      console.log('[PLACE API RESPONSE]', data);

      if (data.success) {
        if (data.alreadyPlaced) {
          // 已有雞舍:同步狀態,不新建 sprite
          console.log('[PLACE API] already placed - calling status API to sync');
          // 更新前端狀態(不同步 React,禁止)
          this.chickenCoopPlaced = true;
          this.chickenCoopTileX = data.building?.tileX ?? 0;
          this.chickenCoopTileY = data.building?.tileY ?? 0;
          this.pendingChickenCoop = false;
          // 更新金幣顯示
          if (data.gold !== undefined) {
            console.log('[CHICKEN COOP SYNCED]', { gold: data.gold });
            this.events.emit('userUpdated', { gold: data.gold, exp: 0, level: 0 });
          }
          this.exitBuildingPlacement('already_placed_sync');
          return;
        }

        // 第一次成功放置:建立 sprite
        console.log('[PLACE API] success - creating sprite');
        this.createChickenCoopSprite(x, y);
        console.log('[LOCAL PLACE SUCCESS]');

        // 更新金幣顯示
        const newGold = data.gold ?? data.coins;
        if (newGold !== undefined) {
          console.log('[CHICKEN COOP PURCHASE COMPLETED]', {
            cost: 500,
            coinsBefore: newGold + 500,
            coinsAfter: newGold,
          });
          this.events.emit('userUpdated', { gold: newGold, exp: 0, level: 0 });
        }

        // 更新前端狀態
        this.chickenCoopPlaced = true;
        this.chickenCoopTileX = tileX;
        this.chickenCoopTileY = tileY;
        this.pendingChickenCoop = false;

        this.exitBuildingPlacement('success_place');
        return;
      }

      // API 失敗:留在放置模式
      if (data.message?.includes('金幣不足')) {
        this.events.emit('placementFailed', '金幣不足');
      } else {
        this.events.emit('placementFailed', data.message || '放置失敗');
      }
    }).catch((err) => {
      console.error('[PLACE API] network error:', err);
      this.events.emit('placementFailed', '網路錯誤');
    });
  }

  // ── 雞舍放置模式包裝 ──
  private startCoopPlacementMode() {
    this.enterBuildingPlacement('chicken_coop');
  }

  // ── 取消放置雞舍 ──
  private cancelCoopPlacement(reason = 'cancel') {
    this.exitBuildingPlacement(reason);
  }

  // ── 確認放置雞舍 ──
  private async confirmCoopPlacement(tileX: number, tileY: number) {
    if (!this.coopPlacementValid) {
      return;
    }

    // 先停在放置模式,等 API 成功再退出
    try {
      const res = await authFetch('/api/animals/chicken-coop/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tileX, tileY }),
      });
      const data = await res.json();
      if (data.success) {
        this.chickenCoopPlaced = true;
        this.chickenCoopTileX = tileX;
        this.chickenCoopTileY = tileY;
        this.pendingChickenCoop = false;
        this.renderChickenCoop();
        this.syncChickenCoopStatus();
        this.startChickenPoll();
        // 通知商店 UI 更新雞舍狀態
        this.events.emit('chickenCoopPlaced');
        // 退出放置模式(清除 preview、DOM listener、debug timer)
        this.cancelCoopPlacement('place_success');
        console.log('[FarmScene] Chicken coop placed at', tileX, tileY);
      } else {
        console.warn('[FarmScene] Place coop failed:', data.message);
        // API 失敗:留在放置模式,讓玩家重選位置
      }
    } catch (err) {
      console.error('[FarmScene] Place coop error:', err);
      // 網路錯誤:留在放置模式
    }
  }

  // ============================================================
  // 清除所有彈窗
  // ============================================================
  private clearAllPopups() {
    // 0. 取消雞舍放置模式
    if (this.coopPlacementMode) {
      this.cancelCoopPlacement('clearAllPopups');
    }
    // 1. 清除選中農地標示
    if (this.selectedTile) {
      const children = this.selectedTile.list;
      for (const child of children) {
        if (child instanceof Phaser.GameObjects.Graphics) {
          const g = child as Phaser.GameObjects.Graphics;
          if ((g as any).lineStyle && (g as any).lineStyle.width === 4) {
            g.destroy();
            break;
          }
        }
      }
      this.selectedTile = null;
    }
    // 2. 清除操作選單
    if (this.actionMenu) { this.actionMenu.destroy(); this.actionMenu = null; }
    this.isFarmActionMenuOpen = false;
    // 3. 清除背景遮罩(必須在 seedPopup 之前)
    if (this.seedPopupOverlay) { this.seedPopupOverlay.destroy(); this.seedPopupOverlay = null; }
    // 4. 清除種子視窗
    if (this.seedPopup) { this.seedPopup.destroy(); this.seedPopup = null; }
    // 5. 清除播種高亮框
    if (this.seedHighlight) { this.seedHighlight.destroy(); this.seedHighlight = null; }
  }

  setSelectedSeed(cropId: number | null) {
    this.selectedSeed = cropId;
    if (cropId === null) this.clearAllPopups();
  }

  // ── 外部控制輸入啟用/停用(Modal 開啟時調用)──
  setInputEnabled(enabled: boolean) {
    this.input.enabled = enabled;
  }

  setFarmInputEnabled(enabled: boolean) {
    this.farmInputEnabled = enabled;
    this.input.enabled = enabled;
      }

  // ============================================================
  // update:每幀更新進度條
  // ============================================================
  update() {
    // ── 每 frame 跟蹤 placement pointer(不 throttle,確保滑鼠流暢跟隨)──
    if (this.coopPlacementMode && this.coopPlacementPreview) {
      const pointer = this.input.activePointer;
      if (pointer) {
        console.log('[POINTER ACTIVE]', pointer.x, pointer.y);
        this.updatePlacementPreview(pointer);
      }
    }

    this._frameCount++;
    if (this._frameCount % 30 !== 0) return;

    // ── 每30幀檢查一次(~500ms) ──
    const now = Date.now();
    this.farmState.forEach((state, index) => {
      // ── 空地或無 cropId:清除所有殘留 UI ──
      if (!state.cropId || state.cropState === 'empty') {
        this.hideMatureIndicator(index);
        this.hideProgressBar(index);
        this.hideDryIndicator(index);
        this.hideWitheredIndicator(index);
        return;
      }

      // ── 處理枯萎計時(30秒自動變枯萎) ──
      if (state.cropState === 'dry') {
        // 已經在 dry 狀態,檢查是否需要變枯萎
        const shouldWither = !!(state.dryStartedAt && now - state.dryStartedAt >= 30000);
        if (shouldWither) {
          console.warn('[WITHER CHECK]', {
            index,
            state: state.cropState,
            dryStartedAt: state.dryStartedAt,
            witherAt: state.witherAt,
            shouldWither,
            elapsed: state.dryStartedAt ? now - state.dryStartedAt : null,
          });
          this.transitionToWithered(index);
          return;
        }
        // dry 狀態顯示營養不良標示
        this.showDryIndicator(index);
        this.hideMatureIndicator(index);
        this.hideProgressBar(index);
        return;
      }

      // ── 枯萎:只顯示枯萎標示 ──
      if (state.cropState === 'withered') {
        this.showWitheredIndicator(index);
        this.hideMatureIndicator(index);
        this.hideProgressBar(index);
        this.hideDryIndicator(index);
        return;
      }

      if (!state.finishAt) return;

      const computedState = recalculateCropState(state.cropId, state.finishAt, state.wateredAt, state.state);

      // ── 播種後 10 秒:檢查是否需要進入 dry ──
      if (state.cropState !== 'dry' &&
          state.cropState !== 'withered' &&
          state.cropState !== 'mature' &&
          state.plantedAt) {
        const plantedElapsed = now - state.plantedAt;
        if (plantedElapsed >= 10000) {
          // 10 秒到了,檢查是否缺水或缺肥
          const needsWater = !state.wateredAt;
          const needsFertilizer = !state.isFertilized;
          if (needsWater || needsFertilizer) {
            this.transitionToDry(index);
            return;
          }
        }
      }

      // ── 剛成熟的:更新 cropState + 顯示可收成標示 ──
      if (state.cropState !== 'mature' &&
          state.cropState !== 'withered' &&
          state.cropState !== 'dry' &&
          computedState === 'mature') {
        this.farmState.set(index, {
          ...state,
          state: 'mature',
          cropState: 'mature',
        });
        this.updateFarmTileVisual(index);
        this.showMatureIndicator(index);
        this.hideProgressBar(index);
        this.hideDryIndicator(index);
        if (this.actionMenu) { this.actionMenu.destroy(); this.actionMenu = null; }
        this.isFarmActionMenuOpen = false;
                return;
      }

      // ── 成長中:顯示進度條 ──
      if (computedState === 'growing' || computedState === 'seedling' || computedState === 'seed') {
        this.updateProgressBar(index);
        this.hideMatureIndicator(index);
        this.hideDryIndicator(index);
        return;
      }


      // ── 已成熟:確保有可收成標示,無進度條 ──
      if (computedState === 'mature' && state.cropState === 'mature') {
        this.showMatureIndicator(index);
        this.hideProgressBar(index);
        this.hideDryIndicator(index);
      }
    });
  }

  // ── Scene shutdown:清理 DOM listener 避免記憶體洩漏 ──
  shutdown() {
    if (this.placementDebugTimer) {
      clearInterval(this.placementDebugTimer);
      this.placementDebugTimer = undefined;
    }
    if (this.placementMouseMoveHandler) {
      window.removeEventListener('mousemove', this.placementMouseMoveHandler, true);
      this.placementMouseMoveHandler = undefined;
      console.log('[DOM MOUSEMOVE CLEANUP ON SHUTDOWN]');
    }
    if (this.coopPlacementPreview) {
      this.coopPlacementPreview.destroy();
      this.coopPlacementPreview = null;
    }
    this.coopPlacementMode = false;
  }
}
