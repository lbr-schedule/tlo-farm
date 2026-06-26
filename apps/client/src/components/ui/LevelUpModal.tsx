import { useState } from 'react';

interface LevelUpModalProps {
  newLevel: number;
  onClose: () => void;
  unlocks?: string[];
}

export default function LevelUpModal({ newLevel, onClose, unlocks = [] }: LevelUpModalProps) {
  const [closing, setClosing] = useState(false);

  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 300);
  };

  return (
    <div
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
      }}
    >
      <div style={{
        background: '#5C3D2E',
        border: '6px solid #F5D76E',
        borderRadius: '4px',
        boxShadow: '6px 6px 0 #3d2518, inset 0 0 0 4px #3d2518',
        padding: '30px 40px',
        textAlign: 'center',
        animation: closing ? 'levelUpPopOut 0.3s ease-in forwards' : 'levelUpPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        maxWidth: '90vw',
        position: 'relative',
        opacity: closing ? 0 : 1,
        transition: 'opacity 0.3s',
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
          恭喜升級至 Lv{newLevel}！
        </div>

        {/* 等級數字 */}
        <div style={{
          fontSize: '64px',
          fontWeight: 'bold',
          color: '#fff',
          textShadow: '4px 4px 0 #F5D76E',
          animation: 'levelPulse 0.8s ease-in-out infinite alternate',
          marginBottom: '20px',
        }}>
          Lv.{newLevel}
        </div>

        {/* 解鎖提示 */}
        <div style={{
          color: '#d4c4a8',
          fontSize: '15px',
          marginBottom: '24px',
          minHeight: '24px',
        }}>
          {unlocks.length === 0 ? (
            <div style={{ lineHeight: 1.6 }}>
              目前沒有新的解鎖內容。
              <br />
              繼續努力經營農場，
              <br />
              下一級將解鎖更多內容！
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: '10px', color: '#F5D76E', fontSize: '16px' }}>已解鎖：</div>
              {unlocks.map((item, i) => (
                <div key={i} style={{ fontSize: '15px', marginBottom: '6px', color: '#d4c4a8' }}>
                  ・{item}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 確定按鈕 */}
        <button
          onClick={handleClose}
          style={{
            background: '#F5D76E',
            border: '3px solid #8B5A2B',
            borderRadius: '4px',
            color: '#5C3D2E',
            fontSize: '18px',
            fontWeight: 'bold',
            padding: '10px 40px',
            cursor: 'pointer',
            boxShadow: '3px 3px 0 #8B5A2B',
          }}
        >
          【確定】
        </button>
      </div>

      <style>{`
        @keyframes levelUpPop {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes levelUpPopOut {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.8); opacity: 0; }
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
