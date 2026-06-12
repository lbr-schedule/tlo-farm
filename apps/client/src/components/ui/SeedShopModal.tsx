// SeedShopModal - 種子商店
// 購買種子，扣除金幣，增加到背包
import { useEffect, useState } from 'react';
import PixelWindow from './PixelWindow';
import { useAuth } from '../../hooks/useAuth';

interface CropInfo {
  id: number;
  nameZhTw: string;
  growTimeSec: number;
  sellPrice: number;
  buyPrice: number;
  exp: number;
  sprite: string;
  requiredLevel: number;
}

interface SeedShopModalProps {
  onClose: () => void;
  userGold: number;
  userLevel: number;
  onPurchaseSuccess: (newGold: number, message: string) => void;
  onLevelUp?: (newLevel: number) => void;
}

export default function SeedShopModal({ onClose, userGold, userLevel, onPurchaseSuccess, onLevelUp }: SeedShopModalProps) {
  const [crops, setCrops] = useState<CropInfo[]>([]);
  const [lockedCrops, setLockedCrops] = useState<CropInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [userGoldState, setUserGoldState] = useState(userGold);
  const { authFetch } = useAuth();

  useEffect(() => {
    fetchCrops();
  }, []);

  const fetchCrops = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/shop/items');
      const data = await res.json();
      if (data.success) {
        setCrops(data.crops || []);
        setLockedCrops(data.locked || []);
      }
    } catch {
      setMessage('載入失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async (crop: CropInfo) => {
    if (userGoldState < crop.buyPrice) {
      setMessage('金幣不足！');
      return;
    }
    if (userLevel < crop.requiredLevel) {
      setMessage(`需要等級 ${crop.requiredLevel} 才能購買`);
      return;
    }

    setBuying(crop.id);
    setMessage('');
    try {
      const res = await authFetch('/api/shop/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cropId: crop.id, amount: 1 }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message);
        setUserGoldState(data.user.gold);
        onPurchaseSuccess(data.user.gold, data.message);

        // 通知庫存更新（SeedSelectModal 會重新讀取）
        window.dispatchEvent(new Event('inventory-updated'));

        // 檢查升級
        if (data.user.level && data.user.level > userLevel && onLevelUp) {
          onLevelUp(data.user.level);
        }
      } else {
        setMessage(data.message || '購買失敗');
      }
    } catch {
      setMessage('網路錯誤');
    } finally {
      setBuying(null);
    }
  };

  const formatTime = (sec: number) => {
    if (sec < 60) return `${sec}秒`;
    if (sec < 3600) return `${Math.floor(sec / 60)}分`;
    return `${Math.floor(sec / 3600)}時${Math.floor((sec % 3600) / 60)}分`;
  };

  const PixelButton = ({ children, onClick, disabled, variant = 'normal' }: {
    children: React.ReactNode;
        onClick: () => void;
        disabled?: boolean;
        variant?: 'normal' | 'danger' | 'success';
      }) => {
        const colors = {
          normal: { bg: '#8B5A2B', border: '#5C3D2E', shadow: '#3d2518' },
          danger: { bg: '#C0392B', border: '#8B0000', shadow: '#3d2518' },
          success: { bg: '#228B22', border: '#1a6b1a', shadow: '#3d2518' },
        }[variant];

        return (
          <button
            onClick={onClick}
            disabled={disabled}
            style={{
              background: disabled ? '#888' : colors.bg,
              border: `3px solid ${colors.border}`,
              borderRadius: '2px',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: disabled ? 'not-allowed' : 'pointer',
              padding: '6px 12px',
              fontFamily: "'Cubic 11', sans-serif",
              boxShadow: `3px 3px 0 ${colors.shadow}`,
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {children}
          </button>
        );
      };

  return (
    <PixelWindow title="商店" onClose={onClose} width={560}>
      <div style={{ fontFamily: "'Cubic 11', sans-serif" }}>
        {/* 金幣顯示 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '8px',
          marginBottom: '12px',
          fontSize: '16px',
          color: '#3d2518',
        }}>
          <span>金幣：<strong>{userGoldState}</strong></span>
        </div>

        {/* 訊息 */}
        {message && (
          <div style={{
            background: message.includes('失敗') || message.includes('不足') || message.includes('錯誤') ? '#C0392B' : '#27AE60',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '2px',
            marginBottom: '12px',
            fontSize: '14px',
            border: '3px solid #3d2518',
            textAlign: 'center',
          }}>
            {message}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#5C3D2E' }}>載入中...</div>
        ) : (
          <>
            {/* 可購買作物（只顯示已解鎖） */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              {crops.map(crop => (
                <div key={crop.id} style={{
                  background: '#fff',
                  border: '4px solid #5C3D2E',
                  borderRadius: '2px',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: '3px 3px 0 #d4c4a8',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      background: '#7EC850',
                      border: '2px solid #3d2518',
                      borderRadius: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      color: '#fff',
                      fontWeight: 'bold',
                    }}>
                      種
                    </div>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3d2518' }}>
                        {crop.nameZhTw}
                      </div>
                      <div style={{ fontSize: '12px', color: '#8B6914', marginTop: '2px' }}>
                        時間 {formatTime(crop.growTimeSec)} · 售價 {crop.sellPrice} · +{crop.exp} EXP
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#C0392B' }}>
                      {crop.buyPrice} 金幣
                    </span>
                    <PixelButton
                      onClick={() => handleBuy(crop)}
                      disabled={buying === crop.id || userGoldState < crop.buyPrice}
                      variant="success"
                    >
                      {buying === crop.id ? '購買中...' : '購買'}
                    </PixelButton>
                  </div>
                </div>
              ))}
            </div>

            {/* 等級不足作物：MVP 完全隱藏（之後再做完整圖鑑） */}
            {lockedCrops.length > 0 && (
              <div style={{ fontSize: '12px', color: '#aaa', textAlign: 'center', padding: '8px 0' }}>
                （{lockedCrops.length} 種高等級作物已隱藏）
              </div>
            )}
          </>
        )}
      </div>
    </PixelWindow>
  );
}