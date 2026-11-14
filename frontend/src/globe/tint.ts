// CTX and HiRISE are black-and-white cameras. Next to the colour Viking map they look like
// a grey patch. This maps each grey value to a Mars colour (a "gradient map"), so the
// sharp photos keep all their detail but match the planet's colours.
// This is a visual tint only. The README says so, and it never changes any number.

type RGB = [number, number, number]

/** Colour stops sampled to match the Viking colour mosaic around Jezero. */
const MARS_STOPS: Array<[number, RGB]> = [
  [0.0, [26, 18, 16]],
  [0.25, [80, 56, 48]],
  [0.5, [132, 96, 82]],
  [0.75, [180, 142, 124]],
  [1.0, [228, 200, 184]],
]

function buildLut(stops: Array<[number, RGB]>): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let k = 0
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++
    const [t0, c0] = stops[k]
    const [t1, c1] = stops[k + 1]
    const f = (t - t0) / (t1 - t0)
    for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = c0[ch] + (c1[ch] - c0[ch]) * f
  }
  return lut
}

const MARS_LUT = buildLut(MARS_STOPS)

/** Return a canvas with the tile recoloured. Transparent (no-data) pixels stay transparent. */
export function tintToMars(image: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0
    px[i] = MARS_LUT[g * 3]
    px[i + 1] = MARS_LUT[g * 3 + 1]
    px[i + 2] = MARS_LUT[g * 3 + 2]
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}
