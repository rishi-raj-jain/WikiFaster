'use client'

import { usePrefs, type Prefs } from '@/components/prefs'
import { PinnableHeader } from '@/components/pinnable-header'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
 * action ("hide" or "move to sidebar") it shows.
 */
export function AppearancePanel({ pinned }: { pinned: boolean }) {
  const { prefs, setPref } = usePrefs()
  return (
    <div className="text-sm">
      <PinnableHeader label="Appearance" pinned={pinned} onToggle={() => setPref('appearance', pinned ? 'hidden' : 'pinned')} />
      {GROUPS.map((group) => (
        <fieldset key={group.key} className="mt-3">
          <legend className="text-subtle mb-1 w-full">{group.label}</legend>
          <Separator className="bg-divider mb-2" />
          <RadioGroup value={prefs[group.key]} onValueChange={(value) => setPref(group.key, value as Prefs[typeof group.key])} className="gap-0.5">
            {group.options.map((option) => {
              const id = `appearance-${group.key}-${option.value}${pinned ? '' : '-menu'}`
              return (
                <div key={option.value} className="flex items-center gap-2 py-1">
                  <RadioGroupItem
                    value={option.value}
                    id={id}
                    className="data-checked:border-primary size-5 border-2 border-(--wiki-input-border) data-checked:border-[6px] data-checked:bg-white [&_[data-slot=radio-group-indicator]]:hidden"
                  />
                  <Label htmlFor={id} className="text-sm font-normal">
                    {option.label}
                  </Label>
                </div>
              )
            })}
          </RadioGroup>
        </fieldset>
      ))}
    </div>
  )
}
