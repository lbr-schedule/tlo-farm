// SeedShopModal - 種子商店（升級版：支援道具+畜牧）
// 購買種子，扣除金幣，增加到背包

console.log('[SEED SHOP MODAL VERSION] 2026-06-26-fix-check');

const DEBUG = false;

import { useEffect, useState } from 'react';
import PixelWindow from './PixelWindow';
import { useAuth } from '../../hooks/useAuth';
import { backpackSystem } from '../../systems/BackpackSystem';

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

interface ItemInfo {
  id: number;
  nameZhTw: string;
  itemType: string;
  itemKey: string;
  buyPrice: number;
  sellPrice: number;
  sprite: string;
  effectType: string;
  effectValue: number;
  requiredLevel: number;
}

interface LivestockInfo {
  id: string;
  nameZhTw: string;
  buyPrice: number;
  requiredLevel: number;
  sprite: string;
  itemType: 'building' | 'livestock' | 'consumable';
  description?: string;
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
  const [items, setItems] = useState<ItemInfo[]>([]);
  const [livestock, setLivestock] = useState<LivestockInfo[]>([]);
  const [lockedCrops, setLockedCrops] = useState<CropInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<number | string | null>(null);
  const [message, setMessage] = useState('');
  const [userGoldState, setUserGoldState] = useState(userGold);
  const [seedCounts, setSeedCounts] = useState<Record<number, number>>({});
  const [itemCounts, setItemCounts] = useState<Record<number, number>>({});
  const [feedCount, setFeedCount] = useState(0);
  const [activeTab, setActiveTab] = useState<'seeds' | 'items' | 'livestock'>('seeds');
  const { authFetch } = useAuth();

  // 雞舍狀態
  const [chickenStatus, setChickenStatus] = useState<{
    placedCoop: boolean;    // 雞舍已放置
    pendingCoop: boolean;   // 已購買但尚未放置
    chickenCount: number;   // 目前小雞數量
    maxCapacity: number;     // 最大容量
    loading: boolean;
  }>({ placedCoop: false, pendingCoop: false, chickenCount: 0, maxCapacity: 4, loading: false });

  useEffect(() => {
    fetchShopData();
    backpackSystem.fetchAll();
    const unsub = backpackSystem.subscribe((state) => {
      if (DEBUG) { console.log('[SEED SHOP BACKPACK STATE]', {
        seeds: state.seeds,
        crops: state.crops,
        items: state.items
      }); }
      const sCounts: Record<number, number> = {};
      (state.seeds ?? []).forEach(s => { sCounts[s.itemId] = s.amount; });
      setSeedCounts(sCounts);
      const iCounts: Record<number, number> = {};
      (state.items ?? []).forEach(i => { iCounts[i.itemId] = i.amount; });
      setItemCounts(iCounts);
      const feedItem = (state.items ?? []).find(i => i.itemId === 2);
      console.log('[5173 FEED INVENTORY COUNT AFTER]', { feedItem, feedCountSet: feedItem?.amount ?? 0, allItems: state.items });
      setFeedCount(feedItem?.amount ?? 0);
    });
    return unsub;
  }, []);

  // 當畜牧 tab 打開時，從 server status API 取得雞舍狀態（統一資料源）
  useEffect(() => {
    if (activeTab !== 'livestock') return;

    setChickenStatus(prev => ({ ...prev, loading: true }));

    authFetch('/api/animals/chicken-coop/status')
      .then(res => res.json())
      .then(data => {
        console.log('[SHOP LIVESTOCK STATUS API RESPONSE]', data);
        if (!data.success) {
          setChickenStatus(prev => ({ ...prev, loading: false }));
          return;
        }
        // hasBuilding：server 已計算好
        const placedCoop = !!data.hasBuilding;
        // animalCount：slots 中非 EMPTY 的數量
        const animalCount = (data.slots || []).filter((s: any) => s.state !== 'EMPTY').length;
        const maxCapacity = (data.slots || []).length || 4;
        setChickenStatus({
          placedCoop,
          pendingCoop: false,
          chickenCount: animalCount,
          maxCapacity,
          loading: false,
        });
        console.log('[SHOP LIVESTOCK STATUS RENDER]', {
          placedCoop,
          hasBuilding: data.hasBuilding,
          animalCount,
          capacity: maxCapacity,
          feedCount,
          chickenCoopButtonDisabled: placedCoop,
          chickButtonDisabled: !placedCoop || animalCount >= maxCapacity,
          feedDisplayCount: feedCount,
        });
      })
      .catch(err => {
        console.error('[SHOP LIVESTOCK STATUS API ERROR]', err);
        setChickenStatus(prev => ({ ...prev, loading: false }));
      });
  }, [activeTab, feedCount]);

  const fetchShopData = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/shop/items');
      const data = await res.json();
      if (data.success) {
        setCrops(data.crops || []);
        setLockedCrops(data.locked || []);
        setItems(data.items || []);
        setLivestock(data.livestock || []);
      }
    } catch {
      setMessage('載入失敗');
    } finally {
      setLoading(false);
    }
  };

  // 從 localStorage 讀取雞舍狀態（不使用 API）
  const readChickenCoopFromLocal = () => {
    const raw = localStorage.getItem('tlo_farm_chicken_coop');
    const coop = raw ? JSON.parse(raw) : null;
    const placedCoop = !!coop && coop.type === 'chicken_coop';
    return {
      placedCoop,
      pendingCoop: false,
      chickenCount: coop?.animals?.length ?? 0,
      maxCapacity: coop?.capacity ?? 4,
    };
  };

  const handleBuyCrop = async (crop: CropInfo) => {
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
        window.dispatchEvent(new Event('inventory-updated'));
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

  const handleBuyItem = async (item: ItemInfo) => {
    if (userGoldState < item.buyPrice) {
      setMessage('金幣不足！');
      return;
    }
    if (userLevel < item.requiredLevel) {
      setMessage(`需要等級 ${item.requiredLevel} 才能購買`);
      return;
    }

    setBuying(item.id);
    setMessage('');
    try {
      const res = await authFetch('/api/shop/buy-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, amount: 1 }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message);
        setUserGoldState(data.user.gold);
        onPurchaseSuccess(data.user.gold, data.message);
        window.dispatchEvent(new Event('inventory-updated'));
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

  const handleBuyLivestock = async (item: LivestockInfo) => {
    console.log('[BUY LIVESTOCK HANDLER ENTERED]', { itemId: item.id, nameZhTw: item.nameZhTw, itemType: item.itemType, isFeed: item.id === 'feed_normal' });
    if (userGoldState < item.buyPrice) {
      setMessage('金幣不足！');
      return;
    }
    if (userLevel < item.requiredLevel) {
      setMessage(`需要等級 ${item.requiredLevel} 才能購買`);
      return;
    }

    // ── 普通飼料：直接寫入 livestock localStorage（不走小雞邏輯）──
    const isFeed = item.id === 'feed_normal' || item.nameZhTw === '普通飼料';
    console.log('[BUY FEED CHECK]', {
      itemId: item.id,
      itemIdType: typeof item.id,
      nameZhTw: item.nameZhTw,
      isFeed,
      item: JSON.parse(JSON.stringify(item)),
    });
    if (isFeed) {
      console.log('[5173 FEED BUY START]', { itemId: item.id, gold: userGoldState, buyPrice: item.buyPrice });
      if (userGoldState < item.buyPrice) { setMessage('金幣不足！'); return; }
      if (userLevel < item.requiredLevel) { setMessage(`需要等級 ${item.requiredLevel} 才能購買`); return; }
      setBuying(item.id);
      setMessage('');
      try {
        const res = await authFetch('/api/shop/buy-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: 2, amount: 1 }),
        });
        const data = await res.json();
        console.log('[5173 FEED BUY API RESPONSE]', data);
        if (data.success) {
          setMessage(data.message);
          setUserGoldState(data.user.gold);
          onPurchaseSuccess(data.user.gold, data.message);
          // ✅ 購買成功後重新抓背包，確保 state.items 有最新庫存
          await backpackSystem.fetchAll();
          // ✅ 同時通知其他系統
          window.dispatchEvent(new Event('inventory-updated'));
        } else {
          setMessage(data.message || '購買失敗');
        }
      } catch {
        setMessage('網路錯誤');
      } finally {
        setBuying(null);
      }
      return;
    }

    // ── 小雞（livestock）：直接用 localStorage ──
    if (item.itemType === 'livestock') {
      const coopRaw = localStorage.getItem('tlo_farm_chicken_coop');
      const coop = coopRaw ? JSON.parse(coopRaw) : null;
      if (!coop || coop.type !== 'chicken_coop') {
        setMessage('請先放置雞舍！');
        return;
      }
      if (!coop.animals) coop.animals = [];
      if (coop.animals.length >= (coop.capacity ?? 4)) {
        setMessage('雞舍已滿！');
        return;
      }

      setBuying(item.id);
      setMessage('');

      // 扣金幣
      const newGold = userGoldState - item.buyPrice;
      setUserGoldState(newGold);
      onPurchaseSuccess(newGold, '購買成功！');

      // 新增小雞到 localStorage
      coop.animals.push({
        id: 'chick_' + Date.now(),
        type: 'chick',
        stage: 'baby',
        status: 'idle',
        createdAt: Date.now(),
      });
      localStorage.setItem('tlo_farm_chicken_coop', JSON.stringify(coop));

      // 更新 React 狀態
      setChickenStatus(prev => ({
        ...prev,
        chickenCount: coop.animals.length,
      }));

      setMessage(`購買成功！小雞 ${coop.animals.length} / ${coop.capacity ?? 4}`);
      setBuying(null);

      // 通知 FarmScene 重新渲染小雞
      window.dispatchEvent(new CustomEvent('chicken-coop-animals-updated'));
      return;
    }

    // ── 雞舍（building）：仍走 API 原本流程 ──
    const payload = { livestockKey: item.id, amount: 1 };
    console.log('[BUY LIVESTOCK REQUEST]', payload);
    console.log('[BUY LIVESTOCK REQUEST] item.id:', item.id, 'item.nameZhTw:', item.nameZhTw, 'item.itemType:', item.itemType);

    setBuying(item.id);
    setMessage('');
    try {
      const res = await authFetch('/api/shop/buy-livestock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // ── 讀取 response body 即使是錯誤 ──
      const responseText = await res.text();
      console.log(`[BUY LIVESTOCK RESPONSE] status=${res.status} body=`, responseText);

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { success: false, message: '回傳格式錯誤: ' + responseText };
      }

      if (data.success) {
        setMessage(data.message);
        setUserGoldState(data.user.gold);
        onPurchaseSuccess(data.user.gold, data.message);
        window.dispatchEvent(new Event('inventory-updated'));

        // 雞舍：進入放置模式
        if (data.action === 'PLACE_BUILDING') {
          // 先設定 pendingCoop = true（已購買但未放置），避免重複扣金幣
          setChickenStatus(prev => ({ ...prev, pendingCoop: true }));
          window.dispatchEvent(new CustomEvent('startCoopPlacement'));
          onClose();
        }
        // 小雞/飼料：重新整理雞舍狀態（從 localStorage 讀）
        const st = readChickenCoopFromLocal();
        setChickenStatus(prev => ({ ...prev, ...st, loading: false }));
      } else {
        // 前端顯示後端錯誤訊息（如果是雞舍相關錯誤，轉換為更友好的訊息）
        let displayMessage = data.message || '購買失敗';
        if (displayMessage.includes('雞舍已經放置過了')) {
          displayMessage = '你已經擁有雞舍了，無法重複購買';
        }
        setMessage(displayMessage);
      }
    } catch (err) {
      console.error('[BUY LIVESTOCK FETCH ERROR]', err);
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

  // 道具圖示對應（sprite → 實際路徑）
  const getItemIcon = (sprite: string) => {
    if (sprite === '普通肥料.png') {
      return '/assets/icon/普通肥料.png';
    }
    return `/assets/icon/${sprite}`;
  };

  // 畜牧圖示
  const getLivestockIcon = (item: LivestockInfo) => {
    if (item.id === 'chicken_coop') return '/assets/buildings/chicken_coop.png';
    if (item.id === 'chick') return '/assets/animals/chick_baby.png';
    if (item.id === 'feed_normal') return '/assets/items/feed_normal.png';
    return '/assets/items/feed_normal.png';
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
            background: message.includes('失敗') || message.includes('不足') || message.includes('沒有') || message.includes('錯誤') || message.includes('請先') || message.includes('已經') || message.includes('擁有') ? '#C0392B' : '#27AE60',
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

        {/* 分頁 Tab */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          <PixelButton
            onClick={() => setActiveTab('seeds')}
            variant={activeTab === 'seeds' ? 'success' : 'normal'}
          >
            種子
          </PixelButton>
          <PixelButton
            onClick={() => setActiveTab('items')}
            variant={activeTab === 'items' ? 'success' : 'normal'}
          >
            道具
          </PixelButton>
          <PixelButton
            onClick={() => setActiveTab('livestock')}
            variant={activeTab === 'livestock' ? 'success' : 'normal'}
          >
            畜牧 🐔
          </PixelButton>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#5C3D2E' }}>載入中...</div>
        ) : (
          <>
            {/* 種子分頁 */}
            {activeTab === 'seeds' && (
              <>
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
                          width: '56px',
                          height: '56px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <img
                            src={getSeedIcon(crop.nameZhTw)}
                            alt={crop.nameZhTw}
                            style={{
                              width: crop.id === 5 ? 80 : 56,
                              height: crop.id === 5 ? 80 : 56,
                              objectFit: 'contain',
                              imageRendering: 'pixelated',
                              display: 'block',
                              flexShrink: 0,
                            }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3d2518' }}>
                            {crop.nameZhTw}
                          </div>
                          <div style={{ fontSize: '12px', color: '#8B6914', marginTop: '2px' }}>
                            時間 {formatTime(crop.growTimeSec)} · 售價 {crop.sellPrice} · +{crop.exp} EXP
                          </div>
                          <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>
                            持有 {seedCounts[crop.id] ?? 0} 個
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#C0392B' }}>
                          {crop.buyPrice} 金幣
                        </span>
                        <PixelButton
                          onClick={() => handleBuyCrop(crop)}
                          disabled={buying === crop.id || userGoldState < crop.buyPrice}
                          variant="success"
                        >
                          {buying === crop.id ? '購買中...' : '購買'}
                        </PixelButton>
                      </div>
                    </div>
                  ))}
                </div>
                {lockedCrops.length > 0 && (
                  <div style={{ fontSize: '12px', color: '#aaa', textAlign: 'center', padding: '8px 0' }}>
                    （{lockedCrops.length} 種高等級作物已隱藏）
                  </div>
                )}
              </>
            )}

            {/* 道具分頁 */}
            {activeTab === 'items' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {items.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#aaa' }}>目前沒有可購買的道具</div>
                ) : items.filter(item => item.nameZhTw !== '普通飼料').map(item => {
                  return (
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
                          width: '64px',
                          height: '64px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <img
                            src={getItemIcon(item.sprite)}
                            alt={item.nameZhTw}
                            style={{
                              width: 64,
                              height: 64,
                              objectFit: 'contain',
                              imageRendering: 'pixelated',
                              display: 'block',
                              flexShrink: 0,
                            }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3d2518' }}>
                            {item.nameZhTw}
                          </div>
                          <div style={{ fontSize: '12px', color: '#8B6914', marginTop: '2px' }}>
                            {item.effectType === 'prevent_dry' ? '作物必要照顧用品，可避免營養不良' : item.effectType === 'grow_time_reduce_percent' ? `成長時間縮短 ${item.effectValue}%` : `效果 ${item.effectValue}`}
                          </div>
                          <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>
                            持有 {itemCounts[item.id] ?? 0} 個
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#C0392B' }}>
                          {item.buyPrice} 金幣
                        </span>
                        <PixelButton
                          onClick={() => handleBuyItem(item)}
                          disabled={buying === item.id || userGoldState < item.buyPrice}
                          variant="success"
                        >
                          {buying === item.id ? '購買中...' : '購買'}
                        </PixelButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 畜牧分頁 */}
            {activeTab === 'livestock' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {(() => {
                  console.log('[SHOP LIVESTOCK STATUS RENDER]', {
                    placedCoop: chickenStatus.placedCoop,
                    hasBuilding: chickenStatus.placedCoop,
                    animalCount: chickenStatus.chickenCount,
                    capacity: chickenStatus.maxCapacity,
                    feedCount,
                    chickenCoopButtonDisabled: chickenStatus.placedCoop,
                    chickButtonDisabled: !chickenStatus.placedCoop || chickenStatus.chickenCount >= chickenStatus.maxCapacity,
                    feedDisplayCount: feedCount,
                  });
                  return null;
                })()}
                {chickenStatus.loading ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#aaa' }}>載入中...</div>
                ) : livestock.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#aaa' }}>目前沒有可購買的畜牧商品</div>
                ) : livestock.map(item => {
                  const levelLocked = userLevel < item.requiredLevel;
                  const goldLocked = userGoldState < item.buyPrice;

                  // ── 雞舍（building）──
                  if (item.itemType === 'building') {
                    const coopPlaced = chickenStatus.placedCoop;
                    const coopPending = chickenStatus.pendingCoop;
                    let buttonLabel = '購買';
                    let isDisabled = false;

                    if (coopPlaced) {
                      // 已放置 → 已擁有，disabled
                      buttonLabel = '已擁有';
                      isDisabled = true;
                    } else if (coopPending) {
                      // 已購買但尚未放置 → 直接進入放置模式，不重複扣金幣
                      buttonLabel = '前往放置';
                      isDisabled = goldLocked || levelLocked || buying === item.id;
                    } else {
                      // 從未購買 → 正常購買流程
                      buttonLabel = '購買';
                      isDisabled = goldLocked || levelLocked || buying === item.id;
                    }

                    return (
                      <div key={item.id} style={{
                        background: '#fff',
                        border: '4px solid #5C3D2E',
                        borderRadius: '2px',
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        boxShadow: '3px 3px 0 #d4c4a8',
                        opacity: levelLocked ? 0.6 : 1,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '64px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <img src={getLivestockIcon(item)} alt={item.nameZhTw} style={{ width: 60, height: 60, objectFit: 'contain', imageRendering: 'pixelated', display: 'block', flexShrink: 0 }} />
                          </div>
                          <div>
                            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3d2518' }}>
                              {item.nameZhTw}
                              {levelLocked && <span style={{ fontSize: '11px', color: '#aaa', marginLeft: '6px' }}>(Lv.{item.requiredLevel} 解鎖)</span>}
                            </div>
                            <div style={{ fontSize: '12px', color: '#8B6914', marginTop: '2px' }}>{item.description}</div>
                            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>一次性建築，放置後可養殖小雞</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#C0392B' }}>{item.buyPrice} 金幣</span>
                          <PixelButton
                            onClick={() => {
                              if (coopPending) {
                                // 已購買但未放置：直接進入放置模式，不重複扣金幣
                                window.dispatchEvent(new CustomEvent('startCoopPlacement'));
                                onClose();
                              } else if (!coopPlaced) {
                                // 從未購買：正常購買流程
                                handleBuyLivestock(item);
                              }
                            }}
                            disabled={isDisabled}
                            variant="success"
                          >
                            {buying === item.id ? '購買中...' : buttonLabel}
                          </PixelButton>
                        </div>
                      </div>
                    );
                  }

                  // ── 小雞（livestock）──
                  if (item.itemType === 'livestock') {
                    const coopFull = chickenStatus.chickenCount >= chickenStatus.maxCapacity;
                    let buttonLabel = '購買';
                    let isDisabled = false;

                    if (!chickenStatus.placedCoop) {
                      buttonLabel = '需先放置雞舍';
                      isDisabled = true;
                    } else if (coopFull) {
                      buttonLabel = '雞舍已滿';
                      isDisabled = true;
                    } else {
                      isDisabled = goldLocked || levelLocked || buying === item.id;
                    }

                    return (
                      <div key={item.id} style={{
                        background: '#fff',
                        border: '4px solid #5C3D2E',
                        borderRadius: '2px',
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        boxShadow: '3px 3px 0 #d4c4a8',
                        opacity: levelLocked ? 0.6 : 1,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '64px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <img src={getLivestockIcon(item)} alt={item.nameZhTw} style={{ width: 68, height: 68, objectFit: 'contain', imageRendering: 'pixelated', display: 'block', flexShrink: 0 }} />
                          </div>
                          <div>
                            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3d2518' }}>
                              {item.nameZhTw}
                              {levelLocked && <span style={{ fontSize: '11px', color: '#aaa', marginLeft: '6px' }}>(Lv.{item.requiredLevel} 解鎖)</span>}
                            </div>
                            <div style={{ fontSize: '12px', color: '#8B6914', marginTop: '2px' }}>{item.description}</div>
                            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>需擁有已放置的雞舍</div>
                            {chickenStatus.placedCoop && !coopFull && (
                              <div style={{ fontSize: '11px', color: '#27AE60', marginTop: '2px' }}>雞舍空位：{chickenStatus.maxCapacity - chickenStatus.chickenCount}/{chickenStatus.maxCapacity}</div>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#C0392B' }}>{item.buyPrice} 金幣</span>
                          <PixelButton
                            onClick={() => handleBuyLivestock(item)}
                            disabled={isDisabled}
                            variant="success"
                          >
                            {buying === item.id ? '購買中...' : buttonLabel}
                          </PixelButton>
                        </div>
                      </div>
                    );
                  }

                  // ── 普通飼料（consumable）──
                  // 永遠可購買，只檢查金幣和等級
                  const isDisabled = goldLocked || levelLocked || buying === item.id;
                  return (
                    <div key={item.id} style={{
                      background: '#fff',
                      border: '4px solid #5C3D2E',
                      borderRadius: '2px',
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      boxShadow: '3px 3px 0 #d4c4a8',
                      opacity: levelLocked ? 0.6 : 1,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '64px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <img src={getLivestockIcon(item)} alt={item.nameZhTw} style={{ width: 68, height: 68, transform: 'translateY(10px)', objectFit: 'contain', imageRendering: 'pixelated', display: 'block', flexShrink: 0 }} />
                        </div>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3d2518' }}>
                            {item.nameZhTw}
                            {levelLocked && <span style={{ fontSize: '11px', color: '#aaa', marginLeft: '6px' }}>(Lv.{item.requiredLevel} 解鎖)</span>}
                          </div>
                          <div style={{ fontSize: '12px', color: '#8B6914', marginTop: '2px' }}>{item.description}</div>
                          <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>持有 {feedCount} 個</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#C0392B' }}>{item.buyPrice} 金幣</span>
                        <PixelButton
                          onClick={() => handleBuyLivestock(item)}
                          disabled={isDisabled}
                          variant="success"
                        >
                          {buying === item.id ? '購買中...' : '購買'}
                        </PixelButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </PixelWindow>
  );
}

// 種子圖示對應（使用方形 sprite，與背包一致）
function getSeedIcon(name: string) {
  const seedMap: Record<string, string> = {
    '小麥': '/assets/icon/cropped/icon_seed_wheat.png',
    '玉米': '/assets/icon/cropped/icon_seed_corn.png',
    '紅蘿蔔': '/assets/icon/cropped/icon_seed_carrot.png',
    '馬鈴薯': '/assets/icon/cropped/icon_seed_potato.png',
    '甘蔗': '/assets/crops/甘蔗種子.png',
  };
  return seedMap[name] || '/assets/icon/cropped/icon_seed.png';
}
