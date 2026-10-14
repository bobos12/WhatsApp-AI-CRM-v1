import { Table } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Trash2, Download } from 'lucide-react'

interface DataTableBulkBarProps<TData> {
  table: Table<TData>
  onBulkDelete?: (rows: TData[]) => Promise<void>
  onBulkExport?: (rows: TData[]) => void
  isDeleting?: boolean
}

export function DataTableBulkBar<TData>({
  table,
  onBulkDelete,
  onBulkExport,
  isDeleting = false,
}: DataTableBulkBarProps<TData>) {
  const selectedRows = table.getSelectedRowModel().rows
  const selectedCount = selectedRows.length

  if (selectedCount === 0) return null

  const handleDelete = async () => {
    if (!onBulkDelete) return
    const confirmed = window.confirm(`Delete ${selectedCount} item${selectedCount !== 1 ? 's' : ''}?`)
    if (confirmed) {
      await onBulkDelete(selectedRows.map((row) => row.original))
    }
  }

  const handleExport = () => {
    if (!onBulkExport) return
    onBulkExport(selectedRows.map((row) => row.original))
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-line bg-raised px-5 py-3 shadow-xl z-40">
      <span className="text-sm font-medium text-white">
        {selectedCount} row{selectedCount !== 1 ? 's' : ''} selected
      </span>

      <div className="h-6 w-px bg-white/10" />

      {onBulkDelete && (
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={isDeleting}
          className="h-8"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      )}

      {onBulkExport && (
        <Button variant="outline" size="sm" onClick={handleExport} className="h-8">
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      )}
    </div>
  )
}
