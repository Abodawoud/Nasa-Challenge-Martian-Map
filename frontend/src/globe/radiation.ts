// Estimated cosmic radiation at the surface, as a heat map.
//
// IMPORTANT, what this is and is not:
//   - It is an ESTIMATE, not a measurement. No orbiter or rover has measured radiation across
//     the planet's surface, and NASA Trek has no radiation layer (checked 2026-11-15).
//   - It follows the method of NASA's own map "Estimated Radiation Dosage on Mars"
//     (PIA03480, NASA/JPL/JSC, 2002): the dose from cosmic rays depends on how much air is
//     above you. Low ground has more air above it, so less radiation. High ground has less
//     air, so more. That map goes from about 10 rem per year in the lowest places to about
//     20 rem per year on the highest.
//   - So this layer recolours NASA's elevation map (MOLA laser altimeter): low ground blue,
//     high ground red. The colour is a rank from lower to higher. We do not print a dose
//     number per place, because the exact formula of the 2002 map is not published.
//   - It does not show solar storms, and it does not show local shelter (a cliff or a cave
//     blocks part of the sky, which this map cannot know).
//
// Fast: one small lookup per pixel, on tiles the browser already has. The elevation tiles
// are 256 x 256 grey pixels and stop at level 5, so very few tiles are ever needed.

/** Colour stops from lowest ground (least radiation) to highest (most), like NASA's map. */
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [26, 44, 160]],
  [0.25, [34, 150, 214]],
  [0.5, [92, 200, 120]],
  [0.72, [246, 214, 70]],
  [0.88, [240, 120, 40]],
  [1, [190, 24, 24]],
]

/** The same ramp as a CSS gradient, for the legend in the panel. */
export const RADIATION_GRADIENT = `linear-gradient(90deg, ${STOPS.map(([at, [r, g, b]]) => `rgb(${r},${g},${b}) ${at * 100}%`).join(', ')})`

/** Grey value (0 to 255) to colour, built once. */
const LOOKUP = (() => {
  const table = new Uint8ClampedArray(256 * 3)
  for (let grey = 0; grey < 256; grey++) {
    const t = grey / 255
    let i = 1
    while (i < STOPS.length - 1 && STOPS[i][0] < t) i++
    const [fromAt, from] = STOPS[i - 1]
    const [toAt, to] = STOPS[i]
    const k = (t - fromAt) / (toAt - fromAt)
    for (let c = 0; c < 3; c++) table[grey * 3 + c] = from[c] + (to[c] - from[c]) * k
  }
  return table
})()

/**
 * Recolour one grey elevation tile. An ImageBitmap in, an ImageBitmap out, in the same
 * orientation (see tint.ts for why a canvas must never be returned).
 */
export function elevationToRadiation(image: CanvasImageSource & { width: number; height: number }): ImageBitmap {
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, image.width, image.height)
  const { data } = pixels
  for (let i = 0; i < data.length; i += 4) {
    // In this NASA mosaic the very lowest ground (the floor of the Hellas basin) is stored as
    // transparent black. It is the lowest ground, so it gets the lowest colour, not a hole.
    const grey = data[i + 3] === 0 ? 0 : data[i]
    data[i] = LOOKUP[grey * 3]
    data[i + 1] = LOOKUP[grey * 3 + 1]
    data[i + 2] = LOOKUP[grey * 3 + 2]
    data[i + 3] = 255
  }
  ctx.putImageData(pixels, 0, 0)
  return canvas.transferToImageBitmap()
}
