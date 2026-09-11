import React, { useRef, useState } from 'react';
import { X, User, ImagePlus, Trash2 } from 'lucide-react';
import { updateUserAvatar } from '../utils/auth';
import { toast } from 'sonner';

const MAX_EDGE = 160;
const JPEG_QUALITY = 0.82;

function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width < 1 || height < 1) {
        reject(new Error('无效图片'));
        return;
      }
      const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法处理图片'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      } catch {
        reject(new Error('导出失败'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片'));
    };
    img.src = url;
  });
}

interface AvatarSettingsModalProps {
  open: boolean;
  userId: string;
  username: string;
  currentAvatar?: string | null;
  onClose: () => void;
  onSaved: (avatarDataUrl?: string) => void;
}

export const AvatarSettingsModal: React.FC<AvatarSettingsModalProps> = ({
  open,
  userId,
  username,
  currentAvatar,
  onClose,
  onSaved,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const pick = () => inputRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !f.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }
    if (f.size > 4 * 1024 * 1024) {
      toast.error('图片请小于 4MB');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(f);
      const res = updateUserAvatar(userId, dataUrl);
      if (!res.ok) {
        toast.error(res.error ?? '保存失败');
        return;
      }
      toast.success('头像已更新');
      onSaved(dataUrl);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '处理失败');
    } finally {
      setBusy(false);
    }
  };

  const clearAvatar = () => {
    const res = updateUserAvatar(userId, null);
    if (!res.ok) {
      toast.error(res.error ?? '清除失败');
      return;
    }
    toast.success('已恢复默认头像');
    onSaved(undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-sm rounded-[24px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-[#1d1d1f]">头像设置</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-black/5">
            <X className="w-5 h-5 text-[#86868b]" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <p className="text-sm text-[#86868b]">账号「{username}」的头像保存在本机浏览器，换电脑需重新设置。</p>
          <div className="flex justify-center">
            {currentAvatar ? (
              <img
                src={currentAvatar}
                alt=""
                className="w-24 h-24 rounded-2xl object-cover border border-black/10 shadow-sm"
              />
            ) : (
              <div className="w-24 h-24 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-2xl font-bold">
                {username[0]?.toUpperCase() ?? '?'}
              </div>
            )}
          </div>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={pick}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <ImagePlus className="w-4 h-4" />
              {busy ? '处理中…' : '选择图片'}
            </button>
            {currentAvatar && (
              <button
                type="button"
                onClick={clearAvatar}
                className="w-full py-2.5 rounded-xl border border-black/10 text-sm font-medium text-[#86868b] hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                清除头像
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
