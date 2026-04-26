import React, { useState } from 'react';
import { Upload, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card';

interface FileUploadProps {
  onDataLoaded: (file1: File, file2: File) => void;
}

export function FileUpload({ onDataLoaded }: FileUploadProps) {
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setFile: React.Dispatch<React.SetStateAction<File | null>>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')) {
        setFile(file);
        setError(null);
      } else {
        setError('请上传有效的 Excel 或 CSV 文件 (.xlsx, .xls, .csv)');
      }
    }
  };

  const handleSubmit = () => {
    if (file1 && file2) {
      onDataLoaded(file1, file2);
    } else {
      setError('请上传两个必需的数据文件。');
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl border-none shadow-[0_20px_40px_rgba(0,0,0,0.08)]">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-semibold text-[#1d1d1f]">上传市场数据</CardTitle>
          <CardDescription className="text-[#86868b]">
            请上传您的亚马逊市场数据文件以生成分析仪表盘。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          {error && (
            <div className="bg-rose-50 text-rose-600 p-4 rounded-xl flex items-center space-x-2 text-sm font-medium">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* File 1 Upload */}
            <div className={`border-2 border-dashed rounded-[20px] p-8 flex flex-col items-center justify-center text-center transition-all relative group cursor-pointer
              ${file1 ? 'border-emerald-500 bg-emerald-50/50' : 'border-black/10 hover:border-indigo-500 hover:bg-indigo-50/30'}`}>
              <input 
                type="file" 
                accept=".xlsx, .xls, .csv" 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                onChange={(e) => handleFileChange(e, setFile1)}
              />
              <div className={`p-4 rounded-full mb-4 transition-colors ${file1 ? 'bg-emerald-100 text-emerald-600' : 'bg-[#f5f5f7] text-[#86868b] group-hover:bg-indigo-100 group-hover:text-indigo-600'}`}>
                <FileSpreadsheet className="w-8 h-8" />
              </div>
              <h3 className="font-semibold text-[#1d1d1f] mb-1">市场明细数据</h3>
              <p className="text-xs text-[#86868b]">包含商品明细的Excel文件</p>
              {file1 && <p className="text-sm font-medium text-emerald-600 mt-3 truncate w-full px-4">{file1.name}</p>}
            </div>

            {/* File 2 Upload */}
            <div className={`border-2 border-dashed rounded-[20px] p-8 flex flex-col items-center justify-center text-center transition-all relative group cursor-pointer
              ${file2 ? 'border-emerald-500 bg-emerald-50/50' : 'border-black/10 hover:border-indigo-500 hover:bg-indigo-50/30'}`}>
              <input 
                type="file" 
                accept=".xlsx, .xls, .csv" 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                onChange={(e) => handleFileChange(e, setFile2)}
              />
              <div className={`p-4 rounded-full mb-4 transition-colors ${file2 ? 'bg-emerald-100 text-emerald-600' : 'bg-[#f5f5f7] text-[#86868b] group-hover:bg-indigo-100 group-hover:text-indigo-600'}`}>
                <FileSpreadsheet className="w-8 h-8" />
              </div>
              <h3 className="font-semibold text-[#1d1d1f] mb-1">历史表现大盘数据</h3>
              <p className="text-xs text-[#86868b]">包含历史销量/销售额的Excel文件</p>
              {file2 && <p className="text-sm font-medium text-emerald-600 mt-3 truncate w-full px-4">{file2.name}</p>}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!file1 || !file2}
            className="w-full bg-[#1d1d1f] hover:bg-black text-white font-medium py-4 rounded-xl flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
          >
            <Upload className="w-5 h-5" />
            <span>生成仪表盘</span>
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

