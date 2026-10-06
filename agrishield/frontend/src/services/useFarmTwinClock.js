import { useSyncExternalStore } from 'react';
import { getFarmNow, millisecondsUntilNextMinute } from '../components/farmTwinGeometry';

let currentTime = getFarmNow();
let timerId = null;
const subscribers = new Set();

function publishTime() {
  currentTime = getFarmNow();
  subscribers.forEach((subscriber) => subscriber());
  scheduleNextMinute();
}

function scheduleNextMinute() {
  if (timerId !== null) window.clearTimeout(timerId);
  timerId = null;
  if (!subscribers.size || document.visibilityState !== 'visible') return;
  timerId = window.setTimeout(publishTime, millisecondsUntilNextMinute(currentTime.getTime()));
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') publishTime();
  else if (timerId !== null) {
    window.clearTimeout(timerId);
    timerId = null;
  }
}

function subscribe(subscriber) {
  const wasEmpty = subscribers.size === 0;
  subscribers.add(subscriber);
  if (wasEmpty) {
    window.addEventListener('focus', publishTime);
    window.addEventListener('pageshow', publishTime);
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  publishTime();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size) return;
    if (timerId !== null) window.clearTimeout(timerId);
    timerId = null;
    window.removeEventListener('focus', publishTime);
    window.removeEventListener('pageshow', publishTime);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

function getSnapshot() {
  return currentTime;
}

export function useFarmTwinClock() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
