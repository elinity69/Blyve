export function ProfileSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-white dark:bg-slate-950 p-8 animate-pulse">
      <div className="w-24 h-24 rounded-full bg-gray-200 dark:bg-slate-800 mb-4" />
      <div className="w-48 h-6 bg-gray-200 dark:bg-slate-800 rounded mb-2" />
      <div className="w-32 h-4 bg-gray-200 dark:bg-slate-800 rounded mb-6" />
      <div className="w-full max-w-md space-y-3">
        <div className="h-4 bg-gray-200 dark:bg-slate-800 rounded" />
        <div className="h-4 bg-gray-200 dark:bg-slate-800 rounded" />
        <div className="h-4 bg-gray-200 dark:bg-slate-800 rounded w-2/3" />
      </div>
    </div>
  );
}
