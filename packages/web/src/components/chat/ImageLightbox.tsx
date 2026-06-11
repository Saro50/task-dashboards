import { useEffect, useCallback, useState } from 'react';

interface Props {
  /** 图片 URL（data URL 或后端 serve-image 端点 URL） */
  src: string;
  /** 图片 alt 文本 */
  alt?: string;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 全屏 Lightbox 组件：居中展示大图，点击遮罩或按 Esc 关闭。
 *
 * 上游：由 PartRenderer 中图片缩略图的 onClick 触发打开。
 * 下游：渲染固定定位的全屏遮罩 + 居中大图。
 *
 * 设计原则：
 * - z-index 高于其他 UI 元素（z-[9999]）
 * - 点击遮罩区域（非图片区域）关闭
 * - Esc 键关闭
 * - 打开时锁定 body 滚动
 * - 图片保持原始比例，最大占视口 90% 宽高
 */
export default function ImageLightbox({ src, alt = '图片预览', onClose }: Props) {
  const [loaded, setLoaded] = useState(false);

  // Esc 键关闭
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // 打开时锁定 body 滚动
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center animate-[fadeIn_0.15s_ease_both]"
      onClick={(e) => {
        // 仅点击遮罩本身（非图片）时关闭
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-colors cursor-pointer"
        title="关闭 (Esc)"
      >
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* 图片容器：最大占视口 90% */}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className={`max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl transition-opacity duration-200 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ display: 'block' }}
      />

      {/* 加载指示器 */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="w-8 h-8 text-white/60 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}
    </div>
  );
}
