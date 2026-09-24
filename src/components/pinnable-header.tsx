import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

/** Vector's panel header: bold label with a small gray "hide" / "move to sidebar" button, then a divider. */
export function PinnableHeader({ label, pinned, onToggle }: { label: string; pinned: boolean; onToggle: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2 pb-1.5">
        <span className="text-emphasized font-bold">{label}</span>
        <Button variant="secondary" size="xs" onClick={onToggle} className="bg-divider text-foreground hover:bg-border-subtle h-5.5 rounded-xs px-2 text-xs font-normal">
          {pinned ? 'hide' : 'move to sidebar'}
        </Button>
      </div>
      <Separator className="bg-divider" />
    </>
  )
}
