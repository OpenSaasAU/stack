import { cn } from "../lib/utils.js";

export interface SkeletonLoaderProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular";
}

/**
 * Skeleton loader component for content placeholders
 */
export function SkeletonLoader({
  className,
  variant = "rectangular"
}: SkeletonLoaderProps) {
  const variantClasses = {
    text: "h-4 rounded",
    circular: "rounded-full",
    rectangular: "rounded-md",
  };

  return (
    <div
      className={cn(
        "animate-pulse bg-muted",
        variantClasses[variant],
        className,
      )}
      aria-hidden="true"
    />
  );
}

/**
 * Table skeleton loader
 */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-6 py-3">
                  <SkeletonLoader variant="text" className="h-4 w-24" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: columns }).map((_, colIndex) => (
                  <td key={colIndex} className="px-6 py-4">
                    <SkeletonLoader variant="text" className="h-4 w-32" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Form skeleton loader
 */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="space-y-6">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <SkeletonLoader variant="text" className="h-4 w-24" />
            <SkeletonLoader variant="rectangular" className="h-10 w-full" />
          </div>
        ))}
        <div className="flex items-center justify-between pt-6 border-t border-border">
          <div className="flex gap-3">
            <SkeletonLoader variant="rectangular" className="h-10 w-20" />
            <SkeletonLoader variant="rectangular" className="h-10 w-20" />
          </div>
        </div>
      </div>
    </div>
  );
}
