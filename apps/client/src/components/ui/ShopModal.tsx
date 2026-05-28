import { useEffect, useState } from 'react';
import PixelWindow from './PixelWindow';

interface CropItem {
  id: number;
  nameZhTw: string;
  growTimeSec: number;
  sellPrice: number;
  buyPrice: number;
  exp: number;
  sprite: string;
  requiredLevel: number;
}

interface LockedCrop {
  id: number;
  nameZhTw: string;
  requiredLevel: number;
}

interface ShopModalProps {
  onClose: () => void;
  userGold: number;
  userLevel: number;
  onPurchaseSuccess: (newGold: number, message: string) => void;
}

interface ApiResponse {
  success: boolean;
  message: string;
  crops: CropItem[];
  locked: LockedCrop[];
  purchase?: {
    cropId: number;
    cropName: string;
    amount: number;
    totalCost: number;
  };
  user?: {
    gold: number;
  };
}

export default function ShopModal({ onClose, userGold, userLevel, onPurchaseSuccess }: ShopModalProps) {
  const [crops, setCrops] = useState<CropItem[]>([]);
  const [locked, setLocked] = useState<LockedCrop[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setMessage('請先登入');
      setLoading(false);
      return;
    }
    fetchCrops();
  }, []);

  const fetchCrops = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        setMessage('請先登入');
        return;
      }
      const res = await fetch('http://localhost:3001/api/shop/items', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data: ApiResponse = await res.json();
      if (data.success) {
        setCrops(data.crops || []);
        setLocked(data.locked || []);
      }
    } catch (err) {
      setMessage('載入失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async (cropId: number) => {
    setPurchasing(cropId);
    setMessage('');
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        setMessage('請先登入');
        return;
      }
      const res = await fetch('http://localhost:3001/api/shop/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cropId, amount: 1 })
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message);
        onPurchaseSuccess(data.user.gold, data.message);
        fetchCrops();
      } else {
        setMessage(data.message || '購買失敗');
      }
    } catch {
      setMessage('網路錯誤');
    } finally {
      setPurchasing(null);
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

  if (loading) {
    return (
      <PixelWindow title="🌾 商店" onClose={onClose}>
        <div style={{ textAlign: 'center', padding: '40px', fontFamily: "'Cubic 11', sans-serif" }}>
          載入中...
        </div>
      </PixelWindow>
    );
  }

  return (
    <PixelWindow title="🌾 商店" onClose={onClose} width={480}>
      <div style={{ fontFamily: "'Cubic 11', sans-serif" }}>
        {/* 金幣 & 等級 */}
        <div style={{
          background: '#5C3D2E',
          padding: '10px 14px',
          borderRadius: '4px',
          marginBottom: '14px',
          display: 'flex',
          justifyContent: 'space-between',
          color: '#F5D76E',
          fontSize: '15px',
          border: '3px solid #3d2518',
        }}>
          <span>💰 金幣：{userGold}</span>
          <span>⭐ 等級：{userLevel}</span>
        </div>

        {/* 分頁 */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
          <PixelButton onClick={() => setActiveTab('buy')} disabled={activeTab === 'buy'}>購買種子</PixelButton>
          <PixelButton onClick={() => setActiveTab('sell')} disabled={activeTab === 'sell'}>賣出作物</PixelButton>
        </div>

        {/* 訊息 */}
        {message && (
          <div style={{
            background: '#27AE60',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '2px',
            marginBottom: '12px',
            fontSize: '14px',
            border: '3px solid #1a6b1a',
            textAlign: 'center',
          }}>
            {message}
          </div>
        )}

        {/* 作物列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {activeTab === 'buy' && crops.map(crop => (
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
                  width: '36px',
                  height: '36px',
                  background: '#7EC850',
                  border: '2px solid #3d2518',
                  borderRadius: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                }}>
                  🌱
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3d2518' }}>{crop.nameZhTw}</div>
                  <div style={{ fontSize: '12px', color: '#8B6914', marginTop: '2px' }}>
                    ⏱ {formatTime(crop.growTimeSec)} · 💰 {crop.sellPrice} · +{crop.exp} XP
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                <div style={{ fontSize: '14px', color: '#C0392B', fontWeight: 'bold' }}>
                  💰 {crop.buyPrice}
                </div>
                <PixelButton
                  onClick={() => handleBuy(crop.id)}
                  disabled={userGold < crop.buyPrice || purchasing === crop.id}
                  variant="success"
                >
                  {purchasing === crop.id ? '購買中...' : '購買'}
                </PixelButton>
              </div>
            </div>
          ))}

          {activeTab === 'buy' && locked.length > 0 && (
            <>
              <div style={{ fontSize: '13px', color: '#8B6914', marginTop: '8px', fontWeight: 'bold' }}>
                🔒 等級不足
              </div>
              {locked.map(crop => (
                <div key={crop.id} style={{
                  background: '#e0d8c8',
                  border: '4px solid #aaa',
                  borderRadius: '2px',
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  opacity: 0.7,
                }}>
                  <span style={{ color: '#666', fontSize: '14px' }}>🔒 {crop.nameZhTw}</span>
                  <span style={{ fontSize: '13px', color: '#888' }}>需 Lv.{crop.requiredLevel}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </PixelWindow>
  );
}
