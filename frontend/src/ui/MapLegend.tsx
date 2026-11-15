// The map legend (opened from the tool bar, Sidebar.tsx): a small card on the map that explains everything drawn on it right now.
// It lists the markers that are always there, then one block per layer that is switched on
// in the Layers panel. Its content comes from PANEL_LAYERS (layers.config.ts), so a new
// layer with a legend shows up here by itself.
import { Box, Flex, HStack, IconButton, Text, VStack } from '@chakra-ui/react'
import { useState, useSyncExternalStore } from 'react'
import { Palette, X } from 'lucide-react'
import { PANEL_LAYERS } from '../globe/layers.config'
import type { LegendItem, PanelLayer } from '../globe/layers.config'
import { layerStore } from '../globe/layerState'
import { FoldButton } from './Sidebar'

/** A small sample of how one thing looks on the map. */
function Sample({ item }: { item: LegendItem }) {
  if (item.line) {
    // Lines are shown on a Mars-coloured chip: a white line would be invisible on the card.
    return (
      <Flex aria-hidden flexShrink={0} align="center" justify="center" w="26px" h="14px" borderRadius="3px" bg="#9a6a50">
        <Box w="20px" borderTopWidth="2.5px" borderTopStyle={item.dashed ? 'dashed' : 'solid'} borderColor={item.color} />
      </Flex>
    )
  }
  return (
    <Flex aria-hidden flexShrink={0} align="center" justify="center" w="26px" h="14px">
      <Box boxSize="11px" borderRadius={item.dot ? 'full' : '2px'} bg={item.color} borderWidth="1.5px" borderColor={item.dot ? 'white' : 'blackAlpha.400'} outline={item.dot ? '1px solid rgba(0,0,0,0.35)' : undefined} />
    </Flex>
  )
}

/** One entry of a legend: a sample, its name, and one sentence about it. */
export function LegendRow({ item, as = 'li' }: { item: LegendItem; as?: 'li' | 'div' }) {
  return (
    <HStack as={as} gap="2" minW="0" align="flex-start">
      <Box mt="1px">
        <Sample item={item} />
      </Box>
      <Box minW="0">
        <Text fontSize="xs" fontWeight="600" color="gray.900" lineHeight="1.3">
          {item.label}
        </Text>
        {item.hint && (
          <Text fontSize="2xs" color="gray.600" lineHeight="1.35">
            {item.hint}
          </Text>
        )}
      </Box>
    </HStack>
  )
}

/** Markers that are on the map whatever layers are on. */
export const MAP_MARKERS: LegendItem[] = [{ color: '#e8231f', label: 'Perseverance landing site', dot: true, hint: 'Where the rover touched down in February 2021.' }]

/** What one layer shows and how to read it: used by the legend card and by the TOC. */
export function LegendBody({ entry, hiddenItems = [] }: { entry: PanelLayer; hiddenItems?: string[] }) {
  // Entries hidden by themselves in the TOC are not on the map, so they are not explained here.
  const items = entry.legendItems?.filter((item) => !hiddenItems.includes(item.label))
  return (
    <Box>
      <Text fontSize="2xs" color="gray.600" lineHeight="1.35" mb={entry.legendScale || entry.legendItems ? '2' : '0'}>
        {entry.note}
        {entry.legend ? ` ${entry.legend}` : ''}
      </Text>
      {entry.legendScale && (
        <Box mb={entry.legendItems ? '2' : '0'}>
          <Box aria-hidden h="10px" borderRadius="full" borderWidth="1px" borderColor="blackAlpha.300" style={{ backgroundImage: entry.legendScale.css }} />
          <HStack justify="space-between" mt="1" fontSize="2xs" color="gray.800">
            <Text>{entry.legendScale.low}</Text>
            <Text>{entry.legendScale.high}</Text>
          </HStack>
        </Box>
      )}
      {items && items.length > 0 && (
        <VStack as="ul" align="stretch" gap="1.5" listStyleType="none">
          {items.map((item) => (
            <LegendRow key={item.label} item={item} />
          ))}
        </VStack>
      )}
      {entry.caution && (
        <Text mt="1.5" fontSize="2xs" color="orange.800">
          An estimate, not a measurement.
        </Text>
      )}
    </Box>
  )
}

export function MapLegend({ activeLayers, open, onClose }: { activeLayers: string[]; open: boolean; onClose: () => void }) {
  const blocks = PANEL_LAYERS.filter((entry) => activeLayers.includes(entry.id) && (entry.legendItems || entry.legendScale))
  const rows = useSyncExternalStore(layerStore.subscribe, layerStore.get)
  /** Folded down to its heading. The legend sits at the bottom of the map, so it folds downwards. */
  const [folded, setFolded] = useState(false)
  if (!open) return null

  return (
    <Box
      as="section"
      id="tool-legend"
      aria-label="Map legend"
      position="absolute"
      bottom="4"
      right="16"
      zIndex="10"
      w="290px"
      maxW="calc(100% - 96px)"
      maxH="min(70%, 520px)"
      overflowY="auto"
      overscrollBehavior="contain"
      bg="whiteAlpha.950"
      backdropFilter="blur(10px)"
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="xl"
      shadow="xl"
    >
      <Flex align="center" justify="space-between" pl="3" pr="1.5" py="1.5" borderBottomWidth={folded ? 0 : '1px'} borderColor="gray.200" position="sticky" top="0" bg="white" zIndex="1">
        <HStack gap="2" color="brand.700">
          <Palette size={15} aria-hidden />
          <Text as="h2" fontWeight="700" fontSize="sm">
            Legend
          </Text>
        </HStack>
        <Flex align="center" gap="0.5">
          <FoldButton title="the legend" folded={folded} onToggle={() => setFolded((now) => !now)} bodyId="tool-legend-body" down />
          <IconButton aria-label="Close the legend" title="Close" size="xs" variant="ghost" color="gray.600" onClick={onClose}>
            <X size={16} aria-hidden />
          </IconButton>
        </Flex>
      </Flex>

      <VStack id="tool-legend-body" hidden={folded} align="stretch" gap="0" aria-live="polite">
        <VStack as="ul" align="stretch" gap="1.5" px="3" py="2.5" listStyleType="none">
          {MAP_MARKERS.map((item) => (
            <LegendRow key={item.label} item={item} />
          ))}
        </VStack>

        {blocks.map((entry) => (
          <Box key={entry.id} px="3" py="2.5" borderTopWidth="1px" borderColor="gray.100">
            <Text as="h3" fontSize="2xs" fontWeight="700" letterSpacing="0.06em" textTransform="uppercase" color="brand.700">
              {entry.title}
            </Text>
            {/* What this layer is, then how to read it. Entries hidden in the TOC are left out. */}
            <LegendBody entry={entry} hiddenItems={rows[entry.id].hiddenItems} />
          </Box>
        ))}

        {blocks.length === 0 && (
          <Text px="3" pb="2.5" fontSize="2xs" color="gray.600">
            Switch on a layer in Layers to see what its colours and lines mean.
          </Text>
        )}
      </VStack>
    </Box>
  )
}
