import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';

interface DailyReward {
  day: number;
  label: string;
  status: 'claimed' | 'claimable' | 'locked';
}

interface DailyLoginData {
  currentDay: number;
  streakDays: number;
  totalLoginDays: number;
  todayClaimed: boolean;
  rewards: DailyReward[];
}

interface DailyLoginTabProps {
  onRewardClaimed?: (updatedUser?: { gold: number; diamonds: number }) => void;
}

// Fallback icon component that won't crash if images are missing
const EventIcon = ({ src, alt, fallback }: { src: string; alt: string; fallback: string }) => {
  const [hasError, setHasError] = useState(false);
  if (hasError || !src) {
    return <span style={{ fontSize: '28px', lineHeight: 1 }}>{fallback}</span>;
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setHasError(true)}
      style={{ width: 48, height: 48, objectFit: 'contain', imageRendering: 'pixelated' }}
    />
  );
};

export default function DailyLoginTab({ onRewardClaimed }: DailyLoginTabProps) {
  const { authFetch, updateUser } = useAuth();
  const [data, setData] = useState<DailyLoginData | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [toast, setToast] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/events/daily-login');
      const result = await res.json();
      if (result.success) {
        setData(result.data);
      }
    } catch (error) {
      console.error('取得每日登入狀態失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleClaim = async () => {
    if (!data || data.todayClaimed || claiming) return;

    setClaiming(true);
    try {
      const res = await authFetch('/api/events/daily-login/claim', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        setToast('領取成功！');
        setTimeout(() => setToast(''), 2000);

        // Update the data
        if (result.updatedUser) {
          // Update gold/diamonds in auth context
          if (updateUser) {
            updateUser({ gold: result.updatedUser.gold, diamonds: result.updatedUser.diamonds });
          }
          if (onRewardClaimed) {
            onRewardClaimed(result.updatedUser);
          }
        }

        // Refresh the status
        await fetchStatus();
      } else {
        setToast(result.message || '領取失敗');
        setTimeout(() => setToast(''), 2000);
      }
    } catch (error) {
      console.error('領取失敗:', error);
      setToast('領取失敗');
      setTimeout(() => setToast(''), 2000);
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#5A3418' }}>
        載入中...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#5A3418' }}>
        無法載入每日登入資料
      </div>
    );
  }

  const claimableReward = data.rewards.find(r => r.status === 'claimable');

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0,0,0,0.85)',
          color: '#FFD700',
          padding: '12px 24px',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: 700,
          zIndex: 2000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          border: '2px solid #FFD700'
        }}>
          {toast}
        </div>
      )}

      {/* Title */}
      <h3 style={{
        color: '#3B2412',
        textAlign: 'center',
        margin: '0 0 16px 0',
        fontSize: '18px',
        fontWeight: 700,
        textShadow: '1px 1px 0 #FFF3D5'
      }}>
        每日登入
      </h3>

      {/* Rewards Grid */}
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        overflowX: 'auto',
        gap: '8px',
        padding: '4px',
        marginBottom: '16px'
      }}>
        {data.rewards.map(reward => {
          const isClaimable = reward.status === 'claimable';
          const isClaimed = reward.status === 'claimed';
          const isLocked = reward.status === 'locked';

          let bgColor = '#E8DCC4';
          let borderColor = '#8B6243';
          let iconBg = '#F4E6C7';
          let glowStyle = {};

          if (isClaimable) {
            bgColor = '#FFF8E0';
            borderColor = '#D4A520';
            glowStyle = {
              boxShadow: '0 0 12px 4px rgba(255, 215, 0, 0.6), inset 0 0 8px rgba(255, 215, 0, 0.3)'
            };
          } else if (isClaimed) {
            bgColor = '#C0A080';
            borderColor = '#7A5A36';
            iconBg = '#B09070';
          } else if (isLocked) {
            bgColor = '#D4C4A8';
            borderColor = '#9A8A70';
            iconBg = '#C8B898';
          }

          let iconFallback = '🔒';
          let iconSrc = '/icon/icon_lock.png';

          if (isClaimed) {
            iconFallback = '✓';
            iconSrc = '/icon/icon_check.png';
          } else if (isClaimable) {
            iconFallback = '🎁';
            iconSrc = '/icon/icon_gift.png';
          }

          return (
            <div
              key={reward.day}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minWidth: '72px',
                padding: '10px 8px',
                background: bgColor,
                border: `3px solid ${borderColor}`,
                borderRadius: '8px',
                boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.3), inset 0 -2px 0 rgba(0,0,0,0.1)',
                ...glowStyle
              }}
            >
              {/* Status Icon */}
              <EventIcon src={iconSrc} alt={`Day ${reward.day}`} fallback={iconFallback} />

              {/* Day Label */}
              <div style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#3B2412',
                marginBottom: '4px'
              }}>
                Day {reward.day}
              </div>

              {/* Reward Label */}
              <div style={{
                fontSize: '10px',
                color: '#5A3418',
                textAlign: 'center',
                lineHeight: 1.2
              }}>
                {reward.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div style={{
        background: '#E8DCC4',
        border: '3px solid #8B6243',
        borderRadius: '8px',
        padding: '12px',
        marginBottom: '12px',
        display: 'flex',
        justifyContent: 'space-around'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: '#9A8268', marginBottom: '2px' }}>連續登入</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#3B2412' }}>{data.streakDays}</div>
          <div style={{ fontSize: '11px', color: '#9A8268' }}>天</div>
        </div>
        <div style={{ width: '1px', background: '#C4A880', margin: '4px 0' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: '#9A8268', marginBottom: '2px' }}>累積登入</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#3B2412' }}>{data.totalLoginDays}</div>
          <div style={{ fontSize: '11px', color: '#9A8268' }}>天</div>
        </div>
      </div>

      {/* Claim Button */}
      {claimableReward && (
        <button
          onClick={handleClaim}
          disabled={claiming}
          style={{
            width: '100%',
            padding: '14px',
            background: claiming ? '#9A8A70' : 'linear-gradient(180deg, #FFD700 0%, #D4A520 100%)',
            border: `3px solid ${claiming ? '#7A6A50' : '#8B6914'}`,
            borderRadius: '8px',
            fontSize: '18px',
            fontWeight: 700,
            color: claiming ? '#666' : '#3B2412',
            cursor: claiming ? 'not-allowed' : 'pointer',
            boxShadow: claiming ? 'none' : '0 4px 0 #6B4A0A, inset 0 2px 0 rgba(255,255,255,0.4)',
            textShadow: '1px 1px 0 rgba(255,255,255,0.4)',
            transition: 'all 0.1s ease'
          }}
        >
          {claiming ? '領取中...' : `領取 ${claimableReward.label}`}
        </button>
      )}

      {!claimableReward && !data.todayClaimed && (
        <div style={{
          textAlign: 'center',
          padding: '12px',
          background: '#E8DCC4',
          border: '2px solid #8B6243',
          borderRadius: '8px',
          color: '#9A8268',
          fontSize: '14px'
        }}>
          明日再來領取獎勵吧！
        </div>
      )}

      {data.todayClaimed && (
        <div style={{
          textAlign: 'center',
          padding: '12px',
          background: '#C0A080',
          border: '2px solid #7A5A36',
          borderRadius: '8px',
          color: '#5A3418',
          fontSize: '14px',
          fontWeight: 700
        }}>
          ✓ 今日獎勵已領取
        </div>
      )}
    </div>
  );
}
