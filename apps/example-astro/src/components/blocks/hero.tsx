import { useState } from 'react';
import { editable } from '@storypane/sdk';
import type { HeroBlock } from '../../types/storypane';
import { assetPath } from '../../lib/content';
import type { RenderOptions } from './block';

export function Hero({ block, preview }: { block: HeroBlock; preview?: RenderOptions['preview'] }) {
  const [failedImage, setFailedImage] = useState('');
  const asset = block.hero_image;
  const image = asset
    ? preview
      ? `${preview.cmsUrl}/api/cms/assets/${encodeURIComponent(asset.assetId)}/content?space=${encodeURIComponent(preview.spaceId)}`
      : assetPath(asset.assetId)
    : '';
  const showImage = !!image && failedImage !== image;
  return (
    <section {...editable(block)} tabIndex={0} className="hero">
      <div className="hero-copy">
        <p className="eyebrow">
          <span className="live-dot" />
          {block.eyebrow}
        </p>
        <h1>{block.title || 'Your next idea starts here.'}</h1>
        <p className="hero-description">{block.description}</p>
        <a className="round-link" href="#ideas">
          A little of what we do <span aria-hidden="true">↗</span>
        </a>
      </div>
      {image && (
        <div
          {...editable(block, 'hero_image')}
          className="hero-art hero-art--image"
          hidden={!showImage}
        >
          <img
            className="hero-image"
            src={image}
            alt={asset ? (asset.alt ?? '') : ''}
            fetchPriority="high"
            onError={() => setFailedImage(image)}
          />
        </div>
      )}
      <div className="hero-art" aria-hidden="true" hidden={showImage}>
        <span className="art-caption">Good things take shape.</span>
        <div className="shape shape-one" />
        <div className="shape shape-two" />
        <div className="shape shape-three" />
        <span className="art-mark">f/w.</span>
        <span className="art-edition">INDEPENDENT STUDIO — VOL. 01</span>
      </div>
      <div className="hero-baseline">
        <span>A space for ideas to become something.</span>
        <span>Built with care. Made to last.</span>
      </div>
    </section>
  );
}
