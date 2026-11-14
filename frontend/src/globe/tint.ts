// CTX and HiRISE are black-and-white cameras. Next to the colour Viking map they look like
// a grey patch. This gives them the Mars colour while keeping all their detail, so the
// sharp photos match the planet's colours.
// This is a visual tint only. The README says so, and it never changes any number.

/**
 * Grey range [low, high] of a source that is stretched to the full 0 to 255 range before
 * colouring. Each source uses only a narrow band of grey (measured 2026-11-14, 2nd and 98th
 * percentile around Jezero): global CTX 115-153, Jezero CTX 105-156, HiRISE 51-137.
 * Stretching each one with its own range makes them match each other.
 */
export type GreyLevels = [low: number, high: number]

/** The Mars colour the photos are tinted with (middle of the Viking colours around Jezero). */
const MARS_TINT = '#9c6b56'

/**
 * Return a canvas with the tile recoloured. Transparent (no-data) pixels stay transparent.
 *
 * Fast path: only canvas filters and blend modes, which the browser runs on the GPU.
 * An earlier version changed every pixel in JavaScript, which made dragging the map stutter.
 * 1. grayscale + brightness + contrast stretch the source's grey range to the full range.
 * 2. The "color" blend mode keeps each pixel's brightness and takes the Mars hue and saturation.
 * 3. "destination-in" puts back the original transparency.
 */
export function tintToMars(
  image: CanvasImageSource & { width: number; height: number },
  levels: GreyLevels = [0, 255],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')!

  const [low, high] = levels
  const middle = (low + high) / 2 / 255
  const brightness = 0.5 / middle
  // Stretch to about 65% of the full range, not 100%. A full stretch turns bright sand white.
  const contrast = 0.65 / Math.max(0.01, ((high - low) / 255) * brightness)
  ctx.filter = `grayscale(1) brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)})`
  ctx.drawImage(image, 0, 0)
  ctx.filter = 'none'

  ctx.globalCompositeOperation = 'color'
  ctx.fillStyle = MARS_TINT
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(image, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}
