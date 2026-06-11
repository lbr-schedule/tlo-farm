import { useEffect, useState } from 'react';
import PixelWindow from './PixelWindow';

interface InventoryItem {
  id: number;
  itemType: 'seed' | 'crop';
  itemId: number;
  amount: number;
  name: string;
  sprite: string;
  sellPrice: number;
  growTimeSec: number;
}

interface InventoryResponse {
  success: boolean;
  message: string;
  inventory: InventoryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface BackpackModalProps {
  onClose: () => void;
  onSelectSeed?: (cropId: number, cropName: string) => void;
  onSellSuccess: (newGold: number, message: string) => void;
}

export default function BackpackModal({ onClose, onSellSuccess }: BackpackModalProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selling, setSelling] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'seed' | 'crop'>('seed');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchInventory();
  }, [activeTab, page]);

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/inventory?type=${activeTab}&page=${page}&limit=10`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data: InventoryResponse = await res.json();
      if (data.success) {
        setItems(data.inventory || []);
        setTotalPages(data.pagination.totalPages || 1);
      }
    } catch {
      setMessage('載入失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleUse = (item: InventoryItem) => {
    if (onSelectSeed) {
      onSelectSeed(item.itemId, item.name);
      onClose();
    }
  };

  const handleSell = async (itemId: number, itemType: string, itemName: string, sellPrice: number) => {
    setSelling(itemId);
    setMessage('');
    try {
      const token = localStorage.getItem('accessToken');
      // 找出 inventory id
      const invItem = items.find(i => i.id === itemId);
      if (!invItem) return;

      const res = await fetch('/api/shop/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cropId: invItem.itemId, amount: 1 })
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message);
        onSellSuccess(data.user.gold, data.message);
        fetchInventory();
      } else {
        setMessage(data.message || '賣出失敗');
      }
    } catch {
      setMessage('網路錯誤');
    } finally {
      setSelling(null);
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
      <PixelWindow title="🎒 背包" onClose={onClose}>
        <div style={{ textAlign: 'center', padding: '40px', fontFamily: "'Cubic 11', sans-serif" }}>
          載入中...
        </div>
      </PixelWindow>
    );
  }

  return (
    <PixelWindow title="🎒 背包" onClose={onClose} width={480}>
      <div style={{ fontFamily: "'Cubic 11', sans-serif" }}>
        {/* 分頁 Tab */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
          <PixelButton onClick={() => { setActiveTab('seed'); setPage(1); }} disabled={activeTab === 'seed'}>
            🌱 種子
          </PixelButton>
          <PixelButton onClick={() => { setActiveTab('crop'); setPage(1); }} disabled={activeTab === 'crop'}>
            🌾 作物
          </PixelButton>
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

        {/* 空狀態 */}
        {items.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '40px',
            color: '#8B6914',
            fontSize: '15px',
          }}>
            {activeTab === 'seed' ? '還沒有種子，去商店購買吧！' : '還沒有作物，先去種田吧！'}
          </div>
        )}

        {/* 物品列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {items.map(item => (
            <div key={item.id} style={{
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
                  background: activeTab === 'seed' ? '#7EC850' : '#F4D03F',
                  border: '2px solid #3d2518',
                  borderRadius: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  position: 'relative',
                }}>
                  {activeTab === 'seed' ? '🌱' : '🌾'}
                  {/* 數量角標 */}
                  <div style={{
                    position: 'absolute',
                    top: '-8px',
                    right: '-8px',
                    background: '#C0392B',
                    color: '#fff',
                    borderRadius: '2px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    padding: '1px 4px',
                    border: '2px solid #fff',
                    minWidth: '18px',
                    textAlign: 'center',
                  }}>
                    {item.amount}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3d2518' }}>{item.name}</div>
                  <div style={{ fontSize: '12px', color: '#8B6914', marginTop: '2px' }}>
                    {activeTab === 'seed' ? `⏱ ${formatTime(item.growTimeSec)}` : `💰 售價 ${item.sellPrice}`}
                  </div>
                </div>
              </div>
              {activeTab === 'seed' && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <PixelButton
                    onClick={() => handleUse(item)}
                    variant="success"
                  >
                    🌱 使用
                  </PixelButton>
                </div>
              )}
              {activeTab === 'crop' && (
                <PixelButton
                  onClick={() => handleSell(item.id, item.itemType, item.name, item.sellPrice)}
                  disabled={selling === item.id}
                >
                  {selling === item.id ? '賣出中...' : `💰 賣出`}
                </PixelButton>
              )}
            </div>
          ))}
        </div>

        {/* 分頁導航 */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
            <PixelButton onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              ◀ 上一頁
            </PixelButton>
            <span style={{ padding: '6px 12px', fontSize: '14px', color: '#5C3D2E' }}>
              {page} / {totalPages}
            </span>
            <PixelButton onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              下一頁 ▶
            </PixelButton>
          </div>
        )}
      </div>
    </PixelWindow>
  );
}
