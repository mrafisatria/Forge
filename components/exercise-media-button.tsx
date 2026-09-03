'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ExerciseMedia } from './media-library';
import { isVideoPath } from '@/lib/media';

type MediaProps = { url: string | null; path: string | null; name: string };

export function ExerciseMediaButton({ url, path, name }: MediaProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  if (!url) return <div className="exercise-image"><ExerciseMedia url={url} path={path} name={name} /></div>;

  return <>
    <button ref={trigger} type="button" className="exercise-image exercise-media-trigger"
      aria-label={`Perbesar ${isVideoPath(path) ? 'video' : 'gambar'} ${name}`} aria-haspopup="dialog"
      onClick={() => setOpen(true)}>
      <ExerciseMedia url={url} path={path} name={name} autoPlay={!open} />
    </button>
    {open && createPortal(<ExerciseMediaDialog url={url} path={path} name={name} onClose={() => {
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    }} />, document.body)}
  </>;
}

export function ExerciseMediaDialog({ url, path, name, onClose }: MediaProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  const titleId = useId();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    const root = document.documentElement;
    const body = document.body;
    const rootOverflow = root.style.overflow;
    const bodyOverflow = body.style.overflow;
    if (element && !element.open) element.showModal();
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      if (element?.open) element.close();
      root.style.overflow = rootOverflow;
      body.style.overflow = bodyOverflow;
    };
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }

  return <dialog ref={dialog} className="media-dialog exercise-media-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onPointerDown={(event) => { backdropPressed.current = event.target === event.currentTarget; }}
    onClick={(event) => { if (backdropPressed.current && event.target === event.currentTarget) close(); }}>
    <div className="exercise-media-dialog-content">
      <header>
        <h2 id={titleId}>{name}</h2>
        <button type="button" className="close-button" onClick={close} aria-label="Tutup gambar atau video" autoFocus><X size={22} /></button>
      </header>
      <div className="exercise-media-stage">
        {failedUrl && failedUrl === url
          ? <p role="alert">Media belum bisa dimuat. Tutup popup dan coba lagi.</p>
          : <ExerciseMedia url={url} path={path} name={name} controls autoPlay onError={() => setFailedUrl(url)} />}
      </div>
    </div>
  </dialog>;
}
