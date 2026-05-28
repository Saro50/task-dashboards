interface Props {
  children: React.ReactNode;
  onOpenEngineConfig: () => void;
}

export default function Layout({ children, onOpenEngineConfig }: Props) {
  return (
    <div className="bg-dark-500 text-gray-100 min-h-screen">
      <nav className="bg-gray-800/90 backdrop-blur-md sticky top-0 z-50 h-14 flex items-center px-4 sm:px-6 border-b border-gray-700">
        <div className="flex items-center gap-2 text-lg font-bold text-white">
          <span className="text-2xl">🤖</span>
          <span className="hidden sm:inline">AICodeAgent</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <a
            href="#"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            项目管理
          </a>
          <button
            onClick={onOpenEngineConfig}
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="hidden sm:inline">引擎配置</span>
          </button>
        </div>
      </nav>
      {children}
    </div>
  );
}
