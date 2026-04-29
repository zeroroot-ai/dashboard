"use client";

/**
 * SecretsList — client component that renders the tenant secrets DataTable.
 *
 * Receives pre-fetched SecretMetadata rows from the server component page.
 * Renders name, category, version, last_rotated_at, last_accessed_at columns.
 * Per-row "View" action navigates to /secrets/[id].
 *
 * SECURITY: NO value column. No value is ever fetched, stored, or rendered.
 *
 * Spec: secrets-tenant-lifecycle Task 10, Requirements 1.1, 1.6.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ExternalLinkIcon, MoreHorizontal, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { SecretMetadata } from "@/src/gen/gibson/admin/v1/secrets_pb";
import { SecretCategory } from "@/src/gen/gibson/admin/v1/secrets_pb";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUnixTs(unixSeconds: bigint): string {
  if (!unixSeconds || unixSeconds === BigInt(0)) return "—";
  const d = new Date(Number(unixSeconds) * 1000);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function categoryLabel(cat: SecretCategory): string {
  switch (cat) {
    case SecretCategory.CRED:
      return "Credential";
    case SecretCategory.PROVIDER_CONFIG:
      return "Provider config";
    default:
      return "Unknown";
  }
}

function categoryVariant(cat: SecretCategory): "default" | "secondary" | "outline" {
  switch (cat) {
    case SecretCategory.CRED:
      return "default";
    case SecretCategory.PROVIDER_CONFIG:
      return "secondary";
    default:
      return "outline";
  }
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

export const secretColumns: ColumnDef<SecretMetadata>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        className="-ml-3"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Name
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => (
      <Badge variant={categoryVariant(row.original.category)}>
        {categoryLabel(row.original.category)}
      </Badge>
    ),
  },
  {
    accessorKey: "version",
    header: "Version",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        v{String(row.original.version)}
      </span>
    ),
  },
  {
    id: "last_rotated_at",
    header: ({ column }) => (
      <Button
        variant="ghost"
        className="-ml-3"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Last rotated
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    accessorFn: (row) => Number(row.updatedAtUnix),
    cell: ({ row }) => (
      <span className="text-sm">{formatUnixTs(row.original.updatedAtUnix)}</span>
    ),
  },
  {
    id: "last_accessed_at",
    header: ({ column }) => (
      <Button
        variant="ghost"
        className="-ml-3"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Last accessed
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    accessorFn: (row) => Number(row.lastAccessedAtUnix),
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {formatUnixTs(row.original.lastAccessedAtUnix)}
      </span>
    ),
  },
  {
    id: "actions",
    enableHiding: false,
    cell: ({ row }) => {
      const name = row.original.name;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${name}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/pages/settings/secrets/${encodeURIComponent(name)}`}>
                <ExternalLinkIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                View details
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SecretsListProps {
  secrets: SecretMetadata[];
  /** Total count for pagination display. */
  total: number;
  /** Current page offset (server-side pagination). */
  offset: number;
  /** Page size. */
  limit: number;
  /** Base href for pagination navigation, e.g. "/dashboard/pages/settings/secrets" */
  basePath: string;
}

export function SecretsList({
  secrets,
  total,
  offset,
  limit,
  basePath,
}: SecretsListProps) {
  const router = useRouter();
  const [sorting, setSorting] = React.useState<SortingState>([]);

  // Gate "Add secret" on SetSecret RPC. Hide on loading=true (no FOUC).
  // Spec: dashboard-authz-ui-gating Task 14, Requirement 5.4.
  const { allowed: canAddSecret, loading: addSecretLoading } = useAuthorize(
    "/gibson.admin.v1.SecretsAdminService/SetSecret",
  );

  const table = useReactTable({
    data: secrets,
    columns: secretColumns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
  });

  const currentPage = Math.floor(offset / limit);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  function prevPage() {
    const newOffset = Math.max(0, offset - limit);
    router.push(`${basePath}?offset=${newOffset}&limit=${limit}`);
  }

  function nextPage() {
    const newOffset = offset + limit;
    if (newOffset < total) {
      router.push(`${basePath}?offset=${newOffset}&limit=${limit}`);
    }
  }

  return (
    <div className="w-full space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {total} secret{total !== 1 ? "s" : ""}
        </p>
        {!addSecretLoading && canAddSecret && (
          <Button asChild size="sm">
            <Link href="/dashboard/pages/settings/secrets/new">
              <PlusIcon className="mr-2 h-4 w-4" aria-hidden="true" />
              Add secret
            </Link>
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(
                      `/dashboard/pages/settings/secrets/${encodeURIComponent(row.original.name)}`
                    )
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={secretColumns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No secrets found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-muted-foreground text-sm">
            Page {currentPage + 1} of {totalPages}
          </span>
          <Button variant="outline" size="sm" onClick={prevPage} disabled={offset === 0}>
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={nextPage}
            disabled={offset + limit >= total}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
