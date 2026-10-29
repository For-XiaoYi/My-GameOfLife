import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT } from '../theme';

/** 统一底色：深青黑 + 一层极淡的网格 + 暗角 */
export const Backdrop: React.FC<{ children?: ReactNode; grid?: boolean }> = ({ children, grid = true }) => {
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT, color: C.text }}>
      {grid && (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(to right, ${C.gridLine} 1px, transparent 1px), linear-gradient(to bottom, ${C.gridLine} 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
            opacity: 0.55,
          }}
        />
      )}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(120% 90% at 50% 0%, rgba(108,245,210,0.10), rgba(5,8,12,0) 60%), radial-gradient(90% 80% at 50% 120%, rgba(108,245,210,0.06), rgba(5,8,12,0) 60%)',
        }}
      />
      <AbsoluteFill style={{ boxShadow: 'inset 0 0 260px 90px rgba(0,0,0,0.75)' }} />
      {children}
    </AbsoluteFill>
  );
};

export const Eyebrow: React.FC<{ children: ReactNode; style?: CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      fontSize: 22,
      letterSpacing: 8,
      color: C.accent,
      textTransform: 'uppercase',
      marginBottom: 22,
      fontFamily: FONT,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Heading: React.FC<{ children: ReactNode; size?: number; style?: CSSProperties }> = ({
  children,
  size = 68,
  style,
}) => (
  <div style={{ fontSize: size, lineHeight: 1.24, fontWeight: 700, letterSpacing: 1, ...style }}>{children}</div>
);

export const Chip: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div
    style={{
      padding: '10px 20px',
      borderRadius: 999,
      border: `1px solid ${C.line}`,
      background: 'rgba(255,255,255,0.04)',
      fontSize: 22,
      color: C.text,
      letterSpacing: 1,
    }}
  >
    {children}
  </div>
);

/** 淡入上升，delay 单位为帧 */
export const Rise: React.FC<{ delay?: number; children: ReactNode; style?: CSSProperties; y?: number }> = ({
  delay = 0,
  children,
  style,
  y = 22,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.7 } });
  return (
    <div style={{ opacity: s, transform: `translateY(${(1 - s) * y}px)`, ...style }}>
      {children}
    </div>
  );
};

export const FadeIn: React.FC<{ from?: number; dur?: number; children: ReactNode; style?: CSSProperties }> = ({
  from = 0,
  dur = 12,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [from, from + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <div style={{ opacity: o, ...style }}>{children}</div>;
};
