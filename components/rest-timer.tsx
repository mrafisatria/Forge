'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bell, BellRing, Timer, X } from 'lucide-react';
import { clampTimerPosition, formatTimer, remainingSeconds, RestAlarm, TIMER_PRESETS } from '@/lib/rest-timer';
import { TimerNotifications, type NotificationState } from '@/lib/timer-notifications';

type Countdown = { id: string; deadline: number; duration: number; ringing: boolean; finished: boolean };
type Drag = { pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean };

export function RestTimer({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [countdown, setCountdown] = useState<Countdown | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [audioWarning, setAudioWarning] = useState(false);
  const [notificationState, setNotificationState] = useState<NotificationState>('loading');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationPending, setNotificationPending] = useState(false);
  const [position, setPosition] = useState<{ side: 'left' | 'right'; y: number }>({ side: 'right', y: 0.65 });
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstPreset = useRef<HTMLButtonElement>(null);
  const active = useRef<Countdown | null>(null);
  const alarm = useRef<RestAlarm | null>(null);
  const notifications = useRef<TimerNotifications | null>(null);
  const wasHidden = useRef(false);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    const client = new TimerNotifications(token);
    notifications.current = client;
    let disposed = false;
    void client.initialize().then(async (state) => {
      if (disposed) return;
      setNotificationState(state);
      const timer = active.current;
      if (state === 'enabled' && timer && !timer.finished) await client.send(timer, 'start', document.visibilityState === 'visible');
    }).catch(() => {
      if (!disposed) setNotificationState('error');
    });
    return () => {
      disposed = true;
      const timer = active.current;
      if (timer && !timer.finished) void client.send(timer, 'cancel', true).catch(() => {});
      client.dispose();
    };
  }, [token]);

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
    if (!countdown) return;
    const tick = () => {
      if (active.current !== countdown) return;
      const visible = document.visibilityState === 'visible';
      if (!visible) {
        wasHidden.current = true;
        alarm.current?.stop();
      }
      if (countdown.finished) return;
      const seconds = remainingSeconds(countdown.deadline);
      setRemaining(seconds);
      if (seconds === 0) {
        const audible = visible && !wasHidden.current;
        const finished = { ...countdown, ringing: audible, finished: true };
        active.current = finished;
        setCountdown(finished);
        setOpen(false);
        setAnnouncement(audible ? 'Waktu istirahat selesai. Tekan bulatan timer untuk menghentikan alarm.' : 'Waktu istirahat selesai.');
        if (audible) {
          void alarm.current?.ring().then((ready) => {
            if (active.current === finished) setAudioWarning(!ready);
          });
          void notifications.current?.send(finished, 'cancel', true).catch(() => {});
        }
      }
      if (visible) wasHidden.current = false;
    };
    const presence = () => {
      tick();
      if (active.current === countdown && !countdown.finished) {
        void notifications.current?.send(countdown, 'presence', document.visibilityState === 'visible').catch(() => {});
      }
    };
    tick();
    const interval = countdown.finished ? undefined : setInterval(tick, 200);
    const heartbeat = countdown.finished ? undefined : setInterval(() => { if (document.visibilityState === 'visible') presence(); }, 5000);
    document.addEventListener('visibilitychange', presence);
    window.addEventListener('pageshow', presence);
    return () => {
      clearInterval(interval);
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', presence);
      window.removeEventListener('pageshow', presence);
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
    const previous = active.current;
    if (previous) void notifications.current?.send(previous, 'cancel', true).catch(() => {});
    const next = { id: crypto.randomUUID(), deadline: now + seconds * 1000, duration: seconds, ringing: false, finished: false };
    active.current = next;
    wasHidden.current = false;
    alarm.current ??= new RestAlarm();
    void alarm.current.prepare().then((ready) => {
      if (active.current === next) setAudioWarning(!ready);
    });
    setCountdown(next); setRemaining(seconds); setAudioWarning(false); setOpen(false);
    setNotificationError('');
    if (notificationState === 'enabled') {
      setNotificationPending(true);
      void notifications.current?.send(next, 'start', true).catch((error) => {
        if (active.current === next) setNotificationError(error instanceof Error ? error.message : 'Notifikasi belum terjadwal. Tetap buka Forge.');
      }).finally(() => { if (active.current?.id === next.id) setNotificationPending(false); });
    }
    setAnnouncement(`Timer istirahat ${formatTimer(seconds)} dimulai.`);
    trigger.current?.focus({ preventScroll: true });
  }

  function stop() {
    const timer = active.current;
    if (timer) void notifications.current?.send(timer, 'cancel', true).catch(() => {
      setNotificationError('Pembatalan notifikasi belum terkirim. Periksa internet; notifikasi lama mungkin masih masuk.');
    });
    active.current = null;
    alarm.current?.stop();
    setCountdown(null); setRemaining(0); setOpen(false); setAudioWarning(false);
    setNotificationPending(false);
    setAnnouncement('Timer dihentikan.');
    trigger.current?.focus({ preventScroll: true });
  }

  async function changeNotifications() {
    if (!notifications.current) return;
    setNotificationBusy(true); setNotificationError('');
    try {
      const state = notificationState === 'enabled' ? await notifications.current.disable()
        : notificationState === 'error' ? await notifications.current.initialize() : await notifications.current.enable();
      setNotificationState(state);
      const timer = active.current;
      if (state === 'enabled' && timer && !timer.finished) await notifications.current.send(timer, 'start', true);
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : 'Notifikasi belum dapat diaktifkan. Coba lagi.');
    } finally { setNotificationBusy(false); }
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
  const label = countdown?.finished ? 'Waktu habis. Tutup timer' : countdown ? `Sisa ${formatTimer(remaining)}. Buka timer istirahat` : 'Buka timer istirahat';

  if (!host) return null;
  return createPortal(<div ref={root} className={`rest-timer ${position.side} ${position.y > 0.5 ? 'panel-above' : 'panel-below'} ${countdown?.ringing ? 'ringing' : ''}`} style={style}>
    {open && <section className="rest-timer-panel" id={panelId} role="dialog" aria-labelledby={titleId}>
      <header><h2 id={titleId}>Timer istirahat</h2><button type="button" className="close-button" aria-label="Tutup pilihan timer" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={18} /></button></header>
      <div className="rest-timer-presets">{TIMER_PRESETS.map((seconds, index) => <button ref={index === 0 ? firstPreset : undefined} key={seconds} type="button" onClick={() => start(seconds, Date.now())} aria-label={`Mulai timer ${formatTimer(seconds)}`}><Timer size={17} /><strong>{formatTimer(seconds)}</strong></button>)}</div>
      {countdown && <button type="button" className="rest-timer-cancel" onClick={stop}>Batalkan timer</button>}
      <div className="rest-timer-notifications">
        <p><Bell size={14} aria-hidden="true" /> {notificationState === 'enabled' ? 'Notifikasi aktif saat minimize' : 'Notifikasi saat minimize'}</p>
        {['ready', 'enabled', 'error'].includes(notificationState) && <button type="button" className="rest-timer-cancel" disabled={notificationBusy} onClick={() => void changeNotifications()}>{notificationBusy ? 'Memproses…' : notificationState === 'enabled' ? 'Nonaktifkan notifikasi' : notificationState === 'error' ? 'Coba sambungkan lagi' : 'Aktifkan notifikasi'}</button>}
        {notificationState === 'loading' && <p>Menyiapkan notifikasi…</p>}
        {notificationState === 'install' && <p>Buka Forge dari Home Screen. Jika belum bisa, tambahkan ulang melalui Safari → Bagikan → Tambahkan ke Layar Utama.</p>}
        {notificationState === 'unsupported' && <p>Notifikasi belum didukung di browser ini. Di iPhone, buka Forge dari Home Screen.</p>}
        {notificationState === 'denied' && <p>Izin ditolak. Aktifkan notifikasi Forge di pengaturan iPhone/browser, lalu buka ulang Forge.</p>}
      </div>
      {notificationError && <p role="alert" className="rest-timer-inline-error">{notificationError}</p>}
      <p>Forge terbuka: alarm berbunyi. Saat minimize: notifikasi saja, tanpa alarm. Perlu internet; pengiriman bisa terlambat.</p>
    </section>}
    {(notificationError || notificationPending) && <p className="rest-timer-warning" role="status">{notificationError || 'Menjadwalkan notifikasi… tunggu sebelum minimize.'}</p>}
    {audioWarning && <p className="rest-timer-warning" role="status">Suara diblokir browser. {countdown?.ringing ? 'Waktu habis—ketuk bulatan.' : 'Mulai ulang timer untuk mengaktifkan suara.'}</p>}
    <button ref={trigger} type="button" className="rest-timer-orb" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      title="Timer istirahat · Geser untuk memindahkan" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={(event) => { pointerUp(event); suppressClick.current = false; }}
      onClick={(event) => {
        if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
        const current = active.current;
        if (current && (current.finished || remainingSeconds(current.deadline) === 0)) stop();
        else setOpen((value) => !value);
      }}>
      <svg className="rest-timer-ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" /><circle cx="32" cy="32" r="29" pathLength="100" strokeDasharray="100" strokeDashoffset={countdown ? 100 * (1 - remaining / countdown.duration) : 100} /></svg>
      {countdown ? <span className="rest-timer-readout" aria-hidden="true">{countdown.ringing && <BellRing size={15} />}<strong>{formatTimer(remaining)}</strong></span> : <span className="rest-timer-idle" aria-hidden="true"><Timer size={26} /></span>}
    </button>
    {countdown?.finished && <span className="rest-timer-stop-hint">{countdown.ringing ? 'Ketuk untuk stop' : 'Waktu habis'}</span>}
    <span className="rest-timer-announcement" role="status" aria-live="polite">{announcement}</span>
  </div>, host);
}
