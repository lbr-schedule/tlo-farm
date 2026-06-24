import { useEffect, useState } from 'react';
import PixelWindow from './PixelWindow';
import { backpackSystem } from '../../systems/BackpackSystem';

interface FoodWorkshopModalProps {
  onClose: () => void;
  userGold: number;
  userLevel?: number;
  onGoldUpdate?: (gold: number) => void;
  onExpUpdate?: (exp: number) => void;
  onWorkshopUpdate?: () => void;
}

// 精緻麵粉配方（PR001）
const FLOUR_RECIPE = {
  productId: 'PR001',
  productName: '精緻麵粉',
  productSprite: '精緻麵粉.png',
  materialName: '小麥',
  materialSprite: '小麥果實.png',
  materialAmount: 2,
  craftTimeSec: 5 * 60, // 5 分鐘
  exp: 3,
  sellPrice: 30,
};

// 小麥在 crops 表的 id（GDD C001 = 1）
const WHEAT_CROP_ID = 1;
// 精緻麵粉當作 items 表 id = 100（加工品專用區間）
const FLOUR_ITEM_ID = 100;

function getWorkshopData() {
  try {
    const raw = localStorage.getItem('tlo_farm_food_workshop');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveWorkshopData(data: Record<string, unknown>) {
  localStorage.setItem('tlo_farm_food_workshop', JSON.stringify(data));
}

export default function FoodWorkshopModal({
  onClose,
  userGold,
  userLevel,
  onGoldUpdate,
  onExpUpdate,
}: FoodWorkshopModalProps) {
  const [gold, setGold] = useState(userGold);
  const [level] = useState(userLevel ?? 1);
  const [message, setMessage] = useState('');
  const [crafting, setCrafting] = useState(false);

  // 佇列狀態：每個 queue 物件 { productId, startedAt, finishAt }
  const [queue, setQueue] = useState<Array<{ productId: string; startedAt: number; finishAt: number }>>([]);
  const [materialCount, setMaterialCount] = useState(0);
  const [tick, setTick] = useState(0); // 用於每秒刷新

  const capacity = 2; // Lv1 兩格佇列

  const refresh = () => {
    const data = getWorkshopData();
    const q: Array<{ productId: string; startedAt: number; finishAt: number }> = [];
    if (data?.queue1?.productId) q.push(data.queue1);
    if (data?.queue2?.productId) q.push(data.queue2);
    setQueue(q);

    // 讀取背包小麥數量
    const items = backpackSystem.getState().items;
    const wheat = items.find(i => i.itemType === 'crop' && i.itemId === WHEAT_CROP_ID);
    setMaterialCount(wheat?.amount ?? 0);
  };

  useEffect(() => {
    refresh();
    // 每秒計時器更新
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const hasBuilding = !!getWorkshopData();
  const canCraft = hasBuilding && materialCount >= FLOUR_RECIPE.materialAmount && queue.length < capacity;

  const handleCraft = () => {
    if (!hasBuilding) {
      setMessage('請先放置食品工坊！');
      return;
    }
    if (materialCount < FLOUR_RECIPE.materialAmount) {
      setMessage('小麥不足！需要 2 個小麥');
      return;
    }
    if (queue.length >= capacity) {
      setMessage('佇列已滿！');
      return;
    }

    setCrafting(true);
    setMessage('');

    try {
      // 扣背包小麥
      const deducted = backpackSystem.deductCrop(WHEAT_CROP_ID, FLOUR_RECIPE.materialAmount);
      if (!deducted) {
        setMessage('小麥不足！');
        setCrafting(false);
        return;
      }

      // 寫入佇列
      const data = getWorkshopData() || {};
      const now = Date.now();
      const slotKey = !data.queue1?.productId ? 'queue1' : 'queue2';
      const slot = {
        productId: FLOUR_RECIPE.productId,
        startedAt: now,
        finishAt: now + FLOUR_RECIPE.craftTimeSec * 1000,
      };
      data[slotKey] = slot;
      saveWorkshopData(data);

      // 更新體驗（加工不給額外經驗，完成領取才給）
      setMaterialCount(prev => Math.max(0, prev - FLOUR_RECIPE.materialAmount));
      refresh();
      setMessage('開始製作精緻麵粉！');

      // 通知農場更新顯示（如果需要）
      window.dispatchEvent(new CustomEvent('food-workshop-updated'));

    } catch (e) {
      // revert 背包
      backpackSystem.addItem('crop', WHEAT_CROP_ID, FLOUR_RECIPE.materialAmount);
      setMessage('製作失敗');
    } finally {
      setCrafting(false);
    }
  };

  const handleCollect = (slotKey: 'queue1' | 'queue2') => {
    const data = getWorkshopData();
    if (!data?.[slotKey]?.productId) return;

    const slot = data[slotKey] as { productId: string; startedAt: number; finishAt: number };
    const now = Date.now();

    if (now < slot.finishAt) {
      setMessage('還沒製作完成！');
      return;
    }

    // 產物進背包
    backpackSystem.addItem('processed', FLOUR_ITEM_ID, 1);

    // 清除佇列
    delete data[slotKey];
    saveWorkshopData(data);

    refresh();
    onWorkshopUpdate?.();
    setMessage(`領取「${FLOUR_RECIPE.productName}」成功！`);
  };

  const now = Date.now();

  // 每個佇列的剩餘秒數
  const queue1Remaining = queue[0] ? Math.max(0, Math.ceil((queue[0].finishAt - now) / 1000)) : null;
  const queue2Remaining = queue[1] ? Math.max(0, Math.ceil((queue[1].finishAt - now) / 1000)) : null;
  const queue1Done = queue[0] ? now >= queue[0].finishAt : false;
  const queue2Done = queue[1] ? now >= queue[1].finishAt : false;

  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <PixelWindow title="🏭 食品工坊" onClose={onClose} width={320}>
      <style>{`
        .fwm-btn {
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
        .fwm-btn:active:not(:disabled) { opacity: 0.8; }
        .fwm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .fwm-craft-btn { background: #E8A020; color: #3B2412; border-color: #5A3418; }
        .fwm-craft-btn:hover:not(:disabled) { background: #c4881a; }
        .fwm-collect-btn { background: #6DB33F; color: #fff; border-color: #4A7C2F; }
        .fwm-collect-btn:hover:not(:disabled) { background: #5a9a32; }
        .fwm-close-btn { background: #5A3418; color: #FFF3D5; border-color: #3B2412; margin-top: 4px; }
        .fwm-close-btn:hover:not(:disabled) { background: #3B2412; }
        .fwm-msg { font-size: 13px; font-weight: 700; text-align: center; margin-bottom: 10px; padding: 6px; border-radius: 4px; }
        .fwm-msg-ok { color: #2E7D32; background: #e8f5e9; }
        .fwm-msg-err { color: #C0392B; background: #ffebee; }
        .fwm-info-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 14px; color: #3B2412; }
        .fwm-info-row span:first-child { font-weight: 700; color: #7A6A59; }
        .fwm-queue-slot { background: #FFF8DC; border: 2px solid #E8C84A; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
        .fwm-queue-label { font-size: 11px; color: #8B6914; font-weight: 700; margin-bottom: 4px; }
        .fwm-queue-name { font-size: 14px; font-weight: 700; color: #3B2412; }
        .fwm-queue-timer { font-size: 12px; color: #7A6A59; }
        .fwm-queue-done { font-size: 14px; font-weight: 700; color: #2E7D32; }
        .fwm-queue-idle { font-size: 12px; color: #BDB094; text-align: center; padding: 8px; }
        .fwm-locked { text-align: center; padding: 20px; color: #7A6A59; font-size: 13px; }
        .fwm-recipe { background: #FEF6E4; border: 2px dashed #E8C84A; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
        .fwm-recipe-title { font-size: 13px; font-weight: 700; color: #5A3418; margin-bottom: 4px; }
        .fwm-recipe-row { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #3B2412; }
      `}</style>

      {hasBuilding ? (
        <div style={{ padding: '8px 4px' }}>
          {/* 基本資訊 */}
          <div className="fwm-info-row">
            <span>食品工坊</span>
            <span>Lv1</span>
          </div>
          <div className="fwm-info-row">
            <span>佇列</span>
            <span>{queue.length} / {capacity}</span>
          </div>

          {/* 配方資訊 */}
          <div className="fwm-recipe">
            <div className="fwm-recipe-title">🍞 精緻麵粉（PR001）</div>
            <div className="fwm-recipe-row">
              <span>需要：</span>
              <img src="/assets/crops/小麥果實.png" width="18" height="18" style={{ imageRendering: 'pixelated' }} alt="小麥" />
              <span>小麥 × {FLOUR_RECIPE.materialAmount}</span>
              <span style={{ color: materialCount >= FLOUR_RECIPE.materialAmount ? '#2E7D32' : '#C0392B' }}>
                （背包：{materialCount}）
              </span>
            </div>
            <div className="fwm-recipe-row">
              <span>時間：</span><span>{fmtTime(FLOUR_RECIPE.craftTimeSec)}</span>
            </div>
            <div className="fwm-recipe-row">
              <span>產出：</span>
              <img src="/assets/processed/精緻麵粉.png" width="18" height="18" style={{ imageRendering: 'pixelated' }} alt="麵粉" />
              <span>精緻麵粉 × 1（+{FLOUR_RECIPE.exp} EXP）</span>
            </div>
          </div>

          {/* 訊息 */}
          {message && (
            <div className={`fwm-msg ${message.includes('失敗') || message.includes('不足') || message.includes('錯誤') || message.includes('還沒') ? 'fwm-msg-err' : 'fwm-msg-ok'}`}>
              {message}
            </div>
          )}

          {/* 佇列 1 */}
          <div className="fwm-queue-slot">
            <div className="fwm-queue-label">佇列 1</div>
            {queue[0] ? (
              queue1Done ? (
                <>
                  <div className="fwm-queue-name">✅ 精緻麵粉 — 完成！</div>
                  <button className="fwm-btn fwm-collect-btn" onClick={() => handleCollect('queue1')}>
                    領取精緻麵粉 ×1
                  </button>
                </>
              ) : (
                <>
                  <div className="fwm-queue-name">製作中...</div>
                  <div className="fwm-queue-timer">剩 {fmtTime(queue1Remaining ?? 0)}</div>
                </>
              )
            ) : (
              <div className="fwm-queue-idle">空閒中</div>
            )}
          </div>

          {/* 佇列 2 */}
          <div className="fwm-queue-slot">
            <div className="fwm-queue-label">佇列 2</div>
            {queue[1] ? (
              queue2Done ? (
                <>
                  <div className="fwm-queue-name">✅ 精緻麵粉 — 完成！</div>
                  <button className="fwm-btn fwm-collect-btn" onClick={() => handleCollect('queue2')}>
                    領取精緻麵粉 ×1
                  </button>
                </>
              ) : (
                <>
                  <div className="fwm-queue-name">製作中...</div>
                  <div className="fwm-queue-timer">剩 {fmtTime(queue2Remaining ?? 0)}</div>
                </>
              )
            ) : (
              <div className="fwm-queue-idle">空閒中</div>
            )}
          </div>

          {/* 製作按鈕 */}
          <button
            className="fwm-btn fwm-craft-btn"
            onClick={handleCraft}
            disabled={!canCraft || crafting}
          >
            {crafting ? '製作中...' :
              materialCount < FLOUR_RECIPE.materialAmount
                ? `🌾 小麥不足（需要 2 個）`
                : queue.length >= capacity
                  ? '佇列已滿'
                  : '🔨 開始製作精緻麵粉'}
          </button>

          {/* 關閉 */}
          <button className="fwm-btn fwm-close-btn" onClick={onClose}>
            關閉
          </button>
        </div>
      ) : (
        <div className="fwm-locked">
          請先在商店購買並放置食品工坊
        </div>
      )}
    </PixelWindow>
  );
}
