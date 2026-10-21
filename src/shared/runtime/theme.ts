import { createThemePreferenceBinding } from '../../../packages/portable/react/theme';
import config from '../../config/theme.json';
export type { ThemePreference } from '../../../packages/portable/react/theme';
export const { useThemePreference, setThemePreference } = createThemePreferenceBinding(config);
