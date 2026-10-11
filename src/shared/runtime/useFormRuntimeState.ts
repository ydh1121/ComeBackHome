import { useRef, useState } from 'react';

export type FormRuntimeState = 'CLEAN' | 'DIRTY' | 'SAVING' | 'SAVED' | 'ERROR';

export function useFormRuntimeState(initial: FormRuntimeState = 'CLEAN') {
  const [state, setState] = useState<FormRuntimeState>(initial);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  return {
    state,
    error,
    markDirty() {
      setError(null);
      setState((current) => current === 'SAVING' ? current : 'DIRTY');
    },
    async save<T>(operation: () => Promise<T>): Promise<T> {
      if (pending.current) throw new Error('SAVE_ALREADY_IN_PROGRESS');
      pending.current = true;
      setError(null);
      setState('SAVING');
      try {
        const result = await operation();
        setState('SAVED');
        return result;
      } catch (error) {
        setState('ERROR');
        setError(error instanceof Error ? error.message : '저장 요청이 실패했습니다.');
        throw error;
      } finally {
        pending.current = false;
      }
    },
  };
}
