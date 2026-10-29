import { AbsoluteFill, Img, staticFile, interpolate, useCurrentFrame } from 'remotion';
import { LifeGrid } from '../components/LifeGrid';
import { Backdrop, Eyebrow, Heading, Rise } from '../components/ui';
import { C } from '../theme';
import { framesOf, getPattern, padBitmap, placeBitmap } from '../lib/life';

/** 三个图案并排：滑翔机 / 脉冲星 / 高斯帕滑翔机枪 */
const CARDS = [
  {
    id: 'glider',
    tag: '飞船',
    desc: '每 4 代整体斜移一格，永不消散',
    px: 30,
    gap: 6,
    gps: 0.25,
    gens: 16,
    width: 400,
    board: (bm: ReturnType<typeof getPattern>) => padBitmap(bm, 2),
  },
  {
    id: 'pulsar',
    tag: '振荡子',
    desc: '13×13 的节拍器，三步一个来回',
    px: 16,
    gap: 3,
    gps: 0.2,
    gens: 12,
    width: 400,
    board: (bm: ReturnType<typeof getPattern>) => padBitmap(bm, 1),
  },
  {
    id: 'gosperglidergun',
    tag: '枪',
    desc: '每 30 代吐出一艘滑翔机，能一直造下去',
    px: 12,
    gap: 2,
    gps: 0.3,
    gens: 96,
    width: 700,
    board: (bm: ReturnType<typeof getPattern>) => placeBitmap(bm, 46, 30, 2, 2),
  },
] as const;

export const PatternsScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '104px 112px' }}>
        <Rise delay={0}>
          <Eyebrow>涌现</Eyebrow>
          <Heading>给它一个初始形状，它就开始自己活着</Heading>
        </Rise>

        <div style={{ display: 'flex', gap: 34, marginTop: 62, alignItems: 'flex-start' }}>
          {CARDS.map((card, i) => {
            const pat = getPattern(card.id);
            const bm = card.board(pat);
            const frames = framesOf(card.id + '-p', bm, card.gens);
            const gi = Math.floor(frame * card.gps) % frames.length;
            const appear = interpolate(frame, [i * 18, i * 18 + 20], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });

            return (
              <div
                key={card.id}
                style={{
                  opacity: appear,
                  transform: `translateY(${(1 - appear) * 28}px)`,
                  width: card.width,
                  padding: 26,
                  borderRadius: 20,
                  border: `1px solid ${C.line}`,
                  background: 'rgba(10,16,23,0.72)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                  <div style={{ fontSize: 34, fontWeight: 700 }}>{pat.name}</div>
                  <div
                    style={{
                      fontSize: 18,
                      color: C.accent,
                      border: `1px solid ${C.accentSoft}`,
                      borderRadius: 999,
                      padding: '3px 12px',
                    }}
                  >
                    {card.tag}
                  </div>
                </div>

                <div
                  style={{
                    height: 420,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 14,
                    background: 'rgba(5,10,14,0.75)',
                    overflow: 'hidden',
                  }}
                >
                  <LifeGrid frames={frames} gi={gi} px={card.px} gap={card.gap} radius={i === 2 ? 2 : 3} showGrid />
                </div>

                <div style={{ fontSize: 21, color: C.dim, lineHeight: 1.6 }}>{card.desc}</div>
              </div>
            );
          })}
        </div>

        <Rise delay={54} style={{ marginTop: 46 }}>
          <div style={{ fontSize: 24, color: C.dim }}>
            这些都不是程序里写死的动画 —— 每一格只知道自己周围有几个邻居。
          </div>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

/** 功能一览：真实界面截图轮播（zoom 用来把注意力拉到界面的某一侧） */
const SHOTS = [
  {
    file: 'shot-main.png',
    title: '一百万格的画布',
    desc: '1024×1024 的环形世界，滚轮缩放、拖拽平移，随时适应全图',
    zoom: 1.05,
    origin: '50% 50%',
  },
  {
    file: 'ui-library.png',
    title: '图案库',
    desc: '静态、振荡、飞船、枪、长寿者，二十种预设随手就摆，摆之前还能先看预览',
    zoom: 1.16,
    origin: '82% 46%',
  },
  {
    file: 'shot-edit.png',
    title: '图案库可以自己改',
    desc: '分组拖拽排序、框选存图案，把喜欢的形状收进自己的库',
    zoom: 1.22,
    origin: '84% 40%',
  },
  {
    file: 'ui-studio.png',
    title: '时刻与时段',
    desc: '把某一代存成快照，或者把一段演化录成可回放的片段',
    zoom: 1.5,
    origin: '50% 50%',
  },
  {
    file: 'ui-help.png',
    title: '全都写在帮助里',
    desc: '按 ← → 单步、Shift+0 回正、Ctrl+Z 撤销，快捷键一览无余',
    zoom: 1.3,
    origin: '50% 50%',
  },
] as const;

export const FeaturesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const per = 74;
  const idx = Math.min(SHOTS.length - 1, Math.floor(frame / per));
  const local = frame - idx * per;
  const shot = SHOTS[idx];

  const imgIn = interpolate(local, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const imgOut = interpolate(local, [per - 12, per - 2], [1, 0.15], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(local, [0, per], [1.03, 1.005]);

  return (
    <Backdrop grid={false}>
      <AbsoluteFill style={{ padding: '76px 90px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <Eyebrow style={{ marginBottom: 12 }}>能做什么</Eyebrow>
            <Heading size={54}>{shot.title}</Heading>
          </div>
          <div style={{ fontSize: 22, color: C.dim }}>
            {String(idx + 1).padStart(2, '0')} / {String(SHOTS.length).padStart(2, '0')}
          </div>
        </div>

        <div
          style={{
            marginTop: 34,
            opacity: imgIn * imgOut,
            transform: `scale(${scale})`,
            borderRadius: 16,
            overflow: 'hidden',
            border: `1px solid ${C.line}`,
            boxShadow: '0 40px 120px rgba(0,0,0,0.6)',
            height: 700,
          }}
        >
          <Img
            src={staticFile(shot.file)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${shot.zoom})`,
              transformOrigin: shot.origin,
              filter: 'brightness(1.16) contrast(1.03) saturate(1.05)',
            }}
          />
        </div>

        <div style={{ marginTop: 26, fontSize: 26, color: C.dim, opacity: imgIn }}>{shot.desc}</div>
      </AbsoluteFill>
    </Backdrop>
  );
};
