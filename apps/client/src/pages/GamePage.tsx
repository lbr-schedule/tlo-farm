import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Phaser from 'phaser';
import FarmScene from '../scenes/FarmScene';
import { useAuth } from '../hooks/useAuth';
import ShopModal from '../components/ui/ShopModal';
import BackpackModal from '../components/ui/BackpackModal';
import LevelUpModal from '../components/ui/LevelUpModal';

function CloudField() {
  const clouds = [
    { src: '/assets/ui/cloud.png', size: 280, top: 15, duration: 40, delay: 0 },
    { src: '/assets/ui/cloud_small.png', size: 180, top: 50, duration: 46, delay: -15 },
    { src: '/assets/ui/cloud.png', size: 240, top: 5, duration: 52, delay: -30 },
    { src: '/assets/ui/cloud_small.png', size: 150, top: 60, duration: 58, delay: -20 },
    { src: '/assets/ui/cloud.png', size: 120, top: 35, duration: 64, delay: -45 },
    { src: '/assets/ui/cloud_small.png', size: 100, top: 80, duration: 70, delay: -55 },
  ];

  return (
    <div style={{ position: 'fixed', top: 36, left: 0, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 1 }}>
      {clouds.map((cloud, i) => (
        <img key={i} src={cloud.src} alt="" style={{
          position: 'absolute',
          top: cloud.top,
          left: -200,
          width: cloud.size,
          height: 'auto',
          imageRendering: 'pixelated',
          animation: 'cloudDriftCustom ' + cloud.duration + 's linear ' + cloud.delay + 's infinite, cloudBob 4s ease-in-out 0s infinite',
          opacity: 0.92,
        }} />
      ))}
    </div>
  );
}

function BirdField() {
  const birds = [
    { top: 78, duration: 14, size: 34, reverse: false },
    { top: 98, duration: 17, size: 30, reverse: false },
    { top: 88, duration: 15, size: 32, reverse: true },
    { top: 110, duration: 19, size: 28, reverse: true },
  ];

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
      {birds.map((bird, i) => (
        <img key={i} src="/assets/ui/bird.png" alt="" style={{
          position: 'absolute',
          top: bird.top,
          left: bird.reverse ? 'auto' : (-80 - i * 35),
          right: bird.reverse ? (-80 - i * 35) : 'auto',
          width: bird.size,
          height: 'auto',
          imageRendering: 'pixelated',
          transform: bird.reverse ? 'scaleX(-1)' : 'none',
          animation: (bird.reverse ? 'birdFlyL ' : 'birdFlyR ') + bird.duration + 's linear infinite, birdFlap 0.22s ease-in-out ' + (i * 0.4) + 's infinite',
        }} />
      ))}
    </div>
  );
}

function FloatingLeaves() {
  const leaves = [
    { x: 8, size: 14, speed: 25, delay: 0 },
    { x: 22, size: 12, speed: 28, delay: 5 },
    { x: 38, size: 15, speed: 22, delay: 2 },
    { x: 55, size: 13, speed: 26, delay: 8 },
    { x: 72, size: 16, speed: 24, delay: 3 },
    { x: 88, size: 11, speed: 27, delay: 7 },
  ];

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 3 }}>
      {leaves.map((leaf, i) => (
        <img key={i} src="/assets/ui/leaf.png" alt="" style={{
          position: 'absolute',
          left: leaf.x + '%',
          top: 0,
          width: leaf.size,
          height: 'auto',
          imageRendering: 'pixelated',
          animation: 'leafFloat ' + leaf.speed + 's linear ' + leaf.delay + 's infinite',
          opacity: 0.7,
        }} />
      ))}
    </div>
  );
}

function GrassWithFlowers() {
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: '80px',
      background: 'linear-gradient(180deg, #7EC850 0%, #5A9A30 100%)',
      zIndex: 5,
      pointerEvents: 'none',
      overflow: 'hidden'
    }}>
      {[...Array(30)].map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          bottom: 0,
          left: (i * 3.5) + '%',
          width: '8px',
          height: '20px',
          background: i % 2 === 0 ? '#5A9A30' : '#4A8A20',
          borderRadius: '50% 50% 0 0',
          imageRendering: 'pixelated'
        }} />
      ))}
      <img src="/assets/ui/flower_red.png" alt="" style={{ position: 'absolute', bottom: 15, left: '5%', width: 20, imageRendering: 'pixelated' }} />
      <img src="/assets/ui/flower_yellow.png" alt="" style={{ position: 'absolute', bottom: 20, left: '15%', width: 16, imageRendering: 'pixelated' }} />
      <img src="/assets/ui/flower_blue.png" alt="" style={{ position: 'absolute', bottom: 12, left: '25%', width: 18, imageRendering: 'pixelated' }} />
      <img src="/assets/ui/flower.png" alt="" style={{ position: 'absolute', bottom: 18, left: '45%', width: 14, imageRendering: 'pixelated' }} />
      <img src="/assets/ui/flower_red.png" alt="" style={{ position: 'absolute', bottom: 14, left: '65%', width: 20, imageRendering: 'pixelated' }} />
      <img src="/assets/ui/flower_yellow.png" alt="" style={{ position: 'absolute', bottom: 22, left: '80%', width: 16, imageRendering: 'pixelated' }} />
      <img src="/assets/ui/flower_blue.png" alt="" style={{ position: 'absolute', bottom: 16, left: '92%', width: 18, imageRendering: 'pixelated' }} />
    </div>
  );
}

export default function GamePage() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showBackpack, setShowBackpack] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [pendingLevelUp, setPendingLevelUp] = useState<number | null>(null);
  const [displayUser, setDisplayUser] = useState(user);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    if (user) {
      setDisplayUser(prev => ({
        ...prev,
        gold: user.gold,
        level: user.level,
        exp: user.exp,
      }));
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 800,
      height: 600,
      backgroundColor: '#87CEEB',
      pixelArt: true,
      render: {
        antialias: false,
        pixelArt: true
      },
      physics: {
        default: 'arcade',
        arcade: { gravity: { x: 0, y: 0 }, debug: false }
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: [FarmScene]
    };

    gameRef.current = new Phaser.Game(config);

    // 等場景啟動後再監聽 harvest 事件（Phaser 場景是延遲啟動的）
    let attempts = 0;
    const harvestHandler = (data: { gold: number; exp: number; cropName: string }) => {
      const newGold = (displayUser?.gold ?? 0) + data.gold;
      setDisplayUser(prev => ({ ...prev, gold: newGold, exp: (prev?.exp ?? 0) + data.exp }));
      if (updateUser) updateUser({ gold: newGold });
    };

    const tryRegister = () => {
      attempts++;
      const farmScene = gameRef.current?.scene.getScene('FarmScene');
      if (farmScene && farmScene.events) {
        farmScene.events.on('harvest', harvestHandler);
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

  const handlePurchaseSuccess = (newGold: number, message: string) => {
    setDisplayUser(prev => ({ ...prev, gold: newGold }));
    if (updateUser) updateUser({ gold: newGold });
  };

  const handleHarvest = (data: { gold: number; exp: number; cropName: string }) => {
    const newGold = (displayUser?.gold ?? 0) + data.gold;
    const newExp = (displayUser?.exp ?? 0) + data.exp;
    setDisplayUser(prev => ({ ...prev, gold: newGold, exp: newExp }));
    if (updateUser) updateUser({ gold: newGold, exp: newExp });
    // 檢查是否升級
    const expForLevel = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
    let lv = displayUser?.level ?? 1;
    while (lv < expForLevel.length && newExp >= expForLevel[lv]) {
      lv++;
    }
    if (lv > (displayUser?.level ?? 1)) {
      handleLevelUp(lv);
    }
  };

  const handleSellSuccess = (newGold: number, message: string) => {
    setDisplayUser(prev => ({ ...prev, gold: newGold }));
    if (updateUser) updateUser({ gold: newGold });
  };

  const handleLevelUp = (newLevel: number) => {
    const oldLevel = displayUser?.level || 1;
    if (newLevel > oldLevel) {
      setDisplayUser(prev => ({ ...prev, level: newLevel }));
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
      background: 'linear-gradient(180deg, #87CEEB 0%, #98D8C8 100%)',
      fontFamily: "'Cubic 11', sans-serif",
      position: 'relative',
      overflow: 'hidden'
    }}>
      {mounted && <CloudField />}
      {mounted && <BirdField />}
      {mounted && <FloatingLeaves />}
      {mounted && <GrassWithFlowers />}

      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 36,
        display: 'flex',
        justifyContent: 'center',
        gap: 0,
        imageRendering: 'pixelated',
        zIndex: 10,
        pointerEvents: 'none'
      }}>
        {[...Array(22)].map((_, i) => (
          <img key={i} src="/assets/ui/fence_decoration.png" alt="" style={{
            imageRendering: 'pixelated',
            animation: 'fenceSway 2.5s ease-in-out ' + (i * 0.08) + 's infinite alternate',
          }} />
        ))}
      </div>

      {/* 頂部狀態列 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 20px',
        background: 'rgba(93, 64, 55, 0.95)',
        color: '#fff',
        boxShadow: '0 4px 0 #3d2518',
        fontFamily: "'Cubic 11', sans-serif",
        zIndex: 20,
        position: 'relative'
      }}>
        <div style={{ display: 'flex', gap: '25px', alignItems: 'center', fontSize: '1rem', fontFamily: "'Cubic 11', sans-serif" }}>
          <span style={{ fontWeight: 'bold', fontFamily: "'Cubic 11', sans-serif" }}>👤 {displayUser?.nickname || '玩家'}</span>
          <span style={{ fontFamily: "'Cubic 11', sans-serif" }}>💰 {displayUser?.gold ?? 0}</span>
          <span style={{ fontFamily: "'Cubic 11', sans-serif" }}>⭐ Lv.{displayUser?.level ?? 1}</span>
          <span style={{ fontFamily: "'Cubic 11', sans-serif" }}>✨ {displayUser?.exp ?? 0} XP</span>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setShowShop(true)}
            style={{
              padding: '8px 16px',
              background: '#228B22',
              border: '3px solid #5C3D2E',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '0.9rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '3px 3px 0 #3d2518',
              fontFamily: "'Cubic 11', sans-serif"
            }}
          >
            🛒 商店
          </button>
          <button
            onClick={() => setShowBackpack(true)}
            style={{
              padding: '8px 16px',
              background: '#8B5A2B',
              border: '3px solid #5C3D2E',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '0.9rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '3px 3px 0 #3d2518',
              fontFamily: "'Cubic 11', sans-serif"
            }}
          >
            🎒 背包
          </button>
          <button
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              background: '#8B0000',
              border: '3px solid #5C3D2E',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '0.9rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '3px 3px 0 #3d2518',
              fontFamily: "'Cubic 11', sans-serif"
            }}
          >
            登出
          </button>
        </div>
      </div>

      {/* Phaser 遊戲區域 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: '#87CEEB',
          position: 'relative',
          zIndex: 15
        }}
      />

      {/* 底部工具列 */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '12px',
        padding: '10px 20px',
        background: 'rgba(93, 64, 55, 0.95)',
        boxShadow: '0 -4px 0 #3d2518',
        zIndex: 20,
        position: 'relative'
      }}>
        {['🌱 播種', '💧 澆水', '🌾 收成'].map((tool) => {
          const toolMap: Record<string, string> = { '🌱 播種': '播種', '💧 澆水': '澆水', '🌾 收成': '收成' };
          const isSelected = selectedTool === toolMap[tool];
          return (
          <button
            key={tool}
            onClick={() => {
              const scene = gameRef.current?.scene.getScene('FarmScene') as any;
              if (scene) {
                // 先清除舊選中框
                if (scene.clearSelection) scene.clearSelection();
                scene.selectedTool = toolMap[tool];
              }
              setSelectedTool(toolMap[tool]);
            }}
            style={{
              padding: '10px 20px',
              background: isSelected ? '#3d2518' : '#6B8E23',
              border: '3px solid #3d2518',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: isSelected ? '0 0 0 3px #FFD700, 3px 3px 0 #3d2518' : '3px 3px 0 #3d2518',
              fontFamily: "'Cubic 11', sans-serif",
              transform: isSelected ? 'translateY(2px)' : 'none'
            }}
          >
            {tool}
          </button>
          );
        })}
      </div>

      {/* 彈窗：商店 */}
      {showShop && (
        <ShopModal
          onClose={() => setShowShop(false)}
          userGold={displayUser?.gold ?? 0}
          userLevel={displayUser?.level ?? 1}
          onPurchaseSuccess={(newGold, message) => {
            handlePurchaseSuccess(newGold, message);
            // 檢查是否升級
            const expForLevel = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
            const newExp = displayUser?.exp ?? 0;
            let lv = displayUser?.level ?? 1;
            while (lv < expForLevel.length && newExp >= expForLevel[lv]) {
              lv++;
            }
            if (lv > (displayUser?.level ?? 1)) {
              handleLevelUp(lv);
            }
          }}
        />
      )}

      {/* 彈窗：背包 */}
      {showBackpack && (
        <BackpackModal
          onClose={() => setShowBackpack(false)}
          onSelectSeed={(cropId, cropName) => {
            const scene = gameRef.current?.scene.getScene('FarmScene') as any;
            if (scene && scene.setSelectedSeed) {
              scene.setSelectedSeed(cropId);
              setSelectedTool(null);
            }
          }}
          onSellSuccess={(newGold, message) => handleSellSuccess(newGold, message)}
        />
      )}

      {/* 彈窗：升級提示 */}
      {pendingLevelUp !== null && (
        <LevelUpModal
          newLevel={pendingLevelUp}
          onClose={() => setPendingLevelUp(null)}
        />
      )}

      <style>{`
        @keyframes cloudDriftCustom { from { left: -200px; } to { left: calc(100vw + 200px); } }
        @keyframes cloudBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }
        @keyframes birdFlyR { from { left: -80px; } to { left: calc(100vw + 80px); } }
        @keyframes birdFlyL { from { right: -80px; } to { right: calc(100vw + 80px); } }
        @keyframes birdFlap { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.35); } }
        @keyframes leafFloat { 0% { transform: translateY(-20px) rotate(0deg); opacity: 0; } 10% { opacity: 0.7; } 90% { opacity: 0.7; } 100% { transform: translateY(100vh) rotate(360deg); opacity: 0; } }
        @keyframes fenceSway { 0% { transform: rotate(-1.5deg); } 100% { transform: rotate(1.5deg); } }
      `}</style>
    </div>
  );
}
