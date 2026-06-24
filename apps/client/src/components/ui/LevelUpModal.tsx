import { useEffect, useState } from 'react';

interface LevelUpModalProps {
  newLevel: number;
  onClose: () => void;
  unlocks?: string[];
}

export default function LevelUpModal({ newLevel, onClose, unlocks = [] }: LevelUpModalProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  if (!visible) return null;

  return (
    <div
      onClick={() => { setVisible(false); setTimeout(onClose, 300); }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        fontFamily: "'Cubic 11', sans-serif",
        cursor: 'pointer',
      }}
    >
      <div style={{
        background: '#5C3D2E',
        border: '6px solid #F5D76E',
        borderRadius: '4px',
        boxShadow: '6px 6px 0 #3d2518, inset 0 0 0 4px #3d2518',
        padding: '30px 40px',
        textAlign: 'center',
        animation: 'levelUpPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        maxWidth: '90vw',
      }}>
        {/* 星星裝飾 */}
        <div style={{ fontSize: '48px', marginBottom: '10px', animation: 'starSpin 1s ease-in-out infinite' }}>
          ⭐⭐⭐
        </div>

        {/* 等級提升文字 */}
        <div style={{
          color: '#F5D76E',
          fontSize: '28px',
          fontWeight: 'bold',
          textShadow: '3px 3px 0 #8B5A2B',
          marginBottom: '10px',
        }}>
          等級提升！
        </div>

        {/* 等級數字 */}
        <div style={{
          fontSize: '64px',
          fontWeight: 'bold',
          color: '#fff',
          textShadow: '4px 4px 0 #F5D76E',
          animation: 'levelPulse 0.8s ease-in-out infinite alternate',
          marginBottom: '10px',
        }}>
          Lv.{newLevel}
        </div>

        {/* 解鎖提示 */}
        <div style={{
          color: '#d4c4a8',
          fontSize: '15px',
          marginBottom: '20px',
        }}>
          {newLevel >= 10 && unlocks.includes('workshop')
            ? '🏭 食品工坊已解鎖！前往商店購買吧！'
            : newLevel >= 8
            ? '🌾 可以購買新的作物種子了！'
            : '可以購買新的作物種子了！'}
        </div>

        {/* 點擊關閉提示 */}
        <div style={{
          color: '#8B6914',
          fontSize: '13px',
        }}>
          點擊任意處關閉
        </div>
      </div>

      <style>{`
        @keyframes levelUpPop {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes levelPulse {
          from { transform: scale(1); }
          to { transform: scale(1.05); }
        }
        @keyframes starSpin {
          0%, 100% { transform: rotate(-5deg); }
          50% { transform: rotate(5deg); }
        }
      `}</style>
    </div>
  );
}
