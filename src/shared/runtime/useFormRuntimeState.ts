import { useFormRuntimeState as usePortableFormState, type FormRuntimeState } from '../../../packages/portable/react/useFormRuntimeState';
export type { FormRuntimeState } from '../../../packages/portable/react/useFormRuntimeState';
export function useFormRuntimeState(initial: FormRuntimeState = 'CLEAN') {
  return usePortableFormState(initial, '저장 요청이 실패했습니다.');
}
