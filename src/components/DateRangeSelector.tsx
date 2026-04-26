import React, { useState, useEffect, useMemo } from 'react';
import { Calendar } from 'lucide-react';

interface DateRangeSelectorProps {
  availableMonths: string[];
  onRangeChange: (selected: string[], previous: string[], lastYear: string[]) => void;
}

export const DateRangeSelector = React.memo(function DateRangeSelector({ availableMonths, onRangeChange }: DateRangeSelectorProps) {
  const [selectedRange, setSelectedRange] = useState<string>('');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  // Ensure months are sorted chronologically
  const sortedMonths = useMemo(() => {
    return [...availableMonths].sort((a, b) => a.localeCompare(b));
  }, [availableMonths]);

  // When months change (new data loaded), reset to latest month
  useEffect(() => {
    if (sortedMonths.length === 0) return;
    setSelectedRange(sortedMonths[sortedMonths.length - 1]);
    setCustomStart(sortedMonths[Math.max(0, sortedMonths.length - 3)]);
    setCustomEnd(sortedMonths[sortedMonths.length - 1]);
  }, [sortedMonths.join(',')]);

  useEffect(() => {
    if (sortedMonths.length === 0 || !selectedRange) return;

    try {
      let selected: string[] = [];
      let previous: string[] = [];
      let lastYear: string[] = [];

      const getYearMonths = (year: string) => sortedMonths.filter(m => m.startsWith(year));

      if (selectedRange === '今年') {
        const currentYear = sortedMonths[sortedMonths.length - 1].split('-')[0];
        selected = getYearMonths(currentYear);
        previous = getYearMonths((parseInt(currentYear) - 1).toString());
        lastYear = previous;
      } else if (selectedRange === '去年') {
        const currentYear = sortedMonths[sortedMonths.length - 1].split('-')[0];
        const lastY = (parseInt(currentYear) - 1).toString();
        selected = getYearMonths(lastY);
        previous = getYearMonths((parseInt(lastY) - 1).toString());
        lastYear = previous;
      } else if (selectedRange === '前年') {
        const currentYear = sortedMonths[sortedMonths.length - 1].split('-')[0];
        const prevY = (parseInt(currentYear) - 2).toString();
        selected = getYearMonths(prevY);
        previous = getYearMonths((parseInt(prevY) - 1).toString());
        lastYear = previous;
      } else if (selectedRange === 'custom') {
        if (customStart && customEnd && sortedMonths.includes(customStart) && sortedMonths.includes(customEnd)) {
          const startIndex = sortedMonths.indexOf(customStart);
          const endIndex = sortedMonths.indexOf(customEnd);
          if (startIndex !== -1 && endIndex !== -1 && startIndex <= endIndex) {
            selected = sortedMonths.slice(startIndex, endIndex + 1);
            const length = selected.length;
            const prevStartIndex = Math.max(0, startIndex - length);
            if (startIndex > 0) {
              previous = sortedMonths.slice(prevStartIndex, startIndex);
            }
            lastYear = selected
              .map(m => {
                const [y, mon] = m.split('-');
                return `${parseInt(y) - 1}-${mon}`;
              })
              .filter(m => sortedMonths.includes(m));
          }
        }
        if (selected.length === 0) {
          // fallback to last month
          selected = [sortedMonths[sortedMonths.length - 1]];
        }
      } else if (selectedRange.includes('-')) {
        // Single month
        if (sortedMonths.includes(selectedRange)) {
          selected = [selectedRange];
          const idx = sortedMonths.indexOf(selectedRange);
          if (idx > 0) previous = [sortedMonths[idx - 1]];
          const [y, mon] = selectedRange.split('-');
          const ly = `${parseInt(y) - 1}-${mon}`;
          if (sortedMonths.includes(ly)) lastYear = [ly];
        } else {
          // Month not in data, fallback to latest
          selected = [sortedMonths[sortedMonths.length - 1]];
        }
      } else {
        // Unknown range, fallback
        selected = [sortedMonths[sortedMonths.length - 1]];
      }

      onRangeChange(selected, previous, lastYear);
    } catch (e) {
      console.error('[DateRangeSelector] Error computing range:', e);
      // Safe fallback
      onRangeChange([sortedMonths[sortedMonths.length - 1]], [], []);
    }
  }, [selectedRange, customStart, customEnd, sortedMonths]);

  return (
    <div className="flex items-center space-x-3 bg-white px-3 py-1.5 rounded-xl shadow-sm border border-black/5">
      <Calendar className="w-4 h-4 text-[#86868b]" />
      <div className="flex items-center space-x-2">
        <select
          value={selectedRange}
          onChange={(e) => setSelectedRange(e.target.value)}
          className="text-[13px] border-none bg-transparent font-medium text-[#1d1d1f] focus:outline-none cursor-pointer"
        >
          <optgroup label="快捷键">
            <option value="今年">今年</option>
            <option value="去年">去年</option>
            <option value="前年">前年</option>
          </optgroup>
          <optgroup label="单月">
            {sortedMonths.map(m => (
              <option key={m} value={m}>{m === sortedMonths[sortedMonths.length - 1] ? `${m} (本月)` : m}</option>
            ))}
          </optgroup>
          <option value="custom">自定义范围...</option>
        </select>

        {selectedRange === 'custom' && (
          <div className="flex items-center space-x-1 text-[13px]">
            <select
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="border border-black/10 rounded px-1 py-0.5 bg-[#f5f5f7]"
            >
              {sortedMonths.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="text-[#86868b]">-</span>
            <select
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="border border-black/10 rounded px-1 py-0.5 bg-[#f5f5f7]"
            >
              {sortedMonths.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}
      </div>
    </div>
  );
});
