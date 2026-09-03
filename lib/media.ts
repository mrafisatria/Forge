export const MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4';
export const MAX_BATCH_FILES = 20;
export function isVideoPath(path: string | null | undefined) {
  return Boolean(path?.toLowerCase().endsWith('.mp4'));
}
export function validateUploadSize(file: { type: string; size: number }) {
  if (!MEDIA_ACCEPT.split(',').includes(file.type)) throw new Error('Gunakan JPG, PNG, WebP, atau video MP4.');
  const max = file.type === 'video/mp4' ? 10 : 5;
  if (!file.size || file.size > max * 1024 * 1024) throw new Error(`Ukuran ${file.type === 'video/mp4' ? 'video' : 'gambar'} maksimal ${max} MB.`);
}

export async function validateUpload(file: File) {
  validateUploadSize(file);
  if (file.type !== 'video/mp4') return;
  await new Promise<void>((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      video.onloadedmetadata = null; video.onerror = null;
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Video tidak dapat dibaca. Gunakan MP4 H.264.')), 10000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 3
      ? new Error('Video maksimal 3 detik. Potong video terlebih dahulu.') : undefined);
    video.onerror = () => finish(new Error('Video tidak didukung browser ini. Gunakan MP4 H.264.'));
    video.src = url;
  });
}
