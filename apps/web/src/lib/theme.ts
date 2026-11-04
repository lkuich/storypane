import { readMigratedStorage } from './storage-migration';

export const themeStorageKey = 'storypane:theme';
export const themeInitialization = `try{const theme=(${readMigratedStorage.toString()})(localStorage,${JSON.stringify(themeStorageKey)});if(theme==='light'||theme==='dark'){document.documentElement.dataset.theme=theme;}}catch{}`;
