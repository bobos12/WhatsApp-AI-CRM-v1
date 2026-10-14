import { Table } from '@tanstack/react-table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, Settings2, Download } from 'lucide-react'
import { downloadCsv } from '@/lib/exportCsv'

interface FilterOption {
  id: string
  title: string
  options: { label: string; value: string }[]
}

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  searchPlaceholder?: string
  filterableColumns?: FilterOption[]
  exportFilename?: string
  exportHeaders?: string[]
  getExportRow?: (row: TData) => string[]
}

export function DataTableToolbar<TData>({
  table,
  searchPlaceholder = 'Search...',
  filterableColumns = [],
  exportFilename = 'export.csv',
  exportHeaders = [],
  getExportRow,
}: DataTableToolbarProps<TData>) {
  const handleExport = () => {
    const rows = table.getFilteredRowModel().rows
    if (rows.length === 0 || !getExportRow || exportHeaders.length === 0) return

    const data = rows.map((row) => getExportRow(row.original))
    downloadCsv(exportFilename, exportHeaders, data)
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 px-6 py-4">
      <div className="flex flex-1 items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input
            placeholder={searchPlaceholder}
            value={(table.getState().globalFilter as string) ?? ''}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-9 pl-10"
          />
        </div>

        {filterableColumns.map((filter) => {
          const filterValue = (table.getColumn(filter.id)?.getFilterValue() as string) ?? ''
          return (
            <Select key={filter.id} value={filterValue} onValueChange={(value) => {
              table.getColumn(filter.id)?.setFilterValue(value || undefined)
            }}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue placeholder={filter.title} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                {filter.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        {getExportRow && exportHeaders.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={handleExport}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <Settings2 className="mr-2 h-4 w-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {column.columnDef.header as string}
                  </DropdownMenuCheckboxItem>
                )
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
