import type {VideoTexture} from 'three';
import {describe, expect, it, vi} from 'vitest';

import {VideoStream} from './VideoStream';

function createReadyStateVideoStream() {
  const stream = new VideoStream();
  let readyState = 0;

  Object.defineProperty(stream.video, 'readyState', {
    configurable: true,
    get: () => readyState,
  });
  Object.defineProperty(stream.video, 'HAVE_CURRENT_DATA', {
    configurable: true,
    value: 2,
  });

  return {
    stream,
    setReadyState: (nextReadyState: number) => {
      readyState = nextReadyState;
    },
  };
}

describe('VideoStream', () => {
  it('does not mark the texture dirty before the video has current data', () => {
    const {stream, setReadyState} = createReadyStateVideoStream();
    const texture = stream.texture as VideoTexture & {update: () => void};
    const initialVersion = texture.version;

    setReadyState(1);
    texture.update();

    expect(texture.version).toBe(initialVersion);
  });

  it('marks the texture dirty when the video has current data', () => {
    const {stream, setReadyState} = createReadyStateVideoStream();
    const texture = stream.texture as VideoTexture & {update: () => void};
    const initialVersion = texture.version;

    setReadyState(2);
    texture.update();

    expect(texture.version).toBeGreaterThan(initialVersion);
  });

  it('caches snapshots taken within the 8ms window and invalidates them afterwards', async () => {
    const {stream, setReadyState} = createReadyStateVideoStream();
    stream.loaded = true;
    stream.width = 100;
    stream.height = 100;
    setReadyState(2); // HAVE_CURRENT_DATA

    const mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({}),
    };
    const mockCanvas = {
      width: 100,
      height: 100,
      getContext: vi.fn().mockReturnValue(mockContext),
    };

    // Inject mock canvas and context to bypass JSDOM canvas limitations
    (stream as unknown as {canvas_: unknown; context_: unknown}).canvas_ =
      mockCanvas;
    (stream as unknown as {canvas_: unknown; context_: unknown}).context_ =
      mockContext;

    // 1. Verify default 8ms window caching works
    const snap1 = stream.getSnapshot({outputFormat: 'texture'});
    expect(snap1).not.toBeNull();
    expect(mockContext.drawImage).toHaveBeenCalledTimes(1);

    const snap2 = stream.getSnapshot({outputFormat: 'texture'});
    expect(snap2).toBe(snap1); // Cache hit!
    expect(mockContext.drawImage).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 10)); // wait 10ms (>8ms)

    const snap3 = stream.getSnapshot({outputFormat: 'texture'});
    expect(snap3).not.toBeNull();
    expect(mockContext.drawImage).toHaveBeenCalledTimes(2); // Cache expired!

    mockContext.drawImage.mockClear();

    // 2. Verify cacheWindowMs: 0 completely disables caching
    const snapA = stream.getSnapshot({
      outputFormat: 'texture',
      cacheWindowMs: 0,
    });
    const snapB = stream.getSnapshot({
      outputFormat: 'texture',
      cacheWindowMs: 0,
    });
    expect(snapB).not.toBe(snapA); // Cache is disabled, returns fresh capture!
    expect(mockContext.drawImage).toHaveBeenCalledTimes(2);

    mockContext.drawImage.mockClear();

    // Force clear the cache to start the custom window test fresh
    (
      stream as unknown as {snapshotCache_: Map<string, unknown>}
    ).snapshotCache_.clear();

    // 3. Verify custom cacheWindowMs: 20 extends the cache window
    const snapC = stream.getSnapshot({
      outputFormat: 'texture',
      cacheWindowMs: 20,
    });
    await new Promise((resolve) => setTimeout(resolve, 10)); // wait 10ms (<20ms)
    const snapD = stream.getSnapshot({
      outputFormat: 'texture',
      cacheWindowMs: 20,
    });
    expect(snapD).toBe(snapC); // Cache is still valid!
    expect(mockContext.drawImage).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 15)); // wait another 15ms (total 25ms > 20ms)
    const snapE = stream.getSnapshot({
      outputFormat: 'texture',
      cacheWindowMs: 20,
    });
    expect(snapE).not.toBe(snapC); // Cache expired!
    expect(mockContext.drawImage).toHaveBeenCalledTimes(2);
  });
});
