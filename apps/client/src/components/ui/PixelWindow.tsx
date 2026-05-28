// PixelWindow - 像素風格視窗基底元件
import { ReactNode } from 'react';

interface PixelWindowProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}

export default function PixelWindow({ title, children, onClose, width = 400 }: PixelWindowProps) {
  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: width,
      maxWidth: '95vw',
      maxHeight: '85vh',
      background: '#5C3D2E',
      border: '6px solid #3d2518',
      borderRadius: '4px',
      boxShadow: '8px 8px 0 #3d2518',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'Cubic 11', sans-serif",
      animation: 'pixelFadeIn 0.2s ease-out',
    }}>
      {/* title */}
      <div style={{
        background: 'linear-gradient(180deg, #8B5A2B 0%, #6B4423 100%)',
        padding: '12px 16px',
        borderBottom: '4px solid #3d2518',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'move',
      }}>
        <span style={{
          color: '#F5D76E',
          fontSize: '18px',
          fontWeight: 'bold',
          textShadow: '2px 2px 0 #3d2518',
          fontFamily: "'Cubic 11', sans-serif",
        }}>
          {title}
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
          ✕
        </button>
      </div>

      {/* content */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '16px',
        background: '#F5DEB3',
      }}>
        {children}
      </div>

      <style>{`
        @keyframes pixelFadeIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </div>
  );
}
