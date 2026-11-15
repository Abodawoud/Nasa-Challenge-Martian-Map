// The TOC (table of contents of the map): the layers that are switched on, in their groups.
// Each layer can be opened to see what its colours and lines mean, or closed to keep the
// list short. The eye hides a layer on the map and shows it again: the layer stays in this
// list, and while it is hidden it is not in the legend. Layers are switched on and off in
// the Layers panel.
//
// Inside a layer, every legend entry that stands for its own kind of thing (one rock unit, the
// river channels, the rover's marker) has its own eye: it hides that kind only.
import { useState, useSyncExternalStore } from 'react'
import { Box, Button, Flex, HStack, IconButton, Text, VStack } from '@chakra-ui/react'
import { ChevronDown, Eye, EyeOff, Layers, ListTree } from 'lucide-react'
import { PANEL_GROUPS, PANEL_LAYERS } from '../globe/layers.config'
import type { PanelLayer } from '../globe/layers.config'
import { layerStore } from '../globe/layerState'
import { LegendBody, LegendRow, MAP_MARKERS } from './MapLegend'
import type { LegendItem } from '../globe/layers.config'
import { ToolCard } from './Sidebar'

/** Does this layer have something to explain when it is opened? */
const hasLegend = (entry: PanelLayer) => Boolean(entry.legendItems || entry.legendScale || entry.legend)

export function TocPanel({ onClose, onOpenLayers }: { onClose: () => void; onOpenLayers: () => void }) {
  const rows = useSyncExternalStore(layerStore.subscribe, layerStore.get)
  /** Layers whose legend is open. A layer opens by itself the first time it is listed. */
  const [shut, setShut] = useState<Record<string, boolean>>({})
  /** Groups that are folded. */
  const [folded, setFolded] = useState<Record<string, boolean>>({})

  const active = PANEL_LAYERS.filter((entry) => rows[entry.id].on)
  const groups = PANEL_GROUPS.map((group) => ({ group, entries: active.filter((entry) => entry.group === group.id) })).filter((item) => item.entries.length > 0)
  const withLegend = active.filter(hasLegend)
  const hiddenCount = active.filter((entry) => rows[entry.id].hidden).length
  const allShut = withLegend.length > 0 && withLegend.every((entry) => shut[entry.id])

  const setAll = (value: boolean) => setShut(Object.fromEntries(withLegend.map((entry) => [entry.id, value])))

  return (
    <ToolCard id="tool-toc" title="TOC · what is on the map" icon={<ListTree size={16} aria-hidden />} onClose={onClose}>
      <Flex align="center" gap="2" px="4" py="2.5" borderBottomWidth="1px" borderColor="gray.100">
        <Text flex="1" fontSize="xs" color="gray.700">
          {active.length} {active.length === 1 ? 'layer' : 'layers'} on the map{hiddenCount > 0 ? `, ${hiddenCount} hidden` : ''}. The eye shows or hides a layer.
        </Text>
        {withLegend.length > 0 && (
          <Button size="2xs" variant="outline" colorPalette="brand" onClick={() => setAll(!allShut)}>
            {allShut ? 'Open all' : 'Close all'}
          </Button>
        )}
      </Flex>

      {/* Marks that are on the map whatever layers are on. */}
      <Box px="4" py="2.5" borderBottomWidth="1px" borderColor="gray.100">
        <Text as="h3" fontSize="2xs" fontWeight="700" letterSpacing="0.06em" textTransform="uppercase" color="brand.700" mb="1.5">
          Always on the map
        </Text>
        <VStack as="ul" align="stretch" gap="1.5" listStyleType="none">
          {MAP_MARKERS.map((item) => (
            <LegendRow key={item.label} item={item} />
          ))}
        </VStack>
      </Box>

      {groups.map(({ group, entries }) => {
        const groupFolded = !!folded[group.id]
        return (
          <Box key={group.id}>
            <Box as="h3" m="0" borderBottomWidth="1px" borderColor="gray.200">
              <Flex
                as="button"
                w="full"
                align="center"
                gap="2"
                px="4"
                py="2"
                bg="gray.50"
                textAlign="left"
                cursor="pointer"
                aria-expanded={!groupFolded}
                aria-controls={`toc-group-${group.id}`}
                onClick={() => setFolded((all) => ({ ...all, [group.id]: !all[group.id] }))}
                _hover={{ bg: 'gray.100' }}
                _focusVisible={{ outline: '2px solid', outlineColor: 'brand.500', outlineOffset: '-2px' }}
              >
                <Box flexShrink={0} color="brand.700" transform={groupFolded ? 'rotate(-90deg)' : undefined} transition="transform 0.15s ease">
                  <ChevronDown size={14} aria-hidden />
                </Box>
                <Text flex="1" fontSize="xs" fontWeight="700" letterSpacing="0.06em" textTransform="uppercase" color="brand.700">
                  {group.title}
                </Text>
                <Text fontSize="2xs" fontWeight="500" color="gray.600" fontVariantNumeric="tabular-nums">
                  {entries.length}
                </Text>
              </Flex>
            </Box>

            <Box id={`toc-group-${group.id}`} hidden={groupFolded}>
              {entries.map((entry) => {
                const row = rows[entry.id]
                const openable = hasLegend(entry)
                const open = openable && !shut[entry.id]
                return (
                  <Box key={entry.id} borderBottomWidth="1px" borderColor="gray.100">
                    <Flex align="center" gap="1" pl="2" pr="2" py="1">
                      {/* The layer's name opens and closes its legend. */}
                      <Flex
                        as="button"
                        flex="1"
                        minW="0"
                        align="center"
                        gap="1.5"
                        px="2"
                        py="1.5"
                        borderRadius="md"
                        textAlign="left"
                        cursor={openable ? 'pointer' : 'default'}
                        aria-expanded={openable ? open : undefined}
                        aria-controls={openable ? `toc-layer-${entry.id}` : undefined}
                        aria-disabled={!openable}
                        onClick={() => openable && setShut((all) => ({ ...all, [entry.id]: !all[entry.id] }))}
                        _hover={{ bg: openable ? 'gray.100' : undefined }}
                        _focusVisible={{ outline: '2px solid', outlineColor: 'brand.500', outlineOffset: '-2px' }}
                      >
                        <Box flexShrink={0} color={openable ? 'gray.600' : 'transparent'} transform={open ? undefined : 'rotate(-90deg)'} transition="transform 0.15s ease">
                          <ChevronDown size={14} aria-hidden />
                        </Box>
                        <Text fontSize="sm" fontWeight="600" color={row.hidden ? 'gray.500' : 'gray.900'} truncate>
                          {entry.title}
                        </Text>
                        {row.hidden && (
                          <Text flexShrink={0} fontSize="2xs" fontWeight="600" px="1.5" py="0.5" borderRadius="full" bg="gray.200" color="gray.700">
                            Hidden
                          </Text>
                        )}
                        {row.loading && (
                          <Text fontSize="2xs" color="gray.500">
                            loading…
                          </Text>
                        )}
                      </Flex>
                      <IconButton
                        aria-label={row.hidden ? `Show ${entry.title} on the map` : `Hide ${entry.title} on the map`}
                        aria-pressed={!row.hidden}
                        title={row.hidden ? 'Show on the map' : 'Hide on the map'}
                        size="xs"
                        variant="ghost"
                        color={row.hidden ? 'gray.500' : 'brand.700'}
                        disabled={row.loading}
                        onClick={() => layerStore.setHidden(entry, !row.hidden)}
                      >
                        {row.hidden ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                      </IconButton>
                    </Flex>
                    {openable && (
                      <Box id={`toc-layer-${entry.id}`} hidden={!open} pl="9" pr="4" pb="3" opacity={row.hidden ? 0.55 : 1}>
                        <TocLegend entry={entry} hiddenItems={row.hiddenItems} />
                      </Box>
                    )}
                  </Box>
                )
              })}
            </Box>
          </Box>
        )
      })}

      <HStack px="4" py="3" gap="2" justify="space-between">
        <Text fontSize="xs" color="gray.600">
          {active.length === 0 ? 'No layers are on.' : 'Add or remove layers in Layers.'}
        </Text>
        <Button size="xs" variant="outline" colorPalette="brand" flexShrink={0} onClick={onOpenLayers}>
          <Layers size={14} aria-hidden />
          Open Layers
        </Button>
      </HStack>
    </ToolCard>
  )
}

/** Can this legend entry be hidden by itself? Only when the map knows which things it stands for. */
const canHide = (item: LegendItem) => Boolean(item.keys?.length || item.part)

/**
 * The legend of one layer inside the TOC. Like the legend card, plus an eye on every entry
 * that can be hidden by itself.
 */
function TocLegend({ entry, hiddenItems }: { entry: PanelLayer; hiddenItems: string[] }) {
  const items = entry.legendItems ?? []
  const hideable = items.filter(canHide)
  // A layer with one kind only, or with a colour bar: nothing to hide by itself.
  if (hideable.length < 2) return <LegendBody entry={entry} />

  return (
    <Box>
      <Text fontSize="2xs" color="gray.600" lineHeight="1.35" mb="1.5">
        {entry.note}
      </Text>
      <Flex align="center" justify="space-between" mb="1">
        <Text fontSize="2xs" color="gray.600" fontVariantNumeric="tabular-nums">
          {hideable.length - hiddenItems.length} of {hideable.length} shown
        </Text>
        <HStack gap="1">
          <Button size="2xs" variant="ghost" colorPalette="brand" disabled={hiddenItems.length === 0} onClick={() => layerStore.showAllItems(entry)}>
            Show all
          </Button>
          <Button size="2xs" variant="ghost" colorPalette="brand" disabled={hiddenItems.length === hideable.length} onClick={() => hideable.forEach((item) => layerStore.setItemHidden(entry, item.label, true))}>
            Hide all
          </Button>
        </HStack>
      </Flex>
      <VStack as="ul" align="stretch" gap="0.5" listStyleType="none">
        {items.map((item) => {
          const hidden = hiddenItems.includes(item.label)
          return (
            <Flex as="li" key={item.label} align="flex-start" gap="1">
              {canHide(item) ? (
                <IconButton
                  aria-label={hidden ? `Show ${item.label} on the map` : `Hide ${item.label} on the map`}
                  aria-pressed={!hidden}
                  title={hidden ? 'Show on the map' : 'Hide on the map'}
                  size="2xs"
                  variant="ghost"
                  flexShrink={0}
                  color={hidden ? 'gray.400' : 'brand.700'}
                  onClick={() => layerStore.setItemHidden(entry, item.label, !hidden)}
                >
                  {hidden ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                </IconButton>
              ) : (
                <Box w="6" flexShrink={0} />
              )}
              <Box flex="1" minW="0" py="0.5" opacity={hidden ? 0.45 : 1}>
                <LegendRow item={item} as="div" />
              </Box>
            </Flex>
          )
        })}
      </VStack>
    </Box>
  )
}
