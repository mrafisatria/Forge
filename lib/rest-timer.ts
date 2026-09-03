export const TIMER_PRESETS = [60, 90, 120, 180, 240] as const;

export function remainingSeconds(deadline: number, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function formatTimer(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function clampTimerPosition(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(12, Math.min(x, width - 76)),
    y: Math.max(12, Math.min(y, height - 76)),
  };
}

// Three gentle chimes, followed by silence; the audio buffer loops until stopped.
export function alarmSamples(sampleRate: number) {
  const samples = new Float32Array(Math.ceil(sampleRate * 1.8));
  for (let pulse = 0; pulse < 3; pulse++) {
    const start = Math.floor(pulse * 0.3 * sampleRate);
    const duration = Math.floor(0.18 * sampleRate);
    const frequency = pulse === 1 ? 1108.73 : 880;
    for (let i = 0; i < duration; i++) {
      const envelope = Math.min(1, i / (sampleRate * 0.01)) * (1 - i / duration) ** 2;
      samples[start + i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * envelope * 0.22;
    }
  }
  return samples;
}

type PlaybackSession = { type: string };

function browserAudioSession(): PlaybackSession | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { audioSession?: PlaybackSession }).audioSession ?? null;
}

export class RestAlarm {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private ringAt = Infinity;
  private session: PlaybackSession | null = null;
  private previousSessionType = 'auto';
  private generation = 0;
  private createContext: () => AudioContext;
  private getSession: () => PlaybackSession | null;

  constructor(createContext = () => new AudioContext(), getSession = browserAudioSession) {
    this.createContext = createContext;
    this.getSession = getSession;
  }

  private usePlaybackSession() {
    try {
      if (this.session?.type === 'playback') return true;
      this.releaseSession();
      const session = this.getSession();
      if (!session) return false;
      const previous = session.type;
      session.type = 'playback';
      if (session.type !== 'playback') return false;
      this.session = session;
      this.previousSessionType = previous;
      return true;
    } catch {
      // AudioSession is optional; ordinary foreground audio still works without it.
      return false;
    }
  }

  private releaseSession() {
    try {
      if (this.session?.type === 'playback') this.session.type = this.previousSessionType;
    } catch { /* Some browsers may revoke access during an interruption. */ }
    this.session = null;
  }

  // Call directly from a preset's click to unlock audio through a user gesture.
  async schedule(deadline: number): Promise<boolean> {
    this.cancelSource();
    const generation = this.generation;
    try {
      const backgroundPlayback = this.usePlaybackSession();
      if (this.context?.state === 'closed') this.context = null;
      const context = this.context ??= this.createContext();
      await context.resume();
      if (generation !== this.generation) return false;
      if (context.state !== 'running') {
        this.stop();
        return false;
      }
      const delay = Math.max(0, (deadline - Date.now()) / 1000);
      // Start a silent countdown immediately, then loop just the ringtone. This
      // keeps a playback session active without needing background JS to ring.
      // 8 kHz mono keeps the longest (4 minute) preset below 8 MB.
      const sampleRate = backgroundPlayback ? 8000 : context.sampleRate;
      const silentFrames = backgroundPlayback ? Math.ceil(delay * sampleRate) : 0;
      const samples = alarmSamples(sampleRate);
      const buffer = context.createBuffer(1, silentFrames + samples.length, sampleRate);
      buffer.copyToChannel(samples, 0, silentFrames);
      const source = context.createBufferSource();
      this.source = source;
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = silentFrames / sampleRate;
      source.loopEnd = buffer.duration;
      source.connect(context.destination);
      const startAt = context.currentTime + (backgroundPlayback ? 0 : delay);
      this.ringAt = startAt + source.loopStart;
      source.start(startAt);
      return true;
    } catch {
      if (generation === this.generation) this.stop();
      return false;
    }
  }

  // Foreground ticks must not restart an alarm already ringing in background.
  ring(): Promise<boolean> {
    if (this.source && this.context?.state === 'running' && this.context.currentTime >= this.ringAt) {
      return Promise.resolve(true);
    }
    return this.schedule(Date.now());
  }

  private cancelSource() {
    this.generation++;
    this.ringAt = Infinity;
    if (this.source) {
      try { this.source.stop(); } catch { /* Already stopped or not yet started. */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  stop() {
    this.cancelSource();
    this.releaseSession();
  }

  dispose() {
    this.stop();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}
