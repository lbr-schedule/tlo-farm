import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Phaser from 'phaser';
import FarmScene from '../scenes/FarmScene';
import { useAuth } from '../hooks/useAuth';
import { HotbarIconMap } from '../utils/HotbarIconMap';
import ShopModal from '../components/ui/ShopModal';
import { backpackSystem } from '../systems/BackpackSystem';
import BackpackModal from '../components/ui/BackpackModal';
import LevelUpModal from '../components/ui/LevelUpModal';
import OrderModal from '../components/ui/OrderModal';
import TaskModal from '../components/ui/TaskModal';
import PlayerModal from '../components/ui/PlayerModal';
import AvatarModal from '../components/ui/AvatarModal';
import EventModal from '../components/ui/EventModal';
import ChickenCoopModal from '../components/ui/ChickenCoopModal';
import FoodWorkshopModal from '../components/ui/FoodWorkshopModal';

// 作物名稱到 ID 的映射（配合任務系統）
const CROP_NAME_TO_ID: Record<string, number> = {
  '小麥': 1,
  '玉米': 2,
  '紅蘿蔔': 3,
  '馬鈴薯': 4,
};

// Sprite Sheet icon 佈局（1536×1024，12列×8行，每格128×128）
// icon_coin.png、icon_level.png、icon_exp.png 是 sprite sheet
function getSpriteBgPos(spriteName: string): { bg: string; col: number; row: number } {
  const layouts: Record<string, Record<string, { col: number; row: number }>> = {
    '/assets/icon/icon_coin.png': {
      'icon_coin': { col: 0, row: 0 },
      'icon_diamond': { col: 1, row: 0 },
      'icon_exp': { col: 2, row: 0 },
      'icon_level': { col: 7, row: 0 },
    },
  };

  const coinLayout = layouts['/assets/icon/icon_coin.png'];
  if (coinLayout[spriteName]) {
    const { col, row } = coinLayout[spriteName];
    return { bg: '/assets/icon/icon_coin.png', col, row };
  }

  return { bg: '/assets/icon/icon_coin.png', col: 0, row: 0 };
}

function SpriteIcon({ name, size = 28 }: { name: string; size?: number }) {
  const { bg, col, row } = getSpriteBgPos(name);
  const CELL = 128;
  const DISPLAY = size;
  const SHEET_W = 1536;
  const SHEET_H = 1024;
  const scaledW = (SHEET_W / CELL) * DISPLAY;
  const scaledH = (SHEET_H / CELL) * DISPLAY;
  return (
    <div style={{
      width: size,
      height: size,
      backgroundImage: `url('${bg}')`,
      backgroundSize: `${scaledW}px ${scaledH}px`,
      backgroundPosition: `-${col * DISPLAY}px -${row * DISPLAY}px`,
      backgroundRepeat: 'no-repeat',
      imageRendering: 'pixelated',
      flexShrink: 0,
    }} />
  );
}

export default function GamePage() {
  const navigate = useNavigate();
  const { user, logout, updateUser, authFetch } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [showShop, setShowShop] = useState(false);
  const [shopKey, setShopKey] = useState(0);
  const [showBackpack, setShowBackpack] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [showTask, setShowTask] = useState(false);
  // showTaskRef 用於在事件處理函式中即時取得 current 值（避免 closure 問題）
  const showTaskRef = useRef(false);
  // 同步 showTask → showTaskRef（被動監聽）
  useEffect(() => { showTaskRef.current = showTask; }, [showTask]);
  const [taskRefreshKey, setTaskRefreshKey] = useState(0);
  const [showPlayer, setShowPlayer] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [showChickenCoop, setShowChickenCoop] = useState(false);
  const [showFoodWorkshop, setShowFoodWorkshop] = useState(false);
  const [showPlayerProfile, setShowPlayerProfile] = useState(false);
  const [playerToast, setPlayerToast] = useState('');
  const [editFarmOpen, setEditFarmOpen] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editSigOpen, setEditSigOpen] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarKey, setAvatarKey] = useState(0); // cache bust for avatar images
  const [farmNameInput, setFarmNameInput] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [sigInput, setSigInput] = useState('');
  const [displayUser, setDisplayUser] = useState(user);
  const [pendingLevelUp, setPendingLevelUp] = useState<number | null>(null);
  const [pendingLevelUnlocks, setPendingLevelUnlocks] = useState<string[]>([]);
  const lastShownLevelRef = useRef<number | null>(null);
  const loginTaskMarkedRef = useRef(false);

  useEffect(() => {
    if (user) setDisplayUser(user);
  }, [user]);

  // ── 升級時 fetch 解鎖內容 ──
  useEffect(() => {
    if (pendingLevelUp === null) return;
    fetch('/api/game/level-unlocks')
      .then(r => r.json())
      .then(data => {
        if (!data.success) return;
        const lvl = pendingLevelUp;
        const unlockLines: string[] = [];

        // 作物解鎖：該等级解鎖但前一等级未解鎖的作物
        const prevLvl = lvl - 1;
        const newCrops = (data.crops as any[])
          .filter((c: any) => c.requiredLevel === lvl && (prevLvl <= 0 || (data.crops as any[]).filter((p: any) => p.id === c.id && p.requiredLevel <= prevLvl).length === 0))
          .map((c: any) => c.name);

        // 建築/物品解鎖（LEVEL_UNLOCKS 靜態設定）
        const config = data.levelConfig?.[lvl];
        if (config) {
          unlockLines.push(...config.crops.map((n: string) => n));
          unlockLines.push(...config.buildings.map((n: string) => n));
          unlockLines.push(...config.items.map((n: string) => n));
        }

        // 合併並去除重複
        const all = [...newCrops, ...unlockLines];
        setPendingLevelUnlocks(all.length > 0 ? all : []);
      })
      .catch(() => setPendingLevelUnlocks([]));
  }, [pendingLevelUp]);

  // ── 監聽畜牧狀態更新（雞舍放置成功後同步金幣）──
  useEffect(() => {
    const handler = (event: any) => {
      const { gold, hasChickenCoop, pendingChickenCoop, placedChickenCoop, chickenCoopCapacity, chickenCount } = event.detail || {};
      console.log('[LIVESTOCK STATE UPDATED IN REACT]', event.detail);
      if (gold !== undefined) {
        setDisplayUser((prev: any) => ({ ...prev, gold }));
      }
      // 強制重掛 ShopModal，重新取得雞舍狀態
      setShopKey((k: number) => k + 1);
    };
    window.addEventListener('livestock-state-updated', handler);
    return () => window.removeEventListener('livestock-state-updated', handler);
  }, []);

  // ── 首次登入：標記登入任務完成 ──
  useEffect(() => {
    if (!user || loginTaskMarkedRef.current) return;
    loginTaskMarkedRef.current = true;

    const markLoginTask = async () => {
      try {
        const res = await authFetch('/api/tasks/login', { method: 'POST' });
        const result = await res.json();
        if (result.success === true) {
          console.log('[Tasks] Login task marked');
        } else {
          console.warn('[Tasks] Login task failed:', result.message);
        }
      } catch (e) {
        console.warn('[Tasks] Failed to mark login task:', e);
      }
    };
    markLoginTask();
  }, [user, authFetch]);

  // ── 進入遊戲前驗證 token（只執行一次）──
  useEffect(() => {
    // 避免在 /login 頁面又觸發導向
    if (window.location.pathname === '/login') return;

    const token = localStorage.getItem('accessToken');
    if (!token) {
      navigate('/login');
      return;
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      if (!payload.exp || payload.exp < now) {
        console.warn('[GamePage] Token 已過期，導向登入頁');
        navigate('/login');
      }
    } catch {
      console.warn('[GamePage] Token 格式無效，導向登入頁');
      navigate('/login');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ── 只在 mount 時執行一次，不依賴 navigate ──

  useEffect(() => {
    if (!containerRef.current) return;

    // 動態取得容器尺寸
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: containerW,
      height: containerH,
      parent: containerRef.current,
      backgroundColor: 0x000000,
      transparent: true,
      scene: [FarmScene],
      physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
      render: { pixelArt: true, antialias: false },
    };

    gameRef.current = new Phaser.Game(config);

    const tryRegister = () => {
      const scene = gameRef.current?.scene.getScene('FarmScene');
      if (!scene) {
        const attempts = (tryRegister as any).attempts || 0;
        if (attempts < 20) {
          (tryRegister as any).attempts = attempts + 1;
          setTimeout(tryRegister, 100);
        }
        return;
      }
      // 移除舊監聽（防止重複）
      scene.events.off('harvest');
      scene.events.off('userUpdated');
      scene.events.off('openChickenCoop');
      scene.events.off('chickenCoopPlaced');
      scene.events.off('placementFailed');

      scene.events.on('harvest', (data: { gold: number; exp: number; cropName: string; harvestYield: number }) => {
        handleHarvest(data);
      });
      scene.events.on('userUpdated', (user: { gold: number; exp: number; level: number }) => {
        handleUserUpdated(user);
      });
      scene.events.on('openChickenCoop', () => {
        setShowChickenCoop(true);
      });
      scene.events.on('openFoodWorkshop', () => {
        setShowFoodWorkshop(true);
      });
      scene.events.on('chickenCoopPlaced', () => {
        // 強制重掛 ShopModal，使其重新取得雞舍狀態
        setShopKey(k => k + 1);
      });
      scene.events.on('placementFailed', (message: string) => {
        setPlayerToast(message);
        setTimeout(() => setPlayerToast(''), 2000);
      });
      scene.events.on('game-toast', (message: string) => {
        console.log('[GAMEPAGE TOAST RECEIVED from scene.events]', message);
        setPlayerToast(message);
        setTimeout(() => setPlayerToast(''), 2500);
      });

      // backup listener：window.dispatchEvent 的 game-toast
      const handleWindowToast = (e: Event) => {
        const message = (e as CustomEvent).detail?.message || (e as any).message;
        console.log('[GAMEPAGE TOAST RECEIVED from window]', message);
        console.log('[GAMEPAGE PLAYER TOAST SET]', message);
        setPlayerToast(message);
        setTimeout(() => setPlayerToast(''), 2500);
      };
      window.addEventListener('game-toast', handleWindowToast);
    };
    setTimeout(tryRegister, 50);

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  // ── 任何 Modal 開啟時阻擋 Phaser 農地點擊 ──
  const isModalOpen = showBackpack || showShop || showOrder || showTask || showPlayer || showEvent || showPlayerProfile;
  useEffect(() => {
    // 1. canvas pointerEvents 保險
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.style.pointerEvents = isModalOpen ? 'none' : '';
    }
    // 2. 通知 Phaser Scene 禁用農地點擊
    const scene = gameRef.current?.scene.getScene('FarmScene') as any;
    if (scene?.setFarmInputEnabled) {
      scene.setFarmInputEnabled(!isModalOpen);
    }
  }, [isModalOpen]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handlePurchaseSuccess = (newGold: number, _message: string) => {
    setDisplayUser(prev => ({ ...prev!, gold: newGold }));
    if (updateUser) updateUser({ gold: newGold });
    // 刷新背包資料，讓 SeedSelectModal 可以看到最新數量
    backpackSystem.fetchAll();
  };

  const handleHarvest = (data: { gold: number; exp: number; cropName: string; harvestYield: number }) => {
    // gold/exp/level 統一由 handleUserUpdated（伺服器權威值）更新
    // harvest 事件只用於通知顯示（ cropName + harvestYield）
    // 任務進度已在後端 harvest API 中更新（updateTaskProgress）
    // 這裡只負責刷新任務視窗（如果已開啟）
    console.log('[HARVEST API RESPONSE]', { cropId: undefined, cropName: data.cropName, harvestYield: data.harvestYield, message: `收成成功！${data.cropName} +${data.harvestYield}！` });
    setPlayerToast(`收成成功！${data.cropName} +${data.harvestYield}！`);
    setTimeout(() => setPlayerToast(''), 2500);
    console.log('[HARVEST BACKPACK REFRESHED]');
    if (showTaskRef.current) {
      console.log('[QUEST PROGRESS REQUEST] 任務視窗已開啟，刷新');
      setTaskRefreshKey(k => k + 1);
    } else {
      console.log('[QUEST PROGRESS REQUEST] 任務視窗未開啟，不刷新');
    }
  };

  // ── 從伺服器更新使用者資料（exp/level/gold）──
  const handleUserUpdated = (user: { gold: number; exp?: number; level?: number }) => {
    const oldLevel = displayUser?.level ?? 1;
    setDisplayUser(prev => ({
      ...prev!,
      gold: user.gold ?? prev?.gold,
      exp: user.exp ?? prev?.exp,
      level: user.level ?? prev?.level,
    }));
    if (updateUser) updateUser({
      gold: user.gold ?? displayUser?.gold,
      exp: user.exp ?? displayUser?.exp,
      level: user.level ?? displayUser?.level,
    });
    // 升級檢查：oldLevel 在 setDisplayUser 之前 captured，防止同一 level 重複彈窗
    if (user.level > oldLevel && user.level > (lastShownLevelRef.current ?? 0)) {
      lastShownLevelRef.current = user.level;
      setPendingLevelUp(user.level);
    }
  };

  const handleSellSuccess = (newGold: number, _message: string) => {
    setDisplayUser(prev => ({ ...prev!, gold: newGold }));
    if (updateUser) updateUser({ gold: newGold });
  };

  const handleLevelUp = (_newLevel: number) => {
    // 等級已由 handleUserUpdated 在 setDisplayUser 前 capture oldLevel 並直接設定 pendingLevelUp
    // 這裡只做日誌或預留擴充
  };

  // GDD 等級表（key = 等級, value = 該級累積經驗）
  const GDD_EXP_BY_LEVEL: Record<number, number> = {
    1: 0, 2: 100, 3: 220, 4: 360, 5: 520,
    6: 700, 7: 900, 8: 1120, 9: 1360, 10: 1620,
    11: 1920, 12: 2260, 13: 2640, 14: 3060, 15: 3520,
    16: 4020, 17: 4570, 18: 5170, 19: 5820, 20: 6520,
    21: 7320, 22: 8220, 23: 9220, 24: 10320, 25: 11520,
    26: 12820, 27: 14220, 28: 15720, 29: 17320,
  };
  const currentLevel = displayUser?.level ?? 1;
  const totalExp = displayUser?.exp ?? 0;
  const currentLevelBaseExp = GDD_EXP_BY_LEVEL[currentLevel] ?? 0;
  const nextLevelBaseExp = GDD_EXP_BY_LEVEL[currentLevel + 1] ?? currentLevelBaseExp + 100;
  const displayExp = Math.max(0, totalExp - currentLevelBaseExp);
  const displayMax = nextLevelBaseExp - currentLevelBaseExp;
  const expPercent = displayMax > 0 ? Math.min(100, (displayExp / displayMax) * 100) : 0;
  
  return (
    <>
      <style>{`
        /* 主畫面 - 全頁草地背景 */
        /* Toast 淡入動畫 */
        @keyframes toastFadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes toastFadeOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }

        .game-root {
          width: 100vw;
          height: 100vh;
          background-image: url('/assets/grass/草地.png');
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          font-family: 'Cubic 11', sans-serif;
          position: relative;
          overflow: visible;
        }

        /* 玩家資訊 Bar - 大頭像淡木框 */
        .pip-panel {
          position: absolute;
          left: 16px;
          top: 16px;
          width: 260px;
          background: #F4E6C7;
          border: 4px solid #4A2D16;
          border-radius: 4px;
          overflow: hidden;
          z-index: 20;
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 10px 12px;
          gap: 10px;
          box-sizing: border-box;
          box-shadow: inset 0 3px 0 #FFF8E8, inset 0 -4px 0 #D4B896, 0 4px 0 #3A2010;
        }
        .pip-avatar {
          width: 56px;
          height: 56px;
          image-rendering: pixelated;
          object-fit: cover;
          display: block;
          flex-shrink: 0;
          border: 3px solid #4A2D16;
          border-radius: 8px;
          background: #F4E6C7;
          box-shadow: inset 0 0 0 2px #D4B896;
        }
        .pip-info {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0;
          flex: 1;
          min-width: 0;
        }
        .pip-name { font-size: 18px; font-weight: 700; line-height: 1.1; color: #2B1A0F; }
        .pip-title { font-size: 13px; line-height: 1.2; margin-top: 3px; }
        .pip-level { font-size: 13px; line-height: 1.1; color: #4E6A3D; margin-top: 2px; }
        .pip-exp-label { font-size: 12px; line-height: 1.1; color: #7A6A59; margin-top: 3px; }
        .pip-exp-bar-bg {
          width: 140px;
          height: 8px;
          background: #E8DCC4;
          border: 2px solid #4A2D16;
          overflow: hidden;
          margin-top: 3px;
          box-sizing: border-box;
          background-clip: padding-box;
        }
        .pip-exp-bar-fill {
          height: 100%;
          background: repeating-linear-gradient(
            90deg,
            #63C9FF 0px,
            #63C9FF 4px,
            #58E0C1 4px,
            #58E0C1 8px,
            #3FD7A3 8px,
            #3FD7A3 12px
          );
          transition: width 0.3s ease;
          border-right: 1px solid #2A4A1A;
          box-sizing: border-box;
        }

        /* 貨幣 Bar - 淡框大字 */
        .pc-bar {
          background: #C89A5B;
          border: 4px solid #5A3418;
          box-shadow: inset 0 3px 0 #EFD6A0, inset 0 -4px 0 #8C6030, 0 4px 0 #4B2A12;
          border-radius: 4px;
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .pc-bar-icon {
          width: 22px;
          height: 22px;
          image-rendering: pixelated;
          object-fit: contain;
          display: block;
          flex-shrink: 0;
        }
        .pc-bar-text {
          font-family: 'Cubic 11', sans-serif;
          font-size: 16px;
          font-weight: 700;
          color: #3b2412;
        }

        /* 底部 Hotbar - 五張獨立木牌按鈕 */
        .bottom-hotbar {
          position: absolute;
          left: 50%;
          bottom: 20px;
          transform: translateX(-50%);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 10px;
          width: auto;
          height: auto;
          padding-top: 10px;
          padding-bottom: 10px;
          overflow: visible;
          z-index: 50;
        }
        .hotbar-action-button {
          width: 84px;
          height: 96px;
          background: #C89A5B;
          border: 4px solid #5A3418;
          box-shadow:
            inset 0 3px 0 #EFD6A0,
            inset 0 -4px 0 #8C6030,
            0 4px 0 #4B2A12;
          border-radius: 4px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 6px 4px;
          box-sizing: border-box;
          cursor: pointer;
          flex-shrink: 0;
          overflow: visible;
        }
        .hotbar-action-button:hover {
          transform: translateY(-3px);
        }
        .hotbar-action-button:active {
          transform: translateY(2px);
          box-shadow:
            inset 0 2px 0 #8C6030,
            inset 0 -2px 0 #5A3418,
            0 2px 0 #4B2A12;
        }
        .hotbar-action-icon-wrapper {
          width: 68px;
          height: 68px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: visible;
        }
        .hotbar-action-icon {
          width: 64px !important;
          height: 64px !important;
          object-fit: contain;
          image-rendering: pixelated;
          display: block;
          flex-shrink: 0;
        }
        .hotbar-action-label {
          font-size: 16px;
          font-weight: 700;
          line-height: 1;
          color: #3B2412;
          text-shadow: 1px 1px 0 #FFF3D5;
          margin-top: 2px;
          text-align: center;
        }
        .bottom-hotbar .hotbar-action-button:nth-child(4) .hotbar-action-icon {
          width: 94px !important;
          height: 94px !important;
        }
        .bottom-hotbar .hotbar-action-button:nth-child(1) .hotbar-action-icon {
          width: 58px !important;
          height: 62px !important;
        }
        .bottom-hotbar .hotbar-action-button:nth-child(2) .hotbar-action-icon {
          width: 62px !important;
        }
        .bottom-hotbar .hotbar-action-button:nth-child(5) .hotbar-action-icon {
          width: 52px !important;
          height: 52px !important;
        }
        .bottom-hotbar .hotbar-action-button:nth-child(4) .hotbar-action-icon-wrapper {
          height: 68px !important;
          overflow: visible;
        }
        .bottom-hotbar .hotbar-action-button:nth-child(2) .hotbar-action-label,
        .bottom-hotbar .hotbar-action-button:nth-child(3) .hotbar-action-label,
        .bottom-hotbar .hotbar-action-button:nth-child(5) .hotbar-action-label {
          margin-top: 0 !important;
        }
        .bottom-hotbar .hotbar-action-button:nth-child(4) .hotbar-action-label {
          margin-top: -4px !important;
        }
      `}</style>

      {/* Toast — 全域提示，置於最上層 */}
      {playerToast && (
        <div style={{
          position: 'fixed',
          top: '90px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(45, 30, 15, 0.80)',
          color: '#FFF8D6',
          padding: '10px 18px',
          borderRadius: '9px',
          fontSize: '14px',
          fontWeight: 700,
          zIndex: 99999,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          border: '2px solid rgba(255, 220, 120, 0.45)',
          boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
          animation: 'toastFadeIn 0.2s ease-out',
        }}>
          {playerToast}
        </div>
      )}

    <div className="game-root">

      {/* 頂部狀態列 */}
      <div style={{
        position: 'relative',
        height: 110,
        imageRendering: 'pixelated',
        zIndex: 20,
      }}>
        {/* 玩家資訊面板 */}
        <div className="pip-panel" onClick={() => setShowPlayerProfile(true)} style={{cursor:'pointer'}}>
          <img className="pip-avatar" src={displayUser?.avatar ? `${displayUser.avatar}?t=${avatarKey}` : '/assets/icon/hotbar/icon_player_hotbar.png'} alt="avatar" />
          <div className="pip-info">
            <div className="pip-name">{displayUser?.nickname ?? displayUser?.username ?? displayUser?.name ?? '玩家'}</div>
            <div className="pip-title" style={{ color: displayUser?.title ? '#D8B04A' : '#9A8268' }}>{displayUser?.title ? `稱號：${displayUser.title}` : '尚未設定稱號'}</div>
            <div className="pip-level">Lv.{displayUser?.level ?? 1}</div>
            <div className="pip-exp-label">{totalExp} / {nextLevelBaseExp}</div>
            <div className="pip-exp-bar-bg">
              <div className="pip-exp-bar-fill" style={{ width: `${expPercent.toFixed(1)}%` }} />
            </div>
          </div>
        </div>

        {/* 金幣列 */}
        <div className="pc-bar" style={{
          position: 'absolute',
          right: 200,
          top: 16,
          width: 150,
          height: 48,
        }}>
          <img className="pc-bar-icon currency-icon" src="/assets/icon/ui/icon_coin_ui.png" alt="coin" />
          <span className="pc-bar-text">{displayUser?.gold ?? 500}</span>
        </div>

        {/* 鑽石列 */}
        <div className="pc-bar" style={{
          position: 'absolute',
          right: 16,
          top: 16,
          width: 150,
          height: 48,
        }}>
          <img className="pc-bar-icon currency-icon" src="/assets/icon/ui/icon_diamond_ui.png" alt="diamond" />
          <span className="pc-bar-text">{displayUser?.diamond ?? 0}</span>
        </div>
      </div>

      {/* Phaser 遊戲區域 */}
      <div
        ref={containerRef}
        id="phaserContainer"
        style={{
          position: 'absolute',
          left: 0,
          top: 100,
          right: 0,
          bottom: 100,
          background: 'transparent',
          zIndex: 15,
          pointerEvents: isModalOpen ? 'none' : 'auto',
        }}
      />

      {/* 底部工具列 - 五張獨立木牌按鈕 */}
      <div className="bottom-hotbar">
        <button className="hotbar-action-button" onClick={() => setShowBackpack(true)}>
          <div className="hotbar-action-icon-wrapper">
            <img className="hotbar-action-icon" src={HotbarIconMap.inventory} alt="背包" onError={(e) => { console.log('[HOTBAR] inventory src:', e.currentTarget.src); }} />
          </div>
          <span className="hotbar-action-label">背包</span>
        </button>
        <button className="hotbar-action-button" onClick={() => setShowShop(true)}>
          <div className="hotbar-action-icon-wrapper">
            <img className="hotbar-action-icon" src={HotbarIconMap.shop} alt="商店" onError={(e) => { console.log('[HOTBAR] shop src:', e.currentTarget.src); }} />
          </div>
          <span className="hotbar-action-label">商店</span>
        </button>
        <button className="hotbar-action-button" onClick={() => setShowOrder(true)}>
          <div className="hotbar-action-icon-wrapper">
            <img className="hotbar-action-icon" src={HotbarIconMap.order} alt="訂單" onError={(e) => { console.log('[HOTBAR] order src:', e.currentTarget.src); }} />
          </div>
          <span className="hotbar-action-label">訂單</span>
        </button>
        <button className="hotbar-action-button" onClick={() => { showTaskRef.current = true; setShowTask(true); }}>
          <div className="hotbar-action-icon-wrapper">
            <img className="hotbar-action-icon" src={HotbarIconMap.quest} alt="任務" onError={(e) => { console.log('[HOTBAR] quest src:', e.currentTarget.src); }} />
          </div>
          <span className="hotbar-action-label">任務</span>
        </button>
        <button className="hotbar-action-button" onClick={() => setShowEvent(true)}>
          <div className="hotbar-action-icon-wrapper">
            <img className="hotbar-action-icon" src={HotbarIconMap.event} alt="活動" onError={(e) => { console.log('[HOTBAR] event src:', e.currentTarget.src); }} />
          </div>
          <span className="hotbar-action-label">活動</span>
        </button>
      </div>

      {/* 彈窗：商店 */}
      {showShop && (
        <ShopModal
          key={shopKey}
          onClose={() => setShowShop(false)}
          userGold={displayUser?.gold ?? 0}
          userLevel={displayUser?.level ?? 1}
          onPurchaseSuccess={(newGold, _message) => {
            handlePurchaseSuccess(newGold, _message);
          }}
        />
      )}

      {/* 彈窗：背包 */}
      {showBackpack && (
        <BackpackModal
          onClose={() => {
            setShowBackpack(false);
          }}
          onSelectSeed={(cropId, _cropName) => {
            const scene = gameRef.current?.scene.getScene('FarmScene') as any;
            if (scene && scene.setSelectedSeed) {
              scene.setSelectedSeed(cropId);
              setSelectedTool(null);
            }
          }}
          onSellSuccess={(newGold, _message) => handleSellSuccess(newGold, _message)}
        />
      )}

      {/* DEV：再次觸發升級彈窗（完成後移除） */}
      <button
        onClick={() => {
          setPendingLevelUp(displayUser?.level ?? 6);
          setPendingLevelUnlocks(displayUser?.level === 8
            ? ['農地可擴充 10 → 12', '擴充費用：1800 金幣', '建築材料：無']
            : []);
        }}
        style={{ position: 'fixed', bottom: 80, right: 16, zIndex: 9999, background: '#ff6b00', color: '#fff', border: '2px solid #fff', borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 'bold', cursor: 'pointer' }}
      >
        [DEV] 升級彈窗
      </button>

      {/* 彈窗：升級提示 */}
      {pendingLevelUp !== null && (
        <LevelUpModal newLevel={pendingLevelUp} onClose={() => {
          if (pendingLevelUp >= 8) {
            const scene = gameRef.current?.scene.getScene('FarmScene');
            if (scene) scene.events.emit('extraFarmsUnlocked');
          }
          if (pendingLevelUp >= 10) {
            const scene = gameRef.current?.scene.getScene('FarmScene');
            if (scene) scene.events.emit('workshopUnlocked');
          }
          setPendingLevelUp(null);
          setPendingLevelUnlocks([]);
        }} unlocks={pendingLevelUnlocks} />
      )}

      {/* 彈窗：訂單 */}
      {showOrder && <OrderModal onClose={() => setShowOrder(false)} onUserUpdate={handleUserUpdated} />}

      {/* 彈窗：任務 */}
      {showTask && <TaskModal refreshKey={taskRefreshKey} onClose={() => { showTaskRef.current = false; setShowTask(false); }} onUserUpdate={handleUserUpdated} />}

      {/* 彈窗：玩家 */}
      {showPlayer && <PlayerModal onClose={() => setShowPlayer(false)} user={displayUser} />}
      {showEvent && (
        <EventModal
          onClose={() => setShowEvent(false)}
          onRewardClaimed={(updatedUser) => {
            if (updatedUser) {
              handlePurchaseSuccess(updatedUser.gold, '獎勵已發放');
            }
          }}
        />
      )}

      {/* 彈窗：雞舍 */}
      {showChickenCoop && (
        <ChickenCoopModal
          onClose={() => setShowChickenCoop(false)}
          userGold={displayUser?.gold ?? 0}
          userLevel={displayUser?.level ?? 1}
          onGoldUpdate={(newGold) => {
            setDisplayUser(prev => ({ ...prev!, gold: newGold }));
            if (updateUser) updateUser({ gold: newGold });
          }}
        />
      )}

      {/* 彈窗：食品工坊 */}
      {showFoodWorkshop && (
        <FoodWorkshopModal
          onClose={() => setShowFoodWorkshop(false)}
          userGold={displayUser?.gold ?? 0}
          userLevel={displayUser?.level ?? 1}
          onGoldUpdate={(newGold) => {
            setDisplayUser(prev => ({ ...prev!, gold: newGold }));
            if (updateUser) updateUser({ gold: newGold });
          }}
          onWorkshopUpdate={() => {
            window.dispatchEvent(new Event('inventory-updated'));
          }}
        />
      )}

            {/* ── 玩家資料視窗 ── */}
      {showPlayerProfile && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowPlayerProfile(false)}>
          <div style={{background:'linear-gradient(180deg,#C89A5B 0%,#A07040 100%)',border:'4px solid #5A3418',borderRadius:'12px',padding:'20px',width:'90%',maxWidth:'400px',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 4px 0 #4B2A12, 0 8px 16px rgba(0,0,0,0.4)'}} onClick={e=>e.stopPropagation()}>

            {/* Header */}
            <div style={{position:'relative',marginBottom:'12px',paddingTop:'4px'}}>
              <h2 style={{color:'#3B2412',fontSize:'18px',fontWeight:700,letterSpacing:'1px',textAlign:'center',margin:0}}>玩家資料</h2>
              <button onClick={()=>setShowPlayerProfile(false)} style={{position:'absolute',right:0,top:'-2px',background:'none',border:'none',fontSize:'20px',cursor:'pointer',color:'#5A3418',padding:0,lineHeight:1}}>✕</button>
            </div>



            {/* 玩家名片區 */}
            <div style={{background:'#F4E6C7',border:'3px solid #4A2D16',borderRadius:'8px',padding:'14px',marginBottom:'10px',display:'flex',gap:'14px',alignItems:'flex-start'}}>
              <img src={displayUser?.avatar ? `${displayUser.avatar}?t=${avatarKey}` : '/assets/icon/hotbar/icon_player_hotbar.png'} alt="avatar" style={{width:'72px',height:'72px',objectFit:'cover',border:'3px solid #4A2D16',borderRadius:'8px',boxShadow:'inset 0 0 0 2px #D4B896',flexShrink:0,display:'block'}} />
              <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'20px',fontWeight:800,color:'#2B1A0F',lineHeight:1.2}}>{displayUser?.nickname ?? '玩家'}</div>

                {/* 稱號木牌 */}
                <div style={{background:'linear-gradient(180deg,#C8955A 0%,#A0723A 100%)',border:'2px solid #5A3418',borderRadius:'6px',padding:'2px 8px',display:'inline-block',alignSelf:'flex-start',maxWidth:'100%'}}>
                  <span style={{fontSize:'11px',fontWeight:600,color: displayUser?.titleId ? '#FFE566' : '#8B6914',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'block',maxWidth:'180px'}}>
                    {displayUser?.titleId ? `稱號：${displayUser.titleId}` : '尚未設定稱號'}
                  </span>
                </div>

                <div style={{fontSize:'12px',color:'#4E6A3D',fontWeight:700,letterSpacing:'1px'}}>{displayUser?.playerCode || '-'}</div>
                <div style={{fontSize:'11px',color:'#9A8268'}}>{displayUser?.farmName || displayUser?.nickname + '的農場'}</div>
                <div style={{fontSize:'12px',fontWeight:700,color:'#4E6A3D'}}>Lv.{displayUser?.level ?? 1}</div>
                <div style={{marginTop:'3px'}}>
                  <div style={{width:'100%',height:'7px',background:'#E8DCC4',border:'2px solid #4A2D16',overflow:'hidden'}}>
                    <div style={{width:`${expPercent.toFixed(1)}%`,height:'100%',background:'repeating-linear-gradient(90deg,#63C9FF 0px,#63C9FF 4px,#58E0C1 4px,#58E0C1 8px,#3FD7A3 8px,#3FD7A3 12px)',transition:'width 0.3s'}} />
                  </div>
                  <div style={{fontSize:'10px',color:'#7A6A59',marginTop:'1px'}}>{totalExp} / {nextLevelBaseExp}</div>
                </div>
              </div>
            </div>

            {/* 社交資訊卡 */}
            <div style={{background:'#F4E6C7',border:'3px solid #4A2D16',borderRadius:'8px',padding:'10px 14px',marginBottom:'10px',display:'flex',justifyContent:'space-around',gap:'8px'}}>
              <div style={{textAlign:'center',flex:1}}><div style={{fontSize:'10px',color:'#9A8268'}}>好友數</div><div style={{fontSize:'14px',fontWeight:700,color:'#2B1A0F',marginTop:'1px'}}>{displayUser?.friendCount ?? 0} / {displayUser?.friendLimit ?? 50}</div></div>
              <div style={{width:'1px',background:'#D4B896',margin:'0 4px'}} />
              <div style={{textAlign:'center',flex:1}}><div style={{fontSize:'10px',color:'#9A8268'}}>農場人氣</div><div style={{fontSize:'14px',fontWeight:700,color:'#2B1A0F',marginTop:'1px'}}>{displayUser?.farmPopularity ?? 0}</div></div>
              <div style={{width:'1px',background:'#D4B896',margin:'0 4px'}} />
              <div style={{textAlign:'center',flex:1}}>
                <div style={{fontSize:'10px',color:'#9A8268'}}>最後登入</div>
                <div style={{fontSize:'12px',fontWeight:700,color:'#9A8268',marginTop:'1px'}}>
                  {displayUser?.id === user.id ? '現在在線' : (
                    (() => {
                      const now = Date.now();
                      const last = displayUser?.lastLoginAt ? (displayUser.lastLoginAt > 1e12 ? displayUser.lastLoginAt : displayUser.lastLoginAt * 1000) : null;
                      if (!last) return '—';
                      const diff = now - last;
                      if (diff < 60000) return '剛剛上線';
                      if (diff < 3600000) return `${Math.floor(diff/60000)} 分鐘前`;
                      if (diff < 86400000) return `${Math.floor(diff/3600000)} 小時前`;
                      if (diff < 172800000) return '昨天';
                      return `${Math.floor(diff/86400000)} 天前`;
                    })()
                  )}
                </div>
              </div>
            </div>

            {/* 個人簽名木牌 */}
            {displayUser?.id === user.id && (
              <div style={{background:'linear-gradient(180deg,#F8EACC 0%,#EDD9A3 100%)',border:'2px solid #C9A86C',borderRadius:'6px',padding:'6px 12px',marginBottom:'10px',display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{fontSize:'11px',color:'#8B6914',flex:1,wordBreak:'break-word',lineHeight:1.3}}>{displayUser?.signature || '歡迎來我的農場！'}</span>
                <button
                  onClick={() => { setSigInput(displayUser?.signature || ''); setEditSigOpen(true); }}
                  style={{padding:'2px 6px',background:'#5A3418',color:'#FFF3D5',border:'1px solid #3B2412',borderRadius:'4px',fontSize:'10px',cursor:'pointer',flexShrink:0,fontWeight:600}}
                >編輯</button>
              </div>
            )}

            {/* 加入日期 */}
            {displayUser?.id === user.id && displayUser?.createdAt && (
              <div style={{background:'#E8D6B5',border:'2px solid #7A5A36',borderRadius:'6px',padding:'4px 10px',marginBottom:'10px',textAlign:'center',display:'flex',alignItems:'center',justifyContent:'center',gap:'4px'}}>
                <span style={{fontSize:'12px'}}>📅</span>
                <span style={{fontSize:'11px',color:'#5A3B1C',fontWeight:600,opacity:1}}>
                  加入日期：{(() => { const d = new Date(displayUser.createdAt > 1e12 ? displayUser.createdAt : displayUser.createdAt * 1000); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; })()}
                </span>
              </div>
            )}

            {/* 邀請碼卡 */}
            <div style={{background:'#F4E6C7',border:'3px solid #4A2D16',borderRadius:'8px',padding:'10px 14px',marginBottom:'12px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px'}}>
              <div style={{fontSize:'11px',color:'#9A8268'}}>邀請碼</div>
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <div style={{fontSize:'14px',fontWeight:700,color:'#2B1A0F',letterSpacing:'1px',wordBreak:'break-all'}}>{displayUser?.inviteCode || displayUser?.account || '-'}</div>
                <button onClick={() => { const code = displayUser?.inviteCode || displayUser?.account || ''; navigator.clipboard.writeText(code).then(() => { setPlayerToast('已複製邀請碼'); setTimeout(()=>setPlayerToast(''),1500); }); }} style={{padding:'3px 8px',background:'#5A3418',color:'#FFF3D5',border:'1px solid #3B2412',borderRadius:'6px',fontSize:'11px',cursor:'pointer',flexShrink:0,fontWeight:700}}>複製</button>
              </div>
            </div>

            {/* 主要功能按鈕 */}
            <div style={{display:'flex',gap:'8px',marginBottom:'8px'}}>
              {displayUser?.id === user.id ? (
                <>
                  <button style={{flex:1,padding:'9px 4px',background:'#5A3418',color:'#FFF3D5',border:'2px solid #3B2412',borderRadius:'8px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>好友列表</button>
                  <button style={{flex:1,padding:'9px 4px',background:'#5A3418',color:'#FFF3D5',border:'2px solid #3B2412',borderRadius:'8px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>留言板</button>
                  <button style={{flex:1,padding:'9px 4px',background:'#5A3418',color:'#FFF3D5',border:'2px solid #3B2412',borderRadius:'8px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>稱號收藏</button>
                </>
              ) : (
                <>
                  <button style={{flex:1,padding:'9px 4px',background:'#5A3418',color:'#FFF3D5',border:'2px solid #3B2412',borderRadius:'8px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>拜訪農場</button>
                  <button style={{flex:1,padding:'9px 4px',background:'#5A3418',color:'#FFF3D5',border:'2px solid #3B2412',borderRadius:'8px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>留言板</button>
                  <button style={{flex:1,padding:'9px 4px',background:'#5A3418',color:'#FFF3D5',border:'2px solid #3B2412',borderRadius:'8px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>加好友</button>
                </>
              )}
            </div>

            {/* 個人編輯按鈕 - 只在自己資料時顯示 */}
            {displayUser?.id === user.id && (
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                <button onClick={() => setAvatarModalOpen(true)} style={{flex:'1 1 calc(50% - 3px)',padding:'8px 4px',background:'#E8DCC4',color:'#5A3418',border:'2px solid #4A2D16',borderRadius:'8px',fontSize:'11px',cursor:'pointer',fontWeight:600}}>更換頭像</button>
                <button onClick={() => { setNicknameInput(displayUser?.nickname || ''); setEditNameOpen(true); }} style={{flex:'1 1 calc(50% - 3px)',padding:'8px 4px',background:'#E8DCC4',color:'#5A3418',border:'2px solid #4A2D16',borderRadius:'8px',fontSize:'11px',cursor:'pointer',fontWeight:600}}>修改玩家名稱</button>
                <button onClick={() => { setFarmNameInput(displayUser?.farmName || ''); setEditFarmOpen(true); }} style={{flex:'1 1 calc(50% - 3px)',padding:'8px 4px',background:'#E8DCC4',color:'#5A3418',border:'2px solid #4A2D16',borderRadius:'8px',fontSize:'11px',cursor:'pointer',fontWeight:600}}>修改農場名稱</button>
                <button style={{flex:'1 1 calc(50% - 3px)',padding:'8px 4px',background:'#E8DCC4',color:'#5A3418',border:'2px solid #4A2D16',borderRadius:'8px',fontSize:'11px',cursor:'pointer',fontWeight:600}}>更換稱號</button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── 修改農場名稱小視窗 ── */}
      {editFarmOpen && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)',zIndex:1100,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setEditFarmOpen(false)}>
          <div style={{background:'linear-gradient(180deg,#C89A5B 0%,#A07040 100%)',border:'4px solid #5A3418',borderRadius:'12px',padding:'20px',width:'320px',boxShadow:'0 4px 0 #4B2A12'}} onClick={e=>e.stopPropagation()}>
            <h3 style={{color:'#3B2412',fontSize:'16px',fontWeight:700,textAlign:'center',margin:'0 0 14px'}}>修改農場名稱</h3>
            <input value={farmNameInput} onChange={e=>setFarmNameInput(e.target.value)} maxLength={16} placeholder="輸入農場名稱（2～16字）"
              style={{width:'100%',padding:'8px 10px',border:'2px solid #4A2D16',borderRadius:'6px',fontSize:'13px',boxSizing:'border-box',marginBottom:'12px',outline:'none',background:'#F4E6C7',color:'#2B1A0F'}} />
            <div style={{display:'flex',gap:'8px'}}>
              <button onClick={()=>setEditFarmOpen(false)} style={{flex:1,padding:'8px',background:'#E8DCC4',color:'#5A3418',border:'2px solid #4A2D16',borderRadius:'6px',fontSize:'13px',cursor:'pointer',fontWeight:600}}>取消</button>
              <button onClick={async () => {
                const v = farmNameInput.trim();
                if (v.length < 2) { setPlayerToast('農場名稱至少2字'); setTimeout(()=>setPlayerToast(''),1500); return; }
                if (!/^[a-zA-Z0-9\u4e00-\u9fff\s]{2,16}$/.test(v)) { setPlayerToast('僅限中英文和數字'); setTimeout(()=>setPlayerToast(''),1500); return; }
                try {
                  const res = await authFetch('/api/player/profile', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({farmName:v})});
                  const data = await res.json();
                  if (data.success) {
                    const updated = {...displayUser, farmName: data.user.farmName};
                    setDisplayUser(updated);
                    localStorage.setItem('user', JSON.stringify({...user, farmName: data.user.farmName}));
                    setShowPlayerProfile(false);
                    setTimeout(()=>{setShowPlayerProfile(true);setEditFarmOpen(false);},50);
                  } else { setPlayerToast(data.message); setTimeout(()=>setPlayerToast(''),1500); }
                } catch { setPlayerToast('更新失敗'); setTimeout(()=>setPlayerToast(''),1500); }
              }} style={{flex:1,padding:'8px',background:'#5A3418',color:'#FFF3D5',border:'2px solid #3B2412',borderRadius:'6px',fontSize:'13px',cursor:'pointer',fontWeight:700}}>儲存</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 修改玩家名稱小視窗 ── */}
      {editNameOpen && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)',zIndex:1100,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setEditNameOpen(false)}>
          <div style={{background:'linear-gradient(180deg,#C89A5B 0%,#A07040 100%)',border:'4px solid #5A3418',borderRadius:'12px',padding:'20px',width:'320px',boxShadow:'0 4px 0 #4B2A12'}} onClick={e=>e.stopPropagation()}>
            <h3 style={{color:'#3B2412',fontSize:'16px',fontWeight:700,textAlign:'center',margin:'0 0 14px'}}>修改玩家名稱</h3>
            <input value={nicknameInput} onChange={e=>setNicknameInput(e.target.value)} maxLength={16} placeholder="輸入玩家名稱（1～16字）"
              style={{width:'100%',padding:'8px 10px',border:'2px solid #4A2D16',borderRadius:'6px',fontSize:'13px',boxSizing:'border-box',marginBottom:'12px',outline:'none',background:'#F4E6C7',color:'#2B1A0F'}} />
            <div style={{display:'flex',gap:'8px'}}>
              <button onClick={()=>setEditNameOpen(false)} style={{flex:1,padding:'8px',background:'#E8DCC4',color:'#5A3418',border:'2px solid #4A2D16',borderRadius:'6px',fontSize:'13px',cursor:'pointer',fontWeight:600}}>取消</button>
              <button onClick={async () => {
                const v = nicknameInput.trim();
                if (v.length < 1) { setPlayerToast('玩家名稱至少1字'); setTimeout(()=>setPlayerToast(''),1500); return; }
                if (!/^[a-zA-Z0-9\u4e00-\u9fff\s]{1,16}$/.test(v)) { setPlayerToast('僅限中英文和數字'); setTimeout(()=>setPlayerToast(''),1500); return; }
                try {
                  const res = await authFetch('/api/player/profile', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:v})});
                  const data = await res.json();
                  if (data.success) {
                    const updated = {...displayUser, nickname: data.user.nickname};
                    setDisplayUser(updated);
                    localStorage.setItem('user', JSON.stringify({...user, nickname: data.user.nickname}));
                    setShowPlayerProfile(false);
                    setTimeout(()=>{setShowPlayerProfile(true);setEditNameOpen(false);},50);
                  } else { setPlayerToast(data.message); setTimeout(()=>setPlayerToast(''),1500); }
                } catch { setPlayerToast('更新失敗'); setTimeout(()=>setPlayerToast(''),1500); }
              }} style={{flex:1,padding:'8px',background:'#5A3418',color:'#FFF3D5',border:'2px solid #3B2412',borderRadius:'6px',fontSize:'13px',cursor:'pointer',fontWeight:700}}>儲存</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 修改個人簽名小視窗 ── */}
      {editSigOpen && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)',zIndex:1100,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setEditSigOpen(false)}>
          <div style={{background:'linear-gradient(180deg,#C89A5B 0%,#A07040 100%)',border:'4px solid #5A3418',borderRadius:'12px',padding:'20px',width:'320px',boxShadow:'0 4px 0 #4B2A12'}} onClick={e=>e.stopPropagation()}>
            <h3 style={{color:'#3B2412',fontSize:'16px',fontWeight:700,textAlign:'center',margin:'0 0 14px'}}>修改個人簽名</h3>
            <textarea value={sigInput} onChange={e=>setSigInput(e.target.value)} maxLength={30} rows={2} placeholder="最多30字"
              style={{width:'100%',padding:'8px 10px',border:'2px solid #4A2D16',borderRadius:'6px',fontSize:'13px',boxSizing:'border-box',marginBottom:'12px',outline:'none',background:'#F4E6C7',color:'#2B1A0F',resize:'none',fontFamily:'inherit'}} />
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'12px'}}>
              <span style={{fontSize:'11px',color:sigInput.length > 25 ? '#c0392b' : '#9A8268'}}>{sigInput.length}/30</span>
            </div>
            <div style={{display:'flex',gap:'8px'}}>
              <button onClick={()=>setEditSigOpen(false)} style={{flex:1,padding:'8px',background:'#E8DCC4',color:'#5A3418',border:'2px solid #4A2D16',borderRadius:'6px',fontSize:'13px',cursor:'pointer',fontWeight:600}}>取消</button>
              <button onClick={async () => {
                const v = sigInput;
                if (v.length > 30) { setPlayerToast('簽名最多30字'); setTimeout(()=>setPlayerToast(''),1500); return; }
                try {
                  const res = await authFetch('/api/player/profile', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature:v})});
                  const data = await res.json();
                  if (data.success) {
                    const updated = {...displayUser, signature: data.user.signature};
                    setDisplayUser(updated);
                    localStorage.setItem('user', JSON.stringify({...user, signature: data.user.signature}));
                    setShowPlayerProfile(false);
                    setTimeout(()=>{setShowPlayerProfile(true);setEditSigOpen(false);},50);
                  } else { setPlayerToast(data.message); setTimeout(()=>setPlayerToast(''),1500); }
                } catch { setPlayerToast('更新失敗'); setTimeout(()=>setPlayerToast(''),1500); }
              }} style={{flex:1,padding:'8px',background:'#5A3418',color:'#FFF3D5',border:'2px solid #3B2412',borderRadius:'6px',fontSize:'13px',cursor:'pointer',fontWeight:700}}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>

      {/* ── 更換頭像視窗 ── */}
      {avatarModalOpen && (
        <AvatarModal
          currentAvatar={displayUser?.avatar}
          onClose={() => setAvatarModalOpen(false)}
          onAvatarUpdate={(newAvatar) => {
            // Update auth context user state (triggers re-render of all components using useAuth)
            if (updateUser) updateUser({ avatar: newAvatar });
            // Update displayUser for immediate UI refresh
            setDisplayUser(prev => prev ? { ...prev, avatar: newAvatar } : prev);
            // Bump avatarKey to force browser to reload image (cache bust)
            setAvatarKey(k => k + 1);
          }}
          authFetch={authFetch}
          setPlayerToast={setPlayerToast}
        />
      )}
    </>
  );
}