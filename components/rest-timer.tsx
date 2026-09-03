'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, Timer, X } from 'lucide-react';
import { clampTimerPosition, formatTimer, remainingSeconds, RestAlarm, TIMER_PRESETS } from '@/lib/rest-timer';

type Countdown = { deadline: number; duration: number; ringing: boolean };
type Drag = { pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean };

export function RestTimer() {
  const [open, setOpen] = useState(false);
  const [countdown, setCountdown] = useState<Countdown | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [audioWarning, setAudioWarning] = useState(false);
  const [position, setPosition] = useState<{ side: 'left' | 'right'; y: number }>({ side: 'right', y: 0.65 });
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstPreset = useRef<HTMLButtonElement>(null);
  const active = useRef<Countdown | null>(null);
  const alarm = useRef<RestAlarm | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    // Keep the timer reachable even while an image/gallery native dialog is open.
    const updateHost = () => {
      const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
      setHost(dialogs.item(dialogs.length - 1) ?? document.body);
    };
    updateHost();
    const observer = new MutationObserver(updateHost);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => { observer.disconnect(); alarm.current?.dispose(); active.current = null; };
  }, []);

  useEffect(() => {
    if (!countdown || countdown.ringing) return;
    const tick = () => {
      if (active.current !== countdown) return;
      const seconds = remainingSeconds(countdown.deadline);
      setRemaining(seconds);
      if (seconds === 0) {
        const finished = { ...countdown, ringing: true };
        active.current = finished;
        setCountdown(finished);
        setOpen(false);
        setAnnouncement('Waktu istirahat selesai. Tekan bulatan timer untuk menghentikan alarm.');
        // Resync against wall time if the page/audio was suspended in the background.
        void alarm.current?.ring().then((ready) => {
          if (active.current === finished) setAudioWarning(!ready);
        });
      }
    };
    tick();
    const interval = setInterval(tick, 200);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, [countdown]);

  useEffect(() => {
    if (!open) return;
    firstPreset.current?.focus({ preventScroll: true });
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open, host]);

  function start(seconds: number, now: number) {
    const next = { deadline: now + seconds * 1000, duration: seconds, ringing: false };
    active.current = next;
    alarm.current ??= new RestAlarm();
    void alarm.current.schedule(next.deadline).then((ready) => {
      if (active.current === next) setAudioWarning(!ready);
    });
    setCountdown(next); setRemaining(seconds); setAudioWarning(false); setOpen(false);
    setAnnouncement(`Timer istirahat ${formatTimer(seconds)} dimulai.`);
    trigger.current?.focus({ preventScroll: true });
  }

  function stop() {
    active.current = null;
    alarm.current?.stop();
    setCountdown(null); setRemaining(0); setOpen(false); setAudioWarning(false);
    setAnnouncement('Timer dihentikan.');
    trigger.current?.focus({ preventScroll: true });
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: bounds.left, y: bounds.top, moved: false };
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < 7) return;
    current.moved = true; suppressClick.current = true; setOpen(false);
    setDragPosition(clampTimerPosition(current.x + dx, current.y + dy, window.innerWidth, window.innerHeight));
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.moved) {
      const point = clampTimerPosition(current.x + event.clientX - current.startX, current.y + event.clientY - current.startY, window.innerWidth, window.innerHeight);
      setPosition({ side: event.clientX < window.innerWidth / 2 ? 'left' : 'right', y: point.y / window.innerHeight });
    }
    drag.current = null; setDragPosition(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const timerTop = `clamp(max(12px, env(safe-area-inset-top)), ${position.y * 100}dvh, calc(100dvh - 76px - env(safe-area-inset-bottom)))`;
  const style: CSSProperties & { '--timer-top': string } = dragPosition ? { left: dragPosition.x, top: dragPosition.y, right: 'auto', '--timer-top': `${dragPosition.y}px` } : {
    [position.side]: `max(12px, env(safe-area-inset-${position.side}))`,
    top: timerTop, '--timer-top': timerTop,
  };
  const label = countdown?.ringing ? 'Waktu habis. Hentikan alarm' : countdown ? `Sisa ${formatTimer(remaining)}. Buka timer istirahat` : 'Buka timer istirahat';

  if (!host) return null;
  return createPortal(<div ref={root} className={`rest-timer ${position.side} ${position.y > 0.5 ? 'panel-above' : 'panel-below'} ${countdown?.ringing ? 'ringing' : ''}`} style={style}>
    {open && <section className="rest-timer-panel" id={panelId} role="dialog" aria-labelledby={titleId}>
      <header><h2 id={titleId}>Timer istirahat</h2><button type="button" className="close-button" aria-label="Tutup pilihan timer" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={18} /></button></header>
      <div className="rest-timer-presets">{TIMER_PRESETS.map((seconds, index) => <button ref={index === 0 ? firstPreset : undefined} key={seconds} type="button" onClick={() => start(seconds, Date.now())} aria-label={`Mulai timer ${formatTimer(seconds)}`}><Timer size={17} /><strong>{formatTimer(seconds)}</strong></button>)}</div>
      {countdown && <button type="button" className="rest-timer-cancel" onClick={stop}>Batalkan timer</button>}
      <p>Aktifkan volume. Minimize didukung pada iPhone yang kompatibel; jangan tutup paksa aplikasi. Telepon atau audio lain bisa mengganggu alarm.</p>
    </section>}
    {audioWarning && <p className="rest-timer-warning" role="status">Suara diblokir browser. {countdown?.ringing ? 'Waktu habis—ketuk bulatan.' : 'Mulai ulang timer untuk mengaktifkan suara.'}</p>}
    <button ref={trigger} type="button" className="rest-timer-orb" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      title="Timer istirahat · Geser untuk memindahkan" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={(event) => { pointerUp(event); suppressClick.current = false; }}
      onClick={(event) => {
        if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
        const current = active.current;
        if (current && (current.ringing || remainingSeconds(current.deadline) === 0)) stop();
        else setOpen((value) => !value);
      }}>
      <svg className="rest-timer-ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" /><circle cx="32" cy="32" r="29" pathLength="100" strokeDasharray="100" strokeDashoffset={countdown ? 100 * (1 - remaining / countdown.duration) : 100} /></svg>
      {countdown ? <span className="rest-timer-readout" aria-hidden="true">{countdown.ringing && <BellRing size={15} />}<strong>{formatTimer(remaining)}</strong></span> : <span className="rest-timer-idle" aria-hidden="true"><Timer size={26} /></span>}
    </button>
    {countdown?.ringing && <span className="rest-timer-stop-hint">Ketuk untuk stop</span>}
    <span className="rest-timer-announcement" role="status" aria-live="polite">{announcement}</span>
  </div>, host);
}
