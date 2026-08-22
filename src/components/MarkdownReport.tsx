import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownReportProps {
  children: string;
}

export const MarkdownReport: React.FC<MarkdownReportProps> = ({ children }) => (
  <div className="prose prose-sm max-w-none text-[#1d1d1f] leading-relaxed">
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-xl font-bold mt-0 mb-5 text-[#1d1d1f]">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-bold mt-7 mb-3 text-[#1d1d1f]">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-semibold mt-6 mb-2 text-[#1d1d1f]">{children}</h3>,
        p: ({ children }) => <p className="my-3 leading-7">{children}</p>,
        ul: ({ children }) => <ul className="my-3 list-disc pl-5 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="my-3 list-decimal pl-5 space-y-1">{children}</ol>,
        strong: ({ children }) => <strong className="font-semibold text-[#111827]">{children}</strong>,
        table: ({ children }) => (
          <div className="my-4 overflow-x-auto rounded-xl border border-black/10 bg-white">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-[#f5f5f7] text-[#1d1d1f]">{children}</thead>,
        th: ({ children }) => <th className="border-b border-black/10 px-3 py-2 font-semibold align-top">{children}</th>,
        td: ({ children }) => <td className="border-t border-black/5 px-3 py-2 align-top leading-6">{children}</td>,
        blockquote: ({ children }) => (
          <blockquote className="my-4 border-l-4 border-indigo-300 bg-indigo-50/70 px-4 py-2 text-[#424245]">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.92em] text-[#1d1d1f]">
            {children}
          </code>
        ),
      }}
    >
      {children}
    </Markdown>
  </div>
);
