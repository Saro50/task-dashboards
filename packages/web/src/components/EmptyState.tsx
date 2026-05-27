export default function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-6xl mb-4 opacity-40">📂</div>
      <h2 className="text-lg font-semibold text-gray-300 mb-2">暂无项目</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-md">
        点击下方按钮创建你的第一个项目，开始使用 AICodeAgent 管理你的开发任务。
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-primary-500/20 cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        新建项目
      </button>
    </div>
  );
}
