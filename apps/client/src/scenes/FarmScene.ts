import Phaser from 'phaser';

export interface TileData {
  x: number;
  y: number;
  type: 'grass' | 'soil' | 'path' | 'tree';
  cropId?: number;
  plantedAt?: number;
  finishAt?: number;
  wateredAt?: number; // 澆水時間戳，用於計算土壤深淺
  state: 'empty' | 'planted' | 'growing' | 'ready' | 'dead';
  readyAnimated?: boolean; // 是否已完成成熟動畫設置
}

export interface CropData {
  id: number;
  nameZhTw: string;
  growTimeSec: number;
  sellPrice: number;
  exp: number;
  sprite: string;
}

export const TILE_SIZE = 32;
export const GRID_WIDTH = 10;
export const GRID_HEIGHT = 10;

export const TILE_TYPES = {
  GRASS: 'grass',
  SOIL: 'soil',
  PATH: 'path',
  TREE: 'tree'
} as const;

export default class FarmScene extends Phaser.Scene {
  private tiles: Map<string, Phaser.GameObjects.Container> = new Map();
  private hoverTile: Phaser.GameObjects.Container | null = null;
  private cropTooltip: Phaser.GameObjects.Container | null = null;
  private selectedTile: Phaser.GameObjects.Container | null = null;
  private _selectedTool: string | null = null;
  private _isPlantMenuOpen = false;
  private get selectedTool() { return this._selectedTool; }
  private set selectedTool(value: string | null) {
    if (this._selectedTool !== value) {
      this._selectedTool = value;
      this.clearSelection();
      this.setToolCursor(value);
      // 切換工具時關閉播種選單
      this._isPlantMenuOpen = false;
    }
  }
  private farmTiles: Map<string, TileData> = new Map();
  private selectedSeedId: number | null = null; // 從背包選擇的種子

  private crops: CropData[] = [];
  private uiContainer: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: 'FarmScene' });
  }

  preload() {
    // preload 只需要保證紋理存在即可
  }

  create() {
    // 先設置天空背景
    this.cameras.main.setBackgroundColor(0x87CEEB);
    
    // 建立所有紋理（同步進行，不等待 fonts）
    this.createPixelArtTextures();
    
    // 建立網格
    this.createGrid();
    this.createHoverEffect();
    this.createUI();
    this.setupInput();
    this.loadCrops();
    this.loadFarmTiles();
  }

  update() {
    const now = Date.now();
    if (this._frameCount === undefined) this._frameCount = 0;
    this._frameCount++;

    // 每10幀更新一次生長進度（約3秒），加快響應速度
    if (this._frameCount % 30 === 0) {
      this.farmTiles.forEach((tData, tKey) => {
        const [x, y] = tKey.split(',').map(Number);
        if (tData.state === 'growing') {
          const crop = this.crops.find(c => c.id === tData.cropId);
          if (!crop) return;

          if (!tData.wateredAt) {
            // 未澆水：不生長，只更新訊息提示
            return;
          }

          // 澆水後才計算生長（加速50%）
          const speedup = 1.5; // 澆水加速50%
          const effectiveElapsed = (now - tData.plantedAt) * speedup;
          const totalTime = crop.growTimeSec * 1000;

          // 更新進度條
          this.updateCropProgressBar(x, y, tData, crop);

          if (effectiveElapsed >= totalTime) {
            tData.state = 'ready';
            this.updateTileDisplay(x, y, tData);
          }
        }
      });
    }

    // 每幀檢查澆水土壤，逐漸由深色恢復到淺色（每3幀更新一次）
    if (this._frameCount % 3 !== 0) return;
    const WET_MS = 5000; // 5秒後土壤變回普通
    this.tiles.forEach((tile, tKey) => {
      const tData = this.farmTiles.get(tKey);
      if (!tData || !tData.wateredAt) return;
      const soilSprite = tile.getAt(0) as Phaser.GameObjects.Image;
      if (!soilSprite) return;
      const wElapsed = now - tData.wateredAt;
      if (wElapsed >= WET_MS) {
        // 土壤乾燥了，停止生長加速，但保留 wateredAt 讓作物在下一輪自然停止
        // 不要主動清除 wateredAt，讓它自然衰減
        soilSprite.setTexture('tile_soil');
        return;
      }
      // 乾燥進度：0=最濕（深棕）, 1=全乾（普通土壤色）
      const dryRatio = Math.min(1, wElapsed / WET_MS);
      const r = Math.round(80 + (139 - 80) * dryRatio);
      const g = Math.round(50 + (105 - 50) * dryRatio);
      const b = Math.round(10 + (20 - 10) * dryRatio);
      const wColor = (r << 16) | (g << 8) | b;
      const [wx, wy] = tKey.split(',').map(Number);
      const wKey = `soil_wet_${wx}_${wy}`;
      if (soilSprite.texture.key !== wKey) {
        const gfx = this.make.graphics({ x: 0, y: 0 });
        gfx.fillStyle(wColor, 1);
        gfx.fillRect(0, 0, 32, 32);
        gfx.fillStyle(0x000000, 0.15);
        for (let i = 0; i < 8; i++) {
          gfx.fillRect(Phaser.Math.Between(2, 26), Phaser.Math.Between(2, 26), 3, 2);
        }
        gfx.generateTexture(wKey, 32, 32);
        gfx.destroy();
        soilSprite.setTexture(wKey);
      }
    });
  }

  private createPixelArtTextures() {
    const graphics = this.make.graphics({ x: 0, y: 0 });

    // 草地 tile
    graphics.clear();
    graphics.fillStyle(0x7EC850, 1);
    graphics.fillRect(0, 0, 32, 32);
    graphics.fillStyle(0x6AB840, 1);
    for (let i = 0; i < 8; i++) {
      graphics.fillRect(
        Phaser.Math.Between(2, 28),
        Phaser.Math.Between(2, 28),
        2,
        4
      );
    }
    graphics.generateTexture('tile_grass', 32, 32);

    // 土壤 tile（可耕作）- 加1px黑邊，避免跟天空背景融在一起
    graphics.clear();
    graphics.fillStyle(0x8B6914, 1);
    graphics.fillRect(0, 0, 32, 32);
    graphics.fillStyle(0x7A5C12, 1);
    for (let i = 0; i < 6; i++) {
      graphics.fillRect(
        Phaser.Math.Between(0, 24),
        Phaser.Math.Between(0, 24),
        4,
        2
      );
    }
    graphics.lineStyle(1, 0x000000, 0.4);
    graphics.strokeRect(0, 0, 32, 32);
    graphics.generateTexture('tile_soil', 32, 32);

    // 澆水後的深色土壤（動態切換用）
    graphics.clear();
    graphics.fillStyle(0x5A4010, 1);
    graphics.fillRect(0, 0, 32, 32);
    graphics.fillStyle(0x4A3508, 1);
    for (let i = 0; i < 6; i++) {
      graphics.fillRect(
        Phaser.Math.Between(0, 24),
        Phaser.Math.Between(0, 24),
        4,
        2
      );
    }
    graphics.lineStyle(1, 0x000000, 0.5);
    graphics.strokeRect(0, 0, 32, 32);
    graphics.generateTexture('tile_soil_wet', 32, 32);

    // 路徑 tile - 加1px黑邊
    graphics.clear();
    graphics.fillStyle(0xC4A460, 1);
    graphics.fillRect(0, 0, 32, 32);
    graphics.fillStyle(0xB39450, 1);
    graphics.fillRect(2, 2, 12, 12);
    graphics.fillRect(18, 18, 12, 12);
    graphics.lineStyle(1, 0x000000, 0.3);
    graphics.strokeRect(0, 0, 32, 32);
    graphics.generateTexture('tile_path', 32, 32);

    // 樹木裝飾
    graphics.clear();
    graphics.fillStyle(0x4A2800, 1);
    graphics.fillRect(14, 24, 6, 8);
    graphics.fillStyle(0x2D5016, 1);
    graphics.fillCircle(17, 16, 12);
    graphics.fillStyle(0x3A6820, 1);
    graphics.fillCircle(17, 14, 8);
    graphics.generateTexture('tile_tree', 32, 32);

    // 選中框
    graphics.clear();
    graphics.lineStyle(3, 0xFFD700, 1);
    graphics.strokeRect(1, 1, 30, 30);
    graphics.generateTexture('selection_box', 32, 32);

    // Hover 效果
    graphics.clear();
    graphics.lineStyle(2, 0xFFFFFF, 0.8);
    graphics.strokeRect(1, 1, 30, 30);
    graphics.generateTexture('hover_effect', 32, 32);

    // 作物圖示（小麥）- 像素麥穗
    graphics.clear();
    // 麥稈（棕色直桿）
    graphics.fillStyle(0x8B6914, 1);
    graphics.fillRect(15, 14, 3, 16);
    // 左麥粒
    graphics.fillStyle(0xF4D03F, 1);
    graphics.fillRect(10, 6, 5, 8);
    graphics.fillRect(8, 8, 3, 4);
    // 右麥粒
    graphics.fillRect(17, 6, 5, 8);
    graphics.fillRect(21, 8, 3, 4);
    // 頂部麥粒
    graphics.fillStyle(0xF7DC6F, 1);
    graphics.fillRect(12, 4, 8, 4);
    graphics.fillRect(14, 2, 4, 3);
    graphics.generateTexture('crop_wheat', 32, 32);

    // 作物圖示（玉米）- 像素玉米棒
    graphics.clear();
    // 玉米棒 - 黃色胖棒
    graphics.fillStyle(0xF4D03F, 1);
    graphics.fillRect(8, 4, 16, 18);
    // 深色玉米粒點綴
    graphics.fillStyle(0xD4A017, 1);
    graphics.fillRect(9, 5, 4, 4);
    graphics.fillRect(17, 5, 4, 4);
    graphics.fillRect(13, 9, 4, 4);
    graphics.fillRect(9, 13, 4, 4);
    graphics.fillRect(17, 13, 4, 4);
    graphics.fillRect(13, 17, 4, 4);
    // 深色果柄（頂部）
    graphics.fillStyle(0x8B6914, 1);
    graphics.fillRect(13, 2, 6, 4);
    // 葉子
    graphics.fillStyle(0x4A6B20, 1);
    graphics.fillRect(4, 8, 5, 4);
    graphics.fillRect(23, 8, 5, 4);
    // 葉子
    graphics.fillStyle(0x27AE60, 1);
    graphics.fillRect(8, 10, 4, 4);
    graphics.fillRect(20, 10, 4, 4);
    graphics.generateTexture('crop_corn', 32, 32);

    // 作物圖示（番茄）- 像素番茄
    graphics.clear();
    // 莖（綠色方塊）
    graphics.fillStyle(0x27AE60, 1);
    graphics.fillRect(14, 2, 4, 6); // 莖
    graphics.fillRect(11, 4, 4, 3); // 左葉
    graphics.fillRect(17, 4, 4, 3); // 右葉
    // 果實（紅色方塊）
    graphics.fillStyle(0xE74C3C, 1);
    graphics.fillRect(9, 8, 14, 14);
    // 高光（白色方塊）
    graphics.fillStyle(0xFF9999, 1);
    graphics.fillRect(11, 10, 4, 4);
    // 深色斑
    graphics.fillStyle(0xC0392B, 1);
    graphics.fillRect(19, 16, 3, 3);
    graphics.generateTexture('crop_tomato', 32, 32);

    // 作物圖示（草莓）- 像素草莓
    graphics.clear();
    // 莖（綠色方塊）
    graphics.fillStyle(0x27AE60, 1);
    graphics.fillRect(14, 2, 4, 6);
    graphics.fillRect(10, 4, 5, 3); // 左葉
    graphics.fillRect(17, 4, 5, 3); // 右葉
    // 草莓主體（紅色方塊）
    graphics.fillStyle(0xE74C3C, 1);
    graphics.fillRect(10, 8, 12, 12);
    // 草莓籽（黃色小點）
    graphics.fillStyle(0xF7DC6F, 1);
    graphics.fillRect(12, 10, 2, 2);
    graphics.fillRect(17, 10, 2, 2);
    graphics.fillRect(14, 13, 2, 2);
    graphics.fillRect(12, 16, 2, 2);
    graphics.fillRect(17, 16, 2, 2);
    // 高光
    graphics.fillStyle(0xFF8888, 1);
    graphics.fillRect(11, 9, 3, 3);
    graphics.generateTexture('crop_strawberry', 32, 32);
    // 作物幼苗（用於生長階段顯示）
    // 小麥幼苗（兩片葉子的小綠芽）
    graphics.clear();
    graphics.fillStyle(0x4A2800, 1);
    graphics.fillRect(15, 18, 3, 12); // 細莖
    graphics.fillStyle(0x6AB840, 1);
    graphics.fillRect(10, 14, 5, 6); // 左葉
    graphics.fillRect(17, 14, 5, 6); // 右葉
    graphics.generateTexture('seedling_wheat', 32, 32);

    // 玉米幼苗（莖+葉片）
    graphics.clear();
    graphics.fillStyle(0x4A2800, 1);
    graphics.fillRect(15, 16, 3, 14); // 莖
    graphics.fillStyle(0x6AB840, 1);
    graphics.fillRect(8, 12, 6, 5); // 左大葉
    graphics.fillRect(18, 12, 6, 5); // 右大葉
    graphics.generateTexture('seedling_corn', 32, 32);

    // 番茄幼苗（莖+葉子）
    graphics.clear();
    graphics.fillStyle(0x4A2800, 1);
    graphics.fillRect(15, 18, 3, 12); // 莖
    graphics.fillStyle(0x228B22, 1);
    graphics.fillRect(10, 14, 5, 6); // 左葉
    graphics.fillRect(17, 14, 5, 6); // 右葉
    graphics.fillRect(13, 12, 6, 4); // 頂葉
    graphics.generateTexture('seedling_tomato', 32, 32);

    // 草莓幼苗（莖+小葉）
    graphics.clear();
    graphics.fillStyle(0x4A2800, 1);
    graphics.fillRect(15, 20, 3, 10); // 莖
    graphics.fillStyle(0x228B22, 1);
    graphics.fillRect(10, 16, 5, 5); // 左葉
    graphics.fillRect(17, 16, 5, 5); // 右葉
    graphics.generateTexture('seedling_strawberry', 32, 32);

    // 工具游標：播種（手掌/種子）
    graphics.clear();
    graphics.fillStyle(0xD2691E, 1);
    graphics.fillRect(2, 2, 6, 6); // 掌心
    graphics.fillStyle(0x8B4513, 1);
    graphics.fillRect(3, 8, 4, 5); // 指頭
    graphics.fillStyle(0xDAA520, 1);
    graphics.fillCircle(12, 10, 3); // 種子
    graphics.generateTexture('cursor_plant', 24, 24);

    // 工具游標：澆水（水壺）
    graphics.clear();
    graphics.fillStyle(0x4682B4, 1);
    graphics.fillRect(2, 6, 10, 8); // 壺身
    graphics.fillStyle(0x5F9EA0, 1);
    graphics.fillRect(10, 4, 5, 4); // 壺嘴
    graphics.fillStyle(0x8B4513, 1);
    graphics.fillRect(4, 2, 4, 4); // 壺蓋
    graphics.fillStyle(0x87CEEB, 0.7);
    graphics.fillRect(3, 8, 3, 4); // 水
    graphics.generateTexture('cursor_water', 24, 24);

    // 工具游柄：收成（籃子/袋子）
    graphics.clear();
    graphics.fillStyle(0x8B4513, 1);
    graphics.fillRect(2, 8, 12, 8); // 籃身
    graphics.fillStyle(0x6B8E23, 1);
    graphics.fillRect(1, 6, 14, 3); // 籃邊
    graphics.fillStyle(0x9ACD32, 1);
    graphics.fillRect(4, 10, 3, 4); // 蔬菜葉
    graphics.fillRect(9, 11, 3, 3); // 番茄
    graphics.generateTexture('cursor_harvest', 24, 24);

    // 工具游標：播種（手掌）- 48x48 大尺寸
    graphics.clear();
    graphics.fillStyle(0xD2691E, 1);
    graphics.fillRect(4, 4, 12, 12); // 掌心
    graphics.fillStyle(0x8B4513, 1);
    graphics.fillRect(6, 16, 8, 10); // 指頭
    graphics.fillStyle(0xDAA520, 1);
    graphics.fillCircle(24, 20, 6); // 種子
    graphics.fillStyle(0x6B8E23, 1);
    graphics.fillCircle(8, 28, 3); // 小葉
    graphics.generateTexture('cursor_plant', 48, 48);

    // 工具游標：澆水（水壺）- 48x48
    graphics.clear();
    graphics.fillStyle(0x4682B4, 1);
    graphics.fillRect(4, 12, 20, 16); // 壺身
    graphics.fillStyle(0x5F9EA0, 1);
    graphics.fillRect(20, 8, 10, 8); // 壺嘴
    graphics.fillStyle(0x8B4513, 1);
    graphics.fillRect(8, 4, 8, 8); // 壺蓋
    graphics.fillStyle(0x87CEEB, 0.9);
    graphics.fillRect(6, 16, 6, 8); // 水
    graphics.generateTexture('cursor_water', 48, 48);

    // 工具游標：收成（籃子）- 48x48
    graphics.clear();
    graphics.fillStyle(0x8B4513, 1);
    graphics.fillRect(4, 16, 24, 16); // 籃身
    graphics.fillStyle(0x6B8E23, 1);
    graphics.fillRect(2, 12, 28, 6); // 籃邊
    graphics.fillStyle(0x9ACD32, 1);
    graphics.fillRect(8, 20, 6, 8); // 蔬菜葉
    graphics.fillStyle(0xE74C3C, 1);
    graphics.fillCircle(18, 28, 5); // 番茄
    graphics.fillStyle(0xF1C40F, 1);
    graphics.fillCircle(28, 24, 4); // 玉米
    graphics.generateTexture('cursor_harvest', 48, 48);

    // 按鈕背景
    graphics.clear();
    graphics.fillStyle(0x8B5A2B, 1);
    graphics.fillRect(0, 0, 80, 32);
    graphics.fillStyle(0x5C3D2E, 1);
    graphics.fillRect(0, 0, 80, 4);
    graphics.fillRect(0, 28, 80, 4);
    graphics.fillRect(0, 0, 4, 32);
    graphics.fillRect(76, 0, 4, 32);
    graphics.generateTexture('btn_normal', 80, 32);

    // 鎖定按鈕
    graphics.clear();
    graphics.fillStyle(0x666666, 1);
    graphics.fillRect(0, 0, 80, 32);
    graphics.fillStyle(0x444444, 1);
    graphics.fillRect(0, 0, 80, 4);
    graphics.generateTexture('btn_disabled', 80, 32);

    graphics.destroy();
  }

  private createBackground() {
    // 天空背景（讓 React 層的 pixel art 雲朵可見）
    this.cameras.main.setBackgroundColor(0x87CEEB);
    // 不在 Phaser 內畫雲朵，讓 React UI 層的 pixel art 雲朵顯示
  }

  private createGrid() {
    const startX = (800 - GRID_WIDTH * TILE_SIZE) / 2;
    const startY = (600 - GRID_HEIGHT * TILE_SIZE) / 2 - 20;

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const tileType = this.getTileType(x, y);
        const tileKey = `tile_${tileType}`;
        const container = this.add.container(
          startX + x * TILE_SIZE,
          startY + y * TILE_SIZE
        );

        const tileSprite = this.add.image(0, 0, tileKey);
        container.add(tileSprite);

        if (tileType === TILE_TYPES.SOIL) {
          const plotData: TileData = {
            x,
            y,
            type: 'soil',
            state: 'empty'
          };
          this.farmTiles.set(`${x},${y}`, plotData);

          tileSprite.setInteractive();
          tileSprite.on('pointerover', () => this.onTileHover(x, y));
          tileSprite.on('pointerout', () => this.onTileOut());
          tileSprite.on('pointerdown', () => this.onTileClick(x, y));
        }

        container.setData('x', x);
        container.setData('y', y);
        container.setData('type', tileType);
        this.tiles.set(`${x},${y}`, container);
      }
    }
  }

  private getTileType(x: number, y: number): string {
    // 設計簡單的地圖：邊緣是草，中間是土壤
    if (x === 0 || x === GRID_WIDTH - 1 || y === 0 || y === GRID_HEIGHT - 1) {
      return TILE_TYPES.GRASS;
    }
    // 設計小路
    if (y === 5 && (x === 2 || x === 7)) {
      return TILE_TYPES.PATH;
    }
    // 角落放樹
    if ((x === 0 && y === 0) || (x === GRID_WIDTH - 1 && y === 0) ||
        (x === 0 && y === GRID_HEIGHT - 1) || (x === GRID_WIDTH - 1 && y === GRID_HEIGHT - 1)) {
      return TILE_TYPES.TREE;
    }
    return TILE_TYPES.SOIL;
  }

  private createHoverEffect() {
    this.hoverTile = this.add.container(0, 0);
    const hoverSprite = this.add.image(0, 0, 'hover_effect');
    hoverSprite.setVisible(false);
    this.hoverTile.add(hoverSprite);
    this.hoverTile.setDepth(100);

    // 作物提示 tooltip（跟隨滑鼠）
    this.cropTooltip = this.add.container(0, 0);
    this.cropTooltip.setDepth(400);
    this.cropTooltip.setVisible(false);
    const ttBg = this.add.graphics();
    ttBg.fillStyle(0xFFFFF0, 0.95);
    ttBg.fillRoundedRect(-60, -18, 120, 36, 6);
    ttBg.lineStyle(2, 0x5C3D2E, 1);
    ttBg.strokeRoundedRect(-60, -18, 120, 36, 6);
    this.cropTooltip.add(ttBg);
    const ttText = this.add.text(0, 0, '', {
      fontSize: '22px',
      fontFamily: 'Cubic 11, Microsoft JhengHei',
      color: '#3d2518',
      fontStyle: 'bold'
    });
    ttText.setOrigin(0.5);
    this.cropTooltip.add(ttText);
    this.cropTooltip.setData('text', ttText);
  }

  private createUI() {
    this.uiContainer = this.add.container(0, 0);
    this.uiContainer.setDepth(200);

    // 工具列背景（透明，只留按鈕）
    // 狀態顯示已移到 React 層（GamePage），不重複
  }

  private setupInput() {
    // ESC 取消選中
    this.input.keyboard?.on('keydown-ESC', () => {
      this.clearSelection();
      this.setToolCursor(null);
    });

    // 預設游標
    this.setToolCursor(null);
  }

  setToolCursor(tool: string | null) {
    const canvas = this.game.canvas;
    if (!tool) {
      canvas.style.cursor = 'default';
      return;
    }
    const cursorMap: Record<string, string> = {
      '播種': 'cursor_plant',
      '澆水': 'cursor_water',
      '收成': 'cursor_harvest'
    };
    const cursorKey = cursorMap[tool];
    if (cursorKey && this.textures.exists(cursorKey)) {
      // Use data URI for custom cursor
      const img = this.textures.get(cursorKey).getSourceImage() as HTMLCanvasElement;
      const dataUrl = img.toDataURL();
      canvas.style.cursor = `url(${dataUrl}) 12 12, auto`;
    } else {
      // Fallback: crosshair for precision clicking
      canvas.style.cursor = 'crosshair';
    }
  }

  private onTileHover(x: number, y: number) {
    const tile = this.tiles.get(`${x},${y}`);
    if (tile && this.hoverTile) {
      this.hoverTile.setPosition(tile.x, tile.y);
      this.hoverTile.getAt(0)?.setVisible(true);
    }
    // 當有工具選中且hover到地格時，確保游標正確
    if (this.selectedTool) {
      this.setToolCursor(this.selectedTool);
    }

    // 顯示作物提示 tooltip（僅在 FIELD tiles，非 plant menu 內）
    const tileData = this.farmTiles.get(`${x},${y}`);
    if (tileData && (tileData.state === 'growing' || tileData.state === 'ready') && this.cropTooltip && !this._isPlantMenuOpen) {
      const crop = this.crops.find(c => c.id === tileData.cropId);
      if (crop) {
        const ttText = this.cropTooltip.getData('text') as Phaser.GameObjects.Text;
        if (ttText) {
          const stateLabel = tileData.state === 'ready' ? '✅' : '🌱';
          ttText.setText(`${stateLabel} ${crop.nameZhTw}`);
        }
        // 跟隨滑鼠
        const pointer = this.input.activePointer;
        this.cropTooltip.setPosition(pointer.x + 16, pointer.y - 20);
        this.cropTooltip.setVisible(true);
        return;
      }
    }
    if (this.cropTooltip) this.cropTooltip.setVisible(false);
  }

  private onTileOut() {
    if (this.hoverTile) {
      this.hoverTile.getAt(0)?.setVisible(false);
    }
    if (this.cropTooltip) this.cropTooltip.setVisible(false);
  }

  private onTileClick(x: number, y: number) {
    if (this._isPlantMenuOpen) return; // plant menu is open, ignore tile clicks
    const tile = this.tiles.get(`${x},${y}`);
    if (!tile) return;
    const tileData = this.farmTiles.get(`${x},${y}`);
    this.clearSelection();

    // 直接處理點擊動作，不顯示選中框
    this.handleTileAction(x, y, tileData);
  }

  private handleTileAction(x: number, y: number, tileData?: TileData) {
    console.log('[DEBUG handleTileAction]', { x, y, selectedTool: this.selectedTool, selectedSeedId: this.selectedSeedId, tileDataState: tileData?.state });

    // 清除選中框（一開始就清除， 無論結果如何）
    this.clearSelection();


    if (!tileData || tileData.type !== 'soil') {
      this.showMessage('這裡無法操作！');
      return;
    }

    // 如果是從背包選擇了種子，直接播種
    if (this.selectedSeedId !== null) {
      if (tileData.state !== 'empty') {
        this.showMessage('這格已經有東西了！');
        this.selectedSeedId = null;
        return;
      }
      const cropId = this.selectedSeedId;
      this.selectedSeedId = null;
      this.plantCrop(x, y, cropId);
      return;
    }

    if (!this.selectedTool) {
      this.showMessage('請先選擇工具！');
      return;
    }

    switch (this.selectedTool) {
      case '播種':
        this.showPlantMenu(x, y, tileData);
        break;
      case '澆水':
        this.waterTile(x, y, tileData);
        break;
      case '收成':
        this.harvestTile(x, y, tileData);
        break;
    }
  }

  private showPlantMenu(x: number, y: number, tileData: TileData) {
    this._isPlantMenuOpen = true;

    if (tileData.state !== 'empty') {
      this._isPlantMenuOpen = false;
      this.showMessage('這格已經有東西了！');
      return;
    }

    // 使用固定畫面位置（永遠可見）- 匡高縮小到 200
    const menuContainer = this.add.container(400, 180);
    menuContainer.setDepth(300);

    const menuBg = this.add.graphics();
    menuBg.fillStyle(0xFFFFF0, 1);
    menuBg.fillRoundedRect(-90, -75, 180, 180, 12);
    menuBg.lineStyle(3, 0x5C3D2E, 1);
    menuBg.strokeRoundedRect(-90, -75, 180, 180, 12);
    menuContainer.add(menuBg);

    const titleText = this.add.text(0, -68, '🌱 選擇播種', {
      fontSize: '32px',
      fontFamily: 'Cubic 11',
      color: '#3d2518',
      fontStyle: 'bold'
    });
    titleText.setOrigin(0.5);
    titleText.setResolution(1);
    menuContainer.add(titleText);

    const crops = [
      { id: 1, name: '🌾 小麥', time: '30秒', price: 5 },
      { id: 2, name: '🌽 玉米', time: '60秒', price: 15 },
      { id: 3, name: '🍓 草莓', time: '120秒', price: 30 },
      { id: 4, name: '🍅 番茄', time: '180秒', price: 50 }
    ];

    // 拿 this.crops 動態取得作物名稱與時間
    const cropMap = new Map(this.crops.map(c => [c.id, c]));

    const tooltip = this.add.container(130, -30);
    tooltip.setDepth(350);
    tooltip.setVisible(false);
    const tooltipBg = this.add.graphics();
    tooltipBg.fillStyle(0xFFFFF0, 0.95);
    tooltipBg.fillRoundedRect(-75, -28, 150, 56, 6);
    tooltipBg.lineStyle(2, 0x5C3D2E, 1);
    tooltipBg.strokeRoundedRect(-75, -28, 150, 56, 6);
    tooltip.add(tooltipBg);
    const tooltipText = this.add.text(0, 0, '', {
      fontSize: '26px',
      fontFamily: 'Cubic 11, Microsoft JhengHei',
      color: '#3d2518',
      fontStyle: 'bold'
    });
    tooltipText.setOrigin(0.5);
    tooltip.add(tooltipText);
    menuContainer.add(tooltip);

    // 不要設整個 menuContainer 為 interactive，否則子元素會被覆盖
    // 讓子元素自行處理 pointer event

    crops.forEach((crop, idx) => {
      const btnY = -30 + idx * 26;
      const cropData = cropMap.get(crop.id);
      const displayName = cropData?.nameZhTw || crop.name;
      const displayTime = cropData ? this.formatTime(cropData.growTimeSec) : crop.time;
      const displayPrice = cropData?.buyPrice || crop.price;
      const btnText = this.add.text(-80, btnY, `${displayName}  (${displayTime})  ${displayPrice}金`, {
        fontSize: '38px',
        fontFamily: 'Cubic 11',
        color: '#1a5c1a',
        fontStyle: 'bold'
      });
      btnText.setOrigin(0, 0.5);
      btnText.setResolution(1);
      btnText.setInteractive({ useHandCursor: true });
      btnText.on('pointerdown', () => {
        this._isPlantMenuOpen = false;
        this.plantCrop(x, y, crop.id);
        menuContainer.destroy();
      });
      btnText.on('pointerover', () => {
        btnText.setColor('#d35400');
        // Show tooltip with crop info
        tooltip.setVisible(true);
        tooltipText.setText(`${displayName}\n💰 ${displayPrice}金  ⏱ ${displayTime}`);
      });
      btnText.on('pointerout', () => {
        btnText.setColor('#1a5c1a');
        tooltip.setVisible(false);
      });
      menuContainer.add(btnText);
    });

    // 關閉時清除 flag（用於取消播種操作）
    const cleanup = () => {
      console.log('[DEBUG] closeBtn clicked');
      this._isPlantMenuOpen = false;
      menuContainer.destroy();
    };

    // ESC 鍵取消播種選單
    this.input.keyboard.once('keydown-ESC', cleanup);

    // 透明點擊區域用圖形+文字分開，確保 Phaser 能正確處理
    const closeHitArea = this.add.graphics();
    closeHitArea.fillStyle(0xFF0000, 0.0001);
    closeHitArea.fillRect(70, -84, 22, 22);
    closeHitArea.setInteractive(new Phaser.Geom.Rectangle(70, -84, 22, 22), Phaser.Geom.Rectangle.Contains);
    closeHitArea.on('pointerdown', () => { cleanup(); });
    menuContainer.add(closeHitArea);

    const closeBtnText = this.add.text(78, -68, '✕', {
      fontSize: '26px',
      fontFamily: 'Cubic 11',
      color: '#8B4513',
      fontStyle: 'bold'
    });
    closeBtnText.setOrigin(0.5);
    closeBtnText.setResolution(1);
    menuContainer.add(closeBtnText);
  }

  private async plantCrop(x: number, y: number, cropId: number) {
    const crop = this.crops.find(c => c.id === cropId);
    if (!crop) { console.log('[DEBUG plantCrop] crop not found, id=', cropId); return; }

    const tileData = this.farmTiles.get(`${x},${y}`);
    if (!tileData) { console.log('[DEBUG plantCrop] tileData not found', x, y); return; }

    const now = Date.now();
    console.log('[DEBUG plantCrop] BEFORE', { x, y, state: tileData.state, cropId, existingCropId: tileData.cropId });
    tileData.cropId = cropId;
    tileData.plantedAt = now;
    tileData.finishAt = now + crop.growTimeSec * 1000;
    tileData.state = 'growing';
    tileData.wateredAt = undefined;
    tileData.readyAnimated = false;
    console.log('[DEBUG plantCrop] AFTER state=growing, cropId=', cropId);

    this.updateTileDisplay(x, y, tileData);
    this.clearSelection(); // 播種後清除選中框

    // 明確標記這格已種植（加一個視覺指示器）
    const tile = this.tiles.get(`${x},${y}`);
    if (tile) {
      // 消除舊的指示器
      const oldInd = tile.getAt(4);
      if (oldInd) oldInd.destroy();

      // 添加綠色播種指示器（用紅色X表示還沒澆水等）
      const indicator = this.add.graphics();
      indicator.fillStyle(0x00FF00, 0.5);
      indicator.fillCircle(0, 0, 8);
      indicator.setDepth(1);
      tile.add(indicator);

      // 2秒後消失
      this.tweens.add({
        targets: indicator,
        alpha: 0,
        scale: 1.5,
        duration: 800,
        onComplete: () => { indicator.destroy(); }
      });
    }

    this.showMessage(`🌱 種下 ${crop.nameZhTw} 了！快去澆水！`);
  }

  private updateTileDisplay(x: number, y: number, tileData: TileData) {
    const tile = this.tiles.get(`${x},${y}`);
    if (!tile) { console.log('[DEBUG updateTileDisplay] tile not found', x, y); return; }

    console.log('[DEBUG updateTileDisplay]', { x, y, state: tileData.state, cropId: tileData.cropId });

    // empty 狀態：恢復普通土壤，摧毀所有作物相關顯示
    if (tileData.state === 'empty') {
      // 恢復普通土壤貼圖
      const soilSprite = tile.getAt(0) as Phaser.GameObjects.Image;
      if (soilSprite && soilSprite.texture.key !== 'tile_soil') {
        soilSprite.setTexture('tile_soil');
      }
      // 摧毀所有作物相關顯示（child 1 以後）
      const childrenToDestroy = tile.list.slice(1);
      childrenToDestroy.forEach(child => { if (child) child.destroy(); });
      return;
    }

    if (tileData.state === 'growing' || tileData.state === 'ready') {
      const crop = this.crops.find(c => c.id === tileData.cropId);
      if (!crop) { console.log('[DEBUG updateTileDisplay] crop not found for cropId', tileData.cropId); return; }

      // 成熟顯示完整作物，生長中顯示幼苗
      const baseKey = crop.sprite;
      const spriteKey = tileData.state === 'ready' ? baseKey : `seedling_${baseKey.replace('crop_', '')}`;
      console.log('[DEBUG updateTileDisplay] creating sprite', spriteKey);

      // 緊急生成紋理（如果不存在）
      if (!this.textures.exists(spriteKey)) {
        console.log('[DEBUG updateTileDisplay] TEXTURE NOT FOUND - generating:', spriteKey);
        const gfx = this.make.graphics({ x: 0, y: 0 });
        // 成熟作物用黃色圓形，幼苗用綠色
        if (tileData.state === 'ready') {
          gfx.fillStyle(0xF9D71C, 1); // 小麥黃色
        } else {
          gfx.fillStyle(0x4CAF50, 1); // 幼苗綠色
        }
        gfx.fillCircle(16, 16, 12);
        gfx.fillStyle(0x8B4513, 1);
        gfx.fillRect(14, 20, 4, 10);
        gfx.generateTexture(spriteKey, 32, 32);
        gfx.destroy();
      }

      // 先砍舊的進度條圖形（index 2 以後)，避免摧毀新作物圖
      const toDestroy = tile.list.slice(2);
      toDestroy.forEach(child => { if (child) child.destroy(); });

      const cropSprite = this.add.image(0, -2, spriteKey);
      cropSprite.setScale(0.85);
      tile.add(cropSprite);

      // 成熟後：摧毀進度條，顯示閃光動畫
      if (tileData.state === 'ready') {
        if (!tileData.readyAnimated) {
          tileData.readyAnimated = true;
          // 摧毀舊的播種指示器（如果有的話）
          const oldIndicator = tile.getAt(4);
          if (oldIndicator) oldIndicator.destroy();
          // 停止任何現有的動畫
          this.tweens.killTweensOf(cropSprite);
          cropSprite.setAlpha(1);
          cropSprite.y = -2;
          // 上下浮動動畫
          this.tweens.add({
            targets: cropSprite,
            y: cropSprite.y - 4,
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
          });
          // 加閃光星星
          this.addStarSparkle(tile, 0, -16);
        }
      } else {
        // 生長中：顯示進度條
        tileData.readyAnimated = false;
        this.updateCropProgressBar(x, y, tileData, crop);
      }
    }
  }

  // 成熟時的星星閃光特效
  private addStarSparkle(tile: Phaser.GameObjects.Container, offsetX: number, offsetY: number) {
    const sparkle = this.add.text(offsetX, offsetY, '✨', { fontSize: '14px' });
    sparkle.setOrigin(0.5);
    sparkle.setDepth(10);
    tile.add(sparkle);
    // 簡單的閃爍動畫
    this.tweens.add({
      targets: sparkle,
      alpha: 0.3,
      duration: 400,
      yoyo: true,
      repeat: -1,
      ease: 'Power0'
    });
  }

  private updateCropProgressBar(x: number, y: number, tileData: TileData, crop: CropData) {
    const tile = this.tiles.get(`${x},${y}`);
    if (!tile) return;

    // 只清除進度條圖形（index 2 以後），保留作物圖示（index 1）
    const oldChildren = tile.list.slice(2); // index 2 onwards = bars
    oldChildren.forEach(child => { if (child) child.destroy(); });

    if (tileData.state !== 'growing' || !tileData.finishAt || !tileData.plantedAt) return;

    const totalTime = crop.growTimeSec * 1000;

    // 未澆水：顯示紅色靜態進度條（不前進）
    if (!tileData.wateredAt) {
      const barBg = this.add.graphics();
      barBg.fillStyle(0x3d3d3d, 1);
      barBg.fillRect(-13, 9, 26, 7);
      tile.add(barBg);
      // 乾燥提示
      const barFg = this.add.graphics();
      barFg.fillStyle(0xE74C3C, 1);
      barFg.fillRect(-12, 10, 6, 5); // 靜止不動
      tile.add(barFg);
      return;
    }

    // 已澆水：計算實際生長時間（加速50%）
    const speedup = 1.5;
    const effectiveElapsed = (Date.now() - tileData.plantedAt) * speedup;
    const progress = Math.min(1, Math.max(0, effectiveElapsed / totalTime));

    // 進度條背景（灰色底）
    const barBg = this.add.graphics();
    barBg.fillStyle(0x1a1a1a, 1);
    barBg.fillRect(-13, 9, 26, 7);
    tile.add(barBg);

    // 進度條外框
    const barBorder = this.add.graphics();
    barBorder.lineStyle(1, 0x000000, 0.8);
    barBorder.strokeRect(-13, 9, 26, 7);
    tile.add(barBorder);

    // 進度條前景（綠色）
    const barFg = this.add.graphics();
    const barColor = progress > 0.66 ? 0x27AE60 : (progress > 0.33 ? 0xF1C40F : 0x3498DB);
    barFg.fillStyle(barColor, 1);
    barFg.fillRect(-12, 10, Math.floor(24 * progress), 5);
    tile.add(barFg);
  }

  private waterTile(x: number, y: number, tileData: TileData) {
    console.log('[DEBUG waterTile]', { x, y, tileDataState: tileData.state, selectedTool: this.selectedTool });
    // 只能澆水生長中的作物
    if (tileData.state !== 'growing') {
      if (tileData.state === 'empty') {
        this.showMessage('這裡還沒種東西！');
      } else if (tileData.state === 'ready') {
        this.showMessage('已經成熟了，請收成！');
      } else {
        this.showMessage('這裡不需要澆水！');
      }
      return;
    }

    // 記錄澆水時間（加速50%）
    tileData.wateredAt = Date.now();
    this.farmTiles.set(`${x},${y}`, tileData);

    // 馬上更新一次進度條（因為加速了）
    const crop = this.crops.find(c => c.id === tileData.cropId);
    if (crop) this.updateCropProgressBar(x, y, tileData, crop);

    const tile = this.tiles.get(`${x},${y}`);
    if (tile) {
      // 更換為深色土壤貼圖
      const soilSprite = tile.getAt(0) as Phaser.GameObjects.Image;
      if (soilSprite) soilSprite.setTexture('tile_soil_wet');

      // 水滴特效
      for (let i = 0; i < 5; i++) {
        const drop = this.add.text(0, 0, '💧', {
          fontSize: '16px'
        });
        drop.setOrigin(0.5);
        tile.add(drop);
        const angle = (Math.PI * 2 / 5) * i;
        const dist = 15;
        this.tweens.add({
          targets: drop,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist - 10,
          alpha: 0,
          scale: 0.5,
          duration: 500,
          ease: 'Power2',
          onComplete: () => { drop.destroy(); }
        });
      }
    }

    this.showMessage('💧 澆水成功！生長加速 50%！');
  }

  private async harvestTile(x: number, y: number, tileData: TileData) {
    if (tileData.state !== 'ready') {
      if (tileData.state === 'growing') {
        const remaining = Math.max(0, (tileData.finishAt || 0) - Date.now());
        const seconds = Math.ceil(remaining / 1000);
        this.showMessage(`還需要 ${seconds} 秒才能收成！`);
      } else {
        this.showMessage('這裡沒有東西可以收成！');
      }
      return;
    }

    const crop = this.crops.find(c => c.id === tileData.cropId);
    if (!crop) return;

    // 重置土地狀態
    const newTileData: TileData = {
      ...tileData,
      cropId: undefined,
      plantedAt: undefined,
      finishAt: undefined,
      state: 'empty'
    };
    this.farmTiles.set(`${x},${y}`, newTileData);

    // 用 updateTileDisplay 徹底清除所有顯示
    this.updateTileDisplay(x, y, newTileData);

    // +金幣浮動特效
    const tile = this.tiles.get(`${x},${y}`);
    if (tile) {
      const popText = this.add.text(0, -20, `+${crop.sellPrice} 💰`, {
        fontSize: '24px',
        fontFamily: 'Cubic 11, Microsoft JhengHei',
        color: '#FFD700',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 4
      });
      popText.setOrigin(0.5);
      tile.add(popText);
      this.tweens.add({
        targets: popText,
        y: popText.y - 50,
        alpha: 0,
        duration: 1000,
        ease: 'Power2',
        onComplete: () => { popText.destroy(); }
      });
    }

    // 回調通知外面更新金幣和經驗值
    this.events.emit('harvest', {
      gold: crop.sellPrice,
      exp: crop.exp,
      cropName: crop.nameZhTw
    });

    this.showMessage(`🎉 收成！+${crop.sellPrice}金幣 +${crop.exp}經驗！`);
  }

  private showMessage(text: string) {
    const msgBox = this.add.container(400, 250);
    msgBox.setDepth(500);

    const msgBg = this.add.graphics();
    msgBg.fillStyle(0x5C3D2E, 0.95);
    msgBg.fillRoundedRect(-120, -25, 240, 50, 8);
    msgBox.add(msgBg);

    const msgText = this.add.text(0, 0, text, {
      fontSize: '16px',
      fontFamily: 'Cubic 11, Microsoft JhengHei',
      color: '#FFFFFF',
      align: 'center'
    });
    msgText.setOrigin(0.5);
    msgBox.add(msgText);

    this.tweens.add({
      targets: msgBox,
      alpha: 0,
      y: msgBox.y - 20,
      duration: 2000,
      ease: 'Power2',
      onComplete: () => {
        msgBox.destroy();
      }
    });
  }

  private clearSelection() {
    if (this.selectedTile) {
      // 隱藏選中框疊加層（index 5）
      const selOverlay = this.selectedTile.getAt(5);
      if (selOverlay) selOverlay.setVisible(false);
      this.selectedTile = null;
    }
  }

  private formatTime(sec: number): string {
    if (sec < 60) return `${sec}秒`;
    if (sec < 3600) return `${Math.floor(sec / 60)}分`;
    return `${Math.floor(sec / 3600)}時${Math.floor((sec % 3600) / 60)}分`;
  }

  public setSelectedSeed(cropId: number) {
    this.selectedSeedId = cropId;
    // 清除工具選擇，避免衝突
    this.selectedTool = null;
    this.showMessage('點擊空地播種');
  }

  private loadCrops() {
    // 從共享常量載入作物資料
    this.crops = [
      {
        id: 1,
        nameZhTw: '小麥',
        growTimeSec: 30,
        sellPrice: 5,
        exp: 10,
        sprite: 'crop_wheat'
      },
      {
        id: 2,
        nameZhTw: '玉米',
        growTimeSec: 60,
        sellPrice: 15,
        exp: 20,
        sprite: 'crop_corn'
      },
      {
        id: 3,
        nameZhTw: '番茄',
        growTimeSec: 180,
        sellPrice: 50,
        exp: 60,
        sprite: 'crop_tomato'
      },
      {
        id: 4,
        nameZhTw: '草莓',
        growTimeSec: 120,
        sellPrice: 30,
        exp: 40,
        sprite: 'crop_strawberry'
      }
    ];
  }

  private loadFarmTiles() {
    // 從伺服器載入農場狀態
    // TODO: API 呼叫
  }

}
