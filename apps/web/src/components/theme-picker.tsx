'use client';

import { useSyncExternalStore } from 'react';
import { ChevronDown, Moon, Sun, SunMoon } from 'lucide-react';
import { themeStorageKey } from '../lib/theme';

type Theme = 'system' | 'light' | 'dark';
function applyTheme(value: string | null) {
  if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}
function currentTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return value === 'light' || value === 'dark' ? value : 'system';
}
function subscribe(notify: () => void) {
  // Catch changes from another tab while the session screen was still loading.
  try { applyTheme(localStorage.getItem(themeStorageKey)); } catch { /* Keep the current appearance when storage is unavailable. */ }
  function storage(event: StorageEvent) {
    if (event.key !== themeStorageKey && event.key !== null) return;
    applyTheme(event.newValue); notify();
  }
  window.addEventListener('storage', storage);
  window.addEventListener('blok:theme-change', notify);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener('blok:theme-change', notify);
  };
}
export function ThemePicker() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'system' as const);
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : SunMoon;
  return <label className="theme-picker">
    <Icon aria-hidden="true" /><span className="sr-only">Appearance</span>
    <select value={theme} onChange={event => {
      const value = event.target.value;
      applyTheme(value);
      try { localStorage.setItem(themeStorageKey, value); } catch { /* Keep the choice for this page if storage is unavailable. */ }
      window.dispatchEvent(new Event('blok:theme-change'));
    }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select><ChevronDown className="theme-picker-chevron" aria-hidden="true" />
  </label>;
}
