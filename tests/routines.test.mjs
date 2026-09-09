import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveExercise, normalizeTargetReps, repTargetTone, sortRoutinesByDay, trainingDays } from '../lib/routines.ts';

test('routines follow Monday to Sunday instead of creation order', () => {
  const routines = ['Minggu', 'Rabu', 'Sabtu', 'Senin', 'Jumat', 'Selasa', 'Kamis']
    .map((training_day) => ({ training_day }));
  assert.deepEqual(sortRoutinesByDay(routines).map((routine) => routine.training_day), trainingDays);
});

test('day sorting handles legacy capitalization, whitespace, and unscheduled routines', () => {
  const routines = [null, 'Fleksibel', '', 'minggu', ' SENIN ', 'sElAsA']
    .map((training_day) => ({ training_day }));
  assert.deepEqual(sortRoutinesByDay(routines).map((routine) => routine.training_day),
    [' SENIN ', 'sElAsA', 'minggu', null, 'Fleksibel', '']);
});

test('day sorting is stable and does not mutate routines', () => {
  const routines = Object.freeze([
    Object.freeze({ id: 'sunday', training_day: 'Minggu' }),
    Object.freeze({ id: 'first', training_day: 'Senin' }),
    Object.freeze({ id: 'second', training_day: 'Senin' }),
  ]);
  assert.deepEqual(sortRoutinesByDay(routines).map((routine) => routine.id), ['first', 'second', 'sunday']);
  assert.deepEqual(routines.map((routine) => routine.id), ['sunday', 'first', 'second']);
  assert.deepEqual(sortRoutinesByDay([]), []);
});

test('routine order updates when its training day changes', () => {
  const routines = [{ id: 'a', training_day: 'Rabu' }, { id: 'b', training_day: 'Jumat' }];
  const updated = routines.map((routine) => routine.id === 'b' ? { ...routine, training_day: 'Senin' } : routine);
  assert.deepEqual(sortRoutinesByDay(updated).map((routine) => routine.id), ['b', 'a']);
});

test('target rep ranges are normalized and color each actual rep', () => {
  assert.equal(normalizeTargetReps(' 6 – 8 '), '6-8');
  assert.equal(normalizeTargetReps('10'), '10');
  assert.equal(normalizeTargetReps(''), null);
  assert.throws(() => normalizeTargetReps('8-6'));
  assert.throws(() => normalizeTargetReps('sekitar 8'));
  assert.equal(repTargetTone(5, '6-8'), 'below');
  assert.equal(repTargetTone(6, '6-8'), 'within');
  assert.equal(repTargetTone(8, '6-8'), 'within');
  assert.equal(repTargetTone(9, '6-8'), 'above');
  assert.equal(repTargetTone(8, null), null);
});

test('exercise cards can move while keeping a continuous persisted order', () => {
  const exercises = Object.freeze([
    Object.freeze({ id: 'a', sort_order: 0, name: 'A' }),
    Object.freeze({ id: 'b', sort_order: 1, name: 'B' }),
    Object.freeze({ id: 'c', sort_order: 2, name: 'C' }),
  ]);
  const moved = moveExercise(exercises, 'c', 'a');
  assert.deepEqual(moved.map(({ id, sort_order }) => ({ id, sort_order })), [
    { id: 'c', sort_order: 0 }, { id: 'a', sort_order: 1 }, { id: 'b', sort_order: 2 },
  ]);
  assert.deepEqual(exercises.map((item) => item.id), ['a', 'b', 'c']);
  assert.equal(moveExercise(exercises, 'missing', 'a'), exercises);
  assert.equal(moveExercise(exercises, 'a', 'a'), exercises);
});
