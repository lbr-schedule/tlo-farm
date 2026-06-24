import { useEffect, useState } from 'react';
import PixelWindow from './PixelWindow';

interface FoodWorkshopModalProps {
  onClose: () => void;
  userGold: number;
  userLevel?: number;
  onGoldUpdate?: (gold: number) => void;
  onExpUpdate?: (exp: number, level: number) => void;
  onWorkshopUpdate?: () => void;
}

// 精緻麵粉配方（PR001）- 必須與 server WORKSHOP_RECIPES 一致
const FLOUR_RECIPE = {
  productId: 'PR001',
  productName: '精緻麵粉',
  materialName: '小麥',
  materialAmount: 2,
  craftTimeSec: 5 * 60, // 5 分鐘
  exp: 3,
  sellPrice: 30,
};

// 小麥在 crops 表的 id = 1（GDD C001）
const WHEAT_CROP_ID = 1;
// 精緻麵粉 items 表 id = 100（加工品區間）
const FLOUR_ITEM_ID = 100;

interface Job {
  id: number;
  productId: string;
  productName: string;
  status: string;
  slotIndex: number;
  startedAt: number;
  finishAt: number;
}

interface WorkshopState {
  workshopId: number | null;
  hasWorkshop: boolean;
  isPlaced: boolean;
  jobs: Job[];
  wheatAmount: number;
  flourAmount: number;
  loading: boolean;
  message: string;
  messageType: 'ok' | 'err';
}

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

export default function FoodWorkshopModal({
  onClose,
  userGold,
  userLevel,
  onGoldUpdate,
  onExpUpdate,
  onWorkshopUpdate,
}: FoodWorkshopModalProps) {
  const [state, setState] = useState<WorkshopState>({
    workshopId: null,
    hasWorkshop: false,
    isPlaced: false,
    jobs: [],
    wheatAmount: 0,
    flourAmount: 0,
    loading: true,
    message: '',
    messageType: 'ok',
  });

  const capacity = 2; // Lv1 = 2 slots

  const fetchStatus = async () => {
    try {
      const res = await authFetch('/api/workshop/status');
      const data = await res.json();
      if (data.success) {
        const ws = data.workshops?.find((w: any) => w.workshopType === 'P001');
        setState(prev => ({
          ...prev,
          workshopId: ws?.id ?? null,
          hasWorkshop: !!ws,
          isPlaced: ws?.isPlaced === 1,
          jobs: data.jobs || [],
          wheatAmount: data.inventory?.wheat ?? 0,
          flourAmount: data.inventory?.flour ?? 0,
          loading: false,
        }));
      }
    } catch {
      setState(prev => ({ ...prev, loading: false, message: '無法載入加工廠狀態', messageType: 'err' }));
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const setMsg = (message: string, messageType: 'ok' | 'err' = 'ok') => {
    setState(prev => ({ ...prev, message, messageType }));
  };

  const handleCraft = async () => {
    const { workshopId, jobs, wheatAmount } = state;
    if (!workshopId) { setMsg('請先放置食品工坊', 'err'); return; }
    if (!state.isPlaced) { setMsg('食品工坊尚未放置', 'err'); return; }
    if (jobs.filter(j => j.status === 'processing' || j.status === 'completed').length >= capacity) {
      setMsg('佇列已滿', 'err'); return;
    }
    if (wheatAmount < FLOUR_RECIPE.materialAmount) {
      setMsg('小麥不足！需要 2 個小麥', 'err'); return;
    }

    setMsg('');
    try {
      const res = await authFetch('/api/workshop/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workshopId, productId: FLOUR_RECIPE.productId }),
      });
      const data = await res.json();
      if (data.success) {
        const newJob: Job = {
          id: Date.now(), // optimistic
          productId: data.job.productId,
          productName: data.job.productName,
          status: data.job.status,
          slotIndex: data.job.slotIndex,
          startedAt: data.job.startedAt,
          finishAt: data.job.finishAt,
        };
        setState(prev => ({
          ...prev,
          jobs: [...prev.jobs, newJob],
          wheatAmount: data.job.remainingWheat ?? Math.max(0, prev.wheatAmount - FLOUR_RECIPE.materialAmount),
          message: data.message,
          messageType: 'ok',
        }));
        setTimeout(() => setMsg(''), 3000);
      } else {
        setMsg(data.message || '製作失敗', 'err');
      }
    } catch {
      setMsg('網路錯誤', 'err');
    }
  };

  const handleCollect = async (job: Job) => {
    try {
      const res = await authFetch('/api/workshop/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (data.success) {
        setState(prev => ({
          ...prev,
          jobs: prev.jobs.filter(j => j.id !== job.id),
          flourAmount: prev.flourAmount + 1,
          message: data.message,
          messageType: 'ok',
        }));
        if (data.leveledUp && data.user) {
          onExpUpdate?.(data.user.exp, data.user.level);
        }
        onWorkshopUpdate?.();
        setTimeout(() => setMsg(''), 3000);
      } else {
        setMsg(data.message || '領取失敗', 'err');
      }
    } catch {
      setMsg('網路錯誤', 'err');
    }
  };

  const now = Date.now();

  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Build queue state: two slots (slot 0 and slot 1)
  const queueBySlot: (Job | null)[] = [null, null];
  for (const job of state.jobs) {
    if (job.status === 'processing' || job.status === 'completed') {
      if (job.slotIndex === 0 || job.slotIndex === 1) {
        queueBySlot[job.slotIndex] = job;
      }
    }
  }

  const activeCount = queueBySlot.filter(j => j !== null).length;
  const canCraft = state.hasWorkshop && state.isPlaced &&
    activeCount < capacity &&
    state.wheatAmount >= FLOUR_RECIPE.materialAmount;

  return (
    <PixelWindow title="🏭 食品工坊" onClose={onClose} width={320}>
      <style>{`
        .fwm-btn { width: 100%; padding: 10px 16px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: 'Cubic 11', sans-serif; border: 3px solid; margin-bottom: 8px; }
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

      {state.loading ? (
        <div style={{ textAlign: 'center', padding: '20px', color: '#7A6A59' }}>載入中...</div>
      ) : !state.hasWorkshop ? (
        <div className="fwm-locked">
          請先在商店購買並放置食品工坊
        </div>
      ) : (
        <div style={{ padding: '8px 4px' }}>
          {/* 基本資訊 */}
          <div className="fwm-info-row">
            <span>食品工坊</span>
            <span>Lv1 · P001</span>
          </div>
          <div className="fwm-info-row">
            <span>佇列</span>
            <span>{activeCount} / {capacity}</span>
          </div>

          {/* 配方資訊 */}
          <div className="fwm-recipe">
            <div className="fwm-recipe-title">🍞 精緻麵粉（PR001）</div>
            <div className="fwm-recipe-row">
              <span>需要：</span>
              <span>小麥 × {FLOUR_RECIPE.materialAmount}</span>
              <span style={{ color: state.wheatAmount >= FLOUR_RECIPE.materialAmount ? '#2E7D32' : '#C0392B' }}>
                （背包：{state.wheatAmount}）
              </span>
            </div>
            <div className="fwm-recipe-row">
              <span>時間：</span><span>{fmtTime(FLOUR_RECIPE.craftTimeSec)}</span>
            </div>
            <div className="fwm-recipe-row">
              <span>產出：</span>
              <span>精緻麵粉 × 1（+{FLOUR_RECIPE.exp} EXP）</span>
            </div>
          </div>

          {/* 訊息 */}
          {state.message && (
            <div className={`fwm-msg fwm-msg-${state.messageType}`}>
              {state.message}
            </div>
          )}

          {/* 佇列 1 */}
          <div className="fwm-queue-slot">
            <div className="fwm-queue-label">佇列 1</div>
            {queueBySlot[0] ? (
              (queueBySlot[0]!.status === 'completed' || now >= queueBySlot[0]!.finishAt) ? (
                <>
                  <div className="fwm-queue-name">✅ 精緻麵粉 — 完成！</div>
                  <button className="fwm-btn fwm-collect-btn" onClick={() => handleCollect(queueBySlot[0]!)}>
                    領取精緻麵粉 ×1
                  </button>
                </>
              ) : (
                <>
                  <div className="fwm-queue-name">製作中...</div>
                  <div className="fwm-queue-timer">
                    剩 {fmtTime(Math.ceil((queueBySlot[0]!.finishAt - now) / 1000))}
                  </div>
                </>
              )
            ) : (
              <div className="fwm-queue-idle">空閒中</div>
            )}
          </div>

          {/* 佇列 2 */}
          <div className="fwm-queue-slot">
            <div className="fwm-queue-label">佇列 2</div>
            {queueBySlot[1] ? (
              (queueBySlot[1]!.status === 'completed' || now >= queueBySlot[1]!.finishAt) ? (
                <>
                  <div className="fwm-queue-name">✅ 精緻麵粉 — 完成！</div>
                  <button className="fwm-btn fwm-collect-btn" onClick={() => handleCollect(queueBySlot[1]!)}>
                    領取精緻麵粉 ×1
                  </button>
                </>
              ) : (
                <>
                  <div className="fwm-queue-name">製作中...</div>
                  <div className="fwm-queue-timer">
                    剩 {fmtTime(Math.ceil((queueBySlot[1]!.finishAt - now) / 1000))}
                  </div>
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
            disabled={!canCraft}
          >
            {!state.isPlaced
              ? '請先放置食品工坊'
              : state.wheatAmount < FLOUR_RECIPE.materialAmount
                ? `🌾 小麥不足（需要 ${FLOUR_RECIPE.materialAmount} 個）`
                : activeCount >= capacity
                  ? '佇列已滿'
                  : '🔨 開始製作精緻麵粉'}
          </button>

          {/* 關閉 */}
          <button className="fwm-btn fwm-close-btn" onClick={onClose}>
            關閉
          </button>
        </div>
      )}
    </PixelWindow>
  );
}
