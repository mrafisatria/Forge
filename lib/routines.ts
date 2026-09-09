export const trainingDays = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

const dayOrder = new Map(trainingDays.map((day, index) => [day.toLowerCase(), index]));

export function sortRoutinesByDay<T extends { training_day: string | null }>(routines: readonly T[]): T[] {
  const rank = (day: string | null) => dayOrder.get(day?.trim().toLowerCase() ?? '') ?? trainingDays.length;
  // Keep the existing order within each day and leave the source array untouched.
  return [...routines].sort((a, b) => rank(a.training_day) - rank(b.training_day));
}

export function normalizeTargetReps(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,5})(?:\s*[-–—]\s*(\d{1,5}))?$/);
  if (!match) throw new Error('Target Rep harus berupa angka atau rentang, misalnya 8 atau 6-8.');
  const minimum = Number(match[1]);
  const maximum = Number(match[2] ?? match[1]);
  if (minimum > 10000 || maximum > 10000 || minimum > maximum) {
    throw new Error('Rentang Target Rep tidak valid.');
  }
  return match[2] ? `${minimum}-${maximum}` : String(minimum);
}

export function repTargetTone(reps: number, target: string | null): 'below' | 'within' | 'above' | null {
  if (!target) return null;
  const match = target.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const minimum = Number(match[1]);
  const maximum = Number(match[2] ?? match[1]);
  if (reps < minimum) return 'below';
  if (reps > maximum) return 'above';
  return 'within';
}

export function moveExercise<T extends { id: string; sort_order: number }>(items: readonly T[], activeId: string, overId: string): T[] {
  const from = items.findIndex((item) => item.id === activeId);
  const to = items.findIndex((item) => item.id === overId);
  if (from < 0 || to < 0 || from === to) return items as T[];
  const reordered = [...items];
  const [active] = reordered.splice(from, 1);
  reordered.splice(to, 0, active);
  return reordered.map((item, index) => ({ ...item, sort_order: index }));
}
