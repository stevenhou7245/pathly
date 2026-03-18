export type SoundKey =
  | "click"
  | "complete"
  | "unlock"
  | "error"
  | "notification"
  | "failure";

const SOUND_SRC: Record<SoundKey, string> = {
  click: "/sounds/click.wav",
  complete: "/sounds/complete.wav",
  unlock: "/sounds/unlock.wav",
  error: "/sounds/error.wav",
  notification: "/sounds/notification.wav",
  failure: "/sounds/failure.wav",
};

const DEFAULT_VOLUME = 0.3;

let soundEffectsEnabled = true;
const audioPool = new Map<SoundKey, HTMLAudioElement>();

function canUseAudio() {
  return typeof window !== "undefined" && typeof Audio !== "undefined";
}

function getAudio(key: SoundKey) {
  const cached = audioPool.get(key);
  if (cached) {
    return cached;
  }

  if (!canUseAudio()) {
    return null;
  }

  const audio = new Audio(SOUND_SRC[key]);
  audio.preload = "auto";
  audio.volume = DEFAULT_VOLUME;
  audioPool.set(key, audio);
  return audio;
}

export function setSoundEffectsEnabled(enabled: boolean) {
  soundEffectsEnabled = enabled;
}

export function areSoundEffectsEnabled() {
  return soundEffectsEnabled;
}

export function playSound(key: SoundKey, options?: { volume?: number }) {
  if (!soundEffectsEnabled) {
    return;
  }

  const audio = getAudio(key);
  if (!audio) {
    return;
  }

  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = options?.volume ?? DEFAULT_VOLUME;
    const maybePromise = audio.play();
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {
        // Ignore playback errors (autoplay policy / device constraints).
      });
    }
  } catch {
    // Ignore playback errors.
  }
}
