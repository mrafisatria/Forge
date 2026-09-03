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

  // Call directly from a preset's click to unlock audio through a user gesture.
  async schedule(deadline: number): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    try {
      const context = this.context ??= this.createContext();
      await context.resume();
      if (generation !== this.generation) return false;
      if (context.state !== 'running') return false;
      const samples = alarmSamples(context.sampleRate);
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(context.destination);
      this.source = source;
      source.start(context.currentTime + Math.max(0, (deadline - Date.now()) / 1000));
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
