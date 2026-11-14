// The Layers panel: a button on the map that opens a white card. Every row is one entry of
// PANEL_LAYERS (layers.config.ts): a switch, and a transparency slider for overlays.
import { useEffect, useRef, useState } from 'react'
import type * as Cesium from 'cesium'
import { Badge, Box, Button, Flex, HStack, IconButton, Slider, Spinner, Switch, Text, VStack } from '@chakra-ui/react'
import { Layers, X } from 'lucide-react'
import { PANEL_LAYERS } from '../globe/layers.config'
import type { LayerCategory, PanelLayer } from '../globe/layers.config'
import { setLayerOpacity, setLayerVisible } from '../globe/layerControl'
import type { RoverPathInfo } from '../globe/layerControl'

const CATEGORY: Record<LayerCategory, { label: string; palette: string }> = {
  optical: { label: 'Photo', palette: 'gray' },
  topographic: { label: 'Terrain', palette: 'green' },
  thermal: { label: 'Heat', palette: 'orange' },
  spectral: { label: 'Minerals', palette: 'purple' },
  vector: { label: 'Mission', palette: 'blue' },
}

interface RowState {
  on: boolean
  opacity: number
  /** Only the rover path: it is downloaded when first switched on. */
  loading: boolean
  error: boolean
  info?: RoverPathInfo
}

const initialState = (): Record<string, RowState> =>
  Object.fromEntries(PANEL_LAYERS.map((entry) => [entry.id, { on: entry.defaultOn, opacity: entry.defaultOpacity, loading: false, error: false }]))

export function LayersPanel({ viewer }: { viewer: Cesium.Viewer | null }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(initialState)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const count = PANEL_LAYERS.filter((entry) => rows[entry.id].on).length

  const patch = (id: string, change: Partial<RowState>) => setRows((all) => ({ ...all, [id]: { ...all[id], ...change } }))

  const toggle = (entry: PanelLayer, on: boolean) => {
    if (!viewer) return
    const { opacity } = rows[entry.id]
    patch(entry.id, { on, error: false, loading: on && entry.kind === 'rover-path' })
    setLayerVisible(viewer, entry, on, opacity)
      .then((info) => patch(entry.id, { loading: false, ...(info ? { info } : {}) }))
      .catch((error) => {
        console.warn('[Layers] could not show', entry.id, error)
        patch(entry.id, { on: false, loading: false, error: true })
      })
  }

  const fade = (entry: PanelLayer, opacity: number) => {
    patch(entry.id, { opacity })
    if (viewer) setLayerOpacity(viewer, entry, opacity)
  }

  // Escape closes the panel and gives the focus back to its button.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <Box position="absolute" top="4" left="4" zIndex="10" maxW="calc(100% - 32px)">
      {!open && (
        <Button
          ref={buttonRef}
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="layers-panel"
          size="sm"
          bg="whiteAlpha.900"
          color="brand.700"
          backdropFilter="blur(10px)"
          borderWidth="1px"
          borderColor="whiteAlpha.600"
          borderRadius="xl"
          shadow="lg"
          fontWeight="600"
          _hover={{ bg: 'white' }}
        >
          <Layers size={16} aria-hidden />
          Layers
          <Badge size="sm" colorPalette="brand" variant="solid" borderRadius="full" fontVariantNumeric="tabular-nums">
            {count}
          </Badge>
        </Button>
      )}

      {open && (
        <Box
          id="layers-panel"
          role="region"
          aria-label="Map layers"
          w="320px"
          maxW="full"
          maxH="calc(100vh - 170px)"
          overflowY="auto"
          overscrollBehavior="contain"
          bg="white"
          borderWidth="1px"
          borderColor="gray.200"
          borderRadius="xl"
          shadow="xl"
        >
          <Flex align="center" justify="space-between" px="4" py="2.5" borderBottomWidth="1px" borderColor="gray.200" position="sticky" top="0" bg="white" zIndex="1">
            <HStack gap="2" color="brand.700">
              <Layers size={16} aria-hidden />
              <Text as="h2" fontWeight="700" fontSize="sm">
                Map layers
              </Text>
            </HStack>
            <IconButton aria-label="Close the layers panel" size="xs" variant="ghost" color="gray.600" onClick={() => setOpen(false)} autoFocus>
              <X size={16} aria-hidden />
            </IconButton>
          </Flex>

          <VStack align="stretch" gap="0">
            {PANEL_LAYERS.map((entry) => {
              const row = rows[entry.id]
              const category = CATEGORY[entry.category]
              return (
                <Box key={entry.id} px="4" py="3" borderBottomWidth="1px" borderColor="gray.100" _last={{ borderBottomWidth: 0 }}>
                  <Switch.Root
                    checked={row.on}
                    onCheckedChange={(event) => toggle(entry, event.checked)}
                    disabled={!viewer || row.loading}
                    colorPalette="brand"
                    size="sm"
                    display="flex"
                    alignItems="flex-start"
                    justifyContent="space-between"
                    gap="3"
                    w="full"
                  >
                    <Box minW="0">
                      <HStack gap="2" wrap="wrap">
                        <Switch.Label fontSize="sm" fontWeight="600" color="gray.900">
                          {entry.title}
                        </Switch.Label>
                        <Badge size="xs" colorPalette={category.palette} variant="subtle">
                          {category.label}
                        </Badge>
                      </HStack>
                      <Text fontSize="xs" color="gray.600" mt="0.5">
                        {entry.note}
                      </Text>
                    </Box>
                    <Switch.HiddenInput />
                    <Switch.Control mt="0.5" flexShrink={0}>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Root>

                  <Box aria-live="polite">
                    {row.loading && (
                      <HStack gap="2" mt="2" fontSize="xs" color="gray.600">
                        <Spinner size="xs" />
                        <Text>Loading the path from NASA…</Text>
                      </HStack>
                    )}
                    {row.error && (
                      <Text mt="2" fontSize="xs" color="red.700">
                        Could not load this layer from NASA. Switch it on again to retry.
                      </Text>
                    )}
                    {row.on && row.info && (
                      <Text mt="2" fontSize="xs" color="gray.700" fontVariantNumeric="tabular-nums">
                        {row.info.driveCount} drives · {row.info.lengthKm.toFixed(1)} km · up to sol {row.info.lastSol} (a sol is one Mars day)
                      </Text>
                    )}
                  </Box>

                  {row.on && entry.legend && (
                    <Text mt="2" fontSize="xs" color="gray.700">
                      {entry.legend}
                    </Text>
                  )}

                  {row.on && entry.adjustable && (
                    <Slider.Root
                      mt="2"
                      size="sm"
                      colorPalette="brand"
                      min={10}
                      max={100}
                      step={5}
                      value={[Math.round(row.opacity * 100)]}
                      onValueChange={(event) => fade(entry, event.value[0] / 100)}
                      aria-label={[`Transparency of ${entry.title}`]}
                    >
                      <HStack justify="space-between" fontSize="xs" color="gray.600">
                        <Slider.Label>Strength</Slider.Label>
                        <Text fontVariantNumeric="tabular-nums">{Math.round(row.opacity * 100)}%</Text>
                      </HStack>
                      <Slider.Control>
                        <Slider.Track>
                          <Slider.Range />
                        </Slider.Track>
                        <Slider.Thumbs />
                      </Slider.Control>
                    </Slider.Root>
                  )}

                  <Text mt="1.5" fontSize="2xs" color="gray.500">
                    Source: {entry.source}
                  </Text>
                </Box>
              )
            })}
          </VStack>
        </Box>
      )}
    </Box>
  )
}
