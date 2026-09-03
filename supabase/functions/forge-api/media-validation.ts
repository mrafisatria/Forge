import { HttpError, imageExtension } from './validation.ts';

export const VIDEO_LIMIT = 10 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 10;

// Read bounded ISO-BMFF boxes, never trusting client-supplied duration metadata.
export function mp4Duration(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  const invalid = () => new HttpError('Video MP4 tidak valid. Gunakan MP4 standar berdurasi maksimal 10 detik.', 400);
  type Box = { type: string; start: number; end: number };
  function boxes(start: number, end: number): Box[] {
    const result: Box[] = [];
    while (start < end) {
      if (end - start < 8 || result.length > 10000) throw invalid();
      let size = view.getUint32(start), header = 8;
      if (size === 1) {
        if (end - start < 16) throw invalid();
        size = Number(view.getBigUint64(start + 8)); header = 16;
      } else if (size === 0) size = end - start;
      if (!Number.isSafeInteger(size) || size < header || start + size > end) throw invalid();
      result.push({ type: ascii(start + 4, 4), start: start + header, end: start + size });
      start += size;
    }
    return result;
  }
  function duration(box: Box | undefined) {
    if (!box || box.end - box.start < 20) throw invalid();
    const version = bytes[box.start];
    if (version > 1 || box.end - box.start < (version === 1 ? 32 : 20)) throw invalid();
    const scale = view.getUint32(box.start + (version === 1 ? 20 : 12));
    const ticks = version === 1 ? Number(view.getBigUint64(box.start + 24)) : view.getUint32(box.start + 16);
    if (!scale || !Number.isSafeInteger(ticks) || ticks <= 0) throw invalid();
    return ticks / scale;
  }
  const top = boxes(0, bytes.length);
  const ftyp = top.find((box) => box.type === 'ftyp');
  const moov = top.find((box) => box.type === 'moov');
  if (!ftyp || ftyp.end - ftyp.start < 8 || !moov || !top.some((box) => box.type === 'mdat' && box.end > box.start)) throw invalid();
  const brands = [];
  for (let pos = ftyp.start; pos + 4 <= ftyp.end; pos += 4) if (pos !== ftyp.start + 4) brands.push(ascii(pos, 4));
  if (!brands.some((brand) => ['isom', 'iso2', 'mp41', 'mp42', 'avc1'].includes(brand))) throw invalid();
  const movie = boxes(moov.start, moov.end);
  if (movie.some((box) => box.type === 'mvex')) throw invalid();
  const durations = [duration(movie.find((box) => box.type === 'mvhd'))];
  let video = false;
  for (const track of movie.filter((box) => box.type === 'trak')) {
    const mdia = boxes(track.start, track.end).find((box) => box.type === 'mdia');
    if (!mdia) throw invalid();
    const media = boxes(mdia.start, mdia.end);
    durations.push(duration(media.find((box) => box.type === 'mdhd')));
    const handler = media.find((box) => box.type === 'hdlr');
    if (handler && handler.end - handler.start >= 12 && ascii(handler.start + 8, 4) === 'vide') video = true;
  }
  if (!video) throw invalid();
  const seconds = Math.max(...durations);
  if (seconds > MAX_VIDEO_SECONDS) throw new HttpError('Video maksimal 10 detik. Potong video terlebih dahulu sebelum upload.', 400);
  return seconds;
}

export async function validateMedia(file: File) {
  if (file.type !== 'video/mp4') return { extension: await imageExtension(file), kind: 'image' as const, duration: null };
  if (!file.size || file.size > VIDEO_LIMIT) throw new HttpError('Ukuran video maksimal 10 MB.', 400);
  return { extension: 'mp4', kind: 'video' as const, duration: mp4Duration(new Uint8Array(await file.arrayBuffer())) };
}
