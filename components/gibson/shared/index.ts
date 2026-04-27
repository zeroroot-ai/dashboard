export { ErrorAlert } from './ErrorAlert';
export {
  TableSkeleton,
  CardGridSkeleton,
  KPICardsSkeleton,
  PageHeaderSkeleton,
} from './DataSkeleton';
// NOTE: TenantSwitcher is intentionally NOT re-exported here. It's a Server
// Component (uses 'server-only' active-tenant + getMyMemberships → gibson-client
// → grpc-js) and Turbopack's static module-graph analysis treats any
// 'use client' file that imports from this barrel as transitively pulling
// server-only code into the client bundle. The active tenant switcher
// lives at @/components/layout/sidebar/tenant-switcher and is imported
// directly there. If a Server Component genuinely wants to render the
// gibson/shared variant, import from `./TenantSwitcher` directly.
