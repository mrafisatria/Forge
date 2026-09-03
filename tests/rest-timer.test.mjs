import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alarmSamples, clampTimerPosition, formatTimer, remainingSeconds, RestAlarm, TIMER_PRESETS } from '../lib/rest-timer.ts';

test('rest timer includes all five requested presets', () => {
  assert.deepEqual([...TIMER_PRESETS], [60, 90, 120, 180, 240]);
  assert.deepEqual(TIMER_PRESETS.map(formatTimer), ['1:00', '1:30', '2:00', '3:00', '4:00']);
});

test('countdown uses its deadline, including delayed background ticks', () => {
  const deadline = 100_000;
  assert.equal(remainingSeconds(deadline, 10_000), 90);
  assert.equal(remainingSeconds(deadline, 99_001), 1);
  assert.equal(remainingSeconds(deadline, 100_000), 0);
  assert.equal(remainingSeconds(deadline, 180_000), 0);
  assert.equal(formatTimer(-1), '0:00');
  assert.equal(formatTimer(59), '0:59');
});

test('dragging keeps the timer inside narrow and desktop viewports', () => {
  assert.deepEqual(clampTimerPosition(-10, -100, 375, 667), { x: 12, y: 12 });
  assert.deepEqual(clampTimerPosition(1000, 1000, 375, 667), { x: 299, y: 591 });
  assert.deepEqual(clampTimerPosition(100, 300, 1920, 1080), { x: 100, y: 300 });
});

test('alarm generates a bounded ringtone with pauses between repeats', () => {
  const samples = alarmSamples(8000);
  assert.equal(samples.length, 14400);
  assert.ok(samples.some((sample) => Math.abs(sample) > 0.1));
  assert.ok(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 0.22));
  assert.ok(samples.slice(8000).every((sample) => sample === 0));
});

function audioFixture() {
  const sources = [];
  const context = {
    state: 'suspended', sampleRate: 8000, currentTime: 5, destination: {}, resumes: 0, closes: 0,
    async resume() { this.resumes++; this.state = 'running'; },
    async close() { this.closes++; this.state = 'closed'; },
    createBuffer(channels, length, rate) {
      assert.equal(channels, 1); assert.equal(length, 14400); assert.equal(rate, 8000);
      return { copyToChannel(samples) { assert.equal(samples.length, length); } };
    },
    createBufferSource() {
      const source = { loop: false, started: null, stops: 0, disconnected: false,
        connect() {}, start(when) { this.started = when; },
        stop() { this.stops++; }, disconnect() { this.disconnected = true; },
      };
      sources.push(source); return source;
    },
  };
  return { context, sources, alarm: new RestAlarm(() => context) };
}

test('preset unlocks audio immediately and schedules a looping alarm at its deadline', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { alarm, context, sources } = audioFixture();
  const ready = alarm.schedule(190_000);
  assert.equal(context.resumes, 1);
  assert.equal(await ready, true);
  assert.equal(sources[0].started, 95);
  assert.equal(sources[0].loop, true);
  alarm.stop();
  assert.equal(sources[0].stops, 1);
  assert.equal(sources[0].disconnected, true);
});

test('replacing or cancelling timers stops the previous scheduled audio', async () => {
  const { alarm, sources } = audioFixture();
  await alarm.schedule(Date.now() + 60_000);
  await alarm.schedule(Date.now() + 240_000);
  assert.equal(sources[0].stops, 1);
  assert.equal(sources[0].disconnected, true);
  assert.equal(sources[1].stops, 0);
  alarm.stop(); alarm.stop();
  assert.equal(sources[1].stops, 1);
});

test('expired deadline rings immediately when a suspended page returns', async () => {
  const { alarm, context, sources } = audioFixture();
  await alarm.schedule(Date.now() - 60_000);
  assert.equal(sources[0].started, context.currentTime);
  alarm.dispose();
  assert.equal(sources[0].stops, 1);
  assert.equal(context.closes, 1);
});

test('stopping while audio permission is pending cannot start a late alarm', async () => {
  const { alarm, context, sources } = audioFixture();
  let resume;
  context.resume = () => new Promise((resolve) => { resume = () => { context.state = 'running'; resolve(); }; });
  const pending = alarm.schedule(Date.now() + 60_000);
  alarm.stop(); resume();
  assert.equal(await pending, false);
  assert.equal(sources.length, 0);
});

test('blocked or missing audio is reported without crashing the countdown', async () => {
  const { alarm, context, sources } = audioFixture();
  context.resume = async () => { throw new Error('Blocked'); };
  assert.equal(await alarm.schedule(Date.now()), false);
  assert.equal(sources.length, 0);
  const unavailable = new RestAlarm(() => { throw new Error('Unsupported'); });
  assert.equal(await unavailable.schedule(Date.now()), false);
});
