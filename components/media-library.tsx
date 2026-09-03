'use client';

/* Signed Supabase URLs intentionally use native media elements. */
/* eslint-disable @next/next/no-img-element */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Dumbbell, Images, LoaderCircle, Play, Search, Upload, X } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { isVideoPath, MAX_BATCH_FILES, MEDIA_ACCEPT, validateUpload } from '@/lib/media';
import type { MediaAsset } from '@/lib/types';

type Picker = { selectedPath?: string | null; onSelect?: (asset: MediaAsset | null) => void };
const MediaContext = createContext<(picker?: Picker) => void>(() => {});
export const useMediaLibrary = () => useContext(MediaContext);

export function MediaProvider({ token, onError, children }: { token: string; onError: (error: unknown) => unknown; children: ReactNode }) {
  const [picker, setPicker] = useState<Picker | null>(null);
  return <MediaContext.Provider value={useCallback((options: Picker = {}) => setPicker(options), [])}>
    {children}
    {picker && createPortal(<MediaLibrary token={token} picker={picker} onError={onError} onClose={() => setPicker(null)} />, document.body)}
  </MediaContext.Provider>;
}

export function ExerciseMedia({ url, path, name, controls = false, autoPlay = false }: { url: string | null; path: string | null; name: string; controls?: boolean; autoPlay?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!autoPlay || !video.current) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { if (motion.matches) video.current?.pause(); else void video.current?.play().catch(() => {}); };
    update(); motion.addEventListener('change', update);
    return () => motion.removeEventListener('change', update);
  }, [autoPlay, url]);
  if (!url) return <Dumbbell size={24} />;
  return isVideoPath(path)
    ? <video ref={video} src={url} aria-label={name} muted loop playsInline controls={controls} preload="metadata" />
    : <img src={url} alt={name} loading="lazy" />;
}

export function MediaChooseButton({ path, url, onSelect }: { path: string | null; url: string | null; onSelect: (asset: MediaAsset | null) => void }) {
  const open = useMediaLibrary();
  return <button type="button" className="image-picker media-picker-button" onClick={() => open({ selectedPath: path, onSelect })} aria-label="Pilih gambar atau video dari galeri">
    {url ? <><ExerciseMedia url={url} path={path} name="Media terpilih" /><span className="media-change-label">Ganti</span></> : <><Images size={22} /><small>Pilih media</small></>}
  </button>;
}

type UploadItem = { id: string; file: File; status: 'waiting' | 'uploading' | 'done' | 'error'; message?: string };
type MediaResponse = { media: MediaAsset[]; next_offset: number | null };

function MediaLibrary({ token, picker, onError, onClose }: { token: string; picker: Picker; onError: (error: unknown) => unknown; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const requests = useRef(new AbortController());
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<MediaAsset | null>(null);
  const busyRef = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    requests.current = new AbortController();
    dialog.current?.showModal();
    return () => { requests.current.abort(); };
  }, []);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const timer = setInterval(() => setRefresh((value) => value + 1), 20 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    generation.current++;
    const controller = new AbortController();
    setLoading(true); setError(''); setItems([]); setOffset(null);
    apiRequest<MediaResponse>(`/media?q=${encodeURIComponent(query)}`, { token, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setItems(data.media); setOffset(data.next_offset); } })
      .catch((cause) => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Galeri belum dapat dimuat.'); onError(cause); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, query, refresh, onError]);

  async function loadMore() {
    if (offset === null || loading) return;
    const pageGeneration = generation.current;
    setLoading(true);
    try {
      const data = await apiRequest<MediaResponse>(`/media?offset=${offset}&q=${encodeURIComponent(query)}`, { token, signal: requests.current.signal });
      if (pageGeneration !== generation.current || requests.current.signal.aborted) return;
      setItems((current) => [...current, ...data.media.filter((item) => !current.some((old) => old.id === item.id))]); setOffset(data.next_offset);
    } catch (cause) { if (!requests.current.signal.aborted) { setError('Media berikutnya belum dapat dimuat.'); onError(cause); } }
    finally { if (pageGeneration === generation.current && !requests.current.signal.aborted) setLoading(false); }
  }

  async function upload(batch: UploadItem[]) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    const signal = requests.current.signal;
    for (const item of batch) {
      if (signal.aborted) break;
      setQueue((current) => current.map((row) => row.id === item.id ? { ...row, status: 'uploading', message: undefined } : row));
      try {
        await validateUpload(item.file);
        if (signal.aborted) break;
        const body = new FormData(); body.append('file', item.file);
        const data = await apiRequest<{ media: MediaAsset; reused: boolean }>('/media', { method: 'POST', token, body, signal });
        if (signal.aborted) break;
        setQueue((current) => current.map((row) => row.id === item.id ? { ...row, status: 'done', message: data.reused ? 'Sudah ada di galeri' : 'Tersimpan' } : row));
      } catch (cause) {
        if (signal.aborted) break;
        setQueue((current) => current.map((row) => row.id === item.id ? { ...row, status: 'error', message: cause instanceof Error ? cause.message : 'Upload gagal.' } : row));
        onError(cause);
      }
    }
    if (!signal.aborted) { setBusy(false); busyRef.current = false; setSearch(''); setRefresh((value) => value + 1); }
  }

  function addFiles(files: FileList | null) {
    if (!files?.length || busyRef.current) return;
    if (files.length > MAX_BATCH_FILES) { setError('Pilih maksimal 20 file dalam satu unggahan.'); return; }
    const batch: UploadItem[] = Array.from(files, (file) => ({ id: crypto.randomUUID(), file, status: 'waiting' }));
    setQueue(batch); void upload(batch);
  }
  function choose(asset: MediaAsset | null) { if (!busyRef.current && picker.onSelect) { picker.onSelect(asset); onClose(); } }

  return <dialog ref={dialog} className="media-dialog" aria-labelledby="media-title" onCancel={(event) => { event.preventDefault(); if (!busyRef.current) onClose(); }}>
    <header><div><p className="eyebrow">WORKOUT MEDIA</p><h2 id="media-title">{picker.onSelect ? 'Pilih media exercise' : 'Galeri media'}</h2></div><button type="button" className="close-button" onClick={onClose} disabled={busy} aria-label="Tutup galeri"><X size={20} /></button></header>
    <div className="media-library-body">
      <div className="media-upload-zone">
        <Images size={26} /><div><strong>Upload sekali, pakai di banyak exercise.</strong><p>JPG, PNG, WebP hingga 5 MB · MP4 hingga 10 MB, maksimal 3 detik.</p></div>
        <input ref={input} type="file" multiple accept={MEDIA_ACCEPT} hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} aria-label="Upload gambar dan video" />
        <button type="button" className="primary-button" onClick={() => input.current?.click()} disabled={busy}><Upload size={16} />{busy ? 'Mengunggah...' : 'Upload media'}</button>
      </div>
      {queue.length > 0 && <section className="upload-progress" aria-label="Progres upload">
        <p role="status">{queue.filter((item) => item.status === 'done').length}/{queue.length} file tersimpan{busy ? ' · Jangan tutup galeri dahulu' : ''}</p>
        <ul>{queue.map((item) => <li key={item.id} className={item.status}>
          {item.status === 'uploading' ? <LoaderCircle className="spin" size={14} /> : item.status === 'done' ? <Check size={14} /> : null}
          <span>{item.file.name}</span><small>{item.message || (item.status === 'uploading' ? 'Mengunggah...' : 'Menunggu')}</small>
        </li>)}</ul>
        {!busy && queue.some((item) => item.status === 'error') && <button type="button" className="secondary-button" onClick={() => void upload(queue.filter((item) => item.status === 'error'))}>Coba ulang yang gagal</button>}
      </section>}
      <label className="media-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama gambar atau video..." aria-label="Cari media" disabled={loading && items.length > 0} /></label>
      {error && <div className="connection-error" role="alert"><span>{error}</span><button type="button" className="secondary-button" onClick={() => setRefresh((value) => value + 1)}>Muat ulang</button></div>}
      {preview && <section className="media-preview"><div><strong>{preview.name}</strong><button type="button" className="close-button" onClick={() => setPreview(null)} aria-label="Tutup preview"><X size={18} /></button></div><ExerciseMedia url={preview.image_url} path={preview.image_path} name={preview.name} controls /></section>}
      <div className="media-grid">{items.map((item) => <article className={'media-tile ' + (picker.selectedPath === item.image_path ? 'selected' : '')} key={item.id}>
        <button type="button" className="media-thumbnail" disabled={busy} onClick={() => picker.onSelect ? choose(item) : setPreview(item)} aria-label={`${picker.onSelect ? 'Pilih' : 'Lihat'} ${item.name}`}>
          <ExerciseMedia url={item.image_url} path={item.image_path} name={item.name} />
          {item.kind === 'video' && <span className="video-badge"><Play size={11} />{item.duration_seconds?.toFixed(1)} dtk</span>}
          {picker.selectedPath === item.image_path && <span className="media-selected"><Check size={16} /></span>}
        </button><strong title={item.name}>{item.name}</strong><button type="button" className="media-preview-button" onClick={() => setPreview(item)}>Lihat {item.kind === 'video' ? 'video' : 'gambar'}</button>
      </article>)}</div>
      {loading && <div className="media-empty" role="status"><LoaderCircle className="spin" size={24} /> Memuat galeri...</div>}
      {!loading && !error && !items.length && <div className="media-empty"><Images size={30} /><strong>{query ? 'Media tidak ditemukan' : 'Galeri masih kosong'}</strong><span>{query ? 'Coba nama file lain.' : 'Pilih beberapa gambar atau video melalui tombol Upload media.'}</span></div>}
      {offset !== null && <button type="button" className="secondary-button" disabled={loading} onClick={() => void loadMore()}>Muat lebih banyak</button>}
    </div>
    <footer>{picker.onSelect && picker.selectedPath && <button type="button" className="secondary-button" disabled={busy} onClick={() => choose(null)}>Lepas media dari exercise</button>}<button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Selesai</button></footer>
  </dialog>;
}
