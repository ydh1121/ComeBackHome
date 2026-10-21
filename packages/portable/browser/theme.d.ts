export interface ThemeConfig { storageKey: string; changeEvent: string; preferenceEvent: string; colors: { light: string; dark: string }; }
export function installTheme(config: ThemeConfig): () => void;
