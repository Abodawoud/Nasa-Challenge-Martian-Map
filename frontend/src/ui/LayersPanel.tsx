// The Layers panel: a white card opened from the tool bar (Sidebar.tsx). Every row is one entry of
// PANEL_LAYERS (layers.config.ts): a switch, and a transparency slider for overlays.
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'
import type * as Cesium from 'cesium'
import { Badge, Box, Flex, HStack, IconButton, Slider, Spinner, Switch, Text } from '@chakra-ui/react'
import { ChevronDown, Layers, TriangleAlert, X } from 'lucide-react'
import { PANEL_GROUPS, PANEL_LAYERS } from '../globe/layers.config'
import type { LayerCategory } from '../globe/layers.config'
import { layerStore } from '../globe/layerState'
import { FoldButton } from './Sidebar'

const CATEGORY: Record<LayerCategory, { label: string; palette: string }> = {
  optical: { label: 'Photo', palette: 'gray' },
  topographic: { label: 'Terrain', palette: 'green' },
  thermal: { label: 'Heat', palette: 'orange' },
  spectral: { label: 'Minerals', palette: 'purple' },
  vector: { label: 'Mission', palette: 'blue' },
  geology: { label: 'Geology', palette: 'teal' },
  radiation: { label: 'Radiation', palette: 'red' },
}

interface Props {
  viewer: Cesium.Viewer | null
  /** Told which layers are on (panel ids), for the map legend. */
  onActiveChange?: (ids: string[]) => void
  /** The panel stays in the page while closed, so the switches keep their state. */
  open: boolean
  onClose: () => void
}

export function LayersPanel({ viewer, onActiveChange, open, onClose }: Props) {
  // Which layers are on lives in one shared record (layerState.ts): the TOC and the legend read it too.
  const rows = useSyncExternalStore(layerStore.subscribe, layerStore.get)
  const { toggle, fade } = layerStore
  useEffect(() => {
    layerStore.setViewer(viewer)
  }, [viewer])
  /** The whole panel folded up to its heading. */
  const [folded, setFolded] = useState(false)
  /** Groups that are folded: only their heading shows. */
  const [closed, setClosed] = useState<Record<string, boolean>>(() => Object.fromEntries(PANEL_GROUPS.map((group) => [group.id, !!group.startClosed])))

  // The legend lists a layer once it is really on the map (not while it is still loading).
  const active = PANEL_LAYERS.filter((entry) => rows[entry.id].on && !rows[entry.id].loading)
    .map((entry) => entry.id)
    .join('|')
  useEffect(() => {
    onActiveChange?.(active ? active.split('|') : [])
  }, [active, onActiveChange])

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <Box position="absolute" top="3" left="3" zIndex="10" maxW="calc(100% - 24px)" hidden={!open}>
      {open && (
        <Box
          id="layers-panel"
          role="region"
          aria-label="Map layers"
          w="340px"
          maxW="full"
          maxH="calc(100vh - 150px)"
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
            <Flex align="center" gap="0.5">
              <FoldButton title="Map layers" folded={folded} onToggle={() => setFolded((now) => !now)} bodyId="layers-panel-body" />
              <IconButton aria-label="Close the layers panel" title="Close" size="xs" variant="ghost" color="gray.600" onClick={onClose}>
                <X size={16} aria-hidden />
              </IconButton>
            </Flex>
          </Flex>

          <Box id="layers-panel-body" hidden={folded}>
          {PANEL_GROUPS.map((group) => (
            <Fragment key={group.id}>
              {/* The group heading is a button: it folds and unfolds the group. */}
              <Box as="h3" m="0" borderBottomWidth="1px" borderColor="gray.200">
                <Flex
                  as="button"
                  w="full"
                  align="flex-start"
                  gap="2"
                  px="4"
                  py="2.5"
                  bg="gray.50"
                  textAlign="left"
                  cursor="pointer"
                  aria-expanded={!closed[group.id]}
                  aria-controls={`layers-group-${group.id}`}
                  onClick={() => setClosed((all) => ({ ...all, [group.id]: !all[group.id] }))}
                  _hover={{ bg: 'gray.100' }}
                  _focusVisible={{ outline: '2px solid', outlineColor: 'brand.500', outlineOffset: '-2px' }}
                >
                  <Box flexShrink={0} mt="0.5" color="brand.700" transform={closed[group.id] ? 'rotate(-90deg)' : undefined} transition="transform 0.15s ease">
                    <ChevronDown size={14} aria-hidden />
                  </Box>
                  <Box flex="1" minW="0">
                    <Text fontSize="xs" fontWeight="700" letterSpacing="0.06em" textTransform="uppercase" color="brand.700">
                      {group.title}
                    </Text>
                    {group.note && !closed[group.id] && (
                      <Text fontSize="xs" fontWeight="400" color="gray.600" mt="0.5">
                        {group.note}
                      </Text>
                    )}
                  </Box>
                  <Text flexShrink={0} fontSize="2xs" fontWeight="500" color="gray.600" fontVariantNumeric="tabular-nums" mt="0.5">
                    {PANEL_LAYERS.filter((entry) => entry.group === group.id && rows[entry.id].on).length} of {PANEL_LAYERS.filter((entry) => entry.group === group.id).length} on
                  </Text>
                </Flex>
              </Box>
              <Box id={`layers-group-${group.id}`} hidden={closed[group.id]}>
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
                          {row.reason && (
                            <Text as="span" display="block" fontSize="2xs" color="gray.600">
                              Reason: {row.reason}
                            </Text>
                          )}
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
              </Box>
            </Fragment>
          ))}
          </Box>
        </Box>
      )}
    </Box>
  )
}
