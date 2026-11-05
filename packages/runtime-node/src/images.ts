import sharp from 'sharp/lib/index.js';
import type { AssetImages, AssetImageTransform } from '@storypane/assets';

export function focalCrop(width: number, height: number, options: AssetImageTransform) {
  const ratio = options.width / options.height!;
  const cropWidth = Math.min(width, Math.round(height * ratio));
  const cropHeight = Math.min(height, Math.round(width / ratio));
  return {
    left: Math.round((width - cropWidth) * (options.gravity?.x ?? 0.5)),
    top: Math.round((height - cropHeight) * (options.gravity?.y ?? 0.5)),
    width: cropWidth,
    height: cropHeight,
  };
}
export const images: AssetImages = {
  input(body) {
    return {
      transform(options) {
        return {
          async output(output) {
            const reader = body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 20 * 1024 * 1024) throw new Error('Image exceeds 20 MiB');
                chunks.push(value);
              }
            } finally {
              await reader.cancel();
              reader.releaseLock();
            }
            const source = Buffer.concat(chunks);
            // Normalize orientation before applying the same remainder-based focal crop as Images.
            let pipeline = sharp(source, {
              limitInputPixels: 40_000_000,
              animated: false,
            }).rotate();
            if (options.fit === 'cover' && options.height) {
              const normalized = await pipeline.toBuffer({ resolveWithObject: true });
              pipeline = sharp(normalized.data).extract(
                focalCrop(normalized.info.width, normalized.info.height, options),
              );
            }
            const bytes = await pipeline
              .resize({
                width: options.width,
                height: options.height,
                fit: options.fit === 'scale-down' ? 'inside' : options.fit,
                withoutEnlargement: options.fit === 'scale-down',
                background: { r: 0, g: 0, b: 0, alpha: 0 },
              })
              .toFormat(
                output.format === 'image/jpeg'
                  ? 'jpeg'
                  : output.format === 'image/png'
                    ? 'png'
                    : 'webp',
                { quality: output.quality },
              )
              .toBuffer();
            return {
              response: () =>
                new Response(new Uint8Array(bytes), {
                  headers: {
                    'Content-Type': output.format,
                    'Content-Length': String(bytes.byteLength),
                  },
                }),
            };
          },
        };
      },
    };
  },
};
