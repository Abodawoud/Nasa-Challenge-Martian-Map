// The Layers panel: a button on the map that opens a white card. Every row is one entry of
// PANEL_LAYERS (layers.config.ts): a switch, and a transparency slider for overlays.
import { Fragment, useEffect, useRef, useState } from 'react'
import type * as Cesium from 'cesium'
import { Badge, Box, Button, Flex, HStack, IconButton, SimpleGrid, Slider, Spinner, Switch, Text } from '@chakra-ui/react'
import { Layers, TriangleAlert, X } from 'lucide-react'
import { PANEL_GROUPS, PANEL_LAYERS } from '../globe/layers.config'
import type { LayerCategory, PanelLayer } from '../globe/layers.config'
import { setLayerOpacity, setLayerVisible } from '../globe/layerControl'

const CATEGORY: Record<LayerCategory, { label: string; palette: string }> = {
  optical: { label: 'Photo', palette: 'gray' },
  topographic: { label: 'Terrain', palette: 'green' },
  thermal: { label: 'Heat', palette: 'orange' },
  spectral: { label: 'Minerals', palette: 'purple' },
  vector: { label: 'Mission', palette: 'blue' },
  geology: { label: 'Geology', palette: 'teal' },
  radiation: { label: 'Radiation', palette: 'red' },
}

interface RowState {
  on: boolean
  opacity: number
  /** Layers that are downloaded when first switched on. */
  loading: boolean
  error: boolean
  /** A line of facts about the layer, from its data. */
  info?: string
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
    patch(entry.id, { on, error: false, loading: on && entry.kind !== 'imagery' })
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
      requestAnimationFrame(() => buttonRef.current?.focus())
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
          w="340px"
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
          <Flex align="center" justify="space-between" px="4" py="2.5" borderBottomWidth="1px" borderColor="gray.200" position="sticky" top="0" bg="white" zIndex="2">
            <HStack gap="2" color="brand.700">
              <Layers size={16} aria-hidden />
              <Text as="h2" fontWeight="700" fontSize="sm">
                Map layers
              </Text>
            </HStack>
            <IconButton aria-label="Close the layers panel" size="xs" variant="ghost" color="gray.600" onClick={() => setOpen(false)}>
              <X size={16} aria-hidden />
            </IconButton>
          </Flex>

          {PANEL_GROUPS.map((group) => (
            <Fragment key={group.id}>
              <Box px="4" pt="3" pb="2" bg="gray.50" borderBottomWidth="1px" borderColor="gray.200">
                <Text as="h3" fontSize="xs" fontWeight="700" letterSpacing="0.06em" textTransform="uppercase" color="brand.700">
                  {group.title}
                </Text>
                {group.note && (
                  <Text fontSize="xs" color="gray.600" mt="0.5">
                    {group.note}
                  </Text>
                )}
              </Box>
              {PANEL_LAYERS.filter((entry) => entry.group === group.id).map((entry) => {
                const row = rows[entry.id]
                const category = CATEGORY[entry.category]
                return (
                  <Box key={entry.id} px="4" py="3" borderBottomWidth="1px" borderColor="gray.100">
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
                      cursor="pointer"
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
                          <Text>Loading from {entry.kind === 'geology' ? 'USGS' : 'NASA'}…</Text>
                        </HStack>
                      )}
                      {row.error && (
                        <Text mt="2" fontSize="xs" color="red.700">
                          Could not load this layer. Switch it on again to retry.
                        </Text>
                      )}
                      {row.on && row.info && (
                        <Text mt="2" fontSize="xs" color="gray.700" fontVariantNumeric="tabular-nums">
                          {row.info}
                        </Text>
                      )}
                    </Box>

                    {row.on && entry.legend && (
                      <Text mt="2" fontSize="xs" color="gray.700">
                        {entry.legend}
                      </Text>
                    )}

                    {row.on && entry.legendScale && (
                      <Box mt="2">
                        <Box aria-hidden h="10px" borderRadius="full" borderWidth="1px" borderColor="blackAlpha.300" style={{ backgroundImage: entry.legendScale.css }} />
                        <HStack justify="space-between" mt="1" fontSize="2xs" color="gray.700">
                          <Text>{entry.legendScale.low}</Text>
                          <Text>{entry.legendScale.high}</Text>
                        </HStack>
                      </Box>
                    )}

                    {row.on && entry.caution && (
                      <HStack align="flex-start" gap="2" mt="2" p="2" borderRadius="md" bg="orange.50" borderWidth="1px" borderColor="orange.200">
                        <Box flexShrink={0} mt="0.5" color="orange.700">
                          <TriangleAlert size={14} aria-hidden />
                        </Box>
                        <Text fontSize="xs" color="orange.900">
                          {entry.caution}
                        </Text>
                      </HStack>
                    )}

                    {row.on && entry.legendItems && (
                      <SimpleGrid as="ul" columns={2} columnGap="3" rowGap="1" mt="2" listStyleType="none">
                        {entry.legendItems.map((item) => (
                          <HStack as="li" key={item.label} gap="1.5" minW="0">
                            <Box
                              aria-hidden
                              flexShrink={0}
                              w={item.line ? '14px' : '10px'}
                              h={item.line ? '0' : '10px'}
                              borderRadius={item.line ? '0' : '2px'}
                              bg={item.line ? undefined : item.color}
                              borderTopWidth={item.line ? '2px' : undefined}
                              borderTopStyle={item.dashed ? 'dashed' : 'solid'}
                              borderColor={item.line ? item.color : 'blackAlpha.400'}
                              borderWidth={item.line ? undefined : '1px'}
                            />
                            <Text fontSize="2xs" color="gray.700" lineHeight="1.25">
                              {item.label}
                            </Text>
                          </HStack>
                        ))}
                      </SimpleGrid>
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
                        aria-label={[`Strength of ${entry.title}`]}
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
            </Fragment>
          ))}
        </Box>
      )}
    </Box>
  )
}
