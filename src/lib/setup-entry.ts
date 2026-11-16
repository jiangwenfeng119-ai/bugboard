/** Where /setup should send the visitor. Null means the first-run form stays. */
export function setupPageRedirect(
  setupComplete: boolean,
  signedIn: boolean
): "/projects" | "/login" | null {
  if (!setupComplete) return null;
  return signedIn ? "/projects" : "/login";
}
