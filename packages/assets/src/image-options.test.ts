import { describe, expect, it } from 'vitest';
import { imageOptions } from './image-options';
import { focalPoint } from './validation';

describe('bounded public image options', () => {
  it('canonicalizes equivalent variants and derives crop dimensions', () => {
    const parse = (value: string) => imageOptions(new URLSearchParams(value));
    expect(parse('width=640')).toEqual(
      parse('fit=contain&format=webp&quality=80&aspect=original&width=640'),
    );
    expect(parse('width=320&aspect=3:4&format=png')).toEqual({
      width: 320,
      height: 427,
      fit: 'cover',
      format: 'image/png',
      quality: undefined,
    });
    expect(parse('width=1280&aspect=16:9&fit=contain&format=jpeg&quality=90')).toEqual({
      width: 1280,
      height: 720,
      fit: 'contain',
      format: 'image/jpeg',
      quality: 90,
    });
  });
  it.each([
    '',
    'width=321',
    'width=0320',
    'width=320&height=10',
    'width=320&width=320',
    'width=320&url=https://example.com',
    'width=320&aspect=2:1',
    'width=320&fit=crop',
    'width=320&quality=100',
    'width=320&quality=080',
    'width=320&format=avif',
    'width=320&format=png&quality=80',
  ])('rejects %s', (value) => {
    expect(() => imageOptions(new URLSearchParams(value))).toThrow();
  });
  it('accepts focal boundaries and rejects partial, extra, and nonfinite coordinates', () => {
    expect(focalPoint(null)).toBeNull();
    expect(focalPoint({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
    for (const value of [
      undefined,
      { x: 0 },
      { x: 0, y: 0, width: 10 },
      { x: NaN, y: 0 },
      { x: 0, y: Infinity },
      { x: -0.01, y: 0 },
      { x: 0, y: 1.01 },
    ])
      expect(() => focalPoint(value)).toThrow();
  });
});
