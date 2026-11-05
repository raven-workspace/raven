/**
 * Clipboard writes. A secret (or a command carrying one) goes through `copySecret` so Raven can wipe it
 * when the vault locks; anything else goes through `copyPlain`, which forgets a pending secret because
 * the clipboard no longer holds it.
 */
let holdsSecret = false;

export async function copySecret(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  holdsSecret = true;
}

export async function copyPlain(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  holdsSecret = false;
}

/** Empties the clipboard only if the last Raven copy was a secret. */
export async function clearSecretClipboard(): Promise<void> {
  if (!holdsSecret) return;
  holdsSecret = false;
  await navigator.clipboard.writeText("");
}
