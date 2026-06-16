/*
 * Spanish text-to-speech for the consent reader (spec 5.1 Screen C, 9.1).
 * Uses the offline Web Speech API (SpeechSynthesis). Picks a Spanish voice if
 * the Windows machine has one installed; otherwise requests es-MX/es-ES locale.
 */

function pickSpanishVoice() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (!voices || !voices.length) return null;
  // Prefer Mexican Spanish, then any Spanish.
  return (
    voices.find((v) => /es[-_]MX/i.test(v.lang)) ||
    voices.find((v) => /^es/i.test(v.lang)) ||
    null
  );
}

export const tts = {
  supported() { return 'speechSynthesis' in window; },

  speak(text, { onend } = {}) {
    if (!this.supported()) return false;
    this.stop();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-MX';
    u.rate = 0.95;
    const v = pickSpanishVoice();
    if (v) u.voice = v;
    if (onend) u.onend = onend;
    window.speechSynthesis.speak(u);
    return true;
  },

  stop() {
    if (this.supported()) window.speechSynthesis.cancel();
  },

  speaking() {
    return this.supported() && window.speechSynthesis.speaking;
  }
};

// Some platforms load voices asynchronously.
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => { /* warm the voice list */ window.speechSynthesis.getVoices(); };
}
