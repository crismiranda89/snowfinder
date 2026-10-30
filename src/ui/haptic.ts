// A short buzz on taps that change something, where the phone allows it (Android browsers; iPhones don't let
// web pages vibrate, so there it does nothing). Respects "reduce motion".
export function haptic(pattern: number | number[] = 10) {
  try {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Browsers only allow it after a real tap on the page; before that the call is refused (and logged).
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === false) return;
    navigator.vibrate?.(pattern);
  } catch { /* not supported */ }
}
