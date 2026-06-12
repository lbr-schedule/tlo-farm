import Phaser from 'phaser';
import { backpackSystem } from '../systems/BackpackSystem';
import { authFetch } from '../utils/api';

export interface TileData {
  x: number;
  y: number;
  type: 'grass' | 'soil' | 'path' | 'tree';
  cropId?: number;
  plantedAt?: number;
  finishAt?: number;
  wateredAt?: number;       // 上次澆水時間（ms）
  isWatered: boolean;       // 是否在 30 分鐘內澆過水
  cropStatus: 'healthy' | 'needs_water';  // MVP 暫時只有這兩種
  state: 'empty' | 'seed' | 'seedling' | 'growing' | 'mature'; // 來自後端（兼容用）
  cropState: 'empty' | 'seed' | 'seedling' | 'growing' | 'mature'; // 計算後（mature 優先）
  soilState: 'dry' | 'watered'; // 土地視覺狀態
  readyAnimated?: boolean;
  growingStartedAt?: number;
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
export type GrowthStage = 'seed' | 'seedling' | 'growing' | 'mature';

// 作物代號映射（用於 sprite key）
export const CROP_SPRITES: Record<string, Record<GrowthStage, string>> = {
  wheat: {
    seed: 'crop_wheat_seedling',
    seedling: 'crop_wheat_seedling',
    growing: 'crop_wheat_growing',
    mature: 'crop_wheat_mature',
  },
  corn: {
    seed: 'crop_corn_seedling',
    seedling: 'crop_corn_seedling',
    growing: 'crop_corn_growing',
    mature: 'crop_corn_mature',
  },
  carrot: {
    seed: 'crop_carrot_seedling',
    seedling: 'crop_carrot_seedling',
    growing: 'crop_carrot_growing',
    mature: 'crop_carrot_mature',
  },
  potato: {
    seed: 'crop_potato_seedling',
    seedling: 'crop_potato_seedling',
    growing: 'crop_potato_growing',
    mature: 'crop_potato_mature',
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

// 作物詳細資料（客戶端快取）
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
  private seedPopup: Phaser.GameObjects.Container | null = null;
  private seedPopupOverlay: Phaser.GameObjects.Graphics | null = null;
  private _frameCount: number = 0;
  private FARM_SIZE = 180;
  private FARM_GAP = 24;
  private CANVAS_W = 0;
  private CANVAS_H = 0;

  // ── 澆水有效期：30 分鐘 ──
  private WATER_INTERVAL_MS = 30 * 60 * 1000;

  // ── 根據 wateredAt 計算澆水狀態 ──
  private calcWaterStatus(wateredAt: number | undefined): { isWatered: boolean; cropStatus: 'healthy' | 'needs_water' } {
    if (!wateredAt) return { isWatered: false, cropStatus: 'needs_water' };
    const elapsed = Date.now() - wateredAt;
    if (elapsed <= this.WATER_INTERVAL_MS) return { isWatered: true, cropStatus: 'healthy' };
    return { isWatered: false, cropStatus: 'needs_water' };
  }

  // ── 計算生長速度倍率（根據澆水狀態）──
  // 已澆水：1x，未澆水：0.5x（MVP 規則）
  private getGrowthSpeedMultiplier(wateredAt: number | undefined): number {
    return this.calcWaterStatus(wateredAt).isWatered ? 1.0 : 0.5;
  }

  // ── 計算作物狀態（mature 優先級最高）──
  // 規則：只要 cropId 有值且時間到了就是 mature，不看其他狀態
  private computeCropState(cropId: number | undefined, finishAt: number | undefined, serverState: string): TileData['cropState'] {
    if (!cropId || !finishAt) return 'empty';
    if (Date.now() >= finishAt) return 'mature';
    // 時間還沒到，用 serverState 或從 progress 推算
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

  constructor() {
    super({ key: 'FarmScene' });
  }

  preload() {
    this.load.image('grass_bg', '/assets/tile/草地.png');
    this.load.image('tile_soil', '/assets/tile/農地_初始狀態_32x32.png');
    this.load.image('tile_soil_wet', '/assets/tile/農地_澆水狀態_32x32.png');
    this.load.image('crop_wheat_mature', '/assets/crops/小麥成熟.png');
    this.load.image('crop_wheat_growing', '/assets/crops/小麥成長中.png');
    this.load.image('crop_wheat_seedling', '/assets/crops/小麥幼苗.png');
    this.load.image('crop_corn_mature', '/assets/crops/玉米成熟.png');
    this.load.image('crop_corn_growing', '/assets/crops/玉米成長中.png');
    this.load.image('crop_corn_seedling', '/assets/crops/玉米幼苗.png');
    this.load.image('crop_carrot_mature', '/assets/crops/紅蘿蔔成熟.png');
    this.load.image('crop_carrot_growing', '/assets/crops/紅蘿蔔成長中.png');
    this.load.image('crop_carrot_seedling', '/assets/crops/紅蘿蔔幼苗.png');
    this.load.image('crop_potato_mature', '/assets/crops/馬鈴薯成熟.png');
    this.load.image('crop_potato_growing', '/assets/crops/馬鈴薯成長中.png');
    this.load.image('crop_potato_seedling', '/assets/crops/馬鈴薯幼苗.png');
    this.load.image('icon_seed', '/assets/icon/icon_seed.png.png');
    this.load.image('icon_watering', '/assets/icon/icon_watering.png.png');
    this.load.image('icon_fertilizer', '/assets/icon/icon_fertilizer.png.png');
    this.load.image('icon_harvest', '/assets/icon/icon_harvest.png.png');
  }

  create() {
    const parent = this.sys.game.canvas.parentElement;
    if (parent) {
      this.CANVAS_W = parent.clientWidth;
      this.CANVAS_H = parent.clientHeight;
    } else {
      this.CANVAS_W = this.sys.game.canvas.width;
      this.CANVAS_H = this.sys.game.canvas.height;
    }

    const grassImg = this.add.image(0, 0, 'grass_bg');
    grassImg.setDisplaySize(this.CANVAS_W, this.CANVAS_H);
    grassImg.setOrigin(0, 0);

    const COLS = 3;
    const ROWS = 2;
    const totalFarmW = COLS * this.FARM_SIZE + (COLS - 1) * this.FARM_GAP;
    const totalFarmH = ROWS * this.FARM_SIZE + (ROWS - 1) * this.FARM_GAP;
    const availableH = this.CANVAS_H - 160;
    const farmStartX = (this.CANVAS_W - totalFarmW) / 2;
    const farmStartY = (availableH - totalFarmH) / 2 + 160;

    //全部初始化為空（無硬編碼假資料）
    for (let i = 0; i < 6; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const px = farmStartX + col * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;
      const py = farmStartY + row * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;

      const farmContainer = this.add.container(px, py);
      farmContainer.setData('index', i);

      const soilImg = this.add.image(0, 0, 'tile_soil');
      soilImg.setDisplaySize(this.FARM_SIZE, this.FARM_SIZE);
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

      soilImg.setInteractive();
      soilImg.on('pointerdown', () => this.onFarmClick(i, px, py));

      this.tiles.set(`${i}`, farmContainer);
    }

    this.loadCropDetails();
    backpackSystem.fetchAll();
    this.syncFarmState();

    this.input.keyboard?.on('keydown-ESC', () => {
      this.clearAllPopups();
    });
  }

  // ============================================================
  // 載入作物詳細資料（公開 API）
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
        console.log('[FarmScene] 已載入', cropDetailsCache.length, '種作物資料');
      }
    } catch (err) {
      console.warn('[FarmScene] 載入作物資料失敗', err);
    }
  }

  // ============================================================
  // 從伺服器同步農場狀態
  // ============================================================
  // ── 用 finishAt + 生長速度重新計算 client-side state（不受後端 state 欺騙）──
  // 未澆水時，生長速度 0.5x，effective finish 往後推
  private recalcState(cropId: number | null, finishAt: number | null, wateredAt: number | undefined, serverState: string): 'empty' | 'growing' | 'mature' | 'seed' | 'seedling' {
    if (!cropId || !finishAt) return 'empty';
    const speed = this.getGrowthSpeedMultiplier(wateredAt);
    const now = Date.now();
    if (speed >= 1.0) {
      if (now >= finishAt) return 'mature';
      return 'growing';
    } else {
      // 未澆水：0.5x 速度 → effective finish = finishAt + (growTime * 0.5)
      // 進度落後一半，所以完成時間要往後推
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
      console.log('[FarmScene] farm status from API:', JSON.stringify(data, null, 2));

      if (data.success && data.tiles) {
        for (const tile of data.tiles) {
          const index = tile.y * 3 + tile.x;
          if (this.farmState.has(index)) {
            const existing = this.farmState.get(index)!;
            // ── 用 finishAt 重新計算 state，不完全相信後端 ──
            const computedState = this.recalcState(tile.cropId, tile.finishAt, tile.wateredAt, tile.state);
            const { isWatered, cropStatus } = this.calcWaterStatus(tile.wateredAt);
            const cropState = this.computeCropState(tile.cropId, tile.finishAt, tile.state);
            const soilState = this.computeSoilState(tile.wateredAt);
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
            });
            console.log(`[FarmScene] create farmland: index=${index} x=${tile.x} y=${tile.y} serverState=${tile.state} computedState=${computedState} isWatered=${isWatered}`);
            this.updateFarmTileVisual(index);
            this.renderFarmland(index);
          }
        }
      }
    } catch (err) {
      console.warn('[FarmScene] 同步農場狀態失敗', err);
    }
  }

  // ============================================================
  // 渲染農地土地貼圖（根據 soilState）- 只管土地，不碰作物
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
  // 渲染作物圖（根據當前 cropState 和時間重新計算階段）
  // soilState 不影響是否顯示作物
  // ============================================================
  private renderCrop(index: number) {
    const container = this.tiles.get(`${index}`);
    if (!container) return;
    const state = this.farmState.get(index);
    if (!state) return;

    // 移除舊作物圖
    const toRemove: Phaser.GameObjects.GameObject[] = [];
    container.each((child) => {
      if (child instanceof Phaser.GameObjects.Image && child.texture.key.startsWith('crop_')) {
        toRemove.push(child);
      }
    });
    toRemove.forEach((c) => c.destroy());

    // 無作物或空地：不加載新作物
    if (!state.cropId || state.cropState === 'empty') return;

    const cropKey = CROP_ID_TO_KEY[state.cropId];
    if (!cropKey) return;

    const stage = this.getGrowthStage(state);
    const spriteKey = CROP_SPRITES[cropKey]?.[stage] || CROP_SPRITES[cropKey]?.mature;
    if (spriteKey) {
      const cropImg = this.add.image(0, 0, spriteKey);
      cropImg.setDisplaySize(100, 100);
      container.add(cropImg);
    }
  }

  // ============================================================
  // 更新農地視覺
  // ============================================================
  // 更新農地視覺（作物部分）- 委託 renderCrop
  // ============================================================
  private updateFarmTileVisual(index: number) {
    this.renderCrop(index);
  }

  // ============================================================
  // 計算生長階段
  // ============================================================
  private getGrowthStage(state: TileData): GrowthStage {
    if (!state.plantedAt || !state.finishAt) return 'seed';
    const now = Date.now();
    const total = state.finishAt - state.plantedAt;
    const elapsed = now - state.plantedAt;
    const progress = Math.min(1, Math.max(0, elapsed / total));
    if (progress < 0.25) return 'seed';
    if (progress < 0.5) return 'seedling';
    if (progress < 1) return 'growing';
    return 'mature';
  }

  // ============================================================
  // 點擊農地 - 核心分發
  // ============================================================
  private onFarmClick(index: number, x: number, y: number) {
    if (!this.farmInputEnabled) {
      console.log('[FarmScene] click blocked by modal');
      return;
    }

    const state = this.farmState.get(index);
    if (!state) return;


    console.log(`[DEBUG TILE]`, {
      index,
      state: state.state,
      cropId: state.cropId,
      plantedAt: state.plantedAt,
      finishAt: state.finishAt,
      isWatered: state.isWatered,
      cropState: state.cropState,
      soilState: state.soilState,
    });

    // 清除舊選單
    this.clearAllPopups();

    // ── 狀態分支（用 cropState）──
    if (state.cropState === 'empty') {
      // 空地 →顯示播種選單
      console.log('[FarmScene] → 顯示播種選單');
      this.showSeedPopup(index, x, y - this.FARM_SIZE / 2 - 10);
      return;
    }

    if (state.cropState === 'mature') {
      // 成熟 → 直接收成
      console.log('[FarmScene] → 呼叫 harvestCrop (cropState=mature)');
      this.harvestCrop(index);
      return;
    }

    // 成長中 → 顯示操作選單（澆水/施肥）
    console.log('[FarmScene] → 顯示操作選單 (cropState=', state.cropState, ')');
    this.showActionMenu(index, x, y - this.FARM_SIZE / 2 - 10, state);
  }

  // ============================================================
  // 顯示播種視窗（SeedSelectModal）- MVP 固定置中版
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

    // ── 只顯示前4種作物：小麥、玉米、紅蘿蔔、馬鈴薯 ──
    const displayCrops = cropDetailsCache.slice(0, 4);
    if (displayCrops.length === 0) return;

    // ── 固定尺寸：280x300，置中顯示 ──
    const POPUP_W = 280;
    const POPUP_H = 300;
    const ROW_H = 52;
    const LIST_Y = 64;

    const canvasWidth = this.scale.width;
    const canvasHeight = this.scale.height;

    const popupX = canvasWidth / 2 - POPUP_W / 2;
    const popupY = canvasHeight / 2 - POPUP_H / 2;

    // ── 背景遮罩（點擊關閉）──
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

    // ── 作物清單（只渲染4筆）──
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

      // 種子名稱（左側）
      const nameText = this.add.text(20, rowY + ROW_H / 2, crop.nameZhTw, {
        fontSize: '14px',
        fontFamily: "'Cubic 11', sans-serif",
        color: disabled ? '#888888' : '#FFFFFF',
      });
      nameText.setOrigin(0, 0.5);
      nameText.setAlpha(alpha);
      this.seedPopup.add(nameText);

      // 數量（右側）
      const amountText = this.add.text(POPUP_W - 20, rowY + ROW_H / 2, `x${amount}`, {
        fontSize: '14px',
        fontFamily: "'Cubic 11', sans-serif",
        color: disabled ? '#666666' : '#FFD700',
        fontStyle: 'bold',
      });
      amountText.setOrigin(1, 0.5);
      amountText.setAlpha(alpha);
      this.seedPopup.add(amountText);

      // 成長時間（下方小字）
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

      // ── 點擊區域（數量 > 0 才能點擊）──
      if (disabled) return;

      const hitArea = this.add.graphics();
      hitArea.fillStyle(0x000000, 0);
      hitArea.fillRoundedRect(10, rowY, POPUP_W - 20, ROW_H - 6, 6);
      hitArea.setInteractive(
        new Phaser.Geom.Rectangle(10, rowY, POPUP_W - 20, ROW_H - 6),
        Phaser.Geom.Rectangle.Contains
      );
      hitArea.on('pointerdown', () => {
        console.log(`[FarmScene] 選擇種子播種: cropId=${crop.id} index=${index}`);
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
  // 播種（含樂觀更新）
  // ============================================================
  private async plantCrop(index: number, cropId: number) {
    const state = this.farmState.get(index);
    if (!state) return;
    if (state.cropState !== 'empty') {
      console.warn('[FarmScene] 播種失敗：農地不是空的', state.cropState);
      return;
    }

    console.log(`[FarmScene] plantCrop index=${index} cropId=${cropId}`);

    // ── 樂觀更新：立即顯示幼苗 ──
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
      cropStatus: 'needs_water',
      state: 'seedling',
      cropState: 'seedling',
      soilState: 'dry',
    });


    //立即更新視覺（馬上顯示幼苗）
    this.updateFarmTileVisual(index);
    this.showProgressBar(index);

    // 扣除背包（本地）
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
        this.farmState.set(index, {
          ...state,
          cropId,
          plantedAt: data.tile.plantedAt,
          finishAt: data.tile.finishAt,
          wateredAt: undefined,
          isWatered: false,
          cropStatus: 'needs_water',
          state: 'growing',
          cropState: 'growing',
          soilState: 'dry',
        });
        this.events.emit('goldChanged', data.user.gold);
        this.events.emit('userUpdated', data.user);
        console.log(`[FarmScene] 播種成功！`);
      } else {
        console.warn('[FarmScene] 播種失敗:', data.message);
        // 回滾
        this.farmState.set(index, { ...state, state: 'empty', cropState: 'empty', soilState: 'dry' });
        this.updateFarmTileVisual(index);
        this.hideProgressBar(index);
      }
    } catch (err) {
      console.error('[FarmScene] 播種錯誤', err);
    }
  }

  // ============================================================
  // 顯示進度條 + 計時器
  // ============================================================
  private showProgressBar(index: number) {
    this.hideProgressBar(index);

    const container = this.tiles.get(`${index}`);
    if (!container) return;

    const BAR_W = 70;
    const BAR_H = 6;
    const BAR_Y = -this.FARM_SIZE / 2 - 14;

    const uiContainer = this.add.container(0, 0);
    uiContainer.setDepth(50);
    container.add(uiContainer);
    this.progressBars.set(index, uiContainer);

    const barBg = this.add.graphics();
    barBg.fillStyle(0x333333, 0.8);
    barBg.fillRoundedRect(-BAR_W / 2, BAR_Y, BAR_W, BAR_H, 3);
    uiContainer.add(barBg);

    const timerText = this.add.text(0, BAR_Y - 12, '00:00', {
      fontSize: '11px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    timerText.setOrigin(0.5, 1);
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
    const speed = this.getGrowthSpeedMultiplier(state.wateredAt);
    const total = state.finishAt - state.plantedAt;
    const elapsed = now - state.plantedAt;
    // 考慮生長速度的有效進度
    const effectiveProgress = Math.min(1, Math.max(0, (elapsed * speed) / total));

    if (effectiveProgress >= 1) {
      this.hideProgressBar(index);
      this.showMatureIndicator(index);
      return;
    }

    const BAR_W = 70;
    const BAR_H = 6;
    const BAR_Y = -this.FARM_SIZE / 2 - 14;

    // 考慮速度的剩餘時間
    const remainingMs = Math.max(0, total - elapsed * speed);
    const remainingSec = remainingMs / 1000;

    const timerText = (uiContainer as any)._timerText as Phaser.GameObjects.Text;
    if (timerText) {
      timerText.setText(formatTime(remainingSec));
      timerText.setColor(speed < 1 ? '#8B4513' : '#FFFFFF');
    }

    const barFill = (uiContainer as any)._barFill as Phaser.GameObjects.Graphics;
    if (barFill) {
      barFill.clear();
      const fillW = Math.round(BAR_W * effectiveProgress);
      const color = speed < 1 ? 0xFF6B6B : (effectiveProgress < 0.5 ? 0xFFDD00 : 0x00DD44);
      barFill.fillStyle(color, 1);
      barFill.fillRoundedRect(-BAR_W / 2, BAR_Y, fillW, BAR_H, 3);
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

    const state = this.farmState.get(index);
    console.log(`[DEBUG TILE] showMatureIndicator`, {
      index,
      state: state?.state,
      cropId: state?.cropId,
      cropState: state?.cropState,
      soilState: state?.soilState,
    });

    const indicator = this.add.container(0, -this.FARM_SIZE / 2 - 20);
    indicator.setDepth(60);
    container.add(indicator);
    this.matureIndicators.set(index, indicator);

    const sparkles = this.add.text(0, 0, '可收成', {
      fontSize: '13px',
      fontFamily: "'Cubic 11', sans-serif",
      color: '#FFD700',
      fontStyle: 'bold',
    });
    sparkles.setOrigin(0.5, 0.5);
    indicator.add(sparkles);


    // ── 讓整個 indicator 可點擊，點了直接收成 ──
    indicator.setInteractive(
      new Phaser.Geom.Rectangle(-40, -12, 80, 24),
      Phaser.Geom.Rectangle.Contains
    );
    indicator.on('pointerdown', (e: any) => {
      e.stopPropagation?.();
      console.log(`[FarmScene] 點擊可收成標示，直接收成 index=${index}`);
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
  // 收成（安全：只允許 cropState === 'mature'）
  // ============================================================
  private async harvestCrop(index: number) {
    const state = this.farmState.get(index);
    if (!state) return;

    console.log(`[DEBUG TILE] harvestCrop`, {
      index,
      state: state.state,
      cropId: state.cropId,
      cropState: state.cropState,
      soilState: state.soilState,
    });

    // ── 安全檢查：只用 cropState 判斷是否成熟 ──
    if (state.cropState !== 'mature') {
      console.warn(`[FarmScene] blocked harvest: cropState=${state.cropState}`);
      return;
    }
    if (!state.cropId) {
      console.warn(`[FarmScene] blocked harvest: no cropId`);
      return;
    }

    console.log(`[FarmScene] harvestCrop index=${index}`);


    // ── Optimistic Update：立即清除 UI ──
    this.clearAllPopups();
    this.hideMatureIndicator(index);
    this.hideProgressBar(index);

    // ── 先更新狀態（這樣 updateFarmTileVisual 不會重新加載作物）──
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
        // 刷新背包（收成作物進背包）
        backpackSystem.fetchAll();
        // userUpdated 包含 gold/exp/level，harvest 包含 cropName 和 earned 值
        this.events.emit('userUpdated', data.user);
        this.events.emit('harvest', {
          gold: data.harvest.goldEarned,
          exp: data.harvest.expEarned,
          cropName: data.harvest.cropName,
        });
      } else {
        console.warn('[FarmScene] 收成失敗，回滾:', data.message);
        // API 失敗：重新讀取農場狀態
        this.syncFarmState();
      }
    } catch (err) {
      console.error('[FarmScene] 收成錯誤，回滾:', err);
      this.syncFarmState();
    }
  }

  // ============================================================
  // 澆水
  // ============================================================
  private async waterCrop(index: number) {
    const state = this.farmState.get(index);
    if (!state) return;
    if (state.cropState !== 'growing' && state.cropState !== 'seedling' && state.cropState !== 'seed') {
      console.warn('[FarmScene] 澆水失敗：狀態不正確', state.state);
      return;
    }

    console.log('[FarmScene] watered farmland', index);

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

    // ── 更新澆水狀態（客戶端樂觀更新）──
    const wateredAt = Date.now();
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
        console.log('[FarmScene] 澆水成功！');
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
  // 顯示操作選單（根據狀態動態生成按鈕）
  // ============================================================
  private showActionMenu(index: number, x: number, y: number, state: TileData) {
    if (this.actionMenu) {
      this.actionMenu.destroy();
      this.actionMenu = null;
    }

    // 根據狀態決定顯示哪些按鈕
    const actions: { label: string; icon: string; action: string }[] = [];

    if (state.cropState === 'seed' || state.cropState === 'seedling' || state.cropState === 'growing') {
      actions.push({ label: '澆水', icon: 'icon_watering', action: 'water' });
      actions.push({ label: '施肥', icon: 'icon_fertilizer', action: 'fertilize' });
    }

    if (state.cropState === 'mature') {
      actions.push({ label: '收成', icon: 'icon_harvest', action: 'harvest' });
    }

    if (actions.length === 0) return;

    const btnCount = actions.length;
    const btnW = 56;
    const btnH = 56;
    const menuW = btnCount * btnW + (btnCount + 1) * 10;
    const menuH = 90;

    this.actionMenu = this.add.container(x - menuW / 2, y - menuH);
    this.actionMenu.setDepth(200);

    const menuBg = this.add.graphics();
    menuBg.fillStyle(0x3d2518, 0.9);
    menuBg.fillRoundedRect(0, 0, menuW, menuH, 8);
    menuBg.lineStyle(2, 0x8B4513, 1);
    menuBg.strokeRoundedRect(0, 0, menuW, menuH, 8);
    this.actionMenu.add(menuBg);

    actions.forEach((btn, i) => {
      const btnX = 10 + i * (btnW + 10);
      const btnY = (menuH - btnH) / 2;

      const btnContainer = this.add.container(btnX, btnY);
      btnContainer.setDepth(201);

      const btnBg = this.add.graphics();
      btnBg.fillStyle(0x8B4513, 1);
      btnBg.fillRoundedRect(0, 0, btnW, btnH, 6);
      btnContainer.add(btnBg);

      const iconImg = this.add.image(btnW / 2, btnH / 2 - 6, btn.icon);
      iconImg.setDisplaySize(36, 36);
      btnContainer.add(iconImg);

      const btnText = this.add.text(btnW / 2, btnH - 8, btn.label, {
        fontSize: '12px',
        fontFamily: "'Cubic 11', sans-serif",
        color: '#FFFFFF',
        fontStyle: 'bold',
      });
      btnText.setOrigin(0.5, 1);
      btnContainer.add(btnText);

      btnContainer.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, btnW, btnH),
        Phaser.Geom.Rectangle.Contains
      );
      btnContainer.on('pointerdown', (e: any) => {
        e.stopPropagation?.();
        console.log(`[FarmScene] action: ${btn.action} on farmland ${index}`);
        this.clearAllPopups();
        if (btn.action === 'water') this.waterCrop(index);
        else if (btn.action === 'harvest') this.harvestCrop(index);
        // fertilize 暫時沒實作
      });

      this.actionMenu!.add(btnContainer);
    });
  }

  // ============================================================
  // 清除所有彈窗
  // ============================================================
  private clearAllPopups() {
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
    // 3. 清除背景遮罩（必須在 seedPopup 之前）
    if (this.seedPopupOverlay) { this.seedPopupOverlay.destroy(); this.seedPopupOverlay = null; }
    // 4. 清除種子視窗
    if (this.seedPopup) { this.seedPopup.destroy(); this.seedPopup = null; }
  }

  setSelectedSeed(cropId: number | null) {
    this.selectedSeed = cropId;
    if (cropId === null) this.clearAllPopups();
  }

  // ── 外部控制輸入啟用/停用（Modal 開啟時調用）──
  setInputEnabled(enabled: boolean) {
    this.input.enabled = enabled;
  }

  setFarmInputEnabled(enabled: boolean) {
    this.farmInputEnabled = enabled;
    this.input.enabled = enabled;
    console.log('[FarmScene] input enabled =', enabled);
  }

  // ============================================================
  // update：每幀更新進度條
  // ============================================================
  update() {
    this._frameCount++;
    if (this._frameCount % 30 !== 0) return;

    // ── 每30幀檢查一次 ──
    this.farmState.forEach((state, index) => {
      // ── 空地或無 cropId：清除所有殘留 UI ──
      if (!state.cropId || state.cropState === 'empty') {
        this.hideMatureIndicator(index);
        this.hideProgressBar(index);
        return;
      }

      if (!state.finishAt) return;

      const computedState = this.recalcState(state.cropId, state.finishAt, state.wateredAt, state.state);

      // ── 剛成熟的：更新 cropState + 顯示可收成標示 ──
      if (computedState === 'mature' && state.cropState !== 'mature') {
        this.farmState.set(index, {
          ...state,
          state: 'mature',
          cropState: 'mature',
        });
        this.updateFarmTileVisual(index);
        this.showMatureIndicator(index);
        this.hideProgressBar(index);
        if (this.actionMenu) { this.actionMenu.destroy(); this.actionMenu = null; }
        console.log(`[FarmScene] 作物成熟！index=${index}`);
        return;
      }

      // ── 成長中：顯示進度條 ──
      if (computedState === 'growing' || computedState === 'seedling' || computedState === 'seed') {
        this.updateProgressBar(index);
        this.hideMatureIndicator(index);
        return;
      }


      // ── 已成熟：確保有可收成標示，無進度條 ──
      if (computedState === 'mature' && state.cropState === 'mature') {
        this.showMatureIndicator(index);
        this.hideProgressBar(index);
      }
    });
  }
}
