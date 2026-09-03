import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortRoutinesByDay, trainingDays } from '../lib/routines.ts';

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
