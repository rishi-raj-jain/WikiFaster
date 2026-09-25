'use client'

import { PinnableHeader } from '@/components/pinnable-header'
import { usePrefs, type Prefs } from '@/components/prefs'
import { Separator } from '@/components/ui/separator'

const GROUPS: { key: 'text' | 'width' | 'theme'; label: string; options: { value: string; label: string }[] }[] = [
  {
    key: 'text',
    label: 'Text',
    options: [
      { value: 'small', label: 'Small' },
      { value: 'standard', label: 'Standard' },
      { value: 'large', label: 'Large' },
    ],
  },
  {
    key: 'width',
    label: 'Width',
    options: [
      { value: 'standard', label: 'Standard' },
      { value: 'wide', label: 'Wide' },
    ],
  },
  {
    key: 'theme',
    label: 'Color',
    options: [
      { value: 'auto', label: 'Automatic' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
  },
]

/**
 * Vector 2022's Appearance menu: pinned in the right column on wide screens,
 * or opened from the header's glasses button. `pinned` picks which header
 * action ("hide" or "move to sidebar") it shows. `onMove` runs after either, so a popover can close.
 */
export function AppearancePanel({ pinned, onMove }: { pinned: boolean; onMove?: () => void }) {
  const { prefs, setPref } = usePrefs()
  return (
    <div className="text-sm">
      <PinnableHeader
        label="Appearance"
        pinned={pinned}
        onToggle={() => {
          setPref('appearance', pinned ? 'hidden' : 'pinned')
          onMove?.()
        }}
      />
      {GROUPS.map((group) => (
        <fieldset key={group.key} className="mt-3">
          <legend className="mb-1 w-full text-subtle">{group.label}</legend>
          <Separator className="mb-2 bg-divider" />
          <div role="radiogroup" aria-label={group.label} className="grid gap-0.5">
            {group.options.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="radio"
                  name={`appearance-${group.key}${pinned ? '' : '-menu'}`}
                  value={option.value}
                  checked={prefs[group.key] === option.value}
                  onChange={() => setPref(group.key, option.value as Prefs[typeof group.key])}
                  className="size-5 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-(--wiki-input-border) bg-transparent outline-none checked:border-[6px] checked:border-primary checked:bg-white focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:checked:bg-white"
                />
                <span className="text-sm">{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
