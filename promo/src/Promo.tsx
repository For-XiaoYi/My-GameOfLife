import type { ReactNode } from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { TitleScene, RulesScene } from './scenes/Intro';
import { PatternsScene, FeaturesScene } from './scenes/Showcase';
import { TimeTravelScene, OutroScene } from './scenes/Ending';

type SceneDef = { key: string; dur: number; node: ReactNode };

export const SCENES: SceneDef[] = [
  { key: 'title', dur: 140, node: <TitleScene /> },
  { key: 'rules', dur: 320, node: <RulesScene /> },
  { key: 'patterns', dur: 280, node: <PatternsScene /> },
  { key: 'features', dur: 380, node: <FeaturesScene /> },
  { key: 'time', dur: 250, node: <TimeTravelScene /> },
  { key: 'outro', dur: 175, node: <OutroScene /> },
];

export const FPS = 30;
const FADE = 9;

/** 场景之间用 9 帧淡入淡出衔接（不依赖 @remotion/transitions） */
const Fade: React.FC<{ dur: number; children: ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = Math.min(1, Math.min(f / FADE, (dur - f) / FADE));
  return <AbsoluteFill style={{ opacity: Math.max(0, o) }}>{children}</AbsoluteFill>;
};

export const Promo: React.FC = () => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: '#05080c' }}>
      {/* 整片配乐：build/make-music.mjs 合成，含段落推进与音效，无旁白 */}
      <Audio src={staticFile('music/score.wav')} volume={1} />
      {SCENES.map((s) => {
        const from = at;
        at += s.dur;
        return (
          <Sequence key={s.key} from={from} durationInFrames={s.dur}>
            <Fade dur={s.dur}>{s.node}</Fade>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const TOTAL_FRAMES = SCENES.reduce((n, s) => n + s.dur, 0);
