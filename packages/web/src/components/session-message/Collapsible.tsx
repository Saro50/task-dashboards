import { useState } from 'react';
import { ChevronIcon } from './ChevronIcon';

export function Collapsible({ title, defaultOpen = false, children }: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded bg-gray-50 border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
      >
        <ChevronIcon open={open} />
        <span className="truncate flex-1 text-left">{title}</span>
      </button>
      {open && <div className="px-2 pb-1.5">{children}</div>}
    </div>
  );
}
