import { Composition, registerRoot } from 'remotion';
import { Promo, TOTAL_FRAMES, FPS } from './Promo';
import { DouyinPromo, DOUYIN_FPS, DOUYIN_TOTAL } from './douyin/DouyinPromo';

const Root: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="PromoDouyin" component={DouyinPromo} durationInFrames={DOUYIN_TOTAL} fps={DOUYIN_FPS} width={1080} height={1920} />
  </>
);

registerRoot(Root);
