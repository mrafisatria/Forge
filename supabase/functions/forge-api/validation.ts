export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError('Format data tidak valid.', 400);
  return value as Record<string, unknown>;
}

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError('ID tidak valid.', 400);
  }
  return value.toLowerCase();
}

function text(value: unknown, label: string, max: number, required = false): string | null {
  if (value !== null && value !== undefined && typeof value !== 'string') throw new HttpError(`${label} tidak valid.`, 400);
  const result = typeof value === 'string' ? value.trim() : '';
  if (result.length > max || (required && !result)) throw new HttpError(`${label} wajib diisi, maksimal ${max} karakter.`, 400);
  return result || null;
}

export function metadata(body: Record<string, unknown>) {
  return { name: text(body.name, 'Nama routine', 100, true)!, training_day: text(body.training_day, 'Hari latihan', 40), note: text(body.note, 'Catatan', 1000) };
}

export function imagePath(value: unknown, owner: string, routineId: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const prefix = `${owner}/`;
  if (typeof value !== 'string' || !value.startsWith(prefix) || !/^(library|[0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp|mp4)$/.test(value.slice(prefix.length))) {
    throw new HttpError('Media tidak berasal dari akun ini.', 400);
  }
  const [folder, file] = value.slice(prefix.length).split('/');
  if (folder !== 'library') uuid(folder);
  uuid(file.split('.')[0]);
  void routineId; // Retain the legacy validator signature for existing callers.
  return value;
}

function numeric(value: unknown, label: string, max: number, integer: boolean) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) {
    throw new HttpError(`${label} tidak valid.`, 400);
  }
  if (!integer && Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new HttpError('Beban maksimal dua angka desimal.', 400);
  return value;
}

export function exercises(value: unknown, owner: string, routineId: string) {
  if (!Array.isArray(value) || value.length > 100) throw new HttpError('Maksimal 100 exercise per routine.', 400);
  return value.map((entry, index) => {
    const item = object(entry);
    if (!Array.isArray(item.sets) || item.sets.length < 1 || item.sets.length > 100) throw new HttpError('Setiap exercise harus memiliki 1–100 set.', 400);
    return {
      name: text(item.name, 'Nama exercise', 120, true)!,
      image_path: imagePath(item.image_path, owner, routineId), sort_order: index,
      sets: item.sets.map((entry, setIndex) => {
        const set = object(entry);
        return { set_number: setIndex + 1, weight_kg: numeric(set.weight_kg, 'Beban', 999999.99, false), reps: numeric(set.reps, 'Repetisi', 10000, true) };
      }),
    };
  });
}

export function secret(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value.trim()).length > 72) throw new HttpError('Secret key tidak dikenali.', 401);
  return value.trim();
}

export async function imageExtension(file: File) {
  if (!file.size || file.size > 5 * 1024 * 1024) throw new HttpError('Ukuran foto harus 1 byte–5 MB.', 400);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (file.type === 'image/png' && [137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte)) return 'png';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (file.type === 'image/webp' && ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') return 'webp';
  throw new HttpError('Gunakan file foto JPEG, PNG, atau WebP yang valid.', 400);
}
