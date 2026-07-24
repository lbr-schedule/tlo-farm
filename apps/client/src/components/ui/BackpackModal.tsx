import { useEffect, useState, useMemo } from 'react';
import PixelWindow from './PixelWindow';
import { backpackSystem, BackpackItem } from '../../systems/BackpackSystem';
import { getInventoryIcon, FALLBACK_ICON } from '../../utils/inventoryIcons';

const DEBUG = false;
console.log('[BackpackModal VERSION] 2026-07-01-fertilizer-dedup');
console.log('[FERTILIZER ICON FIX ACTIVE] BackpackModal');

interface BackpackModalProps {
  onClose: () => void;
  onSelectSeed?: (cropId: number, cropName: string) => void;
  onSellSuccess: (newGold: number, message: string) => void;
}

export default function BackpackModal({ onClose, onSelectSeed, onSellSuccess }: BackpackModalProps) {
  const [items, setItems] = useState<BackpackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selling, setSelling] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'seed' | 'crop' | 'livestock' | 'item'>('crop');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsed, setTotalUsed] = useState(0);

  // ── ESC 鍵關閉 ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // ── 訂閱背包資料 ──
  useEffect(() => {
    const unsub = backpackSystem.subscribe((state) => {
      let list: BackpackItem[] = [];
      if (activeTab === 'seed') list = state.seeds;
      else if (activeTab === 'crop') list = state.crops;
      else if (activeTab === 'livestock') list = state.livestock.filter(i => i.itemId !== 2);
      else if (activeTab === 'item') {
        // 合併 items + fertilizers，過濾 amount <= 0，以 itemId 去重（保留 amount 最大的）
        const merged = [...state.items, ...state.fertilizers];
        const beforeMerge = merged.filter(i => (i.amount ?? 0) > 0);
        const seen = new Map<number, BackpackItem>();
        for (const item of beforeMerge) {
          const existing = seen.get(item.itemId);
          if (!existing || (item.amount ?? 0) > (existing.amount ?? 0)) {
            seen.set(item.itemId, item);
          }
        }
        const afterDedup = Array.from(seen.values());
        console.log('[BACKPACK ITEM TAB SOURCES]', {
          items: state.items,
          fertilizers: state.fertilizers,
          beforeMerge,
          afterDedup,
        });
        list = afterDedup;
      }
      if (DEBUG) { console.log('[BACKPACK MODAL DATA]', { seeds: state.seeds, crops: state.crops, items: state.items, loading: state.loading }); }
      setItems(list);
      setLoading(state.loading);
      setTotalPages(Math.max(1, Math.ceil(list.length / 10)));
      // 計算所有分頁中 amount > 0 的物品總數
      const all = [
        ...state.seeds,
        ...state.crops,
        ...state.livestock.filter(i => i.itemId !== 2),
        ...state.items,
        ...state.fertilizers,
      ];
      setTotalUsed(all.filter(i => (i.amount ?? 0) > 0).length);
    });
    backpackSystem.fetchAll();
    return unsub;
  }, [activeTab]);

  const handleUse = (item: BackpackItem) => {
    if (onSelectSeed) {
      onSelectSeed(item.itemId, item.name);
    }
    onClose();
  };

  const handleSell = async (item: BackpackItem) => {
    const sellId = item.itemId ?? item.item_id ?? item.id;
    console.warn('[SELL EGG FINAL REQUEST]', { sellId, item, requestBody: { itemId: sellId, itemType: 'livestock', amount: 1 } });
    setSelling(item.id);
    setMessage('');
    const result = await backpackSystem.sellItem(sellId);
    if (result.success) {
      setMessage(result.message);
      onSellSuccess(result.newGold, result.message);
    } else {
      setMessage(result.message);
    }
    setSelling(null);
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
    const colors = variant === 'danger'
      ? { bg: '#C0392B', border: '#8B0000', shadow: '#3d2518' }
      : variant === 'success'
        ? { bg: '#228B22', border: '#1a6b1a', shadow: '#3d2518' }
        : { bg: '#8B5A2B', border: '#5C3D2E', shadow: '#3d2518' };

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
      <PixelWindow title="背包" onClose={onClose}>
        <div style={{ textAlign: 'center', padding: '40px', fontFamily: "'Cubic 11', sans-serif" }}>
          載入中...
        </div>
      </PixelWindow>
    );
  }

  const pageSize = 10;
  const start = (page - 1) * pageSize;
  const paginatedItems = items.slice(start, start + pageSize);

  return (
    <PixelWindow title="背包" onClose={onClose} width={480}>
      <div style={{ fontFamily: "'Cubic 11', sans-serif", display: 'flex', flexDirection: 'column', maxHeight: '80vh', minHeight: 0, overflow: 'hidden' }}>
        {/* 分頁 Tab（固定不滑動） */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexShrink: 0 }}>
          <PixelButton onClick={() => { setActiveTab('crop'); setPage(1); }} disabled={activeTab === 'crop'}>
            作物
          </PixelButton>
          <PixelButton onClick={() => { setActiveTab('seed'); setPage(1); }} disabled={activeTab === 'seed'}>
            種子
          </PixelButton>
          <PixelButton onClick={() => { setActiveTab('livestock'); setPage(1); }} disabled={activeTab === 'livestock'}>
            畜牧
          </PixelButton>
          <PixelButton onClick={() => { setActiveTab('item'); setPage(1); }} disabled={activeTab === 'item'}>
            道具
          </PixelButton>
        </div>

        {/* 容量顯示（固定不滑動） */}
        <div style={{ fontSize: '12px', color: '#8B6914', marginBottom: '10px', flexShrink: 0, textAlign: 'right' }}>
          容量：{totalUsed} / 50
        </div>

        {/* 訊息（固定不滑動） */}
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
            flexShrink: 0,
          }}>
            {message}
          </div>
        )}

        {/* 物品列表（可滑動） */}
        <div className="backpack-scroll" style={{
          overflowY: 'auto',
          maxHeight: '420px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          {/* 空狀態 */}
          {items.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#8B6914', fontSize: '15px' }}>
              {activeTab === 'seed' ? '還沒有種子，去商店購買吧！' : activeTab === 'crop' ? '還沒有作物，先去種田吧！' : activeTab === 'livestock' ? '還沒有畜牧產品' : '背包裡還沒有道具'}
            </div>
          )}

          {/* 物品 */}
          {paginatedItems.map(item => {
            const icon = getInventoryIcon(item);
            if (DEBUG) { console.log('[BACKPACK ITEM RENDER]', { itemType: item.itemType, itemId: item.itemId, name: item.name, icon, category: activeTab }); }
            if (item.itemType === 'item' && DEBUG) { console.log('[BACKPACK FERTILIZER RENDER]', { name: item.name, itemType: item.itemType, itemId: item.itemId, icon, category: activeTab, imgWidth: 64, imgHeight: 64 }); }
            return (
            <div key={`${item.itemType}-${item.itemId}-${item.name}`} style={{
              background: '#fff',
              border: '4px solid #5C3D2E',
              borderRadius: '2px',
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '3px 3px 0 #d4c4a8',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '56px',
                  height: '56px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  flexShrink: 0,
                }}>
                  <img
                    src={getInventoryIcon(item)}
                    alt={item.name}
                    className={item.sprite === '普通肥料.png' ? 'item-icon fertilizer-icon' : 'item-icon'}
                    style={
                      activeTab === 'crop' && (item.itemId === 6 || item.itemId === 7)
                        ? { width: 53, height: 53, objectFit: 'contain', imageRendering: 'pixelated' }
                        : activeTab === 'seed' && (item.itemId === 6 || item.itemId === 7)
                        ? { width: 70, height: 70, objectFit: 'contain', imageRendering: 'pixelated', transform: item.itemId === 6 || item.itemId === 7 ? 'translateX(-5px)' : undefined }
                        : activeTab === 'seed' && item.itemId === 5
                        ? { width: 106, height: 106, objectFit: 'contain', imageRendering: 'pixelated', display: 'block', flexShrink: 0 }
                        : activeTab === 'seed'
                        ? { width: 56, height: 56, objectFit: 'contain', imageRendering: 'pixelated' }
                        : {}
                    }


                    onError={(e) => {
                      (e.target as HTMLImageElement).src = FALLBACK_ICON;
                      console.warn('[BACKPACK ICON LOAD ERROR]', {
                        name: item.name,
                        src: (e.target as HTMLImageElement).src,
                      });
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-4px',
                    background: '#C0392B',
                    color: '#fff',
                    borderRadius: '2px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    padding: '1px 4px',
                    border: '2px solid #fff',
                    minWidth: '18px',
                    textAlign: 'center',
                    fontFamily: "'Cubic 11', sans-serif",
                  }}>
                    {item.amount}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3d2518' }}>{item.name}</div>
                  <div style={{ fontSize: '12px', color: '#8B6914', marginTop: '2px' }}>
                    {activeTab === 'seed' ? `時間 ${formatTime(item.growTimeSec)}` : activeTab === 'crop' ? `售價 ${item.sellPrice}` : activeTab === 'livestock' ? `持有 ${item.amount} 個` : `持有 ${item.amount} 個`}
                  </div>
                </div>
              </div>
              {activeTab === 'seed' && (
                <PixelButton onClick={() => handleUse(item)} variant="success">
                  使用
                </PixelButton>
              )}
              {activeTab === 'item' && (
                <PixelButton onClick={() => handleUse(item)} variant="success">
                  使用
                </PixelButton>
              )}
              {activeTab === 'crop' && (
                <PixelButton onClick={() => handleSell(item)} disabled={selling === item.id}>
                  {selling === item.id ? '賣出中...' : '賣出'}
                </PixelButton>
              )}
              {activeTab === 'livestock' && (
                <PixelButton onClick={() => handleSell(item)} disabled={selling === item.id}>
                  {selling === item.id ? '賣出中...' : '賣出'}
                </PixelButton>
              )}
            </div>
          );})}
        </div>

        {/* 分頁導航（固定不滑動） */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px', flexShrink: 0 }}>
            <PixelButton onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>上一頁</PixelButton>
            <span style={{ padding: '6px 12px', fontSize: '14px', color: '#5C3D2E' }}>{page} / {totalPages}</span>
            <PixelButton onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>下一頁</PixelButton>
          </div>
        )}
      </div>
      <style>{`
        .backpack-scroll::-webkit-scrollbar { width: 12px; }
        .backpack-scroll::-webkit-scrollbar-track { background: #E8D6B5; border: 2px solid #4A2D16; }
        .backpack-scroll::-webkit-scrollbar-thumb { background: #7A4A22; border: 2px solid #4A2D16; border-radius: 2px; }
        .backpack-scroll::-webkit-scrollbar-thumb:hover { background: #8B5A2B; }
      `}</style>
    </PixelWindow>
  );
}