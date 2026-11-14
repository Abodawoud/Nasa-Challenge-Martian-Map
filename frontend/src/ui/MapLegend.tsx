// The map legend: a small card on the map that explains everything drawn on it right now.
// It lists the markers that are always there, then one block per layer that is switched on
// in the Layers panel. Its content comes from PANEL_LAYERS (layers.config.ts), so a new
// layer with a legend shows up here by itself.
import { useState } from 'react'
import { Box, Button, Flex, HStack, IconButton, Text, VStack } from '@chakra-ui/react'
import { ChevronDown, ListTree } from 'lucide-react'
import { PANEL_LAYERS } from '../globe/layers.config'
import type { LegendItem } from '../globe/layers.config'

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

function Row({ item }: { item: LegendItem }) {
  return (
    <HStack as="li" gap="2" minW="0" align="flex-start">
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
const ALWAYS: LegendItem[] = [{ color: '#e8231f', label: 'Perseverance landing site', dot: true, hint: 'Where the rover touched down in February 2021.' }]

export function MapLegend({ activeLayers }: { activeLayers: string[] }) {
  const [open, setOpen] = useState(true)
  const blocks = PANEL_LAYERS.filter((entry) => activeLayers.includes(entry.id) && (entry.legendItems || entry.legendScale))

  if (!open) {
    return (
      <Box position="absolute" bottom="4" right="16" zIndex="10">
        <Button
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
          <ListTree size={16} aria-hidden />
          Legend
        </Button>
      </Box>
    )
  }

  return (
    <Box
      as="section"
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
      <Flex align="center" justify="space-between" pl="3" pr="1.5" py="1.5" borderBottomWidth="1px" borderColor="gray.200" position="sticky" top="0" bg="white" zIndex="1">
        <HStack gap="2" color="brand.700">
          <ListTree size={15} aria-hidden />
          <Text as="h2" fontWeight="700" fontSize="sm">
            Legend
          </Text>
        </HStack>
        <IconButton aria-label="Hide the legend" aria-expanded size="xs" variant="ghost" color="gray.600" onClick={() => setOpen(false)}>
          <ChevronDown size={16} aria-hidden />
        </IconButton>
      </Flex>

      <VStack align="stretch" gap="0" aria-live="polite">
        <VStack as="ul" align="stretch" gap="1.5" px="3" py="2.5" listStyleType="none">
          {ALWAYS.map((item) => (
            <Row key={item.label} item={item} />
          ))}
        </VStack>

        {blocks.map((entry) => (
          <Box key={entry.id} px="3" py="2.5" borderTopWidth="1px" borderColor="gray.100">
            <Text as="h3" fontSize="2xs" fontWeight="700" letterSpacing="0.06em" textTransform="uppercase" color="brand.700">
              {entry.title}
            </Text>
            {/* What this layer is, in one line, then how to read it. */}
            <Text fontSize="2xs" color="gray.600" lineHeight="1.35" mb="2">
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
            {entry.legendItems && (
              <VStack as="ul" align="stretch" gap="1.5" listStyleType="none">
                {entry.legendItems.map((item) => (
                  <Row key={item.label} item={item} />
                ))}
              </VStack>
            )}
            {entry.caution && (
              <Text mt="1.5" fontSize="2xs" color="orange.800">
                An estimate, not a measurement.
              </Text>
            )}
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
