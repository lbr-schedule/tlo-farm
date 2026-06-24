import { useEffect, useState, useCallback } from 'react';
import PixelWindow from './PixelWindow';
import { backpackSystem } from '../../systems/BackpackSystem';

interface ChickenCoopModalProps {
  onClose: () => void;
  userGold: number;
  userLevel?: number;
  onGoldUpdate?: (gold: number) => void;
}

interface CoopSlot {
  index: number;
  state: string;
  feedAppliedAt: number | null;
  producedAt: number | null;
  animalName: string | null;
  growthStage: string | null;
  feedStatus: string | null;
  lastFedAt: number | null;
  productionReadyAt: number | null;
}

interface CoopAPI {
  success: boolean;
  building: { id: number; tileX: number; tileY: number; unlockedAt: number; createdAt: number };
  slots: CoopSlot[];
  gold: number;
  usingNew: boolean;
}

const CHICKEN_BUY_PRICE = 50;
const FEED_ITEM_ID = 2;
const PRODUCTION_TIME = 120; // seconds

function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('tlo_token');
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

function getRemainingTime(finishAt: number | null): string {
  if (!finishAt) return '';
  const diff = Math.max(0, finishAt - Date.now());
  const s = Math.floor(diff / 1000);
  if (s <= 0) return '馬上好了！';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
}

export default function ChickenCoopModal({ onClose, userGold, onGoldUpdate }: ChickenCoopModalProps) {
  const [gold, setGold] = useState(userGold);
  const [slots, setSlots] = useState<CoopSlot[]>([]);
  const [capacity] = useState(4);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'ok' | 'err'>('ok');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [feedCount, setFeedCount] = useState(0);
  const [eggCount, setEggCount] = useState(0);

  const hasBuilding = slots.length > 0;
  const animalCount = slots.filter(s => s.state !== 'EMPTY').length;
  const isFull = animalCount >= capacity;

  // 任何狀態改變都 call this
  const fetchStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/animals/chicken-coop');
      const data: CoopAPI = await res.json();
      if (data.success) {
        setSlots(data.slots || []);
        setGold(data.gold ?? userGold);
        onGoldUpdate?.(data.gold ?? userGold);
        // 計算可收蛋數
        const ready = (data.slots || []).filter(s => s.state === 'READY_TO_COLLECT').length;
        setEggCount(ready);
      } else {
        setMessage('無法載入雞舍狀態');
        setMessageType('err');
      }
    } catch {
      setMessage('無法連線到伺服器');
      setMessageType('err');
    } finally {
      setFetching(false);
    }
  }, [userGold, onGoldUpdate]);

  // 初始載入
  useEffect(() => {
    fetchStatus();
    // 刷新背包飼料數
    const items = backpackSystem.getState().items;
    const feed = items.find((i: any) => i.itemId === FEED_ITEM_ID);
    setFeedCount(feed?.amount ?? 0);
  }, [fetchStatus]);

  // ---- 餵食 ----
  const handleFeed = async () => {
    if (feedCount <= 0) {
      setMessage('背包沒有普通飼料！');
      setMessageType('err');
      return;
    }
    const hungrySlots = slots.filter(s => s.state === 'READY_TO_FEED');
    if (hungrySlots.length === 0) {
      setMessage('沒有需要餵食的雞！');
      setMessageType('err');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const slotIndex = hungrySlots[0].index;
      const res = await authFetch('/api/animals/chicken-coop/feed', {
        method: 'POST',
        body: JSON.stringify({ slotIndex }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message || '餵食成功！');
        setMessageType('ok');
        setGold(data.user?.gold ?? gold);
        onGoldUpdate?.(data.user?.gold ?? gold);
        // 等背包刷新完成後再重算飼料數
        await backpackSystem.fetchAll();
        await fetchStatus();
        const items = backpackSystem.getState().items;
        const feed = items.find((i: any) => i.itemId === FEED_ITEM_ID);
        setFeedCount(feed?.amount ?? 0);
      } else {
        setMessage(data.message || '餵食失敗');
        setMessageType('err');
      }
    } catch {
      setMessage('餵食失敗，請稍後再試');
      setMessageType('err');
    } finally {
      setLoading(false);
    }
  };

  // ---- 一次餵完 ----
  const handleFeedAll = async () => {
    if (feedCount <= 0) {
      setMessage('背包沒有普通飼料！');
      setMessageType('err');
      return;
    }
    const hungrySlots = slots.filter(s => s.state === 'READY_TO_FEED');
    if (hungrySlots.length === 0) {
      setMessage('沒有需要餵食的雞！');
      setMessageType('err');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const res = await authFetch('/api/animals/chicken-coop/feed-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message || `餵了 ${data.fedCount ?? hungrySlots.length} 隻`);
        setMessageType('ok');
        setGold(data.user?.gold ?? gold);
        onGoldUpdate?.(data.user?.gold ?? gold);
        await backpackSystem.fetchAll();
        await fetchStatus();
        const items = backpackSystem.getState().items;
        const feed = items.find((i: any) => i.itemId === FEED_ITEM_ID);
        setFeedCount(feed?.amount ?? 0);
      } else {
        setMessage(data.message || '餵食失敗');
        setMessageType('err');
      }
    } catch {
      setMessage('餵食失敗，請稍後再試');
      setMessageType('err');
    } finally {
      setLoading(false);
    }
  };

  // ---- 收蛋 ----
  const handleCollect = async () => {
    const readySlots = slots.filter(s => s.state === 'READY_TO_COLLECT');
    if (readySlots.length === 0) {
      setMessage('還沒有雞蛋可收！');
      setMessageType('err');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const res = await authFetch('/api/animals/chicken-coop/collect-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message || `收到 ${data.collectedCount ?? readySlots.length} 個雞蛋！`);
        setMessageType('ok');
        setGold(data.user?.gold ?? gold);
        onGoldUpdate?.(data.user?.gold ?? gold);
        await backpackSystem.fetchAll();
        await fetchStatus();
      } else {
        setMessage(data.message || '領取失敗');
        setMessageType('err');
      }
    } catch {
      setMessage('領取失敗，請稍後再試');
      setMessageType('err');
    } finally {
      setLoading(false);
    }
  };

  // ---- 購買小雞 ----
  const handleBuy = async () => {
    if (isFull) {
      setMessage('雞舍已滿！');
      setMessageType('err');
      return;
    }
    if (gold < CHICKEN_BUY_PRICE) {
      setMessage('金幣不足！');
      setMessageType('err');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const res = await authFetch('/api/animals/chicken-coop/buy', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message || '購買成功！');
        setMessageType('ok');
        setGold(data.user?.gold ?? gold);
        onGoldUpdate?.(data.user?.gold ?? gold);
        await fetchStatus();
      } else {
        setMessage(data.message || '購買失敗');
        setMessageType('err');
      }
    } catch {
      setMessage('購買失敗，請稍後再試');
      setMessageType('err');
    } finally {
      setLoading(false);
    }
  };

  // UI helpers
  const hungryCount = slots.filter(s => s.state === 'READY_TO_FEED').length;
  const producingCount = slots.filter(s => s.state === 'PRODUCING').length;
  const readyCount = slots.filter(s => s.state === 'READY_TO_COLLECT').length;
  const emptyCount = slots.filter(s => s.state === 'EMPTY').length;

  if (fetching) {
    return (
      <PixelWindow title="🐔 雞舍" onClose={onClose} width={320}>
        <div style={{ padding: 20, textAlign: 'center', color: '#7A6A59' }}>載入中...</div>
      </PixelWindow>
    );
  }

  return (
    <PixelWindow title="🐔 雞舍" onClose={onClose} width={320}>
      <style>{`
        .ccm-btn { width: 100%; padding: 10px 16px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: 'Cubic 11', sans-serif; border: 3px solid; margin-bottom: 8px; }
        .ccm-btn:active:not(:disabled) { opacity: 0.8; }
        .ccm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ccm-buy-btn { background: #E8A020; color: #3B2412; border-color: #5A3418; margin-top: 8px; }
        .ccm-buy-btn:hover:not(:disabled) { background: #c4881a; }
        .ccm-feed-btn { background: #6DB33F; color: #fff; border-color: #4A7C2F; }
        .ccm-feed-btn:hover:not(:disabled) { background: #5a9a32; }
        .ccm-feed-all-btn { background: #4A7C2F; color: #fff; border-color: #3A5C25; }
        .ccm-feed-all-btn:hover:not(:disabled) { background: #3A5C25; }
        .ccm-collect-btn { background: #E8A020; color: #3B2412; border-color: #5A3418; }
        .ccm-collect-btn:hover:not(:disabled) { background: #c4881a; }
        .ccm-close-btn { background: #5A3418; color: #FFF3D5; border-color: #3B2412; margin-top: 4px; }
        .ccm-close-btn:hover:not(:disabled) { background: #3B2412; }
        .ccm-msg { font-size: 13px; font-weight: 700; text-align: center; margin-bottom: 10px; padding: 6px; border-radius: 4px; }
        .ccm-msg-ok { color: #2E7D32; background: #e8f5e9; }
        .ccm-msg-err { color: #C0392B; background: #ffebee; }
        .ccm-capacity { font-size: 20px; font-weight: 700; text-align: center; color: #3B2412; margin: 12px 0; }
        .ccm-status { font-size: 13px; color: #7A6A59; text-align: center; margin-bottom: 16px; }
        .ccm-info-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 14px; color: #3B2412; }
        .ccm-info-row span:first-child { font-weight: 700; color: #7A6A59; }
        .ccm-egg-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 14px; border-top: 2px dashed #E8C84A; margin-top: 6px; }
        .ccm-egg-row span:first-child { font-weight: 700; color: #7A6A59; }
        .ccm-slot-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-bottom: 10px; }
        .ccm-slot { background: #F5EFE0; border: 2px solid #C9B896; border-radius: 6px; padding: 6px; text-align: center; font-size: 12px; color: #3B2412; }
        .ccm-slot-empty { background: #EDE8DA; border-color: #D4CCAF; color: #A09080; }
        .ccm-slot-producing { background: #FFF8E1; border-color: #E8C84A; }
        .ccm-slot-ready { background: #E8F5E9; border-color: #6DB33F; }
        .ccm-slot-icon { font-size: 24px; margin-bottom: 2px; }
        .ccm-slot-timer { font-size: 10px; color: #7A6A59; }
      `}</style>

      {!hasBuilding ? (
        <div style={{ textAlign: 'center', padding: 20, color: '#7A6A59', fontSize: 13 }}>
          請先在商店購買並放置雞舍
        </div>
      ) : (
        <div style={{ padding: '8px 4px' }}>
          {/* 基本狀態 */}
          <div className="ccm-capacity">{animalCount} / {capacity} 隻雞</div>
          <div className="ccm-status">
            {animalCount === 0 ? '尚未飼養' : ''}
            {animalCount > 0 && readyCount > 0 && <span style={{ color: '#2E7D32' }}>有 {readyCount} 格可收蛋！</span>}
            {animalCount > 0 && producingCount > 0 && <span style={{ color: '#E8A020' }}> {producingCount} 格產蛋中</span>}
          </div>

          {/* 訊息 */}
          {message && (
            <div className={`ccm-msg ${messageType === 'ok' ? 'ccm-msg-ok' : 'ccm-msg-err'}`}>
              {message}
            </div>
          )}

          {/* 雞格狀態 */}
          <div className="ccm-slot-grid">
            {slots.map(slot => {
              const isEmpty = slot.state === 'EMPTY';
              const isReady = slot.state === 'READY_TO_COLLECT';
              const isProducing = slot.state === 'PRODUCING';
              let cls = 'ccm-slot';
              if (isEmpty) cls += ' ccm-slot-empty';
              else if (isReady) cls += ' ccm-slot-ready';
              else if (isProducing) cls += ' ccm-slot-producing';
              return (
                <div key={slot.index} className={cls}>
                  <div className="ccm-slot-icon">{isEmpty ? '⬜' : isReady ? '🥚' : '🐔'}</div>
                  <div>{isEmpty ? '空' : slot.growthStage === 'baby' ? '雛鳥' : '成雞'}</div>
                  {isProducing && slot.lastFedAt && (
                    <div className="ccm-slot-timer">倒數中</div>
                  )}
                  {isReady && <div className="ccm-slot-timer" style={{ color: '#2E7D32' }}>可收！</div>}
                </div>
              );
            })}
          </div>

          {/* 背包飼料 */}
          <div className="ccm-info-row">
            <span>普通飼料</span>
            <span style={{ color: feedCount > 0 ? '#3B2412' : '#C0392B' }}>
              {feedCount > 0 ? `持有 ${feedCount} 個` : '沒有'}
            </span>
          </div>

          {/* 收蛋按鈕 */}
          {readyCount > 0 && (
            <button
              className="ccm-btn ccm-collect-btn"
              onClick={handleCollect}
              disabled={loading}
            >
              🥚 領取 {readyCount} 個雞蛋
            </button>
          )}

          {/* 餵食 */}
          <button
            className="ccm-btn ccm-feed-btn"
            onClick={handleFeed}
            disabled={loading || feedCount <= 0 || hungryCount === 0}
          >
            {loading ? '餵食中...' : feedCount <= 0 ? '🌾 沒有普通飼料' : hungryCount === 0 ? '✅ 無需餵食' : '🌾 餵一隻'}
          </button>

          {animalCount > 1 && hungryCount > 0 && feedCount > 0 && (
            <button
              className="ccm-btn ccm-feed-all-btn"
              onClick={handleFeedAll}
              disabled={loading}
            >
              🌾 一次餵完 {hungryCount} 隻
            </button>
          )}

          {feedCount > 0 && hungryCount > 0 && (
            <div style={{ fontSize: 11, color: '#8B6914', textAlign: 'center', marginTop: 2 }}>
              背包：{feedCount} 個普通飼料
            </div>
          )}

          {/* 購買 */}
          {isFull ? (
            <div className="ccm-msg ccm-msg-err" style={{ marginTop: 8 }}>
              雞舍已滿（{animalCount}/{capacity}）
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#7A6A59', textAlign: 'center', marginTop: 8 }}>
              價格：{CHICKEN_BUY_PRICE} 金幣（持有 {gold} 金幣）
            </div>
          )}
          <button
            className="ccm-btn ccm-buy-btn"
            onClick={handleBuy}
            disabled={loading || isFull || gold < CHICKEN_BUY_PRICE}
          >
            {loading ? '購買中...' : gold < CHICKEN_BUY_PRICE ? '金幣不足' : isFull ? '已滿' : '🐥 購買小雞'}
          </button>

          <button className="ccm-btn ccm-close-btn" onClick={onClose}>
            關閉
          </button>
        </div>
      )}
    </PixelWindow>
  );
}
