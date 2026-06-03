export function ToolStatusLabel({ status }: { status: string }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-yellow-500">
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        运行中
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="text-[10px] text-green-500">完成</span>
    );
  }
  if (status === 'error') {
    return (
      <span className="text-[10px] text-red-500">错误</span>
    );
  }
  return <span className="text-[10px] text-gray-400">等待中</span>;
}
