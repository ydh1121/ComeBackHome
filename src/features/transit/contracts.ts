import type { TransitAccessFilter } from '../../application/contracts/actions';
export interface TransitAccessViewState { filter: TransitAccessFilter; loading: boolean; errorMessage?: string; noResults: boolean; }
