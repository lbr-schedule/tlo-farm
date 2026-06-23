import React, { useState, useEffect, useCallback } from 'react';
import PixelWindow from './PixelWindow';

interface RouletteModalProps {
  onClose: () => void;
  userGold: number;
  onPurchaseSuccess?: (newGold: number, message: string) => void;
}

const AD_IMAGES = [
  '/assets/ads/ad1.png',
  '/assets/ads/ad2.png',
  '/assets/ads/ad3.png',
  '/assets/ads/ad4.png',
  '/assets/ads/ad5.png',
  '/assets/ads/ad6.png',
  '/assets/ads/ad7.png',
  '/assets/ads/ad8.png',
  '/assets/ads/ad9.png',
  '/assets/ads/ad10.png',
  '/assets/ads/ad11.png',
  '/assets/ads/ad12.png',
  '/assets/ads/ad13.png',
  '/assets/ads/ad14.png',
  '/assets/ads/ad15.png',
  '/assets/ads/ad16.png',
];


export default function RouletteModal({ onClose, userGold, onPurchaseSuccess }: RouletteModalProps) {
  const [adImage, setAdImage] = useState<string>('');
  const [adUsername, setAdUsername] = useState<string>('');
  const [adCaption, setAdCaption] = useState<string>('');
  const [adLink, setAdLink] = useState<string>('');
  const [isBbrPhoto, setIsBbrPhoto] = useState<boolean>(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchAdImage();
  }, []);

  const fetchAdImage = async () => {
    // 直接使用 ad1~ad16 靜態廣告圖
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/public/roulette/ad', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setAdImage(data.adImage);
        setAdUsername(data.adUsername || '');
        setAdCaption(data.adCaption || '');
        setAdLink(data.adLink || '');
        setIsBbrPhoto(false);
      }
    } catch (e) {
      console.error('[Roulette] 取得廣告失敗:', e);
    }
  };



  const handleSpin = useCallback(() => {
    if (isSpinning) return;

    setIsSpinning(true);
    setMessage(null);

    // 隨機旋轉角度(3-5圈 + 隨機停止位置)
    const extraSpins = 3 + Math.floor(Math.random() * 3);
    const randomStop = Math.random() * 360;
    const totalRotation = rotation + extraSpins * 360 + randomStop;

    setRotation(totalRotation);

    // 隨機更換廣告
    setTimeout(() => {
      setAdImage(getRandomAd());
      setIsSpinning(false);
    }, 4000);
  }, [isSpinning, rotation]);

  const handleClose = () => {
    if (isSpinning) return;
    onClose();
  };

  return (
    <PixelWindow title="T-LO大轉盤" onClose={handleClose} width={420} height={520}>
      <style>{`
        .roulette-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 16px;
          font-family: 'Cubic 11', sans-serif;
        }

        .roulette-wheel-container {
          position: relative;
          width: 280px;
          height: 280px;
        }

        .roulette-wheel {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: linear-gradient(135deg, #8B4513 0%, #D2691E 50%, #8B4513 100%);
          border: 8px solid #5C3D2E;
          box-shadow:
            0 0 0 4px #3d2518,
            inset 0 0 20px rgba(0,0,0,0.3);
          position: relative;
          transition: transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99);
        }

        .roulette-wheel.spinning {
          transition: transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99);
        }

        .roulette-pointer {
          position: absolute;
          top: -20px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 15px solid transparent;
          border-right: 15px solid transparent;
          border-top: 30px solid #FFD700;
          filter: drop-shadow(0 2px 2px rgba(0,0,0,0.5));
          z-index: 10;
        }

        .roulette-center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 60px;
          height: 60px;
          background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
          border-radius: 50%;
          border: 4px solid #8B4513;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        }

        .roulette-segment {
          position: absolute;
          width: 50%;
          height: 50%;
          top: 0;
          right: 0;
          transform-origin: bottom left;
          overflow: hidden;
        }

        .roulette-segment::before {
          content: '';
          position: absolute;
          width: 200%;
          height: 200%;
          background: rgba(255, 255, 255, 0.1);
          transform: rotate(22.5deg);
        }

        .roulette-segment:nth-child(1) { transform: rotate(0deg) skewY(-45deg); background: #FF6B6B; }
        .roulette-segment:nth-child(2) { transform: rotate(45deg) skewY(-45deg); background: #4ECDC4; }
        .roulette-segment:nth-child(3) { transform: rotate(90deg) skewY(-45deg); background: #FFE66D; }
        .roulette-segment:nth-child(4) { transform: rotate(135deg) skewY(-45deg); background: #95E1D3; }
        .roulette-segment:nth-child(5) { transform: rotate(180deg) skewY(-45deg); background: #F38181; }
        .roulette-segment:nth-child(6) { transform: rotate(225deg) skewY(-45deg); background: #AA96DA; }
        .roulette-segment:nth-child(7) { transform: rotate(270deg) skewY(-45deg); background: #FCBAD3; }
        .roulette-segment:nth-child(8) { transform: rotate(315deg) skewY(-45deg); background: #A8D8EA; }

        .roulette-btn {
          padding: 12px 32px;
          font-size: 18px;
          font-weight: bold;
          color: #F5E6C8;
          background: linear-gradient(180deg, #7fd34e 0%, #5a9e3a 100%);
          border: 3px solid #3d2518;
          border-radius: 8px;
          cursor: pointer;
          font-family: 'Cubic 11', sans-serif;
          text-shadow: 1px 1px 0 #000;
          box-shadow: 0 4px 0 #2d5016;
          transition: all 0.1s;
        }

        .roulette-btn:hover:not(:disabled) {
          background: linear-gradient(180deg, #8fe45e 0%, #6aae4a 100%);
        }

        .roulette-btn:active:not(:disabled) {
          transform: translateY(2px);
          box-shadow: 0 2px 0 #2d5016;
        }

        .roulette-btn:disabled {
          background: #888;
          box-shadow: 0 4px 0 #555;
          cursor: not-allowed;
        }

        .ad-container {
          width: 100%;
          border: 3px solid #3d2518;
          border-radius: 8px;
          overflow: hidden;
          background: #2a1a10;
        }

        .ad-banner {
          width: 100%;
          height: 80px;
          object-fit: cover;
          display: block;
        }

        .ad-placeholder {
          width: 100%;
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #3d2518;
          color: #A89078;
          font-size: 14px;
        }

        .message {
          font-size: 12px;
          color: #FF6B6B;
          text-align: center;
          text-shadow: 1px 1px 0 #000;
          max-width: 100%;
          word-wrap: break-word;
        }

        .message.success {
          color: #7fd34e;
        }
      `}</style>

      <div className="roulette-container">
        {/* 轉盤 */}
        <div className="roulette-wheel-container">
          <div className="roulette-pointer" />
          <div
            className={`roulette-wheel ${isSpinning ? 'spinning' : ''}`}
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <div className="roulette-segment" />
            <div className="roulette-segment" />
            <div className="roulette-segment" />
            <div className="roulette-segment" />
            <div className="roulette-segment" />
            <div className="roulette-segment" />
            <div className="roulette-segment" />
            <div className="roulette-segment" />
          </div>
          <div className="roulette-center">🎰</div>
        </div>

        {/* 轉動按鈕 */}
        <button
          className="roulette-btn"
          onClick={handleSpin}
          disabled={isSpinning}
        >
          {isSpinning ? '轉動中...' : '開始轉動'}
        </button>

        {/* 訊息 */}
        {message && (
          <div className={`message ${message.includes('成功') ? 'success' : ''}`}>
            {message}
          </div>
        )}

        {/* 廣告區域 */}
        <div className="ad-container">
          {adImage ? (
            isBbrPhoto && adLink ? (
              <a href={adLink} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textDecoration: 'none' }}>
                <img
                  className="ad-banner"
                  src={adImage}
                  alt="BBR 車庫新照片"
                  onError={() => setAdImage('')}
                  style={{ cursor: 'pointer' }}
                />
                <div style={{ fontSize: '0.65rem', color: '#aaa', padding: '4px 6px', textAlign: 'center' }}>
                  @{adUsername} {adCaption ? `• ${adCaption}` : ''}
                </div>
              </a>
            ) : (
              <img
                className="ad-banner"
                src={adImage}
                alt="廣告"
                onError={() => setAdImage('')}
              />
            )
          ) : (
            <div className="ad-placeholder">載入廣告中...</div>
          )}
        </div>
      </div>
    </PixelWindow>
  );
}
