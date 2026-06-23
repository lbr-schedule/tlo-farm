// 訂單系統 - MVP
import { useEffect, useState, useRef, useCallback } from 'react';
import PixelWindow from './PixelWindow';
import { useAuth } from '../../hooks/useAuth';

interface OrderRequirement {
  itemName: string;
  quantity: number;
}

interface Order {
  id: number;
  npcName: string;
  difficulty: 'easy' | 'medium' | 'hard';
  requirements: OrderRequirement[];
  rewardCoins: number;
  rewardExp: number;
  status: 'active' | 'delivering' | 'completed' | 'failed';
  expiresAt: string;
  createdAt: string;
}

interface OrderModalProps {
  onClose: () => void;
  onUserUpdate?: (user: { gold: number; exp: number; level: number }) => void;
}

const DELIVERY_SECONDS = 8;
const CROP_ICONS: Record<string, string> = {
  '小麥': '/assets/icon/cropped/icon_fruit_wheat.png',
  '玉米': '/assets/icon/cropped/icon_fruit_corn.png',
  '紅蘿蔔': '/assets/icon/cropped/icon_fruit_carrot.png',
  '馬鈴薯': '/assets/icon/cropped/icon_fruit_potato.png',
};

const NPC_IMAGES: Record<string, string> = {
  '阿福': '/assets/npc/阿福＿圓形頭像.png',
  '小葵': '/assets/npc/小葵.png',
  '王太太': '/assets/npc/王太太.png',
  '王伯伯': '/assets/npc/王伯伯.png',
};

// 煙霧粒子型別
interface SmokeParticle {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  scale: number;
}

export default function OrderModal({ onClose, onUserUpdate }: OrderModalProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [deliveringIds, setDeliveringIds] = useState<Set<number>>(new Set());
  const [deliveryTimers, setDeliveryTimers] = useState<Record<number, number>>({});
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [smokeParticles, setSmokeParticles] = useState<Record<number, SmokeParticle[]>>({});
  const [dotsAnimation, setDotsAnimation] = useState<Record<number, number>>({});
  const { authFetch } = useAuth();
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const smokeTimerRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});
  const dotsTimerRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});

  useEffect(() => {
    fetchOrders();
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      Object.values(smokeTimerRef.current).forEach(clearInterval);
      Object.values(dotsTimerRef.current).forEach(clearInterval);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prev => prev.map(o => ({ ...o })));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // 配送中dots動畫
  useEffect(() => {
    deliveringIds.forEach(id => {
      if (!dotsTimerRef.current[id]) {
        let dots = 0;
        dotsTimerRef.current[id] = setInterval(() => {
          dots = (dots + 1) % 4;
          setDotsAnimation(prev => ({ ...prev, [id]: dots }));
        }, 400);
      }
    });
    // 清理已完成的
    Object.keys(dotsTimerRef.current).forEach(id => {
      if (!deliveringIds.has(parseInt(id))) {
        clearInterval(dotsTimerRef.current[id]);
        delete dotsTimerRef.current[id];
        setDotsAnimation(prev => { const next = {...prev}; delete next[id]; return next; });
      }
    });
  }, [deliveringIds]);

  // 煙霧粒子生成

  const generateSmokeWithCleanup = useCallback((orderId: number) => {
    const particle: SmokeParticle = {
      id: Date.now() + Math.random(),
      x: Math.random() * 4,
      y: Math.random() * 2,
      size: 2 + Math.random() * 2,
      opacity: 1,
      scale: 1,
    };
    setSmokeParticles(prev => ({
      ...prev,
      [orderId]: [...(prev[orderId] || []).slice(-2), particle].slice(-3)
    }));
    // 0.8 秒後移除（動畫結束）
    setTimeout(() => {
      setSmokeParticles(prev => ({
        ...prev,
        [orderId]: (prev[orderId] || []).filter(p => p.id !== particle.id)
      }));

  // 煙霧動畫效果
  useEffect(() => {
    deliveringIds.forEach(id => {
      if (!smokeTimerRef.current[id]) {
        smokeTimerRef.current[id] = setInterval(() => {
          generateSmokeWithCleanup(id);
        }, 300);  // 每 0.3 秒
      }
    });
    Object.keys(smokeTimerRef.current).forEach(id => {
      if (!deliveringIds.has(parseInt(id))) {
        clearInterval(smokeTimerRef.current[id]);
        delete smokeTimerRef.current[id];
      }
    });
  }, [deliveringIds, generateSmokeWithCleanup]);

  // 煙霧粒子生成後 0.8 秒自動移除（CSS動畫處理視覺效果）
    }, 800);
  }, []);

  const showMessage = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setMessage(msg);
    setMessageType(type);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(''), 3000);
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/orders');
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders);
      } else {
        showMessage(data.message || '載入失敗', 'error');
      }
    } catch {
      showMessage('網路錯誤', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeliver = async (orderId: number) => {
    try {
      const res = await authFetch(`/api/orders/${orderId}/deliver`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDeliveringIds(prev => new Set(prev).add(orderId));
        let remaining = DELIVERY_SECONDS;
        const timer = setInterval(() => {
          remaining -= 1;
          setDeliveryTimers(prev => ({ ...prev, [orderId]: remaining }));
          if (remaining <= 0) {
            clearInterval(timer);
            handleComplete(orderId);
          }
        }, 1000);
      } else {
        showMessage(data.message || '開始配送失敗', 'error');
      }
    } catch {
      showMessage('網路錯誤', 'error');
    }
  };

  const handleComplete = async (orderId: number) => {
    try {
      const res = await authFetch(`/api/orders/${orderId}/complete`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDeliveringIds(prev => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
        setDeliveryTimers(prev => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
        setCompletedIds(prev => new Set(prev).add(orderId));
        showMessage(data.message, 'success');
        if (data.user && onUserUpdate) {
          onUserUpdate(data.user);
        }
        // 更新任務進度：完成訂單
        authFetch('/api/tasks/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'complete_order' }),
        }).catch(e => console.warn('[Tasks] Failed to update order task:', e));
        setTimeout(() => {
          setCompletedIds(prev => {
            const next = new Set(prev);
            next.delete(orderId);
            return next;
          });
          fetchOrders();
        }, 1000);
      } else {
        showMessage(data.message || '完成配送失敗', 'error');
        setDeliveringIds(prev => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
      }
    } catch {
      showMessage('網路錯誤', 'error');
      setDeliveringIds(prev => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  function getTimeLeft(expiresAt: string): string {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return '0:00';
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function isExpired(expiresAt: string): boolean {
    return new Date(expiresAt).getTime() <= Date.now();
  }

  const PixelButton = ({ children, onClick, disabled, variant = 'normal' }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    variant?: 'normal' | 'success';
  }) => {
    const colors = {
      normal: { bg: '#8B5A2B', border: '#5C3D2E', shadow: '#3d2518' },
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
          padding: '6px 16px',
          fontFamily: "'Cubic 11', sans-serif",
          boxShadow: `3px 3px 0 ${colors.shadow}`,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {children}
      </button>
    );
  };

  // 產生 dots 文字
  const getDotsText = (dots: number): string => {
    return '配送中' + '.'.repeat(dots);
  };

  return (
    <PixelWindow title="訂單" onClose={onClose} width={700}>
      <style>{`
        @keyframes truckMove {
          0%, 100% { transform: translateX(-4px); }
          50% { transform: translateX(4px); }
        }
        @keyframes smokeFloat {
          0% { opacity: 1; transform: scale(1) translateX(0px); }
          100% { opacity: 0; transform: scale(1.5) translateX(-10px); }
        }
        .truck-container {
          animation: truckMove 0.8s ease-in-out infinite;
        }
        .smoke-particle {
          animation: smokeFloat 0.8s ease-out forwards;
        }
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 250, 240, 0.9);
          pointer-events: none;
        }
      `}</style>
      <div style={{ fontFamily: "'Cubic 11', sans-serif" }}>
        {message && (
          <div style={{
            background: messageType === 'error' ? '#C0392B' : messageType === 'success' ? '#27AE60' : '#2980B9',
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
          <div style={{ display: 'flex', gap: '12px' }}>
            {orders.map(order => {
              const expired = isExpired(order.expiresAt);
              const timeLeft = getTimeLeft(order.expiresAt);
              const isDelivering = deliveringIds.has(order.id);
              const deliveryLeft = deliveryTimers[order.id] ?? DELIVERY_SECONDS;
              const npcImage = NPC_IMAGES[order.npcName];
              const dots = dotsAnimation[order.id] || 0;
              const particles = smokeParticles[order.id] || [];

              return (
                <div key={order.id} style={{
                  flex: 1,
                  background: '#fff',
                  border: `4px solid ${expired ? '#aaa' : '#5C3D2E'}`,
                  borderRadius: '2px',
                  boxShadow: `3px 3px 0 ${expired ? '#ccc' : '#d4c4a8'}`,
                  opacity: expired ? 0.6 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '12px 8px',
                  minHeight: '420px',
                  minWidth: 0,
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {/* ========== 配送中：顯示貨車圖示 + 倒數 ========== */}
                  {isDelivering ? (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: 1,
                      gap: '12px',
                    }}>
                      {/* 貨車容器 - 只有左右移動 + 煙霧 */}
                      <div className="truck-container" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ position: 'relative' }}>
                          <img
                            src="/assets/icon/icon_貨車.png"
                            alt="配送中"
                            style={{
                              width: '80px',
                              height: 'auto',
                              objectFit: 'contain',
                              imageRendering: 'pixelated',
                            }}
                          />
                          {/* 煙霧粒子 - 從車尾左側產生 */}
                          {particles.map(p => (
                            <div
                              key={p.id}
                              className="smoke-particle"
                              style={{
                                position: 'absolute',
                                left: `-${p.x + 15}px`,
                                top: `${35 + p.y}px`,
                                width: `${p.size}px`,
                                height: `${p.size}px`,
                                background: 'rgba(255, 250, 240, 0.9)',
                                borderRadius: '50%',
                              }}
                            />
                          ))}
                        </div>
                      </div>

                      {/* 配送中文字 + dots */}
                      <div style={{
                        fontSize: '18px',
                        fontWeight: 'bold',
                        color: '#C0392B',
                        textAlign: 'center',
                      }}>
                        {getDotsText(dots)}
                      </div>

                      {/* 倒數 */}
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: '#3d2518',
                        textAlign: 'center',
                      }}>
                        剩餘 {deliveryLeft} 秒
                      </div>
                    </div>
                  ) : completedIds.has(order.id) ? (
                    // 配送完成
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: 1,
                      gap: '8px',
                    }}>
                      <div style={{
                        fontSize: '18px',
                        fontWeight: 'bold',
                        color: '#27AE60',
                        textAlign: 'center',
                      }}>
                        配送完成!
                      </div>
                      <div style={{ fontSize: '13px', color: '#3d2518', textAlign: 'center' }}>
                        +{order.rewardCoins} 金幣
                      </div>
                      <div style={{ fontSize: '13px', color: '#27AE60', textAlign: 'center' }}>
                        +{order.rewardExp} EXP
                      </div>
                    </div>
                  ) : (
                    // 正常顯示訂單內容
                    <>
                      {/* ========== 上區：NPC 頭像 + 名稱 ========== */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: 1,
                      }}>
                        <div style={{
                          width: 80,
                          height: 80,
                          borderRadius: '50%',
                          overflow: 'hidden',
                          border: '3px solid #aaa',
                          background: '#ddd',
                        }}>
                          {npcImage ? (
                            <img
                              src={npcImage}
                              alt={order.npcName}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                              }}
                            />
                          ) : (
                            <span style={{ fontSize: '12px', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>NPC</span>
                          )}
                        </div>
                        <div style={{
                          fontSize: '18px',
                          fontWeight: 'bold',
                          color: '#3d2518',
                          marginTop: '6px',
                          textAlign: 'center',
                        }}>
                          {order.npcName}
                        </div>
                      </div>

                      {/* 分隔線 */}
                      <div style={{ width: '80%', height: '2px', background: '#d4c4a8', margin: '8px 0' }} />

                      {/* ========== 中區：需求區 ========== */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: 1,
                        width: '100%',
                        minHeight: '96px',
                      }}>
                        {[0, 1, 2].map(idx => {
                          const req = order.requirements[idx];
                          return (
                            <div key={idx} style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              height: '28px',
                              visibility: req ? 'visible' : 'hidden',
                              width: '100%',
                            }}>
                              {req && (
                                <>
                                  <img
                                    src={CROP_ICONS[req.itemName] || '/assets/icon/cropped/icon_seed.png'}
                                    alt={req.itemName}
                                    style={{
                                      width: 28,
                                      height: 28,
                                      objectFit: 'contain',
                                      imageRendering: 'pixelated',
                                    }}
                                  />
                                  <span style={{ fontSize: '14px', color: '#3d2518', fontWeight: 'bold', textAlign: 'center' }}>
                                    {req.itemName} x{req.quantity}
                                  </span>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* 分隔線 */}
                      <div style={{ width: '80%', height: '2px', background: '#d4c4a8', margin: '8px 0' }} />

                      {/* ========== 下區：獎勵 + 時間 + 按鈕 ========== */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: 1,
                        gap: '4px',
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                          <div style={{ fontSize: '14px', color: '#C0392B', fontWeight: 'bold', textAlign: 'center' }}>
                            +{order.rewardCoins} 金幣
                          </div>
                          <div style={{ fontSize: '14px', color: '#27AE60', fontWeight: 'bold', textAlign: 'center' }}>
                            +{order.rewardExp} EXP
                          </div>
                        </div>

                        <div style={{
                          fontSize: '13px',
                          fontWeight: 'bold',
                          color: '#3d2518',
                          textAlign: 'center',
                        }}>
                          {expired ? '已過期' : `時間: ${timeLeft}`}
                        </div>

                        {expired ? (
                          <div style={{ fontSize: '11px', color: '#aaa', textAlign: 'center' }}>自動刷新中</div>
                        ) : (
                          <button onClick={() => { console.log('Deliver clicked:', order.id); handleDeliver(order.id); }} style={{ background: '#228B22', color: '#fff', border: '3px solid #1a6b1a', borderRadius: '2px', padding: '6px 16px', fontWeight: 'bold', cursor: 'pointer' }}>
                            交貨
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PixelWindow>
  );
}
