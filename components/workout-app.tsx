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
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { DraftExercise, DraftSet, Routine, RoutineDraft } from '@/lib/types';

const uid = () => crypto.randomUUID();

const demoRoutines: Routine[] = [
  {
    id: 'demo-upper',
    name: 'Upper Body Power',
    training_day: 'Senin',
    note: 'Fokus pada kekuatan dada dan punggung.',
    created_at: new Date().toISOString(),
    gym_exercises: [
      {
        id: 'demo-bench',
        name: 'Incline Chest Press',
        image_url: null,
        sort_order: 0,
        gym_exercise_sets: [
          { id: 'set-1', set_number: 1, weight_kg: 20, reps: 10 },
          { id: 'set-2', set_number: 2, weight_kg: 20, reps: 10 },
          { id: 'set-3', set_number: 3, weight_kg: 20, reps: 10 },
          { id: 'set-4', set_number: 4, weight_kg: 15, reps: 12 },
        ],
      },
      {
        id: 'demo-row',
        name: 'Iso-Lateral Row',
        image_url: null,
        sort_order: 1,
        gym_exercise_sets: [
          { id: 'set-5', set_number: 1, weight_kg: 25, reps: 10 },
          { id: 'set-6', set_number: 2, weight_kg: 25, reps: 10 },
          { id: 'set-7', set_number: 3, weight_kg: 22.5, reps: 12 },
        ],
      },
    ],
  },
  {
    id: 'demo-legs',
    name: 'Leg Day Strength',
    training_day: 'Rabu',
    note: 'Compound lift dan aksesori kaki.',
    created_at: new Date().toISOString(),
    gym_exercises: [
      {
        id: 'demo-squat',
        name: 'Barbell Squat',
        image_url: null,
        sort_order: 0,
        gym_exercise_sets: [
          { id: 'set-8', set_number: 1, weight_kg: 40, reps: 8 },
          { id: 'set-9', set_number: 2, weight_kg: 40, reps: 8 },
          { id: 'set-10', set_number: 3, weight_kg: 35, reps: 10 },
        ],
      },
    ],
  },
  {
    id: 'demo-arms',
    name: 'Arms & Shoulders',
    training_day: 'Jumat',
    note: 'Volume ringan menjelang akhir minggu.',
    created_at: new Date().toISOString(),
    gym_exercises: [
      {
        id: 'demo-curl',
        name: 'Dumbbell Curl',
        image_url: null,
        sort_order: 0,
        gym_exercise_sets: [
          { id: 'set-11', set_number: 1, weight_kg: 10, reps: 12 },
          { id: 'set-12', set_number: 2, weight_kg: 10, reps: 12 },
          { id: 'set-13', set_number: 3, weight_kg: 8, reps: 15 },
        ],
      },
    ],
  },
];

function newSet(index: number): DraftSet {
  return { clientId: uid(), weightKg: '', reps: index === 0 ? '10' : '' };
}

function newExercise(): DraftExercise {
  return {
    clientId: uid(),
    name: '',
    imageUrl: null,
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
    trainingDay: routine.training_day ?? '',
    note: routine.note ?? '',
    exercises: routine.gym_exercises
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((exercise) => ({
        clientId: exercise.id,
        name: exercise.name,
        imageUrl: exercise.image_url,
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

function initials(email?: string) {
  if (!email) return 'MR';
  return email.slice(0, 2).toUpperCase();
}

export default function WorkoutApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [routines, setRoutines] = useState<Routine[]>(isSupabaseConfigured ? [] : demoRoutines);
  const [loading, setLoading] = useState(isSupabaseConfigured);
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
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const loadRoutines = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;

    setLoading(true);
    const { data, error } = await supabase
      .from('gym_routines')
      .select('id,name,training_day,note,created_at,gym_exercises(id,name,image_url,sort_order,gym_exercise_sets(id,set_number,weight_kg,reps))')
      .order('created_at', { ascending: false });

    if (error) showToast(`Gagal mengambil routine: ${error.message}`);
    else setRoutines(((data ?? []) as unknown as Routine[]).map(normalizeRoutine));
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
      if (data.session?.user) loadRoutines();
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
      if (session?.user) loadRoutines();
      else setRoutines([]);
    });

    return () => listener.subscription.unsubscribe();
  }, [loadRoutines]);

  function openNewRoutine() {
    setDraft(emptyDraft());
    setEditorOpen(true);
  }

  function openEditRoutine(routine: Routine) {
    setDraft(draftFromRoutine(routine));
    setEditorOpen(true);
  }

  async function uploadImage(exercise: DraftExercise, routineId: string) {
    if (!exercise.imageFile) return exercise.imageUrl;
    const supabase = getSupabase();
    if (!supabase || !user) return URL.createObjectURL(exercise.imageFile);

    const extension = exercise.imageFile.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filePath = `${user.id}/${routineId}/${uid()}.${extension}`;
    const { error } = await supabase.storage.from('forge-exercise-images').upload(filePath, exercise.imageFile, {
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw error;
    return supabase.storage.from('forge-exercise-images').getPublicUrl(filePath).data.publicUrl;
  }

  async function saveRoutine(event: FormEvent) {
    event.preventDefault();
    if (!draft || !draft.name.trim()) return showToast('Nama routine wajib diisi.');
    if (!draft.exercises.length || draft.exercises.some((exercise) => !exercise.name.trim())) {
      return showToast('Tambahkan minimal satu exercise dan isi namanya.');
    }

    setSaving(true);
    try {
      const routineId = draft.id ?? uid();
      const exercisePayload = await Promise.all(
        draft.exercises.map(async (exercise, index) => ({
          name: exercise.name.trim(),
          image_url: await uploadImage(exercise, routineId),
          sort_order: index,
          sets: exercise.sets.map((set, setIndex) => ({
            set_number: setIndex + 1,
            weight_kg: Number(set.weightKg) || 0,
            reps: Number(set.reps) || 0,
          })),
        })),
      );

      const supabase = getSupabase();
      if (supabase && user) {
        const { error } = await supabase.rpc('save_gym_routine', {
          p_routine_id: routineId,
          p_name: draft.name.trim(),
          p_training_day: draft.trainingDay.trim() || null,
          p_note: draft.note.trim() || null,
          p_exercises: exercisePayload,
        });
        if (error) throw error;
        await loadRoutines();
      } else {
        const localRoutine: Routine = {
          id: routineId,
          name: draft.name.trim(),
          training_day: draft.trainingDay.trim() || null,
          note: draft.note.trim() || null,
          created_at: draft.id ? routines.find((item) => item.id === draft.id)?.created_at ?? new Date().toISOString() : new Date().toISOString(),
          gym_exercises: exercisePayload.map((exercise, index) => ({
            id: uid(),
            name: exercise.name,
            image_url: exercise.image_url,
            sort_order: index,
            gym_exercise_sets: exercise.sets.map((set) => ({ id: uid(), ...set })),
          })),
        };
        setRoutines((current) => [localRoutine, ...current.filter((item) => item.id !== draft.id)]);
      }

      setEditorOpen(false);
      setDraft(null);
      showToast(draft.id ? 'Routine berhasil diperbarui.' : 'Routine baru berhasil dibuat.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Routine gagal disimpan.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteRoutine(routine: Routine) {
    if (!window.confirm(`Hapus routine “${routine.name}”?`)) return;
    const supabase = getSupabase();
    if (supabase && user) {
      const { error } = await supabase.from('gym_routines').delete().eq('id', routine.id);
      if (error) return showToast(error.message);
    }
    setRoutines((current) => current.filter((item) => item.id !== routine.id));
    setSelectedId(null);
    showToast('Routine telah dihapus.');
  }

  if (!authReady) {
    return <div className="full-loader"><LoaderCircle className="spin" size={26} /><span>Menyiapkan Forge...</span></div>;
  }

  if (isSupabaseConfigured && !user) return <AuthScreen onToast={showToast} />;

  return (
    <main className="app-shell">
      <Sidebar user={user} open={mobileMenu} onClose={() => setMobileMenu(false)} />

      <section className="content">
        {!isSupabaseConfigured && (
          <div className="setup-banner"><Sparkles size={16} /><span><strong>Mode demo.</strong> Hubungkan Supabase agar routine tersimpan dan sinkron di semua perangkat.</span></div>
        )}

        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label="Buka menu"><Menu size={20} /></button>
          <div>
            <p className="eyebrow">WORKOUT</p>
            <h1>{selectedRoutine ? selectedRoutine.name : 'Ready to get stronger?'}</h1>
          </div>
          <div className="profile-chip"><div className="avatar">{initials(user?.email)}</div><div><strong>{user?.email?.split('@')[0] ?? 'Demo athlete'}</strong><span>Keep showing up</span></div></div>
        </header>

        {selectedRoutine ? (
          <RoutineDetail routine={selectedRoutine} onBack={() => setSelectedId(null)} onEdit={() => openEditRoutine(selectedRoutine)} onDelete={() => deleteRoutine(selectedRoutine)} />
        ) : (
          <RoutineOverview routines={routines} loading={loading} onCreate={openNewRoutine} onOpen={setSelectedId} />
        )}
      </section>

      {editorOpen && draft && (
        <RoutineEditor draft={draft} setDraft={setDraft} saving={saving} onClose={() => setEditorOpen(false)} onSave={saveRoutine} />
      )}

      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </main>
  );
}

function Sidebar({ user, open, onClose }: { user: User | null; open: boolean; onClose: () => void }) {
  async function signOut() {
    await getSupabase()?.auth.signOut();
  }

  return (
    <>
      {open && <button className="menu-overlay" onClick={onClose} aria-label="Tutup menu" />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark"><Dumbbell size={19} /></span><span>FORGE</span></div>
        <nav>
          <button className="active"><Dumbbell size={19} /><span>Workout</span></button>
        </nav>
        {user && <div className="sidebar-bottom"><button onClick={signOut}><LogOut size={18} /><span>Keluar</span></button></div>}
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

function RoutineDetail({ routine, onBack, onEdit, onDelete }: { routine: Routine; onBack: () => void; onEdit: () => void; onDelete: () => void }) {
  const totalSets = routine.gym_exercises.reduce((sum, exercise) => sum + exercise.gym_exercise_sets.length, 0);
  const totalVolume = routine.gym_exercises.reduce((sum, exercise) => sum + exercise.gym_exercise_sets.reduce((sub, set) => sub + set.weight_kg * set.reps, 0), 0);

  return (
    <section className="detail-view">
      <div className="detail-actions">
        <button className="back-button" onClick={onBack}><ArrowLeft size={18} /> Semua routine</button>
        <div><button className="icon-action" onClick={onEdit} aria-label="Edit routine"><Pencil size={17} /></button><button className="icon-action danger" onClick={onDelete} aria-label="Hapus routine"><Trash2 size={17} /></button></div>
      </div>

      <div className="detail-stats">
        <article><span>EXERCISE</span><strong>{routine.gym_exercises.length}</strong></article>
        <article><span>TOTAL SET</span><strong>{totalSets}</strong></article>
        <article><span>EST. VOLUME</span><strong>{totalVolume.toLocaleString('id-ID')} <small>kg</small></strong></article>
      </div>

      <div className="exercise-heading"><div><p className="eyebrow">ROUTINE PLAN</p><h2>Exercises</h2></div><button onClick={onEdit}><Pencil size={15} /> Edit routine</button></div>

      <div className="exercise-list">
        {routine.gym_exercises.map((exercise, index) => (
          <article className="exercise-card" key={exercise.id}>
            <div className="exercise-title">
              <div className="exercise-image">
                {exercise.image_url ? <img src={exercise.image_url} alt={exercise.name} /> : <Dumbbell size={24} />}
              </div>
              <div><span>EXERCISE {String(index + 1).padStart(2, '0')}</span><h3>{exercise.name}</h3></div>
              <MoreHorizontal size={20} />
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
        {!routine.gym_exercises.length && <div className="empty-state"><Dumbbell size={28} /><h3>Belum ada exercise</h3><p>Edit routine untuk menambahkan gerakan.</p></div>}
      </div>
    </section>
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
        <header><div><p className="eyebrow">ROUTINE BUILDER</p><h2>{draft.id ? 'Edit routine' : 'Routine baru'}</h2></div><button type="button" className="close-button" onClick={onClose}><X size={20} /></button></header>
        <div className="editor-body">
          <div className="form-grid">
            <label className="field wide"><span>Nama routine</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Contoh: Chest + Back" autoFocus /></label>
            <label className="field"><span>Hari latihan</span><input value={draft.trainingDay} onChange={(event) => setDraft({ ...draft, trainingDay: event.target.value })} placeholder="Contoh: Senin" /></label>
            <label className="field"><span>Catatan</span><input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Target atau fokus latihan" /></label>
          </div>

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
                    <input type="number" inputMode="decimal" min="0" step="0.25" value={set.weightKg} onChange={(event) => updateSet(exerciseIndex, setIndex, { weightKg: event.target.value })} placeholder="0" aria-label={`Berat set ${setIndex + 1}`} />
                    <input type="number" inputMode="numeric" min="0" step="1" value={set.reps} onChange={(event) => updateSet(exerciseIndex, setIndex, { reps: event.target.value })} placeholder="10" aria-label={`Repetisi set ${setIndex + 1}`} />
                    <button type="button" onClick={() => updateExercise(exerciseIndex, { sets: exercise.sets.filter((_, index) => index !== setIndex) })} aria-label={`Hapus set ${setIndex + 1}`}><X size={15} /></button>
                  </div>
                ))}
                <button type="button" className="add-set" onClick={() => updateExercise(exerciseIndex, { sets: [...exercise.sets, newSet(exercise.sets.length)] })}><Plus size={15} /> Add set</button>
              </article>
            ))}
          </div>
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? 'Menyimpan...' : 'Save routine'}</button></footer>
      </form>
    </div>
  );
}

function AuthScreen({ onToast }: { onToast: (message: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;
    setBusy(true);
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (result.error) onToast(result.error.message);
    else if (mode === 'register' && !result.data.session) onToast('Cek email untuk konfirmasi akun, lalu masuk kembali.');
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel"><div className="auth-brand"><span><Dumbbell size={21} /></span>FORGE</div><div><p>BUILD. TRACK. REPEAT.</p><h1>Strength is<br />earned here.</h1><span>Bangun routine yang konsisten, catat setiap set, dan jadikan progresmu terlihat.</span></div><small>YOUR PERSONAL TRAINING LOG</small></section>
      <section className="auth-form-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-icon"><CircleUserRound size={24} /></div>
          <p className="eyebrow">WELCOME TO FORGE</p><h2>{mode === 'login' ? 'Masuk ke akunmu' : 'Mulai perjalananmu'}</h2><p className="auth-subtitle">Routine kamu tersimpan aman dan selalu sinkron.</p>
          <div className="auth-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Masuk</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Daftar</button></div>
          <label className="field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="kamu@email.com" required /></label>
          <label className="field"><span>Password</span><input type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Minimal 6 karakter" required /></label>
          <button className="auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : mode === 'login' ? 'Masuk ke Forge' : 'Buat akun'}<ChevronRight size={18} /></button>
        </form>
      </section>
    </main>
  );
}
