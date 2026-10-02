import { useSyncExternalStore } from 'react';
import { getAppPreferences, subscribeAppPreferences } from './appPreferences';

export function useAppPreferences() {
  return useSyncExternalStore(subscribeAppPreferences, getAppPreferences, getAppPreferences);
}
