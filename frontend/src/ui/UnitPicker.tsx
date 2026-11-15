// A dropdown with a search box, to pick one unit. Type a few letters ("mil", "hect") and the
// list shows the units that match. Arrow keys and Enter work too.
import { Combobox, Portal, useFilter, useListCollection } from '@chakra-ui/react'

interface Option {
  id: string
  label: string
}

export function UnitPicker({ label, options, value, onChange }: { label: string; options: Option[]; value: string; onChange: (id: string) => void }) {
  const { contains } = useFilter({ sensitivity: 'base' })
  const { collection, filter } = useListCollection({
    initialItems: options.map((option) => ({ label: option.label, value: option.id })),
    filter: contains,
  })

  return (
    <Combobox.Root
      collection={collection}
      value={[value]}
      onValueChange={(event) => {
        // An emptied box keeps the unit that was chosen: there is always one unit.
        if (event.value[0]) onChange(event.value[0])
      }}
      onInputValueChange={(event) => filter(event.inputValue)}
      // After the list closes, the next opening shows every unit again, not the last search.
      onOpenChange={(event) => {
        if (!event.open) filter('')
      }}
      openOnClick
      selectionBehavior="replace"
      size="sm"
      width="full"
      positioning={{ sameWidth: true }}
    >
      <Combobox.Label fontSize="xs" fontWeight="600" color="gray.800">
        {label}
      </Combobox.Label>
      <Combobox.Control>
        <Combobox.Input placeholder="Type to search a unit…" bg="white" autoComplete="off" spellCheck={false} />
        <Combobox.IndicatorGroup>
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner>
          <Combobox.Content maxH="240px">
            <Combobox.Empty>No unit with that name</Combobox.Empty>
            {collection.items.map((item) => (
              <Combobox.Item item={item} key={item.value}>
                {item.label}
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  )
}
