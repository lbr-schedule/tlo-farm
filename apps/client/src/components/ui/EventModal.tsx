import { useEffect, useState } from 'react';
import DailyLoginTab from './DailyLoginTab';

type TabType = 'daily' | 'limited' | 'seasonal' | 'redeem' | 'announce';

interface EventModalProps {
  onClose: () => void;
  onRewardClaimed?: (updatedUser?: { gold: number; diamonds: number }) => void;
}

export default function EventModal({ onClose, onRewardClaimed }: EventModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('daily');

  // ESC key to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const tabs: { id: TabType; label: string }[] = [
    { id: 'daily', label: '每日登入' },
    { id: 'limited', label: '限時活動' },
    { id: 'seasonal', label: '節慶活動' },
    { id: 'redeem', label: '兌換碼' },
    { id: 'announce', label: '公告' },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, #C89A5B 0%, #A07040 100%)',
          border: '4px solid #5A3418',
          borderRadius: '12px',
          width: '95vw',
          maxWidth: '480px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 4px 0 #4B2A12, 0 8px 16px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          background: 'linear-gradient(180deg, #8B5A2B 0%, #6B4423 100%)',
          padding: '12px 16px',
          borderBottom: '4px solid #3d2518',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{
            color: '#F5D76E',
            fontSize: '18px',
            fontWeight: 'bold',
            textShadow: '2px 2px 0 #3d2518',
            fontFamily: "'Cubic 11', sans-serif",
          }}>
            活動中心
          </span>
          <button
            onClick={onClose}
            style={{
              background: '#C0392B',
              border: '3px solid #8B0000',
              borderRadius: '2px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: 'pointer',
              padding: '4px 10px',
              fontFamily: "'Cubic 11', sans-serif",
              boxShadow: '2px 2px 0 #3d2518',
            }}
          >
            X
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          background: '#5A3418',
          borderBottom: '3px solid #3d2518',
          overflowX: 'auto',
          flexShrink: 0,
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: tab.id === 'announce' ? 'none' : 1,
                padding: '10px 8px',
                background: activeTab === tab.id
                  ? 'linear-gradient(180deg, #C89A5B 0%, #A07040 100%)'
                  : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '3px solid #F5D76E' : '3px solid transparent',
                color: activeTab === tab.id ? '#FFF3D5' : '#C89A5B',
                fontSize: '13px',
                fontWeight: activeTab === tab.id ? 700 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: "'Cubic 11', sans-serif",
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
          background: '#F5DEB3',
        }}>
          {activeTab === 'daily' ? (
            <DailyLoginTab onRewardClaimed={onRewardClaimed} />
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              color: '#9A8268',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔜</div>
              <div style={{
                fontSize: '18px',
                fontWeight: 700,
                color: '#5A3418',
                marginBottom: '8px'
              }}>
                敬請期待
              </div>
              <div style={{ fontSize: '14px', textAlign: 'center', lineHeight: 1.5 }}>
                {activeTab === 'limited' && '限時活動即將推出'}
                {activeTab === 'seasonal' && '節慶活動敬請期待'}
                {activeTab === 'redeem' && '兌換碼功能即將開放'}
                {activeTab === 'announce' && '公告系統敬請期待'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
