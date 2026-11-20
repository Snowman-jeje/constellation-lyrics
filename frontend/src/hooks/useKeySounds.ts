import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauriRuntime, safeListen } from '../store/tauriBridge';
import type { BuddyMood, KeyProfileKind, KeyPulseEvent } from '../types/suite';

export interface UseKeySoundsOptions {
  enabled: boolean;
  profile: KeyProfileKind;
  volume: number;
  release: boolean;
  buddyEnabled: boolean;
}

export interface KeySoundsState {
  wpm: number;
  peakWpm: number;
  mood: BuddyMood;
  lastPulseAt: number;
  celebrate: () => void;
}

function classifyDomKey(e: KeyboardEvent): KeyPulseEvent['kind'] {
  if (e.code === 'Space') return 'space';
  if (
    e.code === 'Enter' ||
    e.code === 'Backspace' ||
    e.code === 'Tab' ||
    e.code.startsWith('Shift') ||
    e.code.startsWith('Control') ||
    e.code.startsWith('Alt')
  ) {
    return 'wide';
  }
  return 'letter';
}

function createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    const env = Math.exp((-i / sampleCount) * 4.5);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  return buffer;
}

function synthesizeKeyClick(
  ctx: AudioContext,
  noiseBuffer: AudioBuffer,
  profile: KeyProfileKind,
  kind: KeyPulseEvent['kind'],
  down: boolean,
  volume: number,
) {
  const gainLevel = Math.max(0, Math.min(1, volume)) * (down ? 1 : 0.42);
  if (gainLevel <= 0.005) return;

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(gainLevel * 0.48, now);
  master.connect(ctx.destination);

  const pitchMult = kind === 'space' ? 0.72 : kind === 'wide' ? 0.84 : 0.96 + Math.random() * 0.08;
  const phaseMult = down ? 1.0 : 1.32;

  // Noise transient burst
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  const noiseGain = ctx.createGain();

  // Body oscillator resonance
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();

  if (profile === 'tactile') {
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1650 * pitchMult * phaseMult, now);
    filter.Q.setValueAtTime(2.4, now);
    noiseGain.gain.setValueAtTime(0.65, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + (down ? 0.028 : 0.018));

    osc.type = 'triangle';
    osc.frequency.setValueAtTime((down ? 520 : 690) * pitchMult, now);
    osc.frequency.exponentialRampToValueAtTime(150 * pitchMult, now + 0.026);
    oscGain.gain.setValueAtTime(down ? 0.45 : 0.18, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);
  } else if (profile === 'office') {
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(760 * pitchMult * phaseMult, now);
    noiseGain.gain.setValueAtTime(0.38, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);

    osc.type = 'sine';
    osc.frequency.setValueAtTime((down ? 240 : 310) * pitchMult, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.025);
    oscGain.gain.setValueAtTime(down ? 0.35 : 0.14, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.026);
  } else if (profile === 'thocky') {
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(480 * pitchMult * phaseMult, now);
    filter.Q.setValueAtTime(1.8, now);
    noiseGain.gain.setValueAtTime(0.45, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.036);

    osc.type = 'sine';
    osc.frequency.setValueAtTime((down ? 175 : 225) * pitchMult, now);
    osc.frequency.exponentialRampToValueAtTime(72, now + 0.042);
    oscGain.gain.setValueAtTime(down ? 0.72 : 0.25, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
  } else {
    // typewriter
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1900 * pitchMult, now);
    noiseGain.gain.setValueAtTime(0.8, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + (down ? 0.032 : 0.02));

    osc.type = 'square';
    osc.frequency.setValueAtTime((down ? 1120 : 1480) * pitchMult, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.022);
    oscGain.gain.setValueAtTime(down ? 0.26 : 0.12, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.024);
  }

  noiseSrc.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(master);

  osc.connect(oscGain);
  oscGain.connect(master);

  noiseSrc.start(now);
  noiseSrc.stop(now + 0.05);
  osc.start(now);
  osc.stop(now + 0.055);
}

export function useKeySounds(options: UseKeySoundsOptions): KeySoundsState {
  const [wpm, setWpm] = useState(0);
  const [peakWpm, setPeakWpm] = useState(0);
  const [mood, setMood] = useState<BuddyMood>('resting');
  const [lastPulseAt, setLastPulseAt] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const noiseBufferRef = useRef<AudioBuffer | null>(null);
  const timestampsRef = useRef<number[]>([]);
  const peakRef = useRef(0);
  const celebratingUntilRef = useRef(0);
  const lastNativePulseRef = useRef(0);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const ensureAudio = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioCtx();
      noiseBufferRef.current = createNoiseBuffer(audioCtxRef.current, 0.055);
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const updateMoodFromWpm = useCallback((nextWpm: number, now: number) => {
    setWpm(nextWpm);
    let hitRecord = false;
    if (nextWpm > peakRef.current && nextWpm >= 45) {
      peakRef.current = nextWpm;
      setPeakWpm(nextWpm);
      hitRecord = true;
    }

    if (now < celebratingUntilRef.current) {
      setMood('celebrating');
      return;
    }
    if (nextWpm <= 0) {
      setMood('resting');
    } else if (hitRecord || nextWpm >= 90) {
      setMood('record');
    } else if (nextWpm >= 45) {
      setMood('fast');
    } else {
      setMood('typing');
    }
  }, []);

  const handlePulse = useCallback(
    (pulse: KeyPulseEvent, fromNative: boolean) => {
      const cfg = optionsRef.current;
      if (!cfg.enabled && !cfg.buddyEnabled) return;

      const now = Date.now();
      if (fromNative) {
        lastNativePulseRef.current = now;
      }

      if (pulse.down) {
        setLastPulseAt(now);
      }

      if (cfg.enabled && (pulse.down || cfg.release)) {
        const ctx = ensureAudio();
        if (ctx && noiseBufferRef.current) {
          synthesizeKeyClick(
            ctx,
            noiseBufferRef.current,
            cfg.profile,
            pulse.kind,
            pulse.down,
            cfg.volume,
          );
        }
      }

      if (pulse.down) {
        let computedWpm = pulse.wpm;
        if (!fromNative || computedWpm <= 0) {
          const cutoff = now - 6000;
          timestampsRef.current = timestampsRef.current.filter((t) => t >= cutoff);
          timestampsRef.current.push(now);
          const count = timestampsRef.current.length;
          const spanSec =
            count >= 2
              ? Math.max(1.2, (now - timestampsRef.current[0]) / 1000)
              : 2.0;
          computedWpm = Math.round((count / 5) * (60 / spanSec));
        }

        if (computedWpm >= 110 && celebratingUntilRef.current < now) {
          celebratingUntilRef.current = now + 1800;
        }
        updateMoodFromWpm(computedWpm, now);
      }
    },
    [ensureAudio, updateMoodFromWpm],
  );

  const celebrate = useCallback(() => {
    celebratingUntilRef.current = Date.now() + 2400;
    setMood('celebrating');
  }, []);

  // Native Tauri key-pulse listener + window keyboard fallback
  useEffect(() => {
    const active = options.enabled || options.buddyEnabled;
    if (!active) {
      setWpm(0);
      setMood('resting');
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    if (isTauriRuntime()) {
      void safeListen<KeyPulseEvent>('key-pulse', (payload) => {
        if (!cancelled) handlePulse(payload, true);
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (Date.now() - lastNativePulseRef.current < 1500) return;
      handlePulse({ kind: classifyDomKey(e), down: true, wpm: 0 }, false);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!optionsRef.current.release) return;
      if (Date.now() - lastNativePulseRef.current < 1500) return;
      handlePulse({ kind: classifyDomKey(e), down: false, wpm: 0 }, false);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);

    const decayTimer = window.setInterval(() => {
      const now = Date.now();
      const cutoff = now - 6000;
      timestampsRef.current = timestampsRef.current.filter((t) => t >= cutoff);
      const idleMs = now - (timestampsRef.current[timestampsRef.current.length - 1] ?? 0);

      if (idleMs > 3200 && now - lastNativePulseRef.current > 3200) {
        updateMoodFromWpm(0, now);
      } else if (timestampsRef.current.length > 0 && now - lastNativePulseRef.current > 1500) {
        const nextWpm = Math.round((timestampsRef.current.length / 5) * 10);
        updateMoodFromWpm(nextWpm, now);
      }
    }, 600);

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.clearInterval(decayTimer);
    };
  }, [options.enabled, options.buddyEnabled, handlePulse, updateMoodFromWpm]);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    wpm,
    peakWpm,
    mood,
    lastPulseAt,
    celebrate,
  };
}
