import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Phaser from 'phaser';
import FarmScene from '../scenes/FarmScene';
import { useAuth } from '../hooks/useAuth';
import ShopModal from '../components/ui/ShopModal';
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

  useEffect(() => {
    if (user) setDisplayUser(user);
  }, [user]);

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
      if (scene?.sys.settings?.status === 'loaded' || (scene as any)?.texture) {
        scene.events.on('harvest', (data: { gold: number; exp: number; cropName: string }) => {
          handleHarvest(data);
        });
        return;
      }
      const attempts = (tryRegister as any).attempts || 0;
      (tryRegister as any).attempts = attempts + 1;
      if (scene?.scene) {
        scene.events.once('ready', () => {
          scene.events.on('harvest', (data: { gold: number; exp: number; cropName: string }) => {
            handleHarvest(data);
          });
        });
      } else if (attempts < 20) {
        setTimeout(tryRegister, 100);
      }
    };
    setTimeout(tryRegister, 50);

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handlePurchaseSuccess = (newGold: number, _message: string) => {
    setDisplayUser(prev => ({ ...prev!, gold: newGold }));
    if (updateUser) updateUser({ gold: newGold });
  };

  const handleHarvest = (data: { gold: number; exp: number; cropName: string }) => {
    const newGold = (displayUser?.gold ?? 0) + data.gold;
    const newExp = (displayUser?.exp ?? 0) + data.exp;
    setDisplayUser(prev => ({ ...prev!, gold: newGold, exp: newExp }));
    if (updateUser) updateUser({ gold: newGold, exp: newExp });
    const expForLevel = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
    let lv = displayUser?.level ?? 1;
    while (lv < expForLevel.length && newExp >= expForLevel[lv]) lv++;
    if (lv > (displayUser?.level ?? 1)) handleLevelUp(lv);
  };

  const handleSellSuccess = (newGold: number, _message: string) => {
    setDisplayUser(prev => ({ ...prev!, gold: newGold }));
    if (updateUser) updateUser({ gold: newGold });
  };

  const handleLevelUp = (newLevel: number) => {
    const oldLevel = displayUser?.level || 1;
    if (newLevel > oldLevel) {
      setDisplayUser(prev => ({ ...prev!, level: newLevel }));
      setPendingLevelUp(newLevel);
      if (updateUser) updateUser({ level: newLevel });
    }
  };

  return (
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
        <div style={{
          position: 'absolute',
          left: 24,
          top: 24,
          width: 360,
          height: 120,
          backgroundImage: "url('/assets/ui/ui_player_info .png')",
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'left top',
          imageRendering: 'pixelated',
        }}>
          {/* 頭像 */}
          <img src="/assets/icon/icon_player.png" alt="avatar" style={{ position: 'absolute', left: 24, top: 28, width: 72, height: 72, imageRendering: 'pixelated', objectFit: 'contain' }} />
          {/* 等級 */}
          <span style={{ position: 'absolute', left: 115, top: 52, fontFamily: "'Cubic 11', sans-serif", fontSize: 18, color: '#3b2412' }}>
            Lv.{displayUser?.level ?? 1}
          </span>
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
            const expForLevel = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
            const newExp = displayUser?.exp ?? 0;
            let lv = displayUser?.level ?? 1;
            while (lv < expForLevel.length && newExp >= expForLevel[lv]) lv++;
            if (lv > (displayUser?.level ?? 1)) handleLevelUp(lv);
          }}
        />
      )}

      {/* 彈窗：背包 */}
      {showBackpack && (
        <BackpackModal
          onClose={() => setShowBackpack(false)}
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
  );
}