import Phaser from 'phaser';
import { backpackSystem } from '../systems/BackpackSystem';
import { authFetch } from '../utils/api';

const DEBUG = false;
const DEBUG_FARM = false;
const DEBUG_COOP = false;


// 開發模式：跳過產蛋倒計時（測試完改 false）
const DEBUG_SKIP_EGG_TIMER = false;

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

export interface CropData {
  id: number;
  nameZhTw: string;
  growTimeSec: number;
  sellPrice: number;
  buyPrice: number;
  exp: number;
  sprite: string;
}

export const TILE_SIZE = 32;
export const GRID_WIDTH = 16;
export const GRID_HEIGHT = 16;

export const TILE_TYPES = {
  GRASS: 'grass',
  SOIL: 'soil',
  PATH: 'path',
  TREE: 'tree'
} as const;

// 生長階段
export type GrowthStage = 'seed' | 'seedling' | 'growing' | 'mature' | 'dry' | 'withered';

// 作物代號映射(用於 sprite key)
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
};

// 作物土堆視覺錨點偏移(x: 右移, y: 下移 = 正值往下)
// 土堆中心對齊農地中心:所有 offset 都是小調整
// 統一使用 setOrigin(0.5, 1),所以 y 正值往下移(作物往上長需要負值)
// 但現有 mature offset 為正,故保持現有方向,只修正 seed/seedling 的極端值
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
};

// 作物 ID 映射到 sprite key
export const CROP_ID_TO_KEY: Record<number, string> = {
  1: 'wheat',
  2: 'corn',
  3: 'carrot',
  4: 'potato',
};

export const CROP_KEY_TO_ID: Record<string, number> = {
  wheat: 1,
  corn: 2,
  carrot: 3,
  potato: 4,
};

// 作物詳細資料(客戶端快取)
let cropDetailsCache: CropData[] = [];

export function getCropDetails(cropId: number): CropData | undefined {
  return cropDetailsCache.find(c => c.id === cropId);
}

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
  private cropTooltip: Phaser.GameObjects.Container | null = null;

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

  // ── 雞舍放置模式 ──
  // ── 農地位置(instance variable 供 placement system 使用)──
  private farmStartX = 0;
  private farmStartY = 0;

  // ── 雞舍放置模式 ──
  private coopPlacementMode = false;
  private coopPlacementPreview: Phaser.GameObjects.Graphics | null = null;
  private placementStartedAt = 0; // 防止 UI 點擊冒泡的 100ms 延遲
  private coopPlacementValid = false;
  private coopPlacementTileX = 0;
  private coopPlacementTileY = 0;
  private coopChickenStatus: any = null;
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

  // ── 根據 wateredAt 計算澆水狀態 ──
  private calcWaterStatus(wateredAt: number | undefined): { isWatered: boolean; cropStatus: 'healthy' | 'needs_water' } {
    if (!wateredAt) return { isWatered: false, cropStatus: 'needs_water' };
    const elapsed = Date.now() - wateredAt;
    if (elapsed <= this.WATER_INTERVAL_MS) return { isWatered: true, cropStatus: 'healthy' };
    return { isWatered: false, cropStatus: 'needs_water' };
  }

  // ── 計算生長速度倍率(根據澆水狀態)──
  // 已澆水:1x,未澆水:0.5x(MVP 規則)
  private getGrowthSpeedMultiplier(wateredAt: number | undefined): number {
    return this.calcWaterStatus(wateredAt).isWatered ? 1.0 : 0.5;
  }

  // ── 計算作物狀態(mature 優先級最高)──
  // 規則:只要 cropId 有值且時間到了就是 mature,不看其他狀態
  private computeCropState(cropId: number | undefined, finishAt: number | undefined, serverState: string): TileData['cropState'] {
    if (!cropId || !finishAt) return 'empty';
    if (Date.now() >= finishAt) return 'mature';
    // 時間還沒到,用 serverState 或從 progress 推算
    if (serverState === 'seed') return 'seed';
    if (serverState === 'seedling') return 'seedling';
    return 'growing';
  }

  // ── 計算土地視覺狀態 ──
  private computeSoilState(wateredAt: number | undefined): TileData['soilState'] {
    return this.calcWaterStatus(wateredAt).isWatered ? 'watered' : 'dry';
  }

  private selectedSeed: number | null = null;
  private farmState: Map<number, TileData> = new Map();
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
    const saved = localStorage.getItem('tlo_farm_chicken_coop');
    if (DEBUG_COOP) console.log('[LOAD LOCALSTORAGE]', saved);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (DEBUG_COOP) console.log('[RESTORE CHICKEN COOP]', saved);
      // restore 時 save:false 避免覆蓋 localStorage,animals 從 parsed 讀取
      this.placeChickenCoopLocal(parsed.x, parsed.y, {
        save: false,
        animals: parsed.animals ?? []
      });
    }
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

    const COLS = 3;
    const ROWS = 2;
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
    for (let i = 0; i < 6; i++) {
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
      farmContainer.on('pointerover', () => this.showCropTooltip(i));
      farmContainer.on('pointermove', (pointer: Phaser.Input.Pointer) => this.moveCropTooltip(pointer));
      farmContainer.on('pointerout', () => this.hideCropTooltip());

      this.tiles.set(`${i}`, farmContainer);
      this.farmlandObjects.push(farmContainer);
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
    }

    this.events.on('extraFarmsUnlocked', () => {
      console.log('[extraFarmsUnlocked] 等級 8 解鎖額外農地');
      this.createExtraFarms();
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      this.clearAllPopups();
      if (this.coopPlacementMode) {
        this.cancelCoopPlacement('esc_cancel');
      }
    });

    // ── 全域 pointermove(只在 placement mode 使用,永遠只綁一次)──
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.coopPlacementMode || !this.coopPlacementPreview) return;
      this.updatePlacementPreview(pointer);
    });
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
    // Phase 2: 暫時停用 syncChickenCoopStatus(後端 sync 不得覆蓋本地雞舍)
    // this.syncChickenCoopStatus();

    // ── Phase4: 監聽商店購買小雞後的更新事件 ──
    window.addEventListener('chicken-coop-animals-updated', () => {
      console.log('[EVENT] chicken-coop-animals-updated received');
      this.loadChickenCoopLocalState();
      this.renderChicksInCoop();
    });

    // ── 監聽背包更新事件(讓雞舍操作後同步背包)──
    window.addEventListener('inventory-updated', () => {
      console.log('[EVENT] inventory-updated received, refetching backpack');
      backpackSystem.fetchAll();
    });
  }

  // 重新排農地(resize 時呼叫)
  private layoutFarmlands() {
    const COLS = 3;
    const ROWS = 2;

    const totalFarmW = COLS * this.FARM_SIZE + (COLS - 1) * this.FARM_GAP;
    const totalFarmH = ROWS * this.FARM_SIZE + (ROWS - 1) * this.FARM_GAP;
    const farmStartX = (this.CANVAS_W - totalFarmW) / 2;
    const farmStartY = (this.CANVAS_H - totalFarmH) / 2;


    for (let i = 0; i < 6; i++) {
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
        cropDetailsCache = data.crops;
              }
    } catch (err) {
      console.warn('[FarmScene] 載入作物資料失敗', err);
    }
  }

  // ============================================================
  // 從伺服器同步農場狀態
  // ============================================================
  // ── 用 finishAt + 生長速度重新計算 client-side state(不受後端 state 欺騙)──
  // 未澆水時,生長速度 0.5x,effective finish 往後推
  private recalcState(cropId: number | null, finishAt: number | null, wateredAt: number | undefined, serverState: string): 'empty' | 'growing' | 'mature' | 'seed' | 'seedling' {
    if (!cropId || !finishAt) return 'empty';
    const speed = this.getGrowthSpeedMultiplier(wateredAt);
    const now = Date.now();
    if (speed >= 1.0) {
      if (now >= finishAt) return 'mature';
      return 'growing';
    } else {
      // 未澆水:0.5x 速度 → effective finish = finishAt + (growTime * 0.5)
      // 進度落後一半,所以完成時間要往後推
      const cropInfo = getCropDetails(cropId);
      const growTimeMs = (cropInfo?.growTimeSec || 60) * 1000;
      const delayMs = growTimeMs; // 0.5x 速度要多等一倍時間 = 再加一個 growTime
      const effectiveFinishAt = finishAt + delayMs;
      if (now >= effectiveFinishAt) return 'mature';
      return 'growing';
    }
  }

  private async syncFarmState() {
    try {
      const res = await authFetch('/api/farm/status');
      const data = await res.json();

      if (data.success && data.tiles) {
        for (const tile of data.tiles) {
          const index = tile.y * 3 + tile.x;
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
              : this.recalcState(tile.cropId, tile.finishAt, tile.wateredAt, tile.state);
            const { isWatered, cropStatus } = this.calcWaterStatus(tile.wateredAt);
            const cropState = isDryOrWithered
              ? rawState as any
              : (clientIsRecovered ? 'growing' : this.computeCropState(tile.cropId, tile.finishAt, tile.state));
            // 空農地一定顯示乾農地,不受 wateredAt 殘留值影響
            const soilState = (!tile.cropId || tile.state === 'empty') ? 'dry' : this.computeSoilState(tile.wateredAt);
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
            this.showSeedPopup(index, x, y - this.FARM_SIZE / 2 - 10);
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
    const displayCrops = cropDetailsCache.slice(0, 4);
    if (displayCrops.length === 0) return;

    // ── 固定尺寸:280x300,置中顯示 ──
    const POPUP_W = 280;
    const POPUP_H = 300;
    const ROW_H = 52;
    const LIST_Y = 64;

    const canvasWidth = this.scale.width;
    const canvasHeight = this.scale.height;

    const popupX = canvasWidth / 2 - POPUP_W / 2;
    const popupY = canvasHeight / 2 - POPUP_H / 2;

    // ── 背景遮罩(點擊關閉)──
    this.seedPopupOverlay = this.add.graphics();
    this.seedPopupOverlay.fillStyle(0x000000, 0.4);
    this.seedPopupOverlay.fillRect(0, 0, canvasWidth, canvasHeight);
    this.seedPopupOverlay.setDepth(199);
    this.seedPopupOverlay.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, canvasWidth, canvasHeight),
      Phaser.Geom.Rectangle.Contains
    );
    this.seedPopupOverlay.on('pointerdown', () => {
      this.clearAllPopups();
    });

    this.seedPopup = this.add.container(popupX, popupY);
    this.seedPopup.setDepth(200);

    // ── 背景 ──
    const bg = this.add.graphics();
    bg.fillStyle(0x3d2518, 0.95);
    bg.fillRoundedRect(0, 0, POPUP_W, POPUP_H, 10);
    bg.lineStyle(2, 0x8B4513, 1);
    bg.strokeRoundedRect(0, 0, POPUP_W, POPUP_H, 10);
    this.seedPopup.add(bg);

    // ── 標題 ──
    const title = this.add.text(POPUP_W / 2, 14, '選擇種子播種', {
      fontSize: '14px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#FFD700',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5, 0);
    this.seedPopup.add(title);

    // ── X 關閉按鈕 ──
    const closeBtn = this.add.graphics();
    closeBtn.fillStyle(0xC0392B, 1);
    closeBtn.fillRoundedRect(POPUP_W - 32, 8, 22, 22, 3);
    closeBtn.setInteractive(
      new Phaser.Geom.Rectangle(POPUP_W - 32, 8, 22, 22),
      Phaser.Geom.Rectangle.Contains
    );
    closeBtn.on('pointerdown', () => {
      this.clearAllPopups();
    });
    this.seedPopup.add(closeBtn);

    const closeText = this.add.text(POPUP_W - 21, 19, 'X', {
      fontSize: '14px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    closeText.setOrigin(0.5, 0.5);
    closeBtn.setDepth(1);
    this.seedPopup.add(closeText);

    // ── 作物清單(只渲染4筆)──
    displayCrops.forEach((crop, i) => {
      const rowY = LIST_Y + i * ROW_H;
      const amount = seedCountMap[crop.id] || 0;
      const disabled = amount <= 0;
      const growTime = crop.growTimeSec || 0;
      const alpha = disabled ? 0.45 : 1;

      // Row 背景
      const rowBg = this.add.graphics();
      rowBg.fillStyle(disabled ? 0x333333 : 0x5C3D2E, disabled ? 0.5 : 0.8);
      rowBg.fillRoundedRect(10, rowY, POPUP_W - 20, ROW_H - 6, 6);
      rowBg.setAlpha(alpha);
      this.seedPopup.add(rowBg);

      // 種子名稱(左側)
      const nameText = this.add.text(20, rowY + ROW_H / 2, crop.nameZhTw, {
        fontSize: '14px',
        fontFamily: "'Cubic 11', sans-serif",
        color: disabled ? '#888888' : '#FFFFFF',
      });
      nameText.setOrigin(0, 0.5);
      nameText.setAlpha(alpha);
      this.seedPopup.add(nameText);

      // 數量(右側)
      const amountText = this.add.text(POPUP_W - 20, rowY + ROW_H / 2, `x${amount}`, {
        fontSize: '14px',
        fontFamily: "'Cubic 11', sans-serif",
        color: disabled ? '#666666' : '#FFD700',
        fontStyle: 'bold',
      });
      amountText.setOrigin(1, 0.5);
      amountText.setAlpha(alpha);
      this.seedPopup.add(amountText);

      // 成長時間(下方小字)
      if (growTime > 0) {
        const timeText = this.add.text(20, rowY + ROW_H / 2 + 14, formatTime(growTime), {
          fontSize: '11px',
          fontFamily: "'Cubic 11', sans-serif",
          color: disabled ? '#555555' : '#AAAAAA',
        });
        timeText.setOrigin(0, 0.5);
        timeText.setAlpha(alpha);
        this.seedPopup.add(timeText);
      }

      // ── 點擊區域(數量 > 0 才能點擊)──
      if (disabled) return;

      const hitArea = this.add.graphics();
      hitArea.fillStyle(0x000000, 0);
      hitArea.fillRoundedRect(10, rowY, POPUP_W - 20, ROW_H - 6, 6);
      hitArea.setInteractive(
        new Phaser.Geom.Rectangle(10, rowY, POPUP_W - 20, ROW_H - 6),
        Phaser.Geom.Rectangle.Contains
      );
      hitArea.on('pointerdown', () => {
                this.clearAllPopups();
        this.plantCrop(index, crop.id);
      });
      this.seedPopup.add(hitArea);
    });
  }

  // ============================================================
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
  // 播種(含樂觀更新)
  // ============================================================
  private async plantCrop(index: number, cropId: number) {
    const state = this.farmState.get(index);
    if (!state) {
      console.error('[FarmScene] plantCrop FAILED: state is null for index=', index);
      return;
    }
    if (state.cropState !== 'empty') {
      console.warn('[FarmScene] 播種失敗:農地不是空的', state.cropState);
      return;
    }


    // ── 樂觀更新:立即顯示幼苗 ──
    const now = Date.now();
    const cropInfo = getCropDetails(cropId);
    const growTimeMs = (cropInfo?.growTimeSec || 60) * 1000;

    this.farmState.set(index, {
      ...state,
      cropId,
      plantedAt: now,
      finishAt: now + growTimeMs,
      wateredAt: undefined,
      isWatered: false,
      isFertilized: 0,
      fertilizedAt: undefined,
      cropStatus: 'needs_water',
      state: 'growing',
      cropState: 'growing',
      soilState: 'dry',
      dryStartedAt: undefined,
      careCheckAt: now + 10000, // 播種後 10 秒才開始檢查照顧條件
    });


    //立即更新視覺(馬上顯示幼苗)
    this.updateFarmTileVisual(index, 'plantCrop');
    this.showProgressBar(index);

    // 扣除背包(本地)
    backpackSystem.deductItem('seed', cropId);

    // ── 伺服器同步 ──
    try {
      const res = await authFetch('/api/farm/plant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: index % 3, y: Math.floor(index / 3), cropId }),
      });
      const data = await res.json();
      if (data.success) {
        const plantedAt = typeof data.tile.plantedAt === 'number' ? data.tile.plantedAt : new Date(data.tile.plantedAt).getTime();
        this.farmState.set(index, {
          ...state,
          cropId,
          plantedAt,
          finishAt: data.tile.finishAt,
          wateredAt: undefined,
          isWatered: false,
          isFertilized: 0,
          fertilizedAt: undefined,
          cropStatus: 'needs_water',
          state: 'growing',
          cropState: 'growing',
          soilState: 'dry',
          dryStartedAt: undefined,
          careCheckAt: plantedAt + 10000,
        });
        this.events.emit('goldChanged', data.user.gold);
        this.events.emit('userUpdated', data.user);
              } else {
        console.warn('[FarmScene] 播種失敗:', data.message);
        // 回滾:恢復農地狀態
        this.farmState.set(index, { ...state, state: 'empty', cropState: 'empty', soilState: 'dry' });
        this.updateFarmTileVisual(index);
        this.hideProgressBar(index);
        // 補償:恢復背包種子
        backpackSystem.addItem('seed', cropId);
      }
    } catch (err) {
      console.error('[FarmScene] 播種錯誤', err);
      // 網路錯誤:回滾並補償
      this.farmState.set(index, { ...state, state: 'empty', cropState: 'empty', soilState: 'dry' });
      this.updateFarmTileVisual(index);
      this.hideProgressBar(index);
      // 補償:恢復背包種子
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

    const tileCenter = this.getTileCenter(index);
    if (!tileCenter) return;

    // 進度條固定在農地中心上方 - 80px(使用統一座標系統)
    const UI_OFFSET_Y = -80;
    const BAR_W = 70;
    const BAR_H = 6;
    const BAR_Y = tileCenter.y + UI_OFFSET_Y;

    const uiContainer = this.add.container(tileCenter.x, 0);
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
  private showHarvestFloatingText(index: number, cropName: string, expEarned: number) {
    const container = this.tiles.get(`${index}`);
    if (!container) return;

    const tileCenter = this.getTileCenter(index);
    if (!tileCenter) return;

    // 飄字容器:置於 tileCenter 上方(world coords since farmland container is at world pos)
    const worldX = container.x + tileCenter.x;
    const worldY = container.y + tileCenter.y - 50;

    const floatContainer = this.add.container(worldX, worldY);
    floatContainer.setDepth(300);

    const cropText = this.add.text(0, 0, `+1 ${cropName}`, {
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
    if (state.cropState === 'withered') {
      console.warn(`[FarmScene] blocked harvest: cropState=withered`);
      return;
    }
    if (state.cropState !== 'mature') {
      console.warn(`[FarmScene] blocked harvest: cropState=${state.cropState}`);
      return;
    }
    if (!state.cropId) {
      console.warn(`[FarmScene] blocked harvest: no cropId`);
      return;
    }

        if (DEBUG) { console.log('[HARVEST FRONTEND REQUEST]', {
      index,
      tileId: state.id,
      x: index % 3,
      y: Math.floor(index / 3),
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

    // ── 立即顯示飄字(不等 API)──
    this.showHarvestFloatingText(index, cropName, expReward);

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
        body: JSON.stringify({ x: index % 3, y: Math.floor(index / 3) }),
      });
      const data = await res.json();
      if (data.success) {
        // 刷新背包(收成作物進背包)
        backpackSystem.fetchAll();
        // 飄字已在 API 呼叫前第一時間顯示(從快取拿資料)
        // userUpdated 包含 gold/exp/level,harvest 包含 cropName 和 earned 值
        this.events.emit('userUpdated', data.user);
        this.events.emit('harvest', {
          gold: data.harvest.goldEarned,
          exp: data.harvest.expEarned,
          cropName: data.harvest.cropName,
        });
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
    if (state.cropState === 'dry' || state.cropState === 'withered' || state.cropState === 'mature') return;

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
    if (state.cropState === 'withered') return;

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
      const x = index % 3;
      const y = Math.floor(index / 3);
      await authFetch('/api/farm/tile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y, ...updates }),
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
        body: JSON.stringify({ x: index % 3, y: Math.floor(index / 3) }),
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
    const state = this.farmState.get(index);
    if (!state) return;
    if (state.cropState !== 'growing' && state.cropState !== 'seedling' && state.cropState !== 'seed' && state.cropState !== 'dry') {
      console.warn('[FarmScene] 澆水失敗:狀態不正確', state.state);
      return;
    }



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

    // ── 更新澆水狀態(客戶端樂觀更新)──
    const wateredAt = Date.now();
    // MVP:dry 恢復由後端判斷,前端只更新澆水狀態
    this.farmState.set(index, {
      ...state,
      wateredAt,
      isWatered: true,
      cropStatus: 'healthy',
      soilState: 'watered',
    });

    // ── 立刻更新土地貼圖 + 重建作物 ──
    this.renderFarmland(index);
    this.renderCrop(index);

    try {
      const res = await authFetch('/api/farm/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: index % 3, y: Math.floor(index / 3) }),
      });
      const data = await res.json();
      if (!data.success) {
        console.warn('[FarmScene] 澆水 API 失敗:', data.message);
        // 回滾澆水狀態
        this.farmState.set(index, { ...state });
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
      // 回滾
      this.farmState.set(index, { ...state });
      this.renderFarmland(index);
      this.renderCrop(index);
    }
  }

  // ============================================================
  // 施肥
  // ============================================================
  private async fertilizeCrop(index: number) {
    const state = this.farmState.get(index);
    if (!state) return;

    if (state.cropState !== 'growing' && state.cropState !== 'seedling' && state.cropState !== 'seed' && state.cropState !== 'dry') {
      console.warn('[FarmScene] 施肥失敗:狀態不正確', state.cropState);
      return;
    }

    if (state.isFertilized) {
      console.warn('[FarmScene] 施肥失敗:已施肥');
      return;
    }


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
        body: JSON.stringify({ x: index % 3, y: Math.floor(index / 3) }),
      });
      const data = await res.json();

      fertilizerText.destroy();

      if (data.success) {
        // 刷新背包
        backpackSystem.fetchAll();
        // 使用伺服器返回的狀態(包含 dry 恢復)
        const prevCropState = state.cropState;
        const now = Date.now();
        const newStateFromServer = data.state ?? state.cropState;
        this.farmState.set(index, {
          ...state,
          isFertilized: 1,
          fertilizedAt: now,
          fertilizerType: 'normal',
          fertilizerSpeedBonus: 20,
          state: newStateFromServer,
          cropState: newStateFromServer,
          dryStartedAt: newStateFromServer === 'growing' ? undefined : state.dryStartedAt,
        });
                // ── DRY 恢復檢查 ──
        if (newStateFromServer === 'growing' && prevCropState === 'dry') {
                    this.recoverDryTile(index);
        } else {
          // 正常施肥(不是 dry 恢復):只更新 UI
          if (this.actionMenu) { this.actionMenu.destroy(); this.actionMenu = null; }
          this.isFarmActionMenuOpen = false;
          this.hideDryIndicator(index);
          this.updateFarmTileVisual(index);
          this.renderCrop(index);
          this.updateProgressBar(index);
        }
        // 更新金幣顯示
        if (data.gold !== undefined) {
          this.events.emit('goldChanged', data.gold);
        }
        this.showFertilizeSuccess(index);
      } else {
        // 顯示錯誤
        const errText = this.add.text(0, -this.FARM_SIZE / 2 - 30, data.message || '施肥失敗', {
          fontSize: '12px',
          fontFamily: "'Cubic 11', sans-serif",
          color: '#FF8888',
          fontStyle: 'bold',
        });
        errText.setOrigin(0.5, 1);
        errText.setDepth(80);
        container.add(errText);
        this.time.delayedCall(1500, () => errText.destroy());
      }
    } catch (err) {
      console.error('[FarmScene] 施肥錯誤', err);
      fertilizerText.destroy();
      const errText = this.add.text(0, -this.FARM_SIZE / 2 - 30, '網路錯誤', {
        fontSize: '12px',
        fontFamily: "'Cubic 11', sans-serif",
        color: '#FF8888',
        fontStyle: 'bold',
      });
      errText.setOrigin(0.5, 1);
      errText.setDepth(80);
      container.add(errText);
      this.time.delayedCall(1500, () => errText.destroy());
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
      if (data.success) {
        this.coopChickenStatus = data;
        this.coopChickenStatus.gold = data.gold;

        if (data.hasBuilding && data.tileX !== null && data.tileY !== null) {
          this.chickenCoopPlaced = true;
          this.chickenCoopTileX = data.tileX;
          this.chickenCoopTileY = data.tileY;
          this.renderChickenCoop();
        } else {
          this.chickenCoopPlaced = false;
          if (this.chickenCoopSprite) {
            if (DEBUG_COOP) console.log('[SYNC SKIPPED] local chicken coop exists, backend sync ignored in Phase 2');
            return;
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
    if (this.chickenCoopSprite) {
      this.chickenCoopSprite.destroy();
      this.chickenCoopSprite = null;
    }
    if (!this.chickenCoopPlaced) return;

    // 農地處於畫布中央,3×2 農地 (360×240) + 間隔
    const COLS = 3;
    const ROWS = 2;
    const totalFarmW = COLS * this.FARM_SIZE + (COLS - 1) * this.FARM_GAP;
    const totalFarmH = ROWS * this.FARM_SIZE + (ROWS - 1) * this.FARM_GAP;
    const farmStartX = (this.CANVAS_W - totalFarmW) / 2;
    const farmStartY = (this.CANVAS_H - totalFarmH) / 2;

    // 雞舍位於農地右側 (x=3, y=0),2×2 農地大小
    // 雞舍座標 stored as farmland-relative farmland tile (FARM_SIZE=120px per tile)
    // this.chickenCoopTileX/Y = farmland-relative farmland tile (0-15)
    const coopPixelX = farmStartX + this.chickenCoopTileX * this.FARM_SIZE + this.FARM_SIZE;
    const coopPixelY = farmStartY + this.chickenCoopTileY * this.FARM_SIZE + this.FARM_SIZE;

    const coopSprite = this.add.sprite(coopPixelX, coopPixelY, 'chicken_coop');
    // 2×2 農地大小 = 240×240
    coopSprite.setDisplaySize(this.FARM_SIZE * 2, this.FARM_SIZE * 2);
    coopSprite.setOrigin(0.5, 0.5);
    coopSprite.setDepth(10);
    coopSprite.setInteractive(
      new Phaser.Geom.Rectangle(-this.FARM_SIZE, -this.FARM_SIZE, this.FARM_SIZE * 2, this.FARM_SIZE * 2),
      Phaser.Geom.Rectangle.Contains
    );
    coopSprite.on('pointerdown', () => {
      if (!this.farmInputEnabled) return;
      this.events.emit('openChickenCoop');
    });

    this.chickenCoopSprite = coopSprite;
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
    console.log('[DEBUG FARM LAND BOUNDS]', {
      farmlandCount: this.farmlandObjects.length,
      bounds: this.farmlandObjects.map((f, i) => {
        const b = f.getBounds();
        return { index: i, x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
      }),
    });

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
    if (DEBUG_COOP) console.log('[PLACE LOCAL COOP]', { x, y, hasSprite: !!this.chickenCoopSprite, options });
    if (this.chickenCoopSprite) {
      console.log('[SKIP CREATE] coop already exists');
      return;
    }
    // 建立雞舍 sprite（不可拖曳，只有 setInteractive）
    const coop = this.add.image(x, y, 'chicken_coop');
    coop.setOrigin(0, 0);
    coop.setDisplaySize(288, 288);
    coop.setDepth(5000);
    coop.removeAllListeners('pointerdown');
    // 恢復：整張圖片可點擊，不要自訂 hitArea
    coop.setInteractive({ useHandCursor: true });
    console.log('[COOP SPRITE READY]', {
      exists: !!coop,
      interactive: !!coop.input,
      depth: coop.depth,
      visible: coop.visible,
      active: coop.active,
    });
    // 點擊雞舍開管理介面（農地選單開啟時阻擋）
    coop.on('pointerdown', (pointer, localX, localY, event) => {
      console.log('[CHICKEN COOP CLICKED]', {
        isFarmActionMenuOpen: this.isFarmActionMenuOpen,
        pointerX: pointer.x, pointerY: pointer.y,
        localX, localY,
      });
      if (this.isFarmActionMenuOpen) {
        console.log('[COOP CLICK BLOCKED BY FARM MENU]');
        return;
      }
      this.openChickenCoopPanel();
    });
    this.chickenCoopSprite = coop;
    console.log('[LOCAL PLACE SUCCESS]');
    // 追蹤是否被摧毀
    if (DEBUG_COOP) {
      this.chickenCoopSprite.on('destroy', () => {
        console.warn('[CHICKEN COOP SPRITE DESTROYED]', { x, y, stack: new Error().stack });
      });
    }

    // 渲染小雞 sprites(renderChicksInCoop 會直接讀 localStorage)
    this.renderChicksInCoop();

    // 只有在需要保存時才寫入 localStorage(購買新雞舍時),restore 時不應覆蓋
    const shouldSave = options.save !== false;
    const animalsToSave = options.animals ?? [];
    if (shouldSave) {
      console.log('[SAVE CHICKEN COOP LOCAL]', { x, y, animalsCount: animalsToSave.length });
      localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify({ type: 'chicken_coop', x, y, widthTiles: 2, heightTiles: 2, level: 1, capacity: 4, animals: animalsToSave }));
      if (DEBUG_COOP) {
        console.log('[VERIFY LOCALSTORAGE AFTER SAVE]', localStorage.getItem('tlo_farm_chicken_coop'));
      }
    } else {
      if (DEBUG_COOP) console.log('[SKIP SAVE] restore mode, animals preserved');
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
    try {
      const raw = localStorage.getItem('tlo_farm_chicken_coop');
      if (!raw) {
        console.log('[LOCAL STORAGE] no saved chicken coop data');
        return;
      }
      const state = JSON.parse(raw);
      if (DEBUG_COOP) console.log('[LOCAL STORAGE LOAD]', state);
      // 防止重複建立
      if (this.chickenCoopSprite) {
        if (DEBUG_COOP) console.log('[SKIP LOCAL LOAD] chickenCoopSprite already exists');
        return;
      }
      // 在 sprite 建立之前就設 flag(syncChickenCoopStatus 是 async,必須搶在它 destroy 之前)
      // 只建立 sprite,不進入放置模式,不顯示 preview
      // restore 時 save:false 避免覆蓋 localStorage 中的 animals
      this.placeChickenCoopLocal(state.x, state.y, {
        save: false,
        animals: state.animals ?? []
      });
      // renderChicksInCoop 已在 placeChickenCoopLocal 內部調用,無需重複調用
    } catch(e) {
      console.error('[LOCAL STORAGE LOAD ERROR]', e);
    }
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
  private _coopListenersInitialized: boolean = false;
  // 用於存 panel DOM 引用，讓 class method 也能呼叫 re-binding
  private _coopPanelEl: HTMLDivElement | null = null;

  // ── 統一按鈕事件綁定（每次 innerHTML 重繪後都要呼叫）──
  private bindChickenCoopPanelEvents(panelEl: HTMLDivElement) {
    const feedBtn = panelEl.querySelector('[data-action="feed"]') as HTMLButtonElement | null;
    const collectBtn = panelEl.querySelector('[data-action="collect-eggs"]') as HTMLButtonElement | null;
    const closeBtn = panelEl.querySelector('[data-action="close"]') as HTMLButtonElement | null;
    console.log('[CLOSE BTN EXISTS]', !!closeBtn);


    // 使用 onclick（單一賦值）取代 addEventListener，避免每秒重新 binding 累積重複監聽器
    if (feedBtn) feedBtn.onclick = (e: Event) => { e.stopPropagation(); this.handleFeedChickenCoop(panelEl); };
    if (collectBtn) collectBtn.onclick = (e: Event) => { e.stopPropagation(); this.handleCollectEggs(panelEl); };
    if (closeBtn) {
      closeBtn.onclick = (e: Event) => {
        console.log('[CLOSE BUTTON CLICKED]');
        e.stopPropagation();
        this.closeChickenCoopPanel();
      };
    }
  }

  // ── 餵食按鈕 handler ──
  private handleFeedChickenCoop(panelEl: HTMLDivElement) {
    const coopRaw = localStorage.getItem('tlo_farm_chicken_coop');
    if (!coopRaw) { this.events.emit('game-toast', '找不到雞舍資料'); return; }
    const coop = JSON.parse(coopRaw);
    const animalCount = (coop.animals ?? []).length;
    const requiredFeed = animalCount;
    if (coop.feedingStatus === 'fed') { this.events.emit('game-toast', '已餵食,請等待倒數完成'); return; }
    if (animalCount <= 0) { this.events.emit('game-toast', '雞舍裡沒有雞'); return; }

    const LIVESTOCK_KEY = 'tlo_farm_inventory_livestock';
    const stored: any[] = JSON.parse(localStorage.getItem(LIVESTOCK_KEY) || '[]');
    const state = backpackSystem.getState();
    const itemsState = state.items;

    // （fields already validated via isBasicFeed check above）

    const getItemDisplayName = (item: any) =>
      String(item.nameZhTw ?? item.itemName ?? item.displayName ?? item.name ?? item.title ?? '');
    const getItemKey = (item: any) =>
      String(item.itemId ?? item.key ?? item.id ?? '');
    const getItemQuantity = (item: any) =>
      Number(item.quantity ?? item.count ?? item.amount ?? 0);
    const isBasicFeed = (item: any) => {
      const name = getItemDisplayName(item);
      const key = getItemKey(item);
      return key === 'feed_basic' || key === 'basic_feed' || key === 'normal_feed' ||
        key === '普通飼料' || name === '普通飼料' || name.includes('普通飼料');
    };

    const feedFromLivestock = stored.find(isBasicFeed);
    const feedFromItems = itemsState.find(isBasicFeed);
    const feedItem = feedFromLivestock ?? feedFromItems;

    if (!feedItem) {
      this.events.emit('game-toast', `普通飼料不足!需要 ${requiredFeed} 包,背包有 0 包`);
      return;
    }

    const feedBefore = getItemQuantity(feedItem);
    if (feedBefore < requiredFeed) {
      this.events.emit('game-toast', `普通飼料不足!需要 ${requiredFeed} 包,背包有 ${feedBefore} 包`);
      return;
    }

    const feedAfter = feedBefore - requiredFeed;
    if (feedFromLivestock) {
      backpackSystem.updateLivestockItem(Number(feedFromLivestock.itemId), -requiredFeed);
    } else {
      backpackSystem.deductItem('item', 2);
      const livestockStored: any[] = JSON.parse(localStorage.getItem(LIVESTOCK_KEY) || '[]');
      const lIdx = livestockStored.findIndex((item: any) => isBasicFeed(item));
      if (lIdx !== -1) livestockStored[lIdx].amount = feedAfter;
      else livestockStored.push({ id: 0, itemType: 'livestock', itemId: 2, amount: feedAfter, name: '普通飼料', sprite: 'feed_normal.png', sellPrice: 0, growTimeSec: 0 });
      localStorage.setItem(LIVESTOCK_KEY, JSON.stringify(livestockStored));
    }


    coop.feedingStatus = 'fed';
    coop.lastFedAt = Date.now();
    localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify(coop));
    window.dispatchEvent(new Event('inventory-updated'));
    this.refreshCoopPanelStatus(panelEl);

    try {
      const res = authFetch('/api/animals/chicken-coop/feed-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      // API failed, local feed already applied
    }
  }

  // ── 收雞蛋按鈕 handler ──
  private handleCollectEggs(panelEl: HTMLDivElement) {
    const coopRaw = localStorage.getItem('tlo_farm_chicken_coop');
    if (!coopRaw) { this.events.emit('game-toast', '找不到雞舍資料'); return; }
    const coop = JSON.parse(coopRaw);
    const eggs = Number(coop.eggCount || 0);
    if (eggs <= 0) { this.events.emit('game-toast', '目前沒有可收雞蛋'); return; }

    let apiSuccess = false;
    try {
      const res = authFetch('/api/animals/chicken-coop/collect-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eggCount: eggs }),
      });
      const result = res as any;
      if (result.success) { apiSuccess = true; }
    } catch (err: any) {
      // API failed, running local-only flow
    }

    const before = [...backpackSystem.getState().livestock];
    backpackSystem.updateLivestockItem(1, eggs);

    coop.eggCount = 0;
    localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify(coop));
    window.dispatchEvent(new Event('inventory-updated'));
    this.refreshCoopPanelStatus(panelEl);
  }

  // ── DEV 立即產蛋 handler ──
  private handleDevInstantEgg(panelEl: HTMLDivElement) {
    const raw = localStorage.getItem('tlo_farm_chicken_coop');
    if (!raw) return;
    const data = JSON.parse(raw);
    const adultCount = (data.animals ?? []).filter((a: any) => a.stage === 'adult').length;
    if (adultCount <= 0) { this.events.emit('game-toast', '沒有成雞，無法測試產蛋'); return; }
    data.eggCount = adultCount;
    data.feedingStatus = 'none';
    data.lastFedAt = null;
    localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify(data));
    this.refreshCoopPanelStatus(panelEl);
    this.events.emit('game-toast', `測試產生 ${adultCount} 顆雞蛋`);
  }

  // ── 重新整理雞舍面板狀態（DOM 重建後重新 binding）──
  private refreshCoopPanelStatus(panelEl: HTMLDivElement) {
    // 如果 panel 已關閉，不做任何事
    if (!this._coopPanelEl) return;
    if (!document.body.contains(panelEl)) {
      if (this._coopCountdownInterval !== null) {
        clearInterval(this._coopCountdownInterval);
        this._coopCountdownInterval = null;
      }
      this._coopListenersInitialized = false;
      return;
    }
    const raw = localStorage.getItem('tlo_farm_chicken_coop');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const animals = data.animals ?? [];
      const animalCount = animals.length;
      const babyCount = animals.filter((a: any) => a.stage === 'baby').length;
      const adultCount = animals.filter((a: any) => a.stage === 'adult').length;
      const feedStatus = data.feedingStatus === 'fed' ? 'fed' : 'none';
      const lastFedAt = data.lastFedAt ?? null;
      const eggCount = data.eggCount ?? 0;

      const container = panelEl.querySelector('#coop-status-container');
      if (!container) return;
      // 重新渲染狀態文字
      const html = this.buildCoopStatusHtml({ animalCount, babyCount, adultCount, feedStatus, lastFedAt, eggCount, capacity: data.capacity ?? 4 });
      container.innerHTML = html;
      // DOM 重建後必須重新 binding
      this.bindChickenCoopPanelEvents(panelEl);
    } catch(e) {}
  }

  // ── 雞舍狀態區塊 HTML（供 refreshCoopPanelStatus 重複呼叫）──
  private buildCoopStatusHtml(state: { animalCount: number; babyCount: number; adultCount: number; feedStatus: 'fed' | 'none'; lastFedAt: number | null; eggCount: number; capacity: number }) {
    const { animalCount, babyCount, adultCount, feedStatus, lastFedAt, eggCount, capacity } = state;
    const feedBtnDisabled = feedStatus === 'fed' || animalCount === 0;
    const feedBtnLabel = animalCount === 0 ? '無雞' : '餵食';
    let countdownHtml = '';
    const BABY_GROW_MS = 10 * 60 * 1000;
    const ADULT_EGG_MS = 15 * 60 * 1000;
    if (feedStatus === 'fed' && lastFedAt) {
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
        <div style="font-size: 15px; font-weight: 700; color: ${feedStatus === 'fed' ? '#2E7D32' : '#C0392B'};">${feedStatus === 'fed' ? '已餵食' : '未餵食'}</div>
        ${countdownHtml}
        <button id="coop-feed-btn" data-action="feed" style="width:100%;padding:8px 16px;background:${feedBtnDisabled?'#ccc':'#6DB33F'};color:${feedBtnDisabled?'#999':'#fff'};border:3px solid ${feedBtnDisabled?'#999':'#4A7C2F'};border-radius:6px;font-size:14px;font-weight:700;cursor:${feedBtnDisabled?'not-allowed':'pointer'};font-family:'Cubic 11',sans-serif;margin-top:6px;margin-bottom:6px;">${feedBtnLabel}</button>
        <div style="font-size:13px;color:#7A6A59;margin-bottom:6px;">可收雞蛋:<strong id="coop-egg-count">${eggCount}</strong> 顆</div>
        <button id="coop-collect-eggs-btn" data-action="collect-eggs" style="width:100%;padding:8px 16px;background:${eggCount>0?'#E8A020':'#ccc'};color:${eggCount>0?'#3B2412':'#999'};border:3px solid ${eggCount>0?'#5A3418':'#999'};border-radius:6px;font-size:14px;font-weight:700;cursor:${eggCount>0?'pointer':'not-allowed'};font-family:'Cubic 11',sans-serif;margin-bottom:8px;">收雞蛋</button>
      </div>`;
  }

  private openChickenCoopPanel() {
    // 避免重複開啟
    if (this._coopPanelEl) return;

    // ── 讀取雞舍狀態 ──
    const savedRaw = localStorage.getItem('tlo_farm_chicken_coop');
    let animalCount = 0;
    let babyCount = 0;
    let adultCount = 0;
    let capacity = 4;
    let feedStatus: 'none' | 'fed' = 'none';
    let lastFedAt: number | null = null;
    let eggCount = 0;
    let animals: any[] = [];

    if (savedRaw) {
      try {
        const savedData = JSON.parse(savedRaw);
        animals = savedData.animals ?? [];
        animalCount = animals.length;
        babyCount = animals.filter((a: any) => a.stage === 'baby').length;
        adultCount = animals.filter((a: any) => a.stage === 'adult').length;
        capacity = savedData.capacity ?? 4;
        feedStatus = savedData.feedingStatus === 'fed' ? 'fed' : 'none';
        lastFedAt = savedData.lastFedAt ?? null;
        eggCount = savedData.eggCount ?? 0;
      } catch(e) {}
    }

    // 背景遮罩
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 9998;
      background: rgba(0,0,0,0.3);
    `;
    backdrop.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); this.closeChickenCoopPanel(); });
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
    `;
    panel.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
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

    // ── 計時器邏輯（每 tick 都呼叫 this.refreshCoopPanelStatus）──
    const BABY_GROW_MS = 10 * 60 * 1000;
    const ADULT_EGG_MS = 15 * 60 * 1000;

    const processCoopTimer = () => {
      const raw = localStorage.getItem('tlo_farm_chicken_coop');
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        if (data.feedingStatus !== 'fed' || !data.lastFedAt) return;
        const elapsed = Date.now() - data.lastFedAt;
        const animals: any[] = data.animals ?? [];
        const babyCount = animals.filter((a: any) => a.stage === 'baby').length;
        const adultCount = animals.filter((a: any) => a.stage === 'adult').length;

        if (babyCount > 0 && elapsed >= BABY_GROW_MS) {
          data.animals.forEach((a: any) => { if (a.stage === 'baby') a.stage = 'adult'; });
          data.feedingStatus = 'none';
          data.lastFedAt = null;
          localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify(data));
          this.renderChicksInCoop();
          this.refreshCoopPanelStatus(panel);
          return;
        }
        if (adultCount > 0 && elapsed >= ADULT_EGG_MS) {
          data.eggCount = (data.eggCount ?? 0) + adultCount;
          data.feedingStatus = 'none';
          data.lastFedAt = null;
          localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify(data));
          this.refreshCoopPanelStatus(panel);
          return;
        }
        this.refreshCoopPanelStatus(panel);
      } catch(e) {}
    };

    const startCountdownLoop = () => {
      this._coopCountdownInterval = window.setInterval(() => {
        processCoopTimer();
      }, 1000);
    };

    // ── 首次建立面板：讀狀態、render、binding──
    const initPanel = () => {
      const raw = localStorage.getItem('tlo_farm_chicken_coop');
      if (!raw) return;
      const data = JSON.parse(raw);
      const animals = data.animals ?? [];
      const animalCount = animals.length;
      const babyCount = animals.filter((a: any) => a.stage === 'baby').length;
      const adultCount = animals.filter((a: any) => a.stage === 'adult').length;
      const feedStatus = data.feedingStatus === 'fed' ? 'fed' : 'none';
      const lastFedAt = data.lastFedAt ?? null;
      const eggCount = data.eggCount ?? 0;
      const capacity = data.capacity ?? 4;
      statusContainer.innerHTML = this.buildCoopStatusHtml({ animalCount, babyCount, adultCount, feedStatus, lastFedAt, eggCount, capacity });
      this.bindChickenCoopPanelEvents(panel);
    };
    initPanel();
    startCountdownLoop();
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
  }

  // ── Phase5: 取得雞舍內可活動區域(小雞走路範圍)──
  private getChickenCoopWalkArea() {
    if (!this.chickenCoopSprite) return null;
    const coopX = this.chickenCoopSprite.x;
    const coopY = this.chickenCoopSprite.y;
    return {
      x: coopX + 95,
      y: coopY + 145,
      width: 120,
      height: 80,
    };
  }

  // ── Phase5: 小雞在雞舍內隨機移動(Tween)──
  private startChickMovement(chick: Phaser.GameObjects.Image, area: { x: number; y: number; width: number; height: number }) {
    const move = () => {
      if (!chick.active) return;
      const randomX = Math.max(area.x, Math.min(area.x + area.width, area.x + Math.random() * area.width));
      const randomY = Math.max(area.y, Math.min(area.y + area.height, area.y + Math.random() * area.height));
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
  private renderChicksInCoop() {
    if (!this.chickenCoopSprite) return;

    const raw = localStorage.getItem('tlo_farm_chicken_coop');
    const coop = raw ? JSON.parse(raw) : null;
    const animals = coop?.animals ?? [];

    this._chickSprites?.forEach(sprite => sprite.destroy());
    this._chickSprites = [];

    const area = this.getChickenCoopWalkArea();
    if (!area) return;

    // 小雞在 walkArea 內分散站位
    const positions = [
      { x: area.x + 25, y: area.y + 25 },
      { x: area.x + 65, y: area.y + 35 },
      { x: area.x + 95, y: area.y + 25 },
      { x: area.x + 55, y: area.y + 65 },
    ];

    animals.slice(0, 4).forEach((animal: { id: string; type: string; stage: string }, index: number) => {
      const pos = positions[index];
      if (!pos) return;

      // 成雞用成年圖,小雞用小雞圖
      const spriteKey = animal.stage === 'adult' ? 'chicken_adult' : 'chick_baby';
      const displaySize = animal.stage === 'adult' ? 40 : 30;

      const chick = this.add.image(pos.x, pos.y, spriteKey);
      chick.setOrigin(0.5, 1);
      chick.setDisplaySize(displaySize, displaySize);
      chick.setDepth(5050 + chick.y);

      this._chickSprites.push(chick);

      // 啟動小範圍隨機移動(2~4 秒一次)
      this.startChickMovement(chick, area);
    });

    if (DEBUG_COOP) console.log('[RENDER CHICKS IN COOP]', { count: animals.length });
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

  // ── 關閉雞舍管理面板 ──
  private closeChickenCoopPanel() {
    console.log('[CLOSE PANEL EXECUTE]');
    // 清除倒數計時器
    if (this._coopCountdownInterval !== null) {
      clearInterval(this._coopCountdownInterval);
      this._coopCountdownInterval = null;
    }
    this._coopListenersInitialized = false;
    if (this._coopPanelEl) {
      this._coopPanelEl.remove();
      this._coopPanelEl = undefined;
    }
    if (this._coopBackdropEl) {
      this._coopBackdropEl.remove();
      this._coopBackdropEl = undefined;
    }
  }

  // ── 共用 API 放置處理(DOM click 與 Phaser pointerdown 共用)──
  private handleCoopPlacementApi() {
    const x = this.currentPlacementX;
    const y = this.currentPlacementY;
    const tileX = Math.floor(x / this.FARM_SIZE);
    const tileY = Math.floor(y / this.FARM_SIZE);

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
  // 農作物 hover tooltip
  // ============================================================
  private showCropTooltip(index: number) {
    const state = this.farmState.get(index);
    const cropName = state?.cropId
      ? (getCropDetails(state.cropId)?.nameZhTw ?? '作物')
      : '空農地';

    this.hideCropTooltip();

    const container = this.add.container(0, 0);
    container.setDepth(9999);

    // Tooltip 尺寸
    const paddingX = 14;
    const paddingY = 8;
    const lineHeight = 22;
    const fontSize = 15;

    // 建立文字（先用同樣樣式測量）
    const measureText = this.add.text(0, 0, cropName, {
      fontFamily: '"Cubic 11", "俐方體11號", monospace',
      fontSize: `${fontSize}px`,
      color: '#3d2010',
    });
    const textWidth = measureText.width;
    const textHeight = measureText.height;
    measureText.destroy();

    const bw = textWidth + paddingX * 2;
    const bh = textHeight + paddingY * 2;

    // 奶油色背景 + 深咖啡色框
    const bg = this.add.graphics();
    bg.fillStyle(0xfff8dc, 1);      // 奶油色 #fff8dc
    bg.fillRoundedRect(0, 0, bw, bh, 4);
    bg.lineStyle(2, 0x5c3d2e, 1);   // 深咖啡色 #5c3d2e
    bg.strokeRoundedRect(0, 0, bw, bh, 4);

    const label = this.add.text(paddingX, paddingY, cropName, {
      fontFamily: '"Cubic 11", "俐方體11號", monospace',
      fontSize: `${fontSize}px`,
      color: '#3d2010',
    });

    container.add([bg, label]);
    container.setPosition(99999, 99999); // 先藏起來，等 pointermove
    this.cropTooltip = container;

    // 立即跟著目前指標位置
    const ptr = this.input.activePointer;
    if (ptr) {
      this.moveCropTooltip(ptr);
    }
  }

  private moveCropTooltip(pointer: Phaser.Input.Pointer) {
    if (!this.cropTooltip) return;
    const x = pointer.x + 18;
    const y = pointer.y - 50;
    // 簡單超界檢查
    if (x + 150 > this.scale.width) {
      this.cropTooltip.setX(pointer.x - 150);
    } else {
      this.cropTooltip.setX(x);
    }
    if (y < 10) {
      this.cropTooltip.setY(pointer.y + 20);
    } else {
      this.cropTooltip.setY(y);
    }
  }

  private hideCropTooltip() {
    if (this.cropTooltip) {
      this.cropTooltip.destroy();
      this.cropTooltip = null;
    }
  }

  // ============================================================
  // Lv8 解鎖額外兩塊農地（plot6, plot7）
  // ============================================================
  // 等級 8 解鎖時，按下 LevelUpModal 確認後呼叫此方法建立額外農地
  private createExtraFarms() {
    const COLS = 3;
    for (let i = 6; i <= 7; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const px = this.farmStartX + col * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;
      const py = this.farmStartY + row * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;

      const farmContainer = this.add.container(px, py);
      farmContainer.setSize(this.FARM_SIZE, this.FARM_SIZE);
      farmContainer.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, this.FARM_SIZE, this.FARM_SIZE),
        Phaser.Geom.Rectangle.Contains
      );
      farmContainer.setData('index', i);

      const soilImg = this.add.image(0, 0, 'tile_soil');
      soilImg.setDisplaySize(this.FARM_SIZE, this.FARM_SIZE);
      soilImg.setOrigin(0.5, 0.5);
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
      farmContainer.on('pointerover', () => this.showCropTooltip(i));
      farmContainer.on('pointermove', (pointer: Phaser.Input.Pointer) => this.moveCropTooltip(pointer));
      farmContainer.on('pointerout', () => this.hideCropTooltip());

      this.tiles.set(`${i}`, farmContainer);
      this.farmlandObjects.push(farmContainer);
    }
    this.events.emit('game-toast', '新增農地 plot6、plot7！');
  }

  // ============================================================
  // 清除所有彈窗
  // ============================================================
  private clearAllPopups() {
    this.hideCropTooltip();
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

      const computedState = this.recalcState(state.cropId, state.finishAt, state.wateredAt, state.state);

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
