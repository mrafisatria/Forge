import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alarmSamples, clampTimerPosition, formatTimer, remainingSeconds, RestAlarm, TIMER_PRESETS } from '../lib/rest-timer.ts';

test('five presets, absolute countdown, and bounded orb remain unchanged', () => {
  assert.deepEqual([...TIMER_PRESETS], [60, 90, 120, 180, 240]);
  assert.deepEqual(TIMER_PRESETS.map(formatTimer), ['1:00', '1:30', '2:00', '3:00', '4:00']);
  assert.equal(remainingSeconds(100000, 10000), 90);
  assert.equal(remainingSeconds(100000, 99001), 1);
  assert.equal(remainingSeconds(100000, 180000), 0);
  assert.equal(formatTimer(-1), '0:00');
  assert.deepEqual(clampTimerPosition(-10, -100, 375, 667), { x: 12, y: 12 });
  assert.deepEqual(clampTimerPosition(1000, 1000, 375, 667), { x: 299, y: 591 });
});
test('ringtone has bounded samples and pauses between repeats', () => {
  const samples = alarmSamples(8000);
  assert.equal(samples.length, 14400);
  assert.ok(samples.some((sample) => Math.abs(sample) > .1));
  assert.ok(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= .22));
  assert.ok(samples.slice(8000).every((sample) => sample === 0));
});
function fixture() {
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
test('preset unlocks audio but schedules no sound or silent playback', async () => {
  const { alarm, context, sources } = fixture();
  const ready = alarm.prepare();
  assert.equal(context.resumes, 1);
  assert.equal(await ready, true);
  assert.equal(sources.length, 0);
});
test('visible completion starts one looping alarm and stop disconnects it', async () => {
  const { alarm, context, sources } = fixture();
  await alarm.prepare();
  assert.equal(await alarm.ring(() => true), true);
  assert.equal(sources[0].started, context.currentTime);
  assert.equal(sources[0].loop, true);
  await alarm.ring(() => true);
  assert.equal(sources.length, 1);
  alarm.stop(); alarm.stop();
  assert.equal(sources[0].stops, 1);
  assert.equal(sources[0].disconnected, true);
});
test('hidden completion never starts audio', async () => {
  const { alarm, sources } = fixture();
  await alarm.prepare();
  assert.equal(await alarm.ring(() => false), false);
  assert.equal(sources.length, 0);
});
test('minimizing during pending resume never starts a late alarm, with or without a page event', async () => {
  for (const stop of [true, false]) {
    const { alarm, context, sources } = fixture();
    let resume, visible = true;
    context.resume = () => new Promise((resolve) => { resume = () => { context.state = 'running'; resolve(); }; });
    const pending = alarm.ring(() => visible);
    visible = false; if (stop) alarm.stop(); resume();
    assert.equal(await pending, false);
    assert.equal(sources.length, 0);
  }
});
test('replacing timer and disposing cancel playback', async () => {
  const { alarm, sources, context } = fixture();
  await alarm.ring(() => true);
  await alarm.prepare();
  assert.equal(sources[0].stops, 1);
  assert.equal(sources.length, 1);
  alarm.dispose();
  assert.equal(context.closes, 1);
});
test('blocked or unavailable audio does not crash the countdown', async () => {
  const { alarm, context, sources } = fixture();
  context.resume = async () => { throw new Error('Blocked'); };
  assert.equal(await alarm.prepare(), false);
  assert.equal(await alarm.ring(() => true), false);
  assert.equal(sources.length, 0);
  assert.equal(await new RestAlarm(() => { throw new Error('Unsupported'); }).prepare(), false);
});
