/**
 * Plays a relaxing chime sound using the Web Audio API.
 * Uses a C major chord (C5, E5, G5) with staggered timing for a pleasant effect.
 */
export function playRelaxChime(audioCtx: AudioContext): void {
  const playTone = (freq: number, startTime: number, duration: number) => {
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = "sine";
    oscillator.frequency.value = freq;

    // Gentle fade in and out
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  };

  const now = audioCtx.currentTime;

  // C major chord
  playTone(523.25, now, 1.5); // C5
  playTone(659.25, now + 0.1, 1.4); // E5
  playTone(783.99, now + 0.2, 1.3); // G5
}
