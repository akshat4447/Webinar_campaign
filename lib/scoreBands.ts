/**
 * Score bands, shared by the Audience page (which renders the distribution and
 * filters by band) and the CSV export action (which must reproduce the exact
 * same filter server-side). Two independent copies of these ranges would drift
 * and make "Export all matching" quietly disagree with the table on screen.
 *
 * Ranges are half-open and contiguous so every scored contact lands in exactly
 * one — overlapping bands would double-count the distribution.
 */
export interface ScoreBandDef {
  id: string;
  label: string;
  min: number;
  max: number;
  color: string;
}

export const SCORE_BANDS: ScoreBandDef[] = [
  { id: 'high', label: 'High 85+', min: 85, max: 101, color: 'var(--success-500)' },
  { id: 'good', label: 'Good 70–84', min: 70, max: 85, color: 'var(--accent-500)' },
  { id: 'low', label: 'Below 70', min: -1, max: 70, color: 'var(--n40)' },
];

export function findScoreBand(id: string | null | undefined): ScoreBandDef | undefined {
  if (!id || id === 'all') return undefined;
  return SCORE_BANDS.find((b) => b.id === id);
}
