/**
 * Copies text, also where the Clipboard API is unavailable - it needs a
 * secure context, and a barangay hall may open the app over plain http on
 * the local network.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* permission refused: fall through to the older route */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const done = document.execCommand('copy');
    ta.remove();
    return done;
  } catch {
    return false;
  }
}
