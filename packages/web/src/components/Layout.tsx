export default function Layout({ children }: { children: React.ReactNode }) {
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
        </div>
      </nav>
      {children}
    </div>
  );
}
