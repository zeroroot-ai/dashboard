import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ── Shared animation class ─────────────────────────────────────────────────────
// Layered on top of the base animate-pulse to give a faint green tint matching
// the Gibson "glass-hack" dark theme.
const SKEL = 'bg-green-950/40 animate-pulse';

// ── TableSkeleton ──────────────────────────────────────────────────────────────

interface TableSkeletonProps {
  /** Number of data rows to render below the header row. Defaults to 5. */
  rows?: number;
  /** Number of columns per row. Defaults to 4. */
  cols?: number;
  className?: string;
}

/**
 * Skeleton placeholder for a data table.
 * Renders a header row followed by `rows` data rows, each with `cols` cells.
 */
export function TableSkeleton({
  rows = 5,
  cols = 4,
  className,
}: TableSkeletonProps) {
  return (
    <div
      className={cn('w-full overflow-hidden rounded-lg border border-green-900/30', className)}
      role="status"
      aria-label="Loading table data"
      aria-busy="true"
    >
      {/* Header row */}
      <div className="flex gap-4 border-b border-green-900/30 bg-green-950/20 px-4 py-3">
        {Array.from({ length: cols }).map((_, colIdx) => (
          <Skeleton
            key={colIdx}
            className={cn(SKEL, 'h-3.5 flex-1', colIdx === 0 && 'max-w-[80px]')}
          />
        ))}
      </div>

      {/* Data rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex gap-4 border-b border-green-900/20 px-4 py-3 last:border-0"
        >
          {Array.from({ length: cols }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              className={cn(
                SKEL,
                'h-4 flex-1',
                // Vary widths slightly for a more natural appearance
                colIdx === 0 && 'max-w-[72px]',
                colIdx === cols - 1 && 'max-w-[96px]',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── CardGridSkeleton ───────────────────────────────────────────────────────────

interface CardGridSkeletonProps {
  /** Number of skeleton cards to render. Defaults to 4. */
  count?: number;
  className?: string;
}

/**
 * Skeleton grid that matches the AgentCard layout:
 * - 1 col on mobile, 2 on tablet (sm), 3 on desktop (xl).
 * Each card mimics the header + badge row + two content lines + footer stripe.
 */
export function CardGridSkeleton({ count = 4, className }: CardGridSkeletonProps) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3', className)}
      role="status"
      aria-label="Loading agent cards"
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="flex flex-col gap-0 overflow-hidden rounded-lg border border-green-900/30 bg-green-950/10"
        >
          {/* Card header */}
          <div className="flex flex-col gap-2 border-b border-green-900/20 px-4 py-4">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className={cn(SKEL, 'h-4 w-32')} />
              <Skeleton className={cn(SKEL, 'h-2.5 w-2.5 shrink-0 rounded-full')} />
            </div>
            {/* Badge row */}
            <div className="flex gap-2">
              <Skeleton className={cn(SKEL, 'h-5 w-16 rounded-full')} />
              <Skeleton className={cn(SKEL, 'h-5 w-14 rounded-full')} />
            </div>
          </div>

          {/* Card body */}
          <div className="flex flex-1 flex-col gap-3 px-4 py-3">
            <div className="space-y-1.5">
              <Skeleton className={cn(SKEL, 'h-3 w-20')} />
              <Skeleton className={cn(SKEL, 'h-4 w-full')} />
            </div>
            {/* Footer stripe */}
            <div className="mt-auto flex items-center justify-between border-t border-green-900/20 pt-2">
              <Skeleton className={cn(SKEL, 'h-3 w-12')} />
              <Skeleton className={cn(SKEL, 'h-3 w-14')} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── KPICardsSkeleton ───────────────────────────────────────────────────────────

interface KPICardsSkeletonProps {
  className?: string;
}

/**
 * Skeleton row of 4 KPI cards matching the DashboardContent KpiCards layout:
 * 2 cols on mobile, 4 on large screens.
 */
export function KPICardsSkeleton({ className }: KPICardsSkeletonProps) {
  return (
    <div
      className={cn('grid grid-cols-2 gap-4 lg:grid-cols-4', className)}
      role="status"
      aria-label="Loading KPI data"
      aria-busy="true"
    >
      {Array.from({ length: 4 }).map((_, idx) => (
        <div
          key={idx}
          className="flex flex-col gap-3 overflow-hidden rounded-lg border border-green-900/30 bg-green-950/10 p-4"
        >
          {/* Card header: label + icon */}
          <div className="flex items-center justify-between">
            <Skeleton className={cn(SKEL, 'h-3 w-24')} />
            <Skeleton className={cn(SKEL, 'h-4 w-4 rounded-sm')} />
          </div>
          {/* Large numeric value */}
          <Skeleton className={cn(SKEL, 'h-8 w-16')} />
        </div>
      ))}
    </div>
  );
}

// ── PageHeaderSkeleton ─────────────────────────────────────────────────────────

interface PageHeaderSkeletonProps {
  /** When true, renders a right-side action button skeleton. Defaults to true. */
  showActions?: boolean;
  className?: string;
}

/**
 * Skeleton for the standard page header pattern used across Gibson pages:
 * a page title on the left and optional action button(s) on the right.
 */
export function PageHeaderSkeleton({
  showActions = true,
  className,
}: PageHeaderSkeletonProps) {
  return (
    <div
      className={cn('flex items-center justify-between gap-4', className)}
      role="status"
      aria-label="Loading page header"
      aria-busy="true"
    >
      {/* Title + optional count badge */}
      <div className="flex items-center gap-3">
        <Skeleton className={cn(SKEL, 'h-7 w-40')} />
        <Skeleton className={cn(SKEL, 'h-5 w-16 rounded-full')} />
      </div>

      {/* Action buttons */}
      {showActions && (
        <div className="flex items-center gap-2">
          <Skeleton className={cn(SKEL, 'h-8 w-24 rounded-md')} />
          <Skeleton className={cn(SKEL, 'h-8 w-8 rounded-md')} />
        </div>
      )}
    </div>
  );
}
