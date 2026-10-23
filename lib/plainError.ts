// Pure. What a person should read when something threw: the sentence, without the class name JavaScript puts in front of it
// ("ZoomError: Zoom is not connected." becomes "Zoom is not connected.").

export function plainError(err: unknown, fallback = 'Something went wrong.'): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const text = raw.replace(/^(?:[A-Z][A-Za-z]*Error|Error):\s*/, '').trim();
  return text || fallback;
}
