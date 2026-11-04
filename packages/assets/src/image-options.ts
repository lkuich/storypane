import { assert } from './validation';

export function imageOptions(params: URLSearchParams) {
  const allowed = ['width', 'aspect', 'fit', 'format', 'quality'];
  for (const key of params.keys()) {
    assert(allowed.includes(key), `Unsupported image parameter: ${key}`);
    assert(params.getAll(key).length === 1, `Duplicate image parameter: ${key}`);
  }
  const width = Number(params.get('width'));
  assert([160, 320, 640, 1280, 1920, 2560].includes(width), 'Unsupported image width');
  assert(params.get('width') === String(width), 'Use a canonical image width');
  const aspect = params.get('aspect') ?? 'original';
  assert(
    ['original', '1:1', '4:3', '3:4', '16:9', '9:16'].includes(aspect),
    'Unsupported image aspect',
  );
  const fit = params.get('fit') ?? 'cover';
  assert(fit === 'cover' || fit === 'contain', 'Unsupported image fit');
  const format = params.get('format') ?? 'webp';
  assert(format === 'webp' || format === 'jpeg' || format === 'png', 'Unsupported image format');
  const quality = Number(params.get('quality') ?? 80);
  assert([60, 80, 90].includes(quality), 'Unsupported image quality');
  assert(
    !params.has('quality') || params.get('quality') === String(quality),
    'Use a canonical image quality',
  );
  assert(format !== 'png' || !params.has('quality'), 'PNG does not accept quality');
  const [x, y] = aspect === 'original' ? [1, 1] : aspect.split(':').map(Number);
  return {
    width,
    height: aspect === 'original' ? undefined : Math.round((width * y) / x),
    fit: aspect === 'original' ? ('scale-down' as const) : (fit as 'cover' | 'contain'),
    format: `image/${format}` as 'image/webp' | 'image/jpeg' | 'image/png',
    quality: format === 'png' ? undefined : quality,
  };
}
