import { useCallback, useEffect, useState } from "react";
import { useSnapshot } from "valtio";

import {
  DEFAULT_SETTINGS,
  PERSISTED_KEYS,
  type Settings,
  settings,
} from "~/components/texture-tool/store";

const SETTINGS_KEY = "sl-texanim:settings:v1";

export function useSettingsPersistence() {
  const [hydrated, setHydrated] = useState(false);

  const applySettings = useCallback((next: Partial<Settings>) => {
    for (const k of PERSISTED_KEYS) {
      (settings[k] as Settings[typeof k]) = (next[k] ?? DEFAULT_SETTINGS[k]) as Settings[typeof k];
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) applySettings(JSON.parse(raw) as Partial<Settings>);
    } catch {}
    setHydrated(true);
  }, [applySettings]);

  const snap = useSnapshot(settings);
  useEffect(() => {
    if (!hydrated) return;
    const payload = Object.fromEntries(PERSISTED_KEYS.map((k) => [k, snap[k]])) as Settings;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
    } catch {}
  }, [hydrated, snap]);

  const resetSettings = useCallback(() => {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch {}
    applySettings(DEFAULT_SETTINGS);
  }, [applySettings]);

  return { hydrated, resetSettings };
}
