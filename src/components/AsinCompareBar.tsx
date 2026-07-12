import React from 'react';
import { Product, getCurrencySymbol } from '../utils/parser';
import { X, ExternalLink, Star } from 'lucide-react';

interface AsinCompareBarProps {
  products: Product[];
  selectedAsins: string[];
  onRemove: (asin: string) => void;
  onClear: () => void;
  domain?: string;
}

export const AsinCompareBar: React.FC<AsinCompareBarProps> = ({
  products,
  selectedAsins,
  onRemove,
  onClear,
  domain = 'amazon.com',
}) => {
  if (selectedAsins.length === 0) return null;

  const selectedProducts = selectedAsins
    .map(asin => products.find(p => p.asin === asin))
    .filter(Boolean) as Product[];

  const cur = getCurrencySymbol(domain);

  return (
    <div className="fixed bottom-0 left-64 right-0 z-50 bg-white border-t border-black/10 shadow-2xl animate-in slide-in-from-bottom duration-300" data-print-hidden>
      <div className="flex items-center justify-between px-4 py-2 border-b border-black/5 bg-slate-50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700">ASIN 对比</span>
          <span className="text-[10px] text-slate-400">（已选 {selectedAsins.length} 个）</span>
        </div>
        <button
          onClick={onClear}
          className="text-[10px] text-slate-400 hover:text-rose-500 transition-colors flex items-center gap-1"
        >
          <X className="w-3 h-3" /> 清空
        </button>
      </div>
      <div className="overflow-x-auto custom-scroll">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-white border-b border-slate-100">
              <th className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap min-w-[120px]">产品</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600 whitespace-nowrap">价格</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600 whitespace-nowrap">月销量</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600 whitespace-nowrap">月销售额</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600 whitespace-nowrap">评分</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600 whitespace-nowrap">评论数</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600 whitespace-nowrap">FBA费用</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600 whitespace-nowrap">上架天数</th>
              <th className="px-3 py-2 text-center font-semibold text-slate-600 whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            {selectedProducts.map(product => (
              <tr key={product.asin} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {product.image
                      ? <img src={product.image} alt="" className="w-8 h-8 rounded object-cover border border-black/5 flex-shrink-0" referrerPolicy="no-referrer" />
                      : <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-[8px] text-slate-400 flex-shrink-0">无图</div>
                    }
                    <div className="min-w-0">
                      <div className="text-slate-800 font-medium truncate max-w-[180px]" title={product.title}>{product.title}</div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1">
                        <span className="font-mono">{product.asin}</span>
                        <a href={`https://www.${domain}/dp/${product.asin}`} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-700"><ExternalLink className="w-2.5 h-2.5" /></a>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-medium text-slate-700">{cur}{product.price.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-medium text-slate-700">{product.monthlySales.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-medium text-emerald-600">{cur}{Math.round(product.monthlyRevenue).toLocaleString()}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-0.5">
                    <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                    <span className="font-medium text-slate-700">{product.rating.toFixed(1)}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-slate-600">{product.reviewCount.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-slate-600">{product.fbaFee > 0 ? `${cur}${product.fbaFee.toFixed(2)}` : '-'}</td>
                <td className="px-3 py-2 text-right text-slate-600">{product.daysSinceLaunch > 0 ? `${product.daysSinceLaunch}天` : '-'}</td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => onRemove(product.asin)}
                    className="p-1 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
