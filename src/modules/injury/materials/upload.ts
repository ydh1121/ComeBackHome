import { ApiError, privateRequest } from '../../auth/client';
import { documentError } from './model';
const base = 'private/case/documents';
type Offset = { offset: number; complete: boolean };

/** One original at a time: retain resumable server identity and verify before success. */
export async function uploadOriginal(file: File, signal: AbortSignal, progress: (value: number) => void): Promise<string> {
  const invalid = documentError(file);
  if (invalid) throw Error(invalid);
  signal.throwIfAborted();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), v => v.toString(16).padStart(2,'0')).join('');
  signal.throwIfAborted();
  const item = await privateRequest<{id:string;status:string}>(base,'POST',{filename:file.name,mime:file.type,bytes:file.size,sha256:hash},signal);
  if (item.status === 'trashed') throw Error('같은 원본이 숨긴 자료에 있어요. 먼저 복원해 주세요.');
  if (item.status !== 'ready') {
    let state = await privateRequest<Offset>(base+'/'+item.id+'/upload','POST',{},signal);
    const check = (s: Offset) => {
      if (!Number.isSafeInteger(s.offset) || s.offset < 0 || s.offset > file.size || typeof s.complete !== 'boolean' || (s.complete && s.offset !== file.size)) throw Error('전송 상태를 확인하지 못했어요. 다시 시도해 주세요.');
    };
    check(state);
    while (!state.complete) {
      signal.throwIfAborted();
      const response = await fetch('/api/'+base+'/'+item.id+'/upload?offset='+state.offset,{
        method:'PUT',headers:{'Content-Type':file.type},body:file.slice(state.offset,Math.min(state.offset+1024*1024,file.size)),credentials:'same-origin',cache:'no-store',signal,
      });
      const result = await response.json();
      if (!response.ok) throw new ApiError(result.error,response.status);
      check(result);
      if (result.offset <= state.offset) throw Error('전송이 멈췄어요. 다시 시도하면 이어서 보관합니다.');
      state=result;
      progress(Math.round(state.offset/file.size*95));
    }
  }
  // Duplicate ready files are reverified too; cached metadata is not integrity evidence.
  await privateRequest(base+'/'+item.id+'/verify','POST',{},signal);
  progress(100);
  return item.id;
}
