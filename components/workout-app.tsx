'use client';

/* User-uploaded Supabase and blob preview URLs intentionally use native images. */
/* eslint-disable @next/next/no-img-element */

import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleUserRound,
  Dumbbell,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest, isSupabaseConfigured, readSession, rememberSession, sessionStorageKey, type ForgeSession, type RoutinesResponse } from '@/lib/api';
import type { DraftExercise, DraftSet, Exercise, Routine, RoutineDraft } from '@/lib/types';

const uid = () => crypto.randomUUID();
const trainingDays = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

function parseWeight(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('Isi beban dengan angka, misalnya 2,5 (maksimal dua desimal).');
  return Number(normalized);
}

function newSet(index: number): DraftSet {
  return { clientId: uid(), weightKg: '', reps: index === 0 ? '10' : '' };
}

function newExercise(): DraftExercise {
  return {
    clientId: uid(),
    name: '',
    imageUrl: null,
    imagePath: null,
    imageFile: null,
    sets: [newSet(0), newSet(1), newSet(2)],
  };
}

function emptyDraft(): RoutineDraft {
  return { id: null, name: '', trainingDay: '', note: '', exercises: [] };
}

function draftFromRoutine(routine: Routine): RoutineDraft {
  return {
    id: routine.id,
    name: routine.name,
    trainingDay: trainingDays.find((day) => day.toLowerCase() === routine.training_day?.trim().toLowerCase()) ?? routine.training_day ?? '',
    note: routine.note ?? '',
    exercises: routine.gym_exercises
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((exercise) => ({
        clientId: exercise.id,
        name: exercise.name,
        imageUrl: exercise.image_url,
        imagePath: exercise.image_path,
        imageFile: null,
        sets: exercise.gym_exercise_sets
          .slice()
          .sort((a, b) => a.set_number - b.set_number)
          .map((set) => ({ clientId: set.id, weightKg: String(set.weight_kg), reps: String(set.reps) })),
      })),
  };
}

function normalizeRoutine(routine: Routine): Routine {
  return {
    ...routine,
    gym_exercises: (routine.gym_exercises ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((exercise) => ({
        ...exercise,
        gym_exercise_sets: (exercise.gym_exercise_sets ?? []).slice().sort((a, b) => a.set_number - b.set_number),
      })),
  };
}

function exerciseToDraft(exercise: Exercise): DraftExercise {
  return {
    clientId: exercise.id,
    name: exercise.name,
    imageUrl: exercise.image_url,
    imagePath: exercise.image_path,
    imageFile: null,
    sets: exercise.gym_exercise_sets
      .slice()
      .sort((a, b) => a.set_number - b.set_number)
      .map((set) => ({ clientId: set.id, weightKg: String(set.weight_kg), reps: String(set.reps) })),
  };
}

function exercisesForRpc(exercises: Exercise[]) {
  return exercises.map((exercise, index) => ({
    name: exercise.name,
    image_path: exercise.image_path,
    sort_order: index,
    sets: exercise.gym_exercise_sets.map((set, setIndex) => ({
      set_number: setIndex + 1,
      weight_kg: set.weight_kg,
      reps: set.reps,
    })),
  }));
}

export default function WorkoutApp() {
  const [session, setSession] = useState<ForgeSession | null>(null);
  const sessionRef = useRef<ForgeSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<RoutineDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);

  const selectedRoutine = useMemo(
    () => routines.find((routine) => routine.id === selectedId) ?? null,
    [routines, selectedId],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    rememberSession(null);
    setSession(null);
    setRoutines([]);
    setSelectedId(null);
    setEditorOpen(false);
    setDraft(null);
    setMobileMenu(false);
    setLoadError('');
    setToast(null);
  }, []);

  const handleError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Koneksi gagal. Silakan coba lagi.';
    if (error instanceof ApiError && error.status === 401) {
      clearSession();
      setAuthError(message);
    } else showToast(message);
    return message;
  }, [clearSession, showToast]);

  const loadRoutines = useCallback(async (token: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await apiRequest<RoutinesResponse>('/routines', { token });
      if (sessionRef.current?.session_token !== token) return;
      setRoutines(data.routines.map(normalizeRoutine));
      setLoadError('');
    } catch (error) {
      if (sessionRef.current?.session_token !== token) return;
      setLoadError(handleError(error));
      throw error;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    let controller: AbortController;
    async function restore() {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const saved = readSession();
      setAuthReady(false);
      sessionRef.current = null;
      setSession(null);
      setRoutines([]);
      setEditorOpen(false);
      setDraft(null);
      setSelectedId(null);
      setMobileMenu(false);
      if (saved && isSupabaseConfigured) {
        try {
          const data = await apiRequest<RoutinesResponse>('/routines', { token: saved.session_token, signal });
          if (signal.aborted) return;
          const verified = { ...saved, user: data.user };
          sessionRef.current = verified;
          setSession(verified);
          setRoutines(data.routines.map(normalizeRoutine));
          setAuthError('');
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof ApiError && error.status === 401) rememberSession(null);
          setAuthError(error instanceof Error ? error.message : 'Sesi belum dapat diperiksa. Silakan masuk kembali.');
        }
      }
      if (!signal.aborted) setAuthReady(true);
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === sessionStorageKey || event.key === null) void restore();
    };
    void restore();
    window.addEventListener('storage', onStorage);
    return () => { controller?.abort(); window.removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    if (!session) return;
    // Refresh signed image links; the database remains the source of truth.
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadRoutines(session.session_token, true).catch(() => {});
    };
    const timer = window.setInterval(refresh, 20 * 60 * 1000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [session, loadRoutines]);

  async function onAuthenticated(nextSession: ForgeSession) {
    sessionRef.current = nextSession;
    rememberSession(nextSession);
    setSession(nextSession);
    setAuthError('');
    await loadRoutines(nextSession.session_token).catch(() => {});
  }

  async function signOut() {
    if (!session) return;
    try {
      await apiRequest('/logout', { method: 'POST', token: session.session_token });
      clearSession();
    } catch (error) { handleError(error); }
  }

  function openNewRoutine() {
    setDraft(emptyDraft());
    setEditorOpen(true);
  }

  function openEditRoutine(routine: Routine) {
    setDraft(draftFromRoutine(routine));
    setEditorOpen(true);
  }

  async function uploadImage(exercise: DraftExercise, routineId: string) {
    if (!exercise.imageFile) return { image_path: exercise.imagePath, image_url: exercise.imageUrl };
    if (!session) throw new ApiError('Silakan masuk kembali.', 401);
    if (exercise.imageFile.size > 5 * 1024 * 1024) throw new Error('Ukuran foto maksimal 5 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(exercise.imageFile.type)) {
      throw new Error('Gunakan foto JPEG, PNG, atau WebP.');
    }
    const body = new FormData();
    body.append('routine_id', routineId);
    body.append('file', exercise.imageFile);
    return apiRequest<{ image_path: string; image_url: string }>('/images', {
      method: 'POST', token: session.session_token, body,
    });
  }

  async function saveRoutine(event: FormEvent) {
    event.preventDefault();
    if (!session || !draft || !draft.name.trim()) return showToast('Nama routine wajib diisi.');
    if (draft.exercises.some((exercise) => !exercise.name.trim())) return showToast('Isi nama setiap exercise yang ditambahkan.');
    setSaving(true);
    try {
      const routineId = draft.id ?? uid();
      const exercisePayload = draft.id ? undefined : await Promise.all(
        draft.exercises.map(async (exercise) => ({
          name: exercise.name.trim(),
          image_path: (await uploadImage(exercise, routineId)).image_path,
          sets: exercise.sets.map((set) => ({ weight_kg: parseWeight(set.weightKg), reps: Number(set.reps) || 0 })),
        })),
      );
      await apiRequest('/routines', {
        method: draft.id ? 'PATCH' : 'POST', token: session.session_token,
        body: { id: routineId, name: draft.name.trim(), training_day: draft.trainingDay.trim(), note: draft.note.trim(), exercises: exercisePayload },
      });
      setEditorOpen(false);
      setDraft(null);
      await loadRoutines(session.session_token);
      showToast(draft.id ? 'Routine berhasil diperbarui.' : 'Routine baru berhasil dibuat.');
    } catch (error) { handleError(error); }
    finally { setSaving(false); }
  }

  async function saveExercise(routine: Routine, exerciseDraft: DraftExercise, exerciseId: string | null) {
    if (!session) return false;
    if (!exerciseDraft.name.trim()) { showToast('Nama exercise wajib diisi.'); return false; }
    if (!exerciseDraft.sets.length) { showToast('Tambahkan minimal satu set.'); return false; }
    try {
      const image = await uploadImage(exerciseDraft, routine.id);
      const previous = routine.gym_exercises.find((exercise) => exercise.id === exerciseId);
      const nextExercise: Exercise = {
        id: exerciseId ?? uid(), name: exerciseDraft.name.trim(), ...image,
        sort_order: previous?.sort_order ?? routine.gym_exercises.length,
        gym_exercise_sets: exerciseDraft.sets.map((set, index) => ({
          id: previous?.gym_exercise_sets[index]?.id ?? uid(), set_number: index + 1,
          weight_kg: parseWeight(set.weightKg), reps: Number(set.reps) || 0,
        })),
      };
      const nextExercises = exerciseId
        ? routine.gym_exercises.map((exercise) => exercise.id === exerciseId ? nextExercise : exercise)
        : [...routine.gym_exercises, nextExercise];
      await apiRequest('/routines', {
        method: 'PUT', token: session.session_token,
        body: { id: routine.id, exercises: exercisesForRpc(nextExercises) },
      });
      setRoutines((current) => current.map((item) => item.id === routine.id ? { ...item, gym_exercises: nextExercises } : item));
      await loadRoutines(session.session_token).catch(() => {});
      showToast(exerciseId ? 'Exercise berhasil diperbarui.' : 'Exercise baru berhasil ditambahkan.');
      return true;
    } catch (error) { handleError(error); return false; }
  }

  async function deleteExercise(routine: Routine, exercise: Exercise) {
    if (!session || !window.confirm('Hapus exercise “' + exercise.name + '”?')) return false;
    try {
      const nextExercises = routine.gym_exercises.filter((item) => item.id !== exercise.id);
      await apiRequest('/routines', {
        method: 'PUT', token: session.session_token,
        body: { id: routine.id, exercises: exercisesForRpc(nextExercises) },
      });
      setRoutines((current) => current.map((item) => item.id === routine.id ? { ...item, gym_exercises: nextExercises } : item));
      await loadRoutines(session.session_token).catch(() => {});
      showToast('Exercise telah dihapus.');
      return true;
    } catch (error) { handleError(error); return false; }
  }

  async function deleteRoutine(routine: Routine) {
    if (!session || !window.confirm('Hapus routine “' + routine.name + '”?')) return;
    try {
      await apiRequest('/routines', { method: 'DELETE', token: session.session_token, body: { id: routine.id } });
      setRoutines((current) => current.filter((item) => item.id !== routine.id));
      setSelectedId(null);
      showToast('Routine telah dihapus.');
    } catch (error) { handleError(error); }
  }

  if (!authReady) return <div className="full-loader"><LoaderCircle className="spin" size={26} /><span>Menyiapkan Forge...</span></div>;
  if (!session) return <AuthScreen onAuthenticated={onAuthenticated} initialError={authError} />;

  return (
    <main className="app-shell">
      <Sidebar open={mobileMenu} onClose={() => setMobileMenu(false)} onSignOut={signOut} />
      <section className="content">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label="Buka menu"><Menu size={20} /></button>
          <div><p className="eyebrow">WORKOUT</p><h1>{selectedRoutine ? selectedRoutine.name : 'Ready to get stronger?'}</h1></div>
          <div className="profile-chip"><div className="avatar">RA</div><div><strong>{session.user.name}</strong><span>Keep showing up</span></div></div>
        </header>
        {loadError && <div className="connection-error" role="alert"><span>{loadError}</span><button className="secondary-button" onClick={() => void loadRoutines(session.session_token).catch(() => {})}>Coba lagi</button></div>}
        {selectedRoutine ? (
          <RoutineDetail key={selectedRoutine.id} routine={selectedRoutine} onBack={() => setSelectedId(null)} onEditInfo={() => openEditRoutine(selectedRoutine)} onDelete={() => deleteRoutine(selectedRoutine)} onSaveExercise={saveExercise} onDeleteExercise={deleteExercise} />
        ) : (
          <RoutineOverview routines={routines} loading={loading} onCreate={openNewRoutine} onOpen={setSelectedId} />
        )}
      </section>
      {editorOpen && draft && <RoutineEditor draft={draft} setDraft={setDraft} saving={saving} onClose={() => setEditorOpen(false)} onSave={saveRoutine} />}
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </main>
  );
}

function Sidebar({ open, onClose, onSignOut }: { open: boolean; onClose: () => void; onSignOut: () => void }) {
  return (
    <>
      {open && <button className="menu-overlay" onClick={onClose} aria-label="Tutup menu" />}
      <aside className={'sidebar ' + (open ? 'open' : '')}>
        <div className="brand"><span className="brand-mark"><Dumbbell size={19} /></span><span>FORGE</span></div>
        <nav><button className="active" onClick={onClose}><Dumbbell size={19} /><span>Workout</span></button></nav>
        <div className="sidebar-bottom"><button onClick={onSignOut}><LogOut size={18} /><span>Keluar</span></button></div>
      </aside>
    </>
  );
}

function RoutineOverview({ routines, loading, onCreate, onOpen }: { routines: Routine[]; loading: boolean; onCreate: () => void; onOpen: (id: string) => void }) {
  const exerciseCount = routines.reduce((total, routine) => total + routine.gym_exercises.length, 0);
  const setCount = routines.reduce((total, routine) => total + routine.gym_exercises.reduce((sum, exercise) => sum + exercise.gym_exercise_sets.length, 0), 0);

  return (
    <>
      <section className="metrics-row">
        <article><span>ROUTINES</span><strong>{String(routines.length).padStart(2, '0')}</strong><small>program aktif</small></article>
        <article><span>EXERCISES</span><strong>{String(exerciseCount).padStart(2, '0')}</strong><small>gerakan tersimpan</small></article>
        <article><span>TOTAL SETS</span><strong>{String(setCount).padStart(2, '0')}</strong><small>siap dilatih</small></article>
      </section>

      <div className="section-head">
        <div><p className="eyebrow">MY TRAINING</p><h2>Routines</h2></div>
        <button className="new-button" onClick={onCreate}><Plus size={18} /><span>New routine</span></button>
      </div>

      {loading ? (
        <div className="routine-grid">{[1, 2, 3].map((item) => <div className="routine-card skeleton" key={item} />)}</div>
      ) : (
        <div className="routine-grid">
          {routines.map((routine, index) => (
            <article className="routine-card" key={routine.id}>
              <div className={`routine-icon tone-${index % 3}`}><Dumbbell size={22} /></div>
              <span className="day">{routine.training_day || 'Fleksibel'}</span>
              <h3>{routine.name}</h3>
              <p>{routine.gym_exercises.length ? routine.gym_exercises.map((exercise) => exercise.name).join(', ') : 'Belum ada exercise'}</p>
              <div className="card-footer">
                <span>{routine.gym_exercises.length} exercise · {routine.gym_exercises.reduce((sum, exercise) => sum + exercise.gym_exercise_sets.length, 0)} sets</span>
                <button onClick={() => onOpen(routine.id)}>Open <ArrowUpRight size={14} /></button>
              </div>
            </article>
          ))}
          <button className="add-card" onClick={onCreate}><span><Plus size={22} /></span><strong>Buat routine baru</strong><small>Susun latihan sesuai targetmu</small></button>
        </div>
      )}
    </>
  );
}

function RoutineDetail({
  routine,
  onBack,
  onEditInfo,
  onDelete,
  onSaveExercise,
  onDeleteExercise,
}: {
  routine: Routine;
  onBack: () => void;
  onEditInfo: () => void;
  onDelete: () => void;
  onSaveExercise: (routine: Routine, draft: DraftExercise, exerciseId: string | null) => Promise<boolean>;
  onDeleteExercise: (routine: Routine, exercise: Exercise) => Promise<boolean>;
}) {
  const [menuExerciseId, setMenuExerciseId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ exerciseId: string | null; draft: DraftExercise } | null>(null);
  const [savingExercise, setSavingExercise] = useState(false);
  const totalSets = routine.gym_exercises.reduce((sum, exercise) => sum + exercise.gym_exercise_sets.length, 0);
  const totalVolume = routine.gym_exercises.reduce((sum, exercise) => sum + exercise.gym_exercise_sets.reduce((sub, set) => sub + set.weight_kg * set.reps, 0), 0);

  async function commitExercise() {
    if (!editing) return;
    setSavingExercise(true);
    const saved = await onSaveExercise(routine, editing.draft, editing.exerciseId);
    setSavingExercise(false);
    if (saved) setEditing(null);
  }

  async function removeExercise(exercise: Exercise) {
    setMenuExerciseId(null);
    await onDeleteExercise(routine, exercise);
  }

  return (
    <section className="detail-view">
      <div className="detail-actions">
        <button className="back-button" onClick={onBack}><ArrowLeft size={18} /> Semua routine</button>
        <div><button className="icon-action" onClick={onEditInfo} aria-label="Edit deskripsi routine"><Pencil size={17} /></button><button className="icon-action danger" onClick={onDelete} aria-label="Hapus routine"><Trash2 size={17} /></button></div>
      </div>

      <div className="detail-stats">
        <article><span>EXERCISE</span><strong>{routine.gym_exercises.length}</strong></article>
        <article><span>TOTAL SET</span><strong>{totalSets}</strong></article>
        <article><span>EST. VOLUME</span><strong>{totalVolume.toLocaleString('id-ID')} <small>kg</small></strong></article>
      </div>

      <div className="exercise-heading"><div><p className="eyebrow">ROUTINE PLAN</p><h2>Exercises</h2></div><button onClick={() => { setEditing({ exerciseId: null, draft: newExercise() }); setMenuExerciseId(null); }} disabled={Boolean(editing)}><Plus size={15} /> Add exercise</button></div>

      <div className="exercise-list">
        {routine.gym_exercises.map((exercise, index) => editing?.exerciseId === exercise.id ? (
          <ExerciseEditCard key={exercise.id} draft={editing.draft} index={index} saving={savingExercise} onChange={(draft) => setEditing({ exerciseId: exercise.id, draft })} onSave={commitExercise} onCancel={() => setEditing(null)} />
        ) : (
          <article className="exercise-card" key={exercise.id}>
            <div className="exercise-title">
              <div className="exercise-image">
                {exercise.image_url ? <img src={exercise.image_url} alt={exercise.name} /> : <Dumbbell size={24} />}
              </div>
              <div><span>EXERCISE {String(index + 1).padStart(2, '0')}</span><h3>{exercise.name}</h3></div>
              <div className="exercise-menu-wrap">
                <button className="exercise-menu-trigger" onClick={() => setMenuExerciseId((current) => current === exercise.id ? null : exercise.id)} aria-label={`Menu ${exercise.name}`} aria-expanded={menuExerciseId === exercise.id}><MoreHorizontal size={20} /></button>
                {menuExerciseId === exercise.id && (
                  <div className="exercise-menu">
                    <button onClick={() => { setEditing({ exerciseId: exercise.id, draft: exerciseToDraft(exercise) }); setMenuExerciseId(null); }}><Pencil size={14} /> Edit</button>
                    <button className="danger" onClick={() => removeExercise(exercise)}><Trash2 size={14} /> Hapus</button>
                  </div>
                )}
              </div>
            </div>
            <div className="sets-table">
              <div className="set-row set-header"><span>SET</span><span>KG</span><span>REPS</span></div>
              {exercise.gym_exercise_sets.map((set) => (
                <div className="set-row" key={set.id}>
                  <span>{set.set_number}</span><span>{set.weight_kg}</span><span>{set.reps}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
        {editing?.exerciseId === null && <ExerciseEditCard draft={editing.draft} index={routine.gym_exercises.length} saving={savingExercise} onChange={(draft) => setEditing({ exerciseId: null, draft })} onSave={commitExercise} onCancel={() => setEditing(null)} />}
        {!routine.gym_exercises.length && !editing && <div className="empty-state"><Dumbbell size={28} /><h3>Belum ada exercise</h3><p>Tekan Add exercise untuk menambahkan gerakan pertama.</p></div>}
      </div>
    </section>
  );
}

function ExerciseEditCard({ draft, index, saving, onChange, onSave, onCancel }: { draft: DraftExercise; index: number; saving: boolean; onChange: (draft: DraftExercise) => void; onSave: () => void; onCancel: () => void }) {
  function updateSet(setIndex: number, changes: Partial<DraftSet>) {
    onChange({ ...draft, sets: draft.sets.map((set, currentIndex) => currentIndex === setIndex ? { ...set, ...changes } : set) });
  }

  return (
    <article className="exercise-card exercise-edit-card">
      <div className="inline-editor-label"><span>{draft.clientId && draft.name ? 'EDIT EXERCISE' : 'NEW EXERCISE'}</span><strong>Exercise {String(index + 1).padStart(2, '0')}</strong></div>
      <div className="draft-exercise-top">
        <label className="image-picker">
          {draft.imageFile ? <img src={URL.createObjectURL(draft.imageFile)} alt="Preview exercise" /> : draft.imageUrl ? <img src={draft.imageUrl} alt="Preview exercise" /> : <><ImagePlus size={22} /><small>Add photo</small></>}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange({ ...draft, imageFile: event.target.files?.[0] ?? null })} />
        </label>
        <label className="field exercise-name"><span>Nama exercise</span><input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Nama gerakan" autoFocus /></label>
      </div>
      <div className="draft-set-header"><span>SET</span><span>KG</span><span>REPS</span><span /></div>
      {draft.sets.map((set, setIndex) => (
        <div className="draft-set-row" key={set.clientId}>
          <strong>{setIndex + 1}</strong>
          <input type="text" inputMode="decimal" pattern="[0-9]+([,.][0-9]+)?" value={set.weightKg} onChange={(event) => updateSet(setIndex, { weightKg: event.target.value })} placeholder="0 atau 2,5" aria-label={`Berat set ${setIndex + 1}`} />
          <input type="number" inputMode="numeric" min="0" step="1" value={set.reps} onChange={(event) => updateSet(setIndex, { reps: event.target.value })} placeholder="10" aria-label={`Repetisi set ${setIndex + 1}`} />
          <button type="button" onClick={() => onChange({ ...draft, sets: draft.sets.filter((_, currentIndex) => currentIndex !== setIndex) })} aria-label={`Hapus set ${setIndex + 1}`}><X size={15} /></button>
        </div>
      ))}
      <button type="button" className="add-set" onClick={() => onChange({ ...draft, sets: [...draft.sets, newSet(draft.sets.length)] })}><Plus size={15} /> Add set</button>
      <div className="inline-editor-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="button" className="primary-button" onClick={onSave} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? 'Menyimpan...' : 'Save exercise'}</button></div>
    </article>
  );
}

function RoutineEditor({ draft, setDraft, saving, onClose, onSave }: { draft: RoutineDraft; setDraft: (draft: RoutineDraft) => void; saving: boolean; onClose: () => void; onSave: (event: FormEvent) => void }) {
  function updateExercise(exerciseIndex: number, changes: Partial<DraftExercise>) {
    setDraft({ ...draft, exercises: draft.exercises.map((exercise, index) => index === exerciseIndex ? { ...exercise, ...changes } : exercise) });
  }

  function updateSet(exerciseIndex: number, setIndex: number, changes: Partial<DraftSet>) {
    const exercise = draft.exercises[exerciseIndex];
    updateExercise(exerciseIndex, { sets: exercise.sets.map((set, index) => index === setIndex ? { ...set, ...changes } : set) });
  }

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-label={draft.id ? 'Edit routine' : 'Routine baru'}>
      <button className="modal-backdrop" onClick={onClose} aria-label="Tutup" />
      <form className="editor" onSubmit={onSave}>
        <header><div><p className="eyebrow">{draft.id ? 'ROUTINE DETAILS' : 'ROUTINE BUILDER'}</p><h2>{draft.id ? 'Edit deskripsi routine' : 'Routine baru'}</h2></div><button type="button" className="close-button" onClick={onClose}><X size={20} /></button></header>
        <div className="editor-body">
          <div className="form-grid">
            <label className="field wide"><span>Nama routine</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Contoh: Chest + Back" autoFocus /></label>
            <label className="field">
              <span>Hari latihan</span>
              <select value={draft.trainingDay} onChange={(event) => setDraft({ ...draft, trainingDay: event.target.value })}>
                <option value="">Pilih hari</option>
                {/* Preserve older custom values until the user chooses a day. */}
                {draft.trainingDay && !trainingDays.includes(draft.trainingDay) && <option value={draft.trainingDay} disabled>{draft.trainingDay} (tersimpan)</option>}
                {trainingDays.map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
            </label>
            <label className="field"><span>Catatan</span><input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Target atau fokus latihan" /></label>
          </div>

          {!draft.id && <>
            <div className="editor-section-title"><div><span>EXERCISES</span><strong>{draft.exercises.length} gerakan</strong></div><button type="button" onClick={() => setDraft({ ...draft, exercises: [...draft.exercises, newExercise()] })}><Plus size={16} /> Add exercise</button></div>

            <div className="draft-exercises">
              {!draft.exercises.length && (
                <div className="editor-empty">
                  <Dumbbell size={21} />
                  <div><strong>Belum ada exercise</strong><span>Tekan Add exercise untuk menambahkan gerakan pertama.</span></div>
                </div>
              )}
              {draft.exercises.map((exercise, exerciseIndex) => (
                <article className="draft-exercise" key={exercise.clientId}>
                  <div className="draft-exercise-top">
                    <label className="image-picker">
                      {exercise.imageFile ? <img src={URL.createObjectURL(exercise.imageFile)} alt="Preview exercise" /> : exercise.imageUrl ? <img src={exercise.imageUrl} alt="Preview exercise" /> : <><ImagePlus size={22} /><small>Add photo</small></>}
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => updateExercise(exerciseIndex, { imageFile: event.target.files?.[0] ?? null })} />
                    </label>
                    <label className="field exercise-name"><span>Exercise {String(exerciseIndex + 1).padStart(2, '0')}</span><input value={exercise.name} onChange={(event) => updateExercise(exerciseIndex, { name: event.target.value })} placeholder="Nama gerakan" /></label>
                    <button type="button" className="remove-exercise" onClick={() => setDraft({ ...draft, exercises: draft.exercises.filter((_, index) => index !== exerciseIndex) })} aria-label="Hapus exercise"><Trash2 size={17} /></button>
                  </div>
                  <div className="draft-set-header"><span>SET</span><span>KG</span><span>REPS</span><span /> </div>
                  {exercise.sets.map((set, setIndex) => (
                    <div className="draft-set-row" key={set.clientId}>
                      <strong>{setIndex + 1}</strong>
                      <input type="text" inputMode="decimal" pattern="[0-9]+([,.][0-9]+)?" value={set.weightKg} onChange={(event) => updateSet(exerciseIndex, setIndex, { weightKg: event.target.value })} placeholder="0 atau 2,5" aria-label={`Berat set ${setIndex + 1}`} />
                      <input type="number" inputMode="numeric" min="0" step="1" value={set.reps} onChange={(event) => updateSet(exerciseIndex, setIndex, { reps: event.target.value })} placeholder="10" aria-label={`Repetisi set ${setIndex + 1}`} />
                      <button type="button" onClick={() => updateExercise(exerciseIndex, { sets: exercise.sets.filter((_, index) => index !== setIndex) })} aria-label={`Hapus set ${setIndex + 1}`}><X size={15} /></button>
                    </div>
                  ))}
                  <button type="button" className="add-set" onClick={() => updateExercise(exerciseIndex, { sets: [...exercise.sets, newSet(exercise.sets.length)] })}><Plus size={15} /> Add set</button>
                </article>
              ))}
            </div>
          </>}
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? 'Menyimpan...' : 'Save routine'}</button></footer>
      </form>
    </div>
  );
}

function AuthScreen({ onAuthenticated, initialError }: { onAuthenticated: (session: ForgeSession) => Promise<void>; initialError: string }) {
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [visible, setVisible] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !isSupabaseConfigured) return;
    setBusy(true);
    setError('');
    try {
      const nextSession = await apiRequest<ForgeSession>('/login', { method: 'POST', body: { secret_key: secretKey } });
      setSecretKey('');
      await onAuthenticated(nextSession);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Tidak dapat masuk. Coba lagi.');
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel"><div className="auth-brand"><span><Dumbbell size={21} /></span>FORGE</div><div><p>BUILD. TRACK. REPEAT.</p><h1>Strength is<br />earned here.</h1><span>Bangun routine yang konsisten, catat setiap set, dan jadikan progresmu terlihat.</span></div><small>YOUR PERSONAL TRAINING LOG</small></section>
      <section className="auth-form-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-icon"><CircleUserRound size={24} /></div>
          <p className="eyebrow">WELCOME BACK, RAFI</p><h2>Masuk ke Forge</h2><p className="auth-subtitle">Gunakan secret key untuk membuka workout kamu.</p>
          <div className="auth-account"><div className="avatar">RA</div><div><strong>Rafi</strong><span>Akun pribadi</span></div></div>
          {!isSupabaseConfigured && <p className="auth-error" role="alert">Koneksi Supabase belum dikonfigurasi. Tambahkan konfigurasi database di pengaturan deployment.</p>}
          <input type="text" name="username" autoComplete="username" value="Rafi" readOnly hidden />
          <label className="field"><span>Secret key</span><input name="password" type={visible ? 'text' : 'password'} value={secretKey} onChange={(event) => setSecretKey(event.target.value)} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Masukkan secret key" required maxLength={72} disabled={busy} aria-describedby={error ? 'login-error' : undefined} /></label>
          <button type="button" className="secret-toggle" onClick={() => setVisible(!visible)} aria-pressed={visible}>{visible ? 'Sembunyikan secret key' : 'Tampilkan secret key'}</button>
          {error && <p id="login-error" className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" disabled={busy || !isSupabaseConfigured}>{busy ? <LoaderCircle className="spin" size={18} /> : 'Masuk ke Forge'}<ChevronRight size={18} /></button>
          <p className="auth-footnote">Khusus akun Rafi. Tidak ada pendaftaran akun baru.</p>
        </form>
      </section>
    </main>
  );
}
