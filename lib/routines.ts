export const trainingDays = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

const dayOrder = new Map(trainingDays.map((day, index) => [day.toLowerCase(), index]));

export function sortRoutinesByDay<T extends { training_day: string | null }>(routines: readonly T[]): T[] {
  const rank = (day: string | null) => dayOrder.get(day?.trim().toLowerCase() ?? '') ?? trainingDays.length;
  // Keep the existing order within each day and leave the source array untouched.
  return [...routines].sort((a, b) => rank(a.training_day) - rank(b.training_day));
}
