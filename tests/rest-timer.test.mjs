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

function audioFixture(session = null) {
  const sources = [];
  const buffers = [];
  const context = {
    state: 'suspended', sampleRate: 8000, currentTime: 5, destination: {}, resumes: 0, closes: 0,
    async resume() { this.resumes++; this.state = 'running'; },
    async close() { this.closes++; this.state = 'closed'; },
    createBuffer(channels, length, rate) {
      assert.equal(channels, 1);
      const data = new Float32Array(length);
      const buffer = { data, sampleRate: rate, duration: length / rate,
        copyToChannel(samples, channel, offset = 0) { assert.equal(channel, 0); data.set(samples, offset); },
      };
      buffers.push(buffer);
      return buffer;
    },
    createBufferSource() {
      const source = { loop: false, started: null, stops: 0, disconnected: false,
        connect() {}, start(when) { this.started = when; },
        stop() { this.stops++; }, disconnect() { this.disconnected = true; },
      };
      sources.push(source); return source;
    },
  };
  return { context, sources, buffers, alarm: new RestAlarm(() => context, () => session) };
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

test('playback starts immediately with a silent countdown and loops only the ringtone', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const session = { type: 'auto' };
  const { alarm, context, sources, buffers } = audioFixture(session);
  context.sampleRate = 48000;
  const pending = alarm.schedule(190_000);
  assert.equal(session.type, 'playback');
  assert.equal(context.resumes, 1);
  assert.equal(await pending, true);
  assert.equal(sources[0].started, 5);
  assert.equal(sources[0].loop, true);
  assert.equal(sources[0].loopStart, 90);
  assert.equal(sources[0].loopEnd, 91.8);
  assert.equal(buffers[0].sampleRate, 8000);
  assert.ok(buffers[0].data.subarray(0, 720000).every((sample) => sample === 0));
  assert.deepEqual(buffers[0].data.subarray(720000), alarmSamples(8000));
  // No page tick is needed to reach the ringtone. Returning must not restart it.
  context.currentTime = 96;
  assert.equal(await alarm.ring(), true);
  assert.equal(sources.length, 1);
  alarm.stop();
  assert.equal(session.type, 'auto');
  assert.equal(sources[0].stops, 1);
});

test('all background presets use a bounded buffer and accurate countdown prefix', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { alarm, sources, buffers } = audioFixture({ type: 'auto' });
  for (const seconds of TIMER_PRESETS) {
    assert.equal(await alarm.schedule(100_000 + seconds * 1000), true);
    assert.equal(sources.at(-1).loopStart, seconds);
    assert.ok(buffers.at(-1).data.byteLength < 8_000_000);
  }
  assert.ok(sources.slice(0, -1).every((source) => source.stops === 1 && source.disconnected));
  alarm.dispose();
});

test('playback session is acquired before creating/resuming audio and restored only on stop', async () => {
  const changes = [];
  let type = 'ambient';
  const session = { get type() { return type; }, set type(value) { changes.push(value); type = value; } };
  const { context } = audioFixture();
  const alarm = new RestAlarm(() => { assert.equal(type, 'playback'); return context; }, () => session);
  await alarm.schedule(Date.now() + 60_000);
  await alarm.schedule(Date.now() + 90_000);
  assert.deepEqual(changes, ['playback']);
  alarm.stop(); alarm.stop();
  assert.deepEqual(changes, ['playback', 'ambient']);
});

test('stop does not overwrite an audio session changed elsewhere', async () => {
  const session = { type: 'auto' };
  const { alarm } = audioFixture(session);
  await alarm.schedule(Date.now() + 60_000);
  session.type = 'transient';
  alarm.stop();
  assert.equal(session.type, 'transient');
});

test('unsupported or rejected playback sessions keep the foreground alarm working', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  for (const session of [null, Object.freeze({ type: 'auto' }), { get type() { return 'auto'; }, set type(_value) {} }]) {
    const { alarm, sources, buffers } = audioFixture(session);
    assert.equal(await alarm.schedule(160_000), true);
    assert.equal(sources[0].started, 65);
    assert.equal(sources[0].loopStart, 0);
    assert.equal(buffers[0].data.length, 14400);
    alarm.dispose();
  }
  const { context } = audioFixture();
  const alarm = new RestAlarm(() => context, () => { throw new Error('Unavailable'); });
  assert.equal(await alarm.schedule(160_000), true);
  alarm.dispose();
});

test('failed audio startup releases the playback session', async () => {
  for (const failure of ['rejected', 'suspended', 'buffer', 'start']) {
    const session = { type: 'auto' };
    const { alarm, context, sources } = audioFixture(session);
    if (failure === 'rejected') context.resume = async () => { throw new Error('Blocked'); };
    if (failure === 'suspended') context.resume = async () => {};
    if (failure === 'buffer') context.createBuffer = () => { throw new Error('Unavailable'); };
    if (failure === 'start') {
      const create = context.createBufferSource;
      context.createBufferSource = () => {
        const source = create(); source.start = () => { throw new Error('Failed'); }; return source;
      };
    }
    assert.equal(await alarm.schedule(Date.now() + 60_000), false);
    assert.equal(session.type, 'auto');
    assert.ok(sources.every((source) => source.stops === 1 && source.disconnected));
  }
});

test('disposing during pending resume restores playback and prevents a late alarm', async () => {
  const session = { type: 'auto' };
  const { alarm, context, sources } = audioFixture(session);
  let resume;
  context.resume = () => new Promise((resolve) => { resume = resolve; });
  const pending = alarm.schedule(Date.now() + 60_000);
  assert.equal(session.type, 'playback');
  alarm.dispose();
  assert.equal(session.type, 'auto');
  resume();
  assert.equal(await pending, false);
  assert.equal(sources.length, 0);
  assert.equal(context.closes, 1);
});

test('late permission result cannot replace a newer timer or release its session', async () => {
  const session = { type: 'auto' };
  const { alarm, context, sources } = audioFixture(session);
  let reject;
  context.resume = () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
  const old = alarm.schedule(Date.now() + 60_000);
  context.resume = async () => { context.state = 'running'; };
  assert.equal(await alarm.schedule(Date.now() + 120_000), true);
  reject(new Error('Old request failed'));
  assert.equal(await old, false);
  assert.equal(session.type, 'playback');
  assert.equal(sources.length, 1);
  assert.equal(sources[0].stops, 0);
  alarm.dispose();
});

test('returning after suspended audio resyncs the alarm to wall time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { alarm, context, sources } = audioFixture({ type: 'auto' });
  await alarm.schedule(160_000);
  context.currentTime = 10;
  context.state = 'suspended';
  t.mock.timers.setTime(170_000);
  assert.equal(await alarm.ring(), true);
  assert.equal(sources[0].stops, 1);
  assert.equal(sources[1].started, 10);
  assert.equal(sources[1].loopStart, 0);
  assert.equal(await alarm.ring(), true);
  assert.equal(sources.length, 2);
  alarm.dispose();
});

test('a closed audio context can be recreated for a new preset', async () => {
  const session = { type: 'auto' };
  const first = audioFixture();
  const second = audioFixture();
  let created = 0;
  const alarm = new RestAlarm(() => (++created === 1 ? first.context : second.context), () => session);
  await alarm.schedule(Date.now() + 60_000);
  first.context.state = 'closed';
  assert.equal(await alarm.schedule(Date.now() + 60_000), true);
  assert.equal(created, 2);
  assert.equal(first.sources[0].stops, 1);
  assert.equal(second.sources.length, 1);
  alarm.dispose();
  assert.equal(session.type, 'auto');
});
