// Pure. Collapses near-identical attention items (the same failure raised once per contact) into one
// card so a 9-contact failure reads as one problem, not nine.

export interface AttentionLike {
  id: string;
  icon: string;
  color: string;
  title: string;
  detail: string;
  actionsCsv: string;
}

export interface AttentionGroup<T extends AttentionLike = AttentionLike> {
  key: string;
  title: string;
  items: T[];
  first: T;
}

function charPrefix(strs: string[]): string {
  let p = strs[0];
  for (const t of strs.slice(1)) {
    let i = 0;
    while (i < p.length && i < t.length && p[i] === t[i]) i++;
    p = p.slice(0, i);
  }
  return p;
}

// "Send failed for A" / "Send failed for B" keeps "Send failed for " (cut back to a word boundary).
function commonPrefix(titles: string[]): string {
  const p = charPrefix(titles);
  const sp = p.lastIndexOf(' ');
  return sp >= 0 ? p.slice(0, sp + 1) : '';
}

// " skipped — sent the template" survives; a half word at the join does not.
function commonSuffix(titles: string[]): string {
  const rev = (s: string) => [...s].reverse().join('');
  const suffix = rev(charPrefix(titles.map(rev)));
  const sp = suffix.indexOf(' ');
  return sp >= 0 ? suffix.slice(sp) : '';
}

export function groupAttentionItems<T extends AttentionLike>(items: T[]): AttentionGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const key = [it.color, it.actionsCsv, it.detail.trim().toLowerCase()].join('|');
    const list = buckets.get(key);
    if (list) list.push(it);
    else buckets.set(key, [it]);
  }
  return [...buckets.entries()].map(([key, list]) => {
    if (list.length === 1) return { key, title: list[0].title, items: list, first: list[0] };
    const titles = list.map((i) => i.title);
    const prefix = commonPrefix(titles);
    const suffix = commonSuffix(titles);
    const title = prefix || suffix ? `${prefix}${list.length} contacts${suffix}` : `${titles[0]} (+${list.length - 1} similar)`;
    return { key, title, items: list, first: list[0] };
  });
}
