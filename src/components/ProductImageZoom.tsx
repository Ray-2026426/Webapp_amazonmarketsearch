import React, { useState } from 'react';

interface ProductImageZoomProps {
  src?: string;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  fallbackText?: string;
}

export const ProductImageZoom: React.FC<ProductImageZoomProps> = ({
  src,
  alt = '',
  className = 'w-12 h-12 rounded-lg object-cover border border-black/5 shrink-0',
  fallbackClassName = 'w-12 h-12 rounded-lg bg-[#f5f5f7] border border-black/5 flex items-center justify-center text-xs text-[#86868b] shrink-0',
  fallbackText = '无图',
}) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!src) return <div className={fallbackClassName}>{fallbackText}</div>;

  const left = pos ? Math.min(pos.x + 18, window.innerWidth - 292) : 0;
  const top = pos ? Math.min(pos.y + 18, window.innerHeight - 292) : 0;

  return (
    <>
      <img
        src={src}
        alt={alt}
        className={`${className} cursor-zoom-in`}
        referrerPolicy="no-referrer"
        onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setPos(null)}
      />
      {pos && (
        <div
          className="fixed z-[90] pointer-events-none rounded-xl border border-black/10 bg-white p-2 shadow-2xl"
          style={{ left, top }}
        >
          <img src={src} alt="" className="h-64 w-64 rounded-lg object-contain bg-white" referrerPolicy="no-referrer" />
        </div>
      )}
    </>
  );
};
