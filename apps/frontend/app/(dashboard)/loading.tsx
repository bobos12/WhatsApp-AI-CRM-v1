/**
 * Route-level loading state for every dashboard screen. Renders instantly
 * inside the app shell (sidebar/header stay put) while the next page's chunk
 * and server payload stream in, so navigation never shows a blank frame.
 * Uses the shimmering `.skeleton` blocks from globals.css.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-4 animate-fade-in" role="status" aria-label="Loading">
      {/* Page title + action row */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="skeleton h-7 w-44 sm:w-56" />
          <div className="skeleton h-3.5 w-28 sm:w-40" />
        </div>
        <div className="skeleton h-10 w-24 rounded-xl sm:w-36" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="skeleton h-28 rounded-xl sm:h-36" />
        ))}
      </div>

      {/* Content blocks */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="skeleton h-64 rounded-xl lg:col-span-8" />
        <div className="skeleton h-64 rounded-xl lg:col-span-4" />
      </div>
    </div>
  );
}
