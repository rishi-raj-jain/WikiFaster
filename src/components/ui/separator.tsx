import { cn } from 'cn'

/** A plain divider (no library code to hydrate). */
function Separator({ className, orientation = 'horizontal', ...props }: React.ComponentProps<'div'> & { orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-slot="separator"
      data-orientation={orientation}
      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch', className)}
      {...props}
    />
  )
}

export { Separator }
