import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { LucideIcon, TrendingUp, TrendingDown, HelpCircle } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  subtitle?: string;
  tooltip?: string;
  large?: boolean;
  yoy?: { value: number; isPositive: boolean; };
  mom?: { value: number; isPositive: boolean; };
}

function TooltipIcon({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex items-center ml-1">
      <HelpCircle
        className="w-3.5 h-3.5 text-[#b0b0b8] hover:text-[#6366f1] cursor-help transition-colors"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && (
        <div className="absolute left-5 top-0 z-50 bg-white border border-black/10 rounded-2xl shadow-2xl p-3 w-56 text-xs text-[#1d1d1f] leading-relaxed pointer-events-none">
          {text}
        </div>
      )}
    </span>
  );
}

export const MetricCard = React.memo(function MetricCard({ title, value, icon: Icon, description, subtitle, tooltip, large, yoy, mom }: MetricCardProps) {
  const TrendIcon = (isPositive: boolean) => isPositive ? TrendingUp : TrendingDown;

  if (large) {
    return (
      <Card className="overflow-visible transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 bg-gradient-to-br from-white to-[#f9f9fb]">
        <CardContent className="pt-5 pb-5 overflow-visible">
          <div className="flex flex-col items-center text-center">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 bg-[#f0f0f5] rounded-lg">
                <Icon className="h-4 w-4 text-indigo-600" />
              </div>
              <span className="text-[13px] font-medium text-[#86868b]">{title}</span>
              {tooltip && <TooltipIcon text={tooltip}/>}
            </div>
            <div className="text-[40px] font-bold tracking-tight text-[#1d1d1f] leading-none my-2">{value}</div>
          </div>
          {(yoy || mom) && (
            <div className="flex justify-center gap-3 mt-3 pt-3 border-t border-black/5">
              {yoy && (
                <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg ${
                  yoy.isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'
                }`}>
                  {React.createElement(TrendIcon(yoy.isPositive), { className: 'h-3 w-3' })}
                  同比 {yoy.isPositive ? '+' : '-'}{Math.abs(yoy.value).toFixed(1)}%
                </div>
              )}
              {mom && (
                <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg ${
                  mom.isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'
                }`}>
                  {React.createElement(TrendIcon(mom.isPositive), { className: 'h-3 w-3' })}
                  环比 {mom.isPositive ? '+' : '-'}{Math.abs(mom.value).toFixed(1)}%
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-visible transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-0.5">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3 px-4">
        <CardTitle className="text-[12px] font-medium text-[#86868b] flex items-center">
          {title}
          {tooltip && <TooltipIcon text={tooltip}/>}
        </CardTitle>
        <div className="p-1.5 bg-[#f5f5f7] rounded-full">
          <Icon className="h-3.5 w-3.5 text-[#86868b]" />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 overflow-visible">
        <div className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">{value}</div>
        {(description || yoy || mom) && (
          <div className="text-[11px] text-[#86868b] mt-1.5 flex flex-wrap gap-1.5">
            {yoy && (
              <span className={`font-medium flex items-center gap-0.5 ${
                yoy.isPositive ? 'text-emerald-500' : 'text-rose-500'
              }`}>
                {React.createElement(TrendIcon(yoy.isPositive), { className: 'h-2.5 w-2.5' })}
                同比{yoy.isPositive ? '+' : '-'}{Math.abs(yoy.value).toFixed(1)}%
              </span>
            )}
            {mom && (
              <span className={`font-medium flex items-center gap-0.5 ${
                mom.isPositive ? 'text-emerald-500' : 'text-rose-500'
              }`}>
                {React.createElement(TrendIcon(mom.isPositive), { className: 'h-2.5 w-2.5' })}
                环比{mom.isPositive ? '+' : '-'}{Math.abs(mom.value).toFixed(1)}%
              </span>
            )}
            {description && <p>{description}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}, (prevProps, nextProps) => {
  return prevProps.title === nextProps.title &&
    prevProps.value === nextProps.value &&
    prevProps.icon === nextProps.icon &&
    prevProps.large === nextProps.large &&
    prevProps.tooltip === nextProps.tooltip &&
    prevProps.description === nextProps.description &&
    prevProps.yoy?.value === nextProps.yoy?.value &&
    prevProps.yoy?.isPositive === nextProps.yoy?.isPositive &&
    prevProps.mom?.value === nextProps.mom?.value &&
    prevProps.mom?.isPositive === nextProps.mom?.isPositive;
});
