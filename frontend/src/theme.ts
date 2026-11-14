// Chakra UI theme: the clean NASA website style (PLAN.md section 9).
// One brand colour scale built around NASA blue #0B3D91. NASA red is only for alerts.
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
        brand: {
          50: { value: '#eef3fb' },
          100: { value: '#d5e1f5' },
          200: { value: '#a9c0ea' },
          300: { value: '#7699db' },
          400: { value: '#4672c7' },
          500: { value: '#1f52ac' },
          600: { value: '#0b3d91' }, // NASA blue
          700: { value: '#082c6b' },
          800: { value: '#061f4c' },
          900: { value: '#041433' },
          950: { value: '#020b1f' },
        },
        nasaRed: { value: '#fc3d21' },
      },
    },
    semanticTokens: {
      colors: {
        // The tokens Chakra components read when they get colorPalette="brand".
        brand: {
          solid: { value: '{colors.brand.600}' },
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
