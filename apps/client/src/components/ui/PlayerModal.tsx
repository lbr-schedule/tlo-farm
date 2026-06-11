// 玩家系統 - 空殼頁（MVP 第一階段不做實際邏輯）
import PixelWindow from './PixelWindow';

interface PlayerModalProps {
  onClose: () => void;
  user?: {
    nickname?: string;
    level?: number;
    exp?: number;
    gold?: number;
  } | null;
}

export default function PlayerModal({ onClose }: PlayerModalProps) {
  return (
    <PixelWindow title="👤 玩家資訊" onClose={onClose} width={420}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 20px',
        fontFamily: "'Cubic 11', sans-serif",
        color: '#5C3D2E',
        gap: '16px'
      }}>
        <div style={{ fontSize: '48px' }}>👤</div>
        <div style={{
          fontSize: '22px',
          fontWeight: 'bold',
          color: '#3d2518',
          textShadow: '2px 2px 0 #d4c4a8'
        }}>
          敬請期待
        </div>
        <div style={{
          fontSize: '14px',
          color: '#8B6243',
          textAlign: 'center'
        }}>
          玩家功能即將開放<br />敬請期待後續更新！
        </div>
      </div>
    </PixelWindow>
  );
}
