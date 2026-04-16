"use client";

import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  Columns,
  FilterIcon,
  FileText,
  MessageSquare,
  Users,
  BarChart3,
  ChevronDown
} from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type Notification = {
  id: number;
  title: string;
  description: string;
  type: "ticket" | "message" | "team";
  time: string;
  status: "read" | "unread";
  user?: {
    name: string;
    avatar?: string;
  };
  actions?: Array<{
    label: string;
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
    onClick?: () => void;
  }>;
};

const getTypeIcon = (type: Notification["type"]) => {
  switch (type) {
    case "ticket":
      return FileText;
    case "message":
      return MessageSquare;
    case "team":
      return Users;
    default:
      return FileText;
  }
};

const getTypeColor = (type: Notification["type"]) => {
  switch (type) {
    case "ticket":
      return "bg-blue-500";
    case "message":
      return "bg-green-500";
    case "team":
      return "bg-purple-500";
    default:
      return "bg-gray-500";
  }
};

export const columns: ColumnDef<Notification>[] = [
  {
    accessorKey: "notification",
    header: "Notification",
    cell: ({ row }) => {
      const notification = row.original;
      const Icon = getTypeIcon(notification.type);
      const iconColor = getTypeColor(notification.type);
      const isUnread = notification.status === "unread";

      return (
        <div className="space-y-3 rounded-md p-2">
          <div className="flex gap-4">
            {notification.user ? (
              <Avatar className="size-10">
                <AvatarImage src={notification.user.avatar} alt={notification.user.name} />
                <AvatarFallback>
                  {notification.user.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div
                className={cn(
                  "flex size-10 items-center justify-center rounded-full text-white",
                  iconColor
                )}>
                <Icon className="size-4" />
              </div>
            )}
            <div className="flex-1 space-y-1">
              <div className="text-sm font-semibold">
                {notification.user ? notification.user.name : notification.title}
              </div>
              <div className="text-muted-foreground text-sm">{notification.description}</div>
              {notification.actions && notification.actions.length > 0 && (
                <div className="flex gap-2 mt-3">
                  {notification.actions.map((action, index) => (
                    <Button
                      key={index}
                      variant={action.variant || "outline"}
                      size="sm"
                      onClick={action.onClick}>
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => {
      const type = row.getValue("type") as string;
      return <div className="capitalize">{type}</div>;
    }
  },
  {
    accessorKey: "time",
    header: ({ column }) => {
      return (
        <Button
          className="-ml-3"
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Time
          <ArrowUpDown className="size-3" />
        </Button>
      );
    },
    cell: ({ row }) => row.getValue("time")
  }
];

export default function NotificationsDataTable({ data }: { data: Notification[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = React.useState("");

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, columnId, filterValue) => {
      const search = filterValue.toLowerCase();
      const title = row.original.title.toLowerCase();
      const description = row.original.description.toLowerCase();
      const type = row.original.type.toLowerCase();
      return title.includes(search) || description.includes(search) || type.includes(search);
    },
    initialState: {
      pagination: {
        pageSize: 10
      }
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter
    }
  });

  const types = [
    {
      value: "ticket",
      label: "Ticket"
    },
    {
      value: "message",
      label: "Message"
    },
    {
      value: "team",
      label: "Team"
    }
  ];

  const statuses = [
    {
      value: "read",
      label: "Read"
    },
    {
      value: "unread",
      label: "Unread"
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <Input
          placeholder="Search notifications..."
          value={globalFilter ?? ""}
          onChange={(event) => setGlobalFilter(event.target.value)}
          className="grow"
        />
        <div className="hidden gap-2 md:flex">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                Status
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-0">
              <Command>
                <CommandInput placeholder="Filter" className="h-9" />
                <CommandList>
                  <CommandEmpty>No filter found.</CommandEmpty>
                  <CommandGroup>
                    {statuses.map((status) => (
                      <CommandItem key={status.value} value={status.value}>
                        {status.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                Type
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-0">
              <Command>
                <CommandInput placeholder="Type" className="h-9" />
                <CommandList>
                  <CommandEmpty>No type found.</CommandEmpty>
                  <CommandGroup>
                    {types.map((type) => (
                      <CommandItem key={type.value} value={type.value}>
                        {type.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="inline md:hidden">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon">
                <FilterIcon />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-60 p-4">
              <div className="grid space-y-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <FilterIcon />
                      Status
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-0">
                    <Command>
                      <CommandInput placeholder="Filter" className="h-9" />
                      <CommandList>
                        <CommandEmpty>No filter found.</CommandEmpty>
                        <CommandGroup>
                          {statuses.map((status) => (
                            <CommandItem key={status.value} value={status.value}>
                              {status.label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <FileText />
                      Type
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-0">
                    <Command>
                      <CommandInput placeholder="Type" className="h-9" />
                      <CommandList>
                        <CommandEmpty>No type found.</CommandEmpty>
                        <CommandGroup>
                          {types.map((type) => (
                            <CommandItem key={type.value} value={type.value}>
                              {type.label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="ms-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Columns />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(!!value)}>
                      {column.id}
                    </DropdownMenuCheckboxItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="space-y-4">
        <div className="rounded-md border">
          <Table>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => {
                  const isUnread = row.original.status === "unread";
                  return (
                    <TableRow
                      key={row.id}
                      className={cn(
                        isUnread &&
                          "border-l border-l-amber-500 bg-orange-50! dark:bg-amber-950/50!"
                      )}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-end space-x-2">
          <div className="text-muted-foreground flex-1 text-sm">
            Showing{" "}
            {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{" "}
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length
            )}{" "}
            of {table.getFilteredRowModel().rows.length} notification(s)
          </div>
          <div className="space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}>
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
