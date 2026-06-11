import Phaser from 'phaser';

export interface TileData {
  x: number;
  y: number;
  type: 'grass' | 'soil' | 'path' | 'tree';
  cropId?: number;
  plantedAt?: number;
  finishAt?: number;
  wateredAt?: number;
  state: 'empty' | 'seed' | 'seedling' | 'growing' | 'mature';
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

export default class FarmScene extends Phaser.Scene {
  private tiles: Map<string, Phaser.GameObjects.Container> = new Map();
  private selectedTile: Phaser.GameObjects.Container | null = null;
  private actionMenu: Phaser.GameObjects.Container | null = null;
  private crops: CropData[] = [];
  private uiContainer: Phaser.GameObjects.Container | null = null;
  private _frameCount: number = 0;
  private FARM_SIZE = 180;
  private FARM_GAP = 24;
  private CANVAS_W = 0; // 動態
  private CANVAS_H = 0; // 動態

  constructor() {
    super({ key: 'FarmScene' });
  }

  preload() {
    // 草地素材（平鋪用）
    this.load.image('grass_bg', '/assets/tile/草地.png');

    // 農地 32x32
    this.load.image('tile_soil', '/assets/tile/農地_初始狀態_32x32.png');

    // 作物素材（正式 crops PNG）
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

    // 操作選單 icon（獨立大圖）
    this.load.image('icon_seed', '/assets/icon/icon_seed.png.png');
    this.load.image('icon_watering', '/assets/icon/icon_watering.png.png');
    this.load.image('icon_fertilizer', '/assets/icon/icon_fertilizer.png.png');
    this.load.image('icon_harvest', '/assets/icon/icon_harvest.png.png');
  }

  create() {
    // 動態取得 canvas 尺寸
    const parent = this.sys.game.canvas.parentElement;
    if (parent) {
      this.CANVAS_W = parent.clientWidth;
      this.CANVAS_H = parent.clientHeight;
    } else {
      this.CANVAS_W = this.sys.game.canvas.width;
      this.CANVAS_H = this.sys.game.canvas.height;
    }

    // 草地背景（鋪滿整個 canvas）
    const grassImg = this.add.image(0, 0, 'grass_bg');
    grassImg.setDisplaySize(this.CANVAS_W, this.CANVAS_H);
    grassImg.setOrigin(0, 0);

    // 6 塊農地：180×180，3×2 排列，間距 24px
    const COLS = 3;
    const ROWS = 2;

    const totalFarmW = COLS * this.FARM_SIZE + (COLS - 1) * this.FARM_GAP;
    const totalFarmH = ROWS * this.FARM_SIZE + (ROWS - 1) * this.FARM_GAP;
    // 農地群組垂直置中於剩餘空間（玩家資訊列高度約 160px）
    const availableH = this.CANVAS_H - 160;
    const farmStartX = (this.CANVAS_W - totalFarmW) / 2;
    const farmStartY = (availableH - totalFarmH) / 2 + 160;

    // 農地資料：6 格，4 格有作物，2 格空地
    const farmData = [
      { index: 0, crop: 'wheat_mature', state: 'mature' },
      { index: 1, crop: 'corn_growing', state: 'growing' },
      { index: 2, crop: null, state: 'empty' },
      { index: 3, crop: 'carrot_seedling', state: 'seedling' },
      { index: 4, crop: 'potato_mature', state: 'mature' },
      { index: 5, crop: null, state: 'empty' },
    ];

    for (let i = 0; i < 6; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const px = farmStartX + col * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;
      const py = farmStartY + row * (this.FARM_SIZE + this.FARM_GAP) + this.FARM_SIZE / 2;

      // 農地容器
      const farmContainer = this.add.container(px, py);
      farmContainer.setData('index', i);
      farmContainer.setData('farmData', farmData[i]);

      // 農地土壤圖（180x180）
      const soilImg = this.add.image(0, 0, 'tile_soil');
      soilImg.setDisplaySize(this.FARM_SIZE, this.FARM_SIZE);
      farmContainer.add(soilImg);

      // 作物圖（100x100，置中）
      const data = farmData[i];
      if (data.crop) {
        const cropImg = this.add.image(0, 0, 'crop_' + data.crop);
        cropImg.setDisplaySize(100, 100);
        farmContainer.add(cropImg);
      }

      // 讓整個農地可點擊
      soilImg.setInteractive();
      soilImg.on('pointerdown', () => this.onFarmClick(i, px, py, data));

      this.tiles.set(`${i}`, farmContainer);
    }

    // ESC 取消選中
    this.input.keyboard?.on('keydown-ESC', () => {
      this.clearSelection();
    });
  }

  private onFarmClick(index: number, x: number, y: number, data: any) {
    console.log(`[FarmScene] clicked farmland ${index}`);

    // 清除之前的選中
    this.clearSelection();

    // 選中此農地
    const tile = this.tiles.get(`${index}`);
    if (!tile) return;

    // 黃色外框
    const highlight = this.add.graphics();
    highlight.lineStyle(4, 0xFFFF00, 1);
    highlight.strokeRect(-this.FARM_SIZE / 2, -this.FARM_SIZE / 2, this.FARM_SIZE, this.FARM_SIZE);
    highlight.setDepth(10);
    tile.add(highlight);
    this.selectedTile = tile;

    // 顯示操作選單
    this.showActionMenu(index, x, y - this.FARM_SIZE / 2 - 10, data);
  }

  private showActionMenu(index: number, x: number, y: number, data: any) {
    // 銷毀舊選單
    if (this.actionMenu) {
      this.actionMenu.destroy();
      this.actionMenu = null;
    }

    // 小型浮動選單（不超過 260x90）
    const menuW = 260;
    const menuH = 90;

    this.actionMenu = this.add.container(x - menuW / 2, y - menuH);
    this.actionMenu.setDepth(200);

    // 半透明深色背景
    const menuBg = this.add.graphics();
    menuBg.fillStyle(0x3d2518, 0.9);
    menuBg.fillRoundedRect(0, 0, menuW, menuH, 8);
    menuBg.lineStyle(2, 0x8B4513, 1);
    menuBg.strokeRoundedRect(0, 0, menuW, menuH, 8);
    this.actionMenu.add(menuBg);

    // 四個按鈕：播種、澆水、施肥、收成
    const buttons = [
      { label: '播種', icon: 'icon_seed', enabled: data.state === 'empty' },
      { label: '澆水', icon: 'icon_watering', enabled: data.state === 'growing' || data.state === 'seedling' },
      { label: '施肥', icon: 'icon_fertilizer', enabled: data.state === 'growing' || data.state === 'seedling' },
      { label: '收成', icon: 'icon_harvest', enabled: data.state === 'mature' },
    ];

    const btnW = 56;
    const btnH = 56;
    const btnGap = (menuW - 4 * btnW) / 5;
    const startX = btnGap;

    buttons.forEach((btn, i) => {
      const btnX = startX + i * (btnW + btnGap);
      const btnY = (menuH - btnH) / 2;

      const btnContainer = this.add.container(btnX, btnY);
      btnContainer.setDepth(201);

      // 按鈕背景
      const btnBg = this.add.graphics();
      btnBg.fillStyle(btn.enabled ? 0x8B4513 : 0x5C3D2E, 1);
      btnBg.fillRoundedRect(0, 0, btnW, btnH, 6);
      btnContainer.add(btnBg);

      // 按鈕 icon（36x36）
      const iconImg = this.add.image(btnW / 2, btnH / 2 - 6, btn.icon);
      iconImg.setDisplaySize(36, 36);
      iconImg.setAlpha(btn.enabled ? 1 : 0.4);
      btnContainer.add(iconImg);

      // 按鈕文字
      const btnText = this.add.text(btnW / 2, btnH - 8, btn.label, {
        fontSize: '12px',
        fontFamily: "'Cubic 11', sans-serif",
        color: btn.enabled ? '#FFFFFF' : '#AAAAAA',
        fontStyle: 'bold'
      });
      btnText.setOrigin(0.5, 1);
      btnContainer.add(btnText);

      // 禁用按鈕不可點擊
      if (btn.enabled) {
        btnContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, btnW, btnH), Phaser.Geom.Rectangle.Contains);
        btnContainer.on('pointerdown', () => {
          console.log(`[FarmScene] action: ${btn.label} on farmland ${index}`);
          this.clearSelection();
        });
      }

      this.actionMenu!.add(btnContainer);
    });
  }

  private clearSelection() {
    if (this.selectedTile) {
      // 移除黃色外框
      const highlight = this.selectedTile.getAt(this.selectedTile.length - 1);
      if (highlight && highlight.type === 'Graphics') {
        highlight.destroy();
      }
      this.selectedTile = null;
    }
    if (this.actionMenu) {
      this.actionMenu.destroy();
      this.actionMenu = null;
    }
  }

  update() {
    this._frameCount++;
  }
}