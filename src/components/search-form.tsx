import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'
import { SearchIcon } from 'lucide-react'

/**
 * The header search form's markup, shared by the plain box the page renders
 * (`SearchField`) and the full combobox (`SearchBox`) that replaces it, so the
 * swap changes nothing on screen. Without JavaScript, or before the combobox
 * loads, it submits to Special:Search like any form.
 */
export function SearchForm({ input, onSubmit }: { input: React.ComponentProps<'input'>; onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return (
    <form role="search" action="/wiki/Special:Search" onSubmit={onSubmit}>
      <ButtonGroup className="w-full">
        <InputGroup className="h-8 rounded-l-xs rounded-r-none border-(--wiki-input-border) bg-background has-[[data-slot=input-group-control]:focus-visible]:shadow-[inset_0_0_0_1px_var(--wiki-progressive)] has-[[data-slot=input-group-control]:focus-visible]:ring-0">
          <InputGroupAddon className="pl-2.5 text-subtle">
            <SearchIcon className="size-4.5" />
          </InputGroupAddon>
          <input
            data-slot="input-group-control"
            name="search"
            placeholder="Search Wikipedia"
            aria-label="Search Wikipedia"
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent pr-2 pl-1 text-sm outline-none placeholder:text-(--wiki-placeholder)"
            {...input}
          />
        </InputGroup>
        <Button type="submit" variant="outline" className="h-8 rounded-l-none rounded-r-xs border-(--wiki-input-border) bg-secondary px-3 text-sm font-bold text-foreground hover:bg-background">
          Search
        </Button>
      </ButtonGroup>
    </form>
  )
}
