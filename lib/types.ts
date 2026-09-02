export type WorkoutSet = {
  id: string;
  set_number: number;
  weight_kg: number;
  reps: number;
};

export type Exercise = {
  id: string;
  name: string;
  image_url: string | null;
  image_path: string | null;
  sort_order: number;
  gym_exercise_sets: WorkoutSet[];
};

export type Routine = {
  id: string;
  name: string;
  training_day: string | null;
  note: string | null;
  created_at: string;
  gym_exercises: Exercise[];
};

export type DraftSet = {
  clientId: string;
  weightKg: string;
  reps: string;
};

export type DraftExercise = {
  clientId: string;
  name: string;
  imageUrl: string | null;
  imagePath: string | null;
  imageFile: File | null;
  sets: DraftSet[];
};

export type RoutineDraft = {
  id: string | null;
  name: string;
  trainingDay: string;
  note: string;
  exercises: DraftExercise[];
};
