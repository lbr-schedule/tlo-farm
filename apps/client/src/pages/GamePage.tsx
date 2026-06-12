import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Phaser from 'phaser';
import FarmScene from '../scenes/FarmScene';
import { useAuth } from '../hooks/useAuth';
import ShopModal from '../components/ui/ShopModal';
import { backpackSystem } from '../systems/BackpackSystem';
import BackpackModal from '../components/ui/BackpackModal';
import LevelUpModal from '../components/ui/LevelUpModal';
import OrderModal from '../components/ui/OrderModal';
import QuestModal from '../components/ui/QuestModal';
import PlayerModal from '../components/ui/PlayerModal';

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
  const { user, logout, updateUser } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [showShop, setShowShop] = useState(false);
  const [showBackpack, setShowBackpack] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [showQuest, setShowQuest] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [displayUser, setDisplayUser] = useState(user);
  const [pendingLevelUp, setPendingLevelUp] = useState<number | null>(null);
  const lastShownLevelRef = useRef<number | null>(null);

  useEffect(() => {
    if (user) setDisplayUser(user);
  }, [user]);

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
      backgroundColor: '#79B95B',
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

      scene.events.on('harvest', (data: { gold: number; exp: number; cropName: string }) => {
        handleHarvest(data);
      });
      scene.events.on('userUpdated', (user: { gold: number; exp: number; level: number }) => {
        handleUserUpdated(user);
      });
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
  const isModalOpen = showBackpack || showShop || showOrder || showQuest || showPlayer;
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

  const handleHarvest = (_data: { gold: number; exp: number; cropName: string }) => {
    // gold/exp/level 統一由 handleUserUpdated（伺服器權威值）更新
    // harvest 事件只用於通知顯示（ cropName 等）
  };

  // ── 從伺服器更新使用者資料（exp/level/gold）──
  const handleUserUpdated = (user: { gold: number; exp: number; level: number }) => {
    const oldLevel = displayUser?.level ?? 1;
    setDisplayUser(prev => ({
      ...prev!,
      gold: user.gold,
      exp: user.exp,
      level: user.level,
    }));
    if (updateUser) updateUser({ gold: user.gold, exp: user.exp, level: user.level });
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

  // 計算升級所需經驗
  const expForLevel = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
  const currentLevel = displayUser?.level ?? 1;
  const currentExp = displayUser?.exp ?? 0;
  const nextLevelExp = expForLevel[Math.min(currentLevel, expForLevel.length - 1)] ?? 100;
  const expPercent = Math.min(100, (currentExp / nextLevelExp) * 100);
  console.log('[PlayerInfo] NEW COMPONENT ACTIVE');

  return (
    <>
      <style>{`
        .pip-panel { position: absolute; left: 24px; top: 24px; width: 360px; height: 120px; background-image: url('/assets/ui/ui_player_info .png'); background-size: 360px 120px; background-repeat: no-repeat; background-position: left top; image-rendering: pixelated; overflow: hidden; }
        .pip-avatar { position: absolute; left: 24px; top: 30px; width: 56px; height: 56px; image-rendering: pixelated; object-fit: contain; }
        .pip-level { position: absolute; left: 110px; top: 30px; font-size: 16px; font-family: 'Cubic 11', sans-serif; color: #3b2412; }
        .pip-exp-text { position: absolute; left: 110px; top: 54px; font-size: 12px; font-family: 'Cubic 11', sans-serif; color: #5C3D2E; }
        .pip-exp-bar-bg { position: absolute; left: 110px; top: 78px; width: 130px; height: 8px; background: #3d2518; border-radius: 2px; overflow: hidden; }
        .pip-exp-bar-fill { height: 100%; background: #7fd34e; border-radius: 2px; transition: width 0.3s ease; }
      `}</style>
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#79B95B',
      fontFamily: "'Cubic 11', sans-serif",
      position: 'relative',
      overflow: 'hidden'
    }}>

      {/* 頂部狀態列 */}
      <div style={{
        position: 'relative',
        height: 160,
        imageRendering: 'pixelated',
        zIndex: 20,
      }}>
        {/* 玩家資訊面板 */}
        <div className="pip-panel">
          <img className="pip-avatar" src="/assets/icon/icon_player.png" alt="avatar" />
          <div className="pip-level">Lv.{displayUser?.level ?? 1}</div>
          <div className="pip-exp-text">EXP {currentExp} / {nextLevelExp}</div>
          <div className="pip-exp-bar-bg">
            <div className="pip-exp-bar-fill" style={{ width: `${expPercent.toFixed(1)}%` }} />
          </div>
        </div>

        {/* 金幣列 */}
        <div style={{
          position: 'absolute',
          right: 260,
          top: 34,
          width: 220,
          height: 56,
          backgroundImage: "url('/assets/ui/ui_currency_bar.png')",
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          imageRendering: 'pixelated',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ fontFamily: "'Cubic 11', sans-serif", fontSize: 20, color: '#3b2412', fontWeight: 'bold' }}>
            {displayUser?.gold ?? 500}
          </span>
        </div>

        {/* 鑽石列 */}
        <div style={{
          position: 'absolute',
          right: 24,
          top: 34,
          width: 220,
          height: 56,
          backgroundImage: "url('/assets/ui/ui_currency_bar.png')",
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          imageRendering: 'pixelated',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ fontFamily: "'Cubic 11', sans-serif", fontSize: 20, color: '#3b2412', fontWeight: 'bold' }}>
            0
          </span>
        </div>
      </div>

      {/* Phaser 遊戲區域 */}
      <div
        ref={containerRef}
        id="phaserContainer"
        style={{
          position: 'absolute',
          left: 0,
          top: 120,
          width: '100vw',
          height: 'calc(100vh - 210px)',
          background: 'transparent',
          zIndex: 15,
          pointerEvents: isModalOpen ? 'none' : 'auto',
        }}
      />

      {/* 底部工具列 */}
      <div id="hotbar" style={{
        position: 'absolute',
        bottom: 50,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 900,
        height: 90,
        backgroundImage: "url('/assets/ui/ui_hotbar.png')",
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        imageRendering: 'pixelated',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'row',
      }}>
        <div style={{ width: 180, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => setShowBackpack(true)}>
          <span style={{ fontFamily: "'Cubic 11', sans-serif", fontSize: 24, fontWeight: 'bold', color: '#3b2412', textAlign: 'center', textShadow: '1px 1px 0 #fff2c2, -1px 1px 0 #fff2c2, 1px -1px 0 #fff2c2, -1px -1px 0 #fff2c2' }}>背包</span>
        </div>
        <div style={{ width: 180, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => setShowShop(true)}>
          <span style={{ fontFamily: "'Cubic 11', sans-serif", fontSize: 24, fontWeight: 'bold', color: '#3b2412', textAlign: 'center', textShadow: '1px 1px 0 #fff2c2, -1px 1px 0 #fff2c2, 1px -1px 0 #fff2c2, -1px -1px 0 #fff2c2' }}>商店</span>
        </div>
        <div style={{ width: 180, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => setShowOrder(true)}>
          <span style={{ fontFamily: "'Cubic 11', sans-serif", fontSize: 24, fontWeight: 'bold', color: '#3b2412', textAlign: 'center', textShadow: '1px 1px 0 #fff2c2, -1px 1px 0 #fff2c2, 1px -1px 0 #fff2c2, -1px -1px 0 #fff2c2' }}>訂單</span>
        </div>
        <div style={{ width: 180, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => setShowQuest(true)}>
          <span style={{ fontFamily: "'Cubic 11', sans-serif", fontSize: 24, fontWeight: 'bold', color: '#3b2412', textAlign: 'center', textShadow: '1px 1px 0 #fff2c2, -1px 1px 0 #fff2c2, 1px -1px 0 #fff2c2, -1px -1px 0 #fff2c2' }}>任務</span>
        </div>
        <div style={{ width: 180, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => setShowPlayer(true)}>
          <span style={{ fontFamily: "'Cubic 11', sans-serif", fontSize: 24, fontWeight: 'bold', color: '#3b2412', textAlign: 'center', textShadow: '1px 1px 0 #fff2c2, -1px 1px 0 #fff2c2, 1px -1px 0 #fff2c2, -1px -1px 0 #fff2c2' }}>玩家</span>
        </div>
      </div>

      {/* 彈窗：商店 */}
      {showShop && (
        <ShopModal
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

      {/* 彈窗：升級提示 */}
      {pendingLevelUp !== null && (
        <LevelUpModal newLevel={pendingLevelUp} onClose={() => setPendingLevelUp(null)} />
      )}

      {/* 彈窗：訂單 */}
      {showOrder && <OrderModal onClose={() => setShowOrder(false)} />}

      {/* 彈窗：任務 */}
      {showQuest && <QuestModal onClose={() => setShowQuest(false)} />}

      {/* 彈窗：玩家 */}
      {showPlayer && <PlayerModal onClose={() => setShowPlayer(false)} user={displayUser} />}
    </div>
    </>
  );
}