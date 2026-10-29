import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { ageColor, type Frame } from '../lib/life';

/**
 * 用 div 画一小片细胞：图案不大（几十到几百格），
 * 比 canvas 更容易做颜色过渡，渲染出来也更锐利。
 */
export const LifeGrid: React.FC<{
  frames: Frame[];
  gi: number;
  px: number;
  gap?: number;
  radius?: number;
  showGrid?: boolean;
  glow?: number;
}> = ({ frames, gi, px, gap = 2, radius = 3, showGrid = false, glow = 0.7 }) => {
  const frame = useCurrentFrame();
  const f = frames[Math.min(frames.length - 1, Math.max(0, gi))];
  const step = px + gap;
  // 用帧号做一点点呼吸感，避免画面死板
  const breathe = 1 + 0.06 * Math.sin(frame / 9);

  return (
    <div style={{ position: 'relative', width: f.w * step - gap, height: f.h * step - gap }}>
      {showGrid && (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(to right, rgba(120,200,220,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(120,200,220,0.07) 1px, transparent 1px)`,
            backgroundSize: `${step}px ${step}px`,
          }}
        />
      )}
      {f.cells.map((v, i) =>
        v ? (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: (i % f.w) * step,
              top: Math.floor(i / f.w) * step,
              width: px,
              height: px,
              borderRadius: radius,
              background: ageColor(f.age[i] ?? 1),
              boxShadow: `0 0 ${px * glow * breathe}px rgba(108,245,210,0.42)`,
            }}
          />
        ) : null,
      )}
    </div>
  );
};
