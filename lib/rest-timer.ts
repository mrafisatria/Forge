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

export class RestAlarm {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private generation = 0;
  private createContext: () => AudioContext;

  constructor(createContext = () => new AudioContext()) {
    this.createContext = createContext;
  }

  // Unlock on a preset click, but do NOT schedule audio into the background.
  async prepare(): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    try {
      if (this.context?.state === 'closed') this.context = null;
      const context = this.context ??= this.createContext();
      await context.resume();
      return generation === this.generation && context.state === 'running';
    } catch { return false; }
  }

  async ring(isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible'): Promise<boolean> {
    if (!isVisible()) return false;
    if (this.source && this.context?.state === 'running') return true;
    const ready = this.prepare();
    const generation = this.generation;
    if (!await ready || generation !== this.generation || !isVisible()) return false;
    try {
      const context = this.context!;
      const samples = alarmSamples(context.sampleRate);
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      this.source = source;
      source.buffer = buffer;
      source.loop = true;
      source.connect(context.destination);
      source.start(context.currentTime);
      return true;
    } catch {
      if (generation === this.generation) this.stop();
      return false;
    }
  }

  stop() {
    this.generation++;
    if (this.source) {
      try { this.source.stop(); } catch { /* Already stopped or not yet started. */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  dispose() {
    this.stop();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}
