'use client';

import { useId } from 'react';
import type { AssetRecord } from '@storypane/assets';
import { assetThumbnailUrl } from './api';

export function FocalPointEditor({
  asset,
  value,
  onChange,
  disabled,
}: {
  asset: AssetRecord;
  value: AssetRecord['focalPoint'];
  onChange: (value: AssetRecord['focalPoint']) => void;
  disabled: boolean;
}) {
  const hint = useId();
  const point = value ?? { x: 0.5, y: 0.5 };
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
  return (
    <div className="asset-focal-editor">
      <h3>Focal point</h3>
      <p id={hint} className="field-hint">
        Select the part to keep in cover crops. Use arrow keys for small changes, Shift + arrows for
        larger changes, or Home to reset.
      </p>
      <button
        type="button"
        className="asset-focal-image"
        aria-label="Image focal point"
        aria-describedby={hint}
        disabled={disabled}
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (bounds.width && bounds.height)
            onChange({
              x: clamp((event.clientX - bounds.left) / bounds.width),
              y: clamp((event.clientY - bounds.top) / bounds.height),
            });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Home') {
            event.preventDefault();
            onChange(null);
            return;
          }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const step = event.shiftKey ? 0.1 : 0.01;
          onChange({
            x: clamp(
              point.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
            ),
            y: clamp(
              point.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
            ),
          });
        }}
      >
        <img src={assetThumbnailUrl(asset.id, 1280)} alt="" />
        <span
          className="asset-focal-marker"
          aria-hidden="true"
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
        />
      </button>
      <output aria-live="polite">
        Horizontal {Math.round(point.x * 100)}%, vertical {Math.round(point.y * 100)}%
      </output>
      <button
        type="button"
        className="button secondary"
        disabled={disabled}
        onClick={() => onChange(null)}
      >
        Reset to center
      </button>
      <figure className="asset-crop-preview">
        <img
          src={assetThumbnailUrl(asset.id, 640)}
          alt="Crop preview"
          style={{ objectPosition: `${point.x * 100}% ${point.y * 100}%` }}
        />
        <figcaption>16:9 cover crop preview</figcaption>
      </figure>
      <p className="field-hint">
        Saving updates crops everywhere this asset is used. Original files stay unchanged. Animated
        images use a still frame in transformed output.
      </p>
    </div>
  );
}
