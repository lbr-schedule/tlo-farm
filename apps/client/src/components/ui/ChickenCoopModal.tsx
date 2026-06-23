import { useEffect, useState } from 'react';
import PixelWindow from './PixelWindow';
import { backpackSystem } from '../../systems/BackpackSystem';

interface ChickenCoopModalProps {
  onClose: () => void;
  userGold: number;
  userLevel?: number;
  onGoldUpdate?: (gold: number) => void;
}

const CHICKEN_BUY_PRICE = 50;
const STORAGE_KEY = 'tlo_farm_chicken_coop';
const FEED_ITEM_ID = 2; // 普通飼料 items.id

function getCoopData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCoopData(data: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export default function ChickenCoopModal({ onClose, userGold, onGoldUpdate }: ChickenCoopModalProps) {
  const [gold, setGold] = useState(userGold);
  const [animalCount, setAnimalCount] = useState(0);
  const [capacity] = useState(4);
  const [message, setMessage] = useState('');
  const [buying, setBuying] = useState(false);
  const [feeding, setFeeding] = useState(false);
  const [feedingStatus, setFeedingStatus] = useState<'not_fed' | 'fed'>('not_fed');
  const [feedCount, setFeedCount] = useState(0);

  // 每次打開面板時從 localStorage 讀取最新狀態
  const refresh = () => {
    const data = getCoopData();
    setAnimalCount(data?.animals?.length ?? 0);
    setFeedingStatus(data?.feedingStatus === 'fed' ? 'fed' : 'not_fed');
    // 讀取背包中的飼料數量
    const items = backpackSystem.getState().items;
    const feedItem = items.find(i => i.itemId === FEED_ITEM_ID);
    setFeedCount(feedItem?.amount ?? 0);
  };

  useEffect(() => {
    refresh();
  }, []);

  const hasBuilding = !!getCoopData();
  const isFull = animalCount >= capacity;
  const canBuy = hasBuilding && !isFull && gold >= CHICKEN_BUY_PRICE;
  const canFeed = hasBuilding && feedCount > 0 && feedingStatus !== 'fed';

  const handleFeed = () => {
    if (!hasBuilding) {
      setMessage('請先放置雞舍！');
      return;
    }
    if (feedCount <= 0) {
      setMessage('背包沒有普通飼料！');
      return;
    }
    if (feedingStatus === 'fed') {
      setMessage('今日已餵食！');
      return;
    }

    setFeeding(true);
    setMessage('');

    try {
      // 扣背包飼料
      const deducted = backpackSystem.deductItem('item', FEED_ITEM_ID);
      if (!deducted) {
        setMessage('背包沒有普通飼料！');
        setFeeding(false);
        return;
      }

      // 更新 localStorage 雞舍狀態
      const data = getCoopData();
      if (!data) {
        // revert 背包
        backpackSystem.addItem('item', FEED_ITEM_ID);
        setMessage('錯誤：找不到雞舍資料');
        setFeeding(false);
        return;
      }

      data.feedingStatus = 'fed';
      data.lastFedAt = Date.now();
      saveCoopData(data);

      setFeedCount(prev => Math.max(0, prev - 1));
      setFeedingStatus('fed');
      setMessage('餵食成功！');

    } catch(e) {
      // revert 背包
      backpackSystem.addItem('item', FEED_ITEM_ID);
      setMessage('餵食失敗');
    } finally {
      setFeeding(false);
    }
  };

  const handleBuy = () => {
    if (!hasBuilding) {
      setMessage('請先放置雞舍！');
      return;
    }
    if (isFull) {
      setMessage('雞舍已滿！');
      return;
    }
    if (gold < CHICKEN_BUY_PRICE) {
      setMessage('金幣不足！');
      return;
    }

    setBuying(true);
    setMessage('');

    try {
      const data = getCoopData();
      if (!data) {
        setMessage('錯誤：找不到雞舍資料');
        setBuying(false);
        return;
      }

      // 扣金幣
      const newGold = gold - CHICKEN_BUY_PRICE;
      setGold(newGold);
      onGoldUpdate?.(newGold);

      // 新增小雞
      if (!data.animals) data.animals = [];
      data.animals.push({
        id: 'chick_' + Date.now(),
        type: 'chick',
        stage: 'baby',
        status: 'idle',
      });

      // 存回 localStorage
      saveCoopData(data);
      setAnimalCount(data.animals.length);
      setMessage(`購買成功！小雞 ${data.animals.length} / ${capacity}`);

      // 通知 FarmScene 更新顯示
      window.dispatchEvent(new CustomEvent('chicken-coop-animals-updated'));

    } catch(e) {
      setMessage('購買失敗');
    } finally {
      setBuying(false);
    }
  };

  return (
    <PixelWindow title="🐔 雞舍" onClose={onClose} width={320}>
      <style>{`
        .ccm-btn {
          width: 100%;
          padding: 10px 16px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          font-family: 'Cubic 11', sans-serif;
          border: 3px solid;
          margin-bottom: 8px;
        }
        .ccm-btn:active:not(:disabled) { opacity: 0.8; }
        .ccm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ccm-buy-btn { background: #E8A020; color: #3B2412; border-color: #5A3418; margin-top: 8px; }
        .ccm-buy-btn:hover:not(:disabled) { background: #c4881a; }
        .ccm-feed-btn { background: #6DB33F; color: #fff; border-color: #4A7C2F; }
        .ccm-feed-btn:hover:not(:disabled) { background: #5a9a32; }
        .ccm-close-btn { background: #5A3418; color: #FFF3D5; border-color: #3B2412; margin-top: 4px; }
        .ccm-close-btn:hover:not(:disabled) { background: #3B2412; }
        .ccm-msg { font-size: 13px; font-weight: 700; text-align: center; margin-bottom: 10px; padding: 6px; border-radius: 4px; }
        .ccm-msg-ok { color: #2E7D32; background: #e8f5e9; }
        .ccm-msg-err { color: #C0392B; background: #ffebee; }
        .ccm-capacity { font-size: 20px; font-weight: 700; text-align: center; color: #3B2412; margin: 12px 0; }
        .ccm-status { font-size: 13px; color: #7A6A59; text-align: center; margin-bottom: 16px; }
        .ccm-chick-icon { display: block; margin: 0 auto 8px; width: 64px; height: 64px; image-rendering: pixelated; }
        .ccm-locked { text-align: center; padding: 20px; color: #7A6A59; font-size: 13px; }
        .ccm-info-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 14px; color: #3B2412; }
        .ccm-info-row span:first-child { font-weight: 700; color: #7A6A59; }
        .ccm-feeding-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 14px; border-top: 2px dashed #E8C84A; margin-top: 6px; }
        .ccm-feeding-row span:first-child { font-weight: 700; color: #7A6A59; }
        .ccm-fed-status { font-weight: 700; color: #2E7D32; }
        .ccm-not-fed-status { font-weight: 700; color: #C0392B; }
      `}</style>

      {/* 雞舍狀態 */}
      {hasBuilding ? (
        <div style={{ padding: '8px 4px' }}>
          {/* 狀態列表 */}
          <div className="ccm-info-row">
            <span>雞舍</span>
            <span>Lv1</span>
          </div>
          <div className="ccm-info-row">
            <span>容量</span>
            <span>{animalCount} / {capacity}</span>
          </div>
          <div className="ccm-info-row">
            <span>狀態</span>
            <span>{animalCount === 0 ? '尚未飼養小雞' : `小雞 ${animalCount} 隻`}</span>
          </div>
          <div className="ccm-feeding-row">
            <span>飼料狀態</span>
            <span className={feedingStatus === 'fed' ? 'ccm-fed-status' : 'ccm-not-fed-status'}>
              {feedingStatus === 'fed' ? '已餵食' : '未餵食'}
            </span>
          </div>

          {/* 訊息 */}
          {message && (
            <div className={`ccm-msg ${message.includes('失敗') || message.includes('不足') || message.includes('錯誤') || message.includes('找不到') || message.includes('已滿') ? 'ccm-msg-err' : 'ccm-msg-ok'}`}>
              {message}
            </div>
          )}

          {/* 餵食按鈕 */}
          <button
            className="ccm-btn ccm-feed-btn"
            onClick={handleFeed}
            disabled={!canFeed || feeding}
            style={{ marginTop: 8 }}
          >
            {feeding ? '餵食中...' : feedingStatus === 'fed' ? '✅ 今日已餵食' : feedCount <= 0 ? '🌾 沒有普通飼料' : '🌾 餵食'}
          </button>
          {feedCount > 0 && feedingStatus !== 'fed' && (
            <div style={{ fontSize: 11, color: '#8B6914', textAlign: 'center', marginTop: 2 }}>
              背包普通飼料：{feedCount}
            </div>
          )}

          {/* 購買按鈕 */}
          {isFull ? (
            <div className="ccm-msg ccm-msg-err" style={{ marginTop: 8 }}>
              雞舍已滿（{animalCount} / {capacity}）
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#7A6A59', textAlign: 'center', marginTop: 8 }}>
              價格：{CHICKEN_BUY_PRICE} 金幣（您有 {gold} 金幣）
            </div>
          )}
          <button
            className="ccm-btn ccm-buy-btn"
            onClick={handleBuy}
            disabled={!canBuy || buying}
          >
            {buying ? '購買中...' : gold < CHICKEN_BUY_PRICE ? '金幣不足' : isFull ? '雞舍已滿' : '🐥 購買小雞'}
          </button>

          {/* 關閉 */}
          <button className="ccm-btn ccm-close-btn" onClick={onClose}>
            關閉
          </button>
        </div>
      ) : (
        <div className="ccm-locked">
          請先在商店購買並放置雞舍
        </div>
      )}
    </PixelWindow>
  );
}
