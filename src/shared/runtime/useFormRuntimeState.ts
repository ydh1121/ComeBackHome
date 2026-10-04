import { useState } from 'react';

export type FormRuntimeState = 'CLEAN' | 'DIRTY' | 'SAVING' | 'SAVED' | 'ERROR';

export function useFormRuntimeState(initial: FormRuntimeState = 'CLEAN') {
  const [state, setState] = useState<FormRuntimeState>(initial);

  return {
    state,
    markDirty() {
      setState((current) => current === 'SAVING' ? current : 'DIRTY');
    },
    async save<T>(operation: () => Promise<T>): Promise<T> {
      setState('SAVING');
      try {
        const result = await operation();
        setState('SAVED');
        return result;
      } catch (error) {
        setState('ERROR');
        throw error;
      }
    },
  };
}
