// 任務系統 - 每日任務 MVP
import { useEffect, useState } from 'react';
import PixelWindow from './PixelWindow';
import { useAuth } from '../../hooks/useAuth';

interface Task {
  id: number;
  key: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  rewardCoins: number;
  rewardExp: number;
  claimed: boolean;
}

interface TaskModalProps {
  onClose: () => void;
  onUserUpdate?: (user: { gold: number; exp: number; level: number }) => void;
  refreshKey?: number;
}

export default function TaskModal({ onClose, onUserUpdate, refreshKey }: TaskModalProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const { authFetch } = useAuth();

  useEffect(() => {
    fetchTasks();
  }, []);

  // refreshKey 改變時重新抓取任務（收成後觸發）
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      fetchTasks();
    }
  }, [refreshKey]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      console.log('[QUEST FETCH] 開始抓取任務');
      const res = await authFetch('/api/tasks');
      const data = await res.json();
      console.log('[QUEST FETCH] 讀取到的任務資料:', JSON.stringify(data.tasks));
      if (data.success) {
        setTasks(data.tasks);
      } else {
        showMessage(data.message || '載入失敗', 'error');
      }
    } catch {
      showMessage('網路錯誤', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleClaim = async (taskId: number) => {
    try {
      const res = await authFetch(`/api/tasks/${taskId}/claim`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showMessage(data.message, 'success');
        if (data.user && onUserUpdate) {
          onUserUpdate(data.user);
        }
        // 更新本地任務狀態
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, claimed: true, progress: t.target } : t
        ));
      } else {
        showMessage(data.message || '領取失敗', 'error');
      }
    } catch {
      showMessage('網路錯誤', 'error');
    }
  };

  // 判斷任務是否完成（進度達標但未領取）
  const isComplete = (task: Task) => task.progress >= task.target && !task.claimed;
  // 判斷任務是否已領取
  const isClaimed = (task: Task) => task.claimed;
  // 判斷任務是否進行中（未完成）
  const isInProgress = (task: Task) => task.progress < task.target && !task.claimed;

  // 像素按鈕元件
  const PixelButton = ({
    children,
    onClick,
    disabled,
    variant = 'normal'
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: 'normal' | 'success' | 'gray';
  }) => {
    const colors = {
      normal: { bg: '#8B5A2B', border: '#5C3D2E' },
      success: { bg: '#228B22', border: '#1a6b1a' },
      gray: { bg: '#888', border: '#666' },
    }[variant];

    return (
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          background: colors.bg,
          border: `3px solid ${colors.border}`,
          borderRadius: '2px',
          color: '#fff',
          fontSize: '13px',
          fontWeight: 'bold',
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '6px 14px',
          fontFamily: "'Cubic 11', sans-serif",
          boxShadow: `3px 3px 0 #3d2518`,
          opacity: disabled ? 0.6 : 1,
          minWidth: '80px',
          textAlign: 'center',
        }}
      >
        {children}
      </button>
    );
  };

  return (
    <PixelWindow title="每日任務" onClose={onClose} width={720}>
      <div style={{ fontFamily: "'Cubic 11', sans-serif" }}>
        {/* 訊息提示 */}
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
          <div style={{ textAlign: 'center', padding: '60px', color: '#5C3D2E' }}>載入中...</div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxHeight: '420px',
            overflowY: 'auto',
            padding: '4px',
          }}>
            {console.log('[QUEST RENDER] tasks:', tasks) || tasks.map(task => (
              <div
                key={task.id}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  background: '#fff',
                  border: `4px solid ${isClaimed(task) ? '#aaa' : '#5C3D2E'}`,
                  borderRadius: '2px',
                  boxShadow: `3px 3px 0 ${isClaimed(task) ? '#ccc' : '#d4c4a8'}`,
                  padding: '12px',
                  gap: '12px',
                  opacity: isClaimed(task) ? 0.7 : 1,
                }}
              >
                {/* 左側：48x48 icon */}
                <div style={{
                  width: 72,
                  height: 64,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <img
                    src="/assets/icon/hotbar/icon_daily_quest.png"
                    alt="每日任務"
                    width={48}
                    height={48}
                    style={{
                      imageRendering: 'pixelated',
                      objectFit: 'contain',
                    }}
                    onError={(e) => {
                      const target = e.currentTarget as HTMLImageElement;
                      target.style.display = 'none';
                      const parent = target.parentElement;
                      if (parent) {
                        const fallback = document.createElement('div');
                        fallback.style.cssText = 'width:64px;height:64px;border-radius:50%;background:#ddd;border:3px solid #aaa;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;';
                        fallback.innerHTML = '<span style="font-size:10px;color:#888;font-weight:bold">任務</span><span style="font-size:16px">📋</span>';
                        parent.appendChild(fallback);
                      }
                    }}
                  />
                </div>

                {/* 中間：任務名稱、進度、說明 */}
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: '4px',
                  minWidth: 0,
                }}>
                  <div style={{
                    fontSize: '16px',
                    fontWeight: 'bold',
                    color: '#3d2518',
                    textShadow: '1px 1px 0 #fff',
                  }}>
                    {task.title}
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: isComplete(task) ? '#27AE60' : '#5C3D2E',
                    fontWeight: isComplete(task) ? 'bold' : 'normal',
                  }}>
                    {task.progress} / {task.target}
                    {isComplete(task) && ' ✅'}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: '#8B6243',
                  }}>
                    {task.description}
                  </div>
                  {/* 獎勵顯示 */}
                  <div style={{
                    display: 'flex',
                    gap: '12px',
                    marginTop: '2px',
                  }}>
                    <span style={{ fontSize: '12px', color: '#C0392B', fontWeight: 'bold' }}>
                      +{task.rewardCoins} 金幣
                    </span>
                    <span style={{ fontSize: '12px', color: '#27AE60', fontWeight: 'bold' }}>
                      +{task.rewardExp} EXP
                    </span>
                  </div>
                </div>

                {/* 右側：領取按鈕 */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {isClaimed(task) ? (
                    <PixelButton disabled variant="gray">
                      已完成
                    </PixelButton>
                  ) : isComplete(task) ? (
                    <PixelButton
                      onClick={() => handleClaim(task.id)}
                      variant="success"
                    >
                      領取
                    </PixelButton>
                  ) : (
                    <PixelButton disabled variant="gray">
                      進行中
                    </PixelButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 底部裝飾 */}
        <div style={{
          textAlign: 'center',
          marginTop: '12px',
          fontSize: '12px',
          color: '#8B6243',
        }}>
          每天凌晨 00:00 重置任務進度
        </div>
      </div>
    </PixelWindow>
  );
}
