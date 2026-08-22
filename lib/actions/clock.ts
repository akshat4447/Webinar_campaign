'use server';

/**
 * Reads the wall clock on the server so components can compare against "now"
 * without calling Date.now() during render — which React's purity rule forbids
 * and which would mismatch between the server and client renders.
 */
export async function getServerNow(): Promise<number> {
  return Date.now();
}
