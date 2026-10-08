export interface SpeakerInput {
  id?: string;
  name: string;
  title?: string | null;
  company?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  linkedinUrl?: string | null;
  isPrimary?: boolean;
  order?: number;
}

/** Formats speakers into a conversational summary: "Dr. Sarah Chen & Alex Rivera" */
export function formatSpeakersSummary(speakers: Array<{ name: string }>): string {
  if (!speakers || speakers.length === 0) return '';
  const names = speakers.map((s) => s.name.trim()).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** Formats a structured speaker/panel roster for Claude prompts */
export function formatSpeakersPromptBlock(
  speakers: Array<{
    name: string;
    title?: string | null;
    company?: string | null;
    bio?: string | null;
    isPrimary?: boolean;
  }>
): string {
  if (!speakers || speakers.length === 0) return '';
  const lines = speakers.map((s) => {
    const roleParts = [s.title?.trim(), s.company?.trim()].filter(Boolean);
    const affiliation = roleParts.length > 0 ? ` (${roleParts.join(' at ')})` : '';
    const tag = s.isPrimary ? ' [Keynote / Primary]' : '';
    const bioText = s.bio?.trim() ? ` — ${s.bio.trim()}` : '';
    return `• ${s.name.trim()}${affiliation}${tag}${bioText}`;
  });
  return `FEATURED SPEAKERS & PANEL:\n${lines.join('\n')}`;
}
