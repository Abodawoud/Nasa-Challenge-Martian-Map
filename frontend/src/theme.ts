// Chakra UI theme for the map screen: clean and light (PLAN.md section 9), in the colours
// of the Red Compass logo. `brand` is the logo's navy. `nasaRed` is the logo's red, used
// for the team mark, alerts and the active route.
import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"

const config = defineConfig({
  globalCss: {
    // The map fills the window exactly. The landing page is taller and scrolls.
    'html, body': { margin: 0, minHeight: '100%' },
    body: { color: 'gray.800' },
  },
  theme: {
    tokens: {
      fonts: {
        heading: { value: FONT },
        body: { value: FONT },
      },
      colors: {
        // The navy of the Red Compass logo (#0c1a3d) and lighter and darker steps of it.
        brand: {
          50: { value: '#eef1f8' },
          100: { value: '#d6dcee' },
          200: { value: '#adb8dc' },
          300: { value: '#8090c4' },
          400: { value: '#5468a8' },
          500: { value: '#33478a' },
          600: { value: '#16275a' },
          700: { value: '#0c1a3d' }, // logo navy
          800: { value: '#08122b' },
          900: { value: '#050b1c' },
          950: { value: '#03060f' },
        },
        // The red of the Red Compass logo.
        nasaRed: { value: '#e8231f' },
      },
    },
    semanticTokens: {
      colors: {
        // The tokens Chakra components read when they get colorPalette="brand".
        brand: {
          solid: { value: '{colors.brand.700}' },
          contrast: { value: 'white' },
          fg: { value: '{colors.brand.700}' },
          muted: { value: '{colors.brand.100}' },
          subtle: { value: '{colors.brand.50}' },
          emphasized: { value: '{colors.brand.200}' },
          focusRing: { value: '{colors.brand.500}' },
        },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
