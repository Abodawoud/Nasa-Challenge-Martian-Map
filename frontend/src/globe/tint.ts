// CTX and HiRISE are black-and-white cameras. Next to the colour Viking map they look like
// a grey patch. This gives them the Mars colour while keeping all their detail, so the
// sharp photos match the planet's colours.
// This is a visual tint only. PLAN.md says so, and it never changes any number.

/**
 * Grey range [low, high] of a source that is stretched to the full 0 to 255 range before
 * colouring. Each source uses only a narrow band of grey (measured 2026-11-14, 2nd and 98th
 * percentile around Jezero): global CTX 115-153, Jezero CTX 105-156, HiRISE 51-137.
 * Stretching each one with its own range makes them match each other.
 */
export type GreyLevels = [low: number, high: number]

/**
 * The colour of the brightest Mars ground. The photo is MULTIPLIED by it, like looking through
 * a tan filter: white becomes this tan, grey becomes brown, black stays black.
 * Measured against the Viking colour mosaic around Jezero.
 */
const MARS_LIGHT = '#e9b28c'

/** After stretching, grey values are lifted by this factor, so the multiply does not look dark. */
const LIFT = 1.25

/**
 * Return the tile recoloured. Transparent (no-data) pixels stay transparent.
 *
 * IMPORTANT, tile orientation: Cesium loads tiles as ImageBitmap objects that are already
 * flipped vertically for WebGL, and it uploads them as they are. A canvas, however, is
 * flipped again by Cesium on upload. An earlier version returned a canvas, so every tile
 * was mirrored top to bottom inside its own square. That cut craters in half at tile edges
 * and made horizontal bands. So: an ImageBitmap in means an ImageBitmap out (same
 * orientation). Only a plain <img> source returns a canvas.
 *
 * Fast path: only canvas filters and blend modes, no per-pixel JavaScript.
 * 1. grayscale + brightness + contrast bring the source's grey range to a common range,
 *    then a small lift.
 * 2. "multiply" with a light Mars tan. An earlier version used the "color" blend, which keeps
 *    each pixel's brightness: very bright sunlit slopes could not hold any colour and turned
 *    white. With multiply, the brightest possible result is the tan itself, never white.
 * 3. "destination-in" puts back the original transparency.
 */
export function tintToMars(
  image: CanvasImageSource & { width: number; height: number },
  levels: GreyLevels = [0, 255],
): HTMLCanvasElement | ImageBitmap {
  const isBitmap = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap
  const canvas = isBitmap
    ? new OffscreenCanvas(image.width, image.height)
    : Object.assign(document.createElement('canvas'), { width: image.width, height: image.height })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

  const [low, high] = levels
  const middle = (low + high) / 2 / 255
  const brightness = 0.5 / middle
  // Bring the source's main grey range to about 60% of the full range, centred. Never reduce
  // contrast: a source that already uses a wide range keeps all its sharpness.
  const contrast = Math.max(1, 0.6 / Math.max(0.01, ((high - low) / 255) * brightness))
  ctx.filter = `grayscale(1) brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) brightness(${LIFT})`
  ctx.drawImage(image, 0, 0)
  ctx.filter = 'none'

  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = MARS_LIGHT
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(image, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  return canvas instanceof OffscreenCanvas ? canvas.transferToImageBitmap() : canvas
}
