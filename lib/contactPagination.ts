import type { Prisma } from '@/lib/generated/prisma/client';

export const CONTACT_PAGE_SIZE = 50;
export function contactQuery(raw?: string | string[]) {
  return (Array.isArray(raw) ? raw[0] : raw ?? '').trim().slice(0, 160);
}
export function contactPage(raw: string | string[] | undefined, total: number) {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  const page = Number.isSafeInteger(value) && value > 0 ? value : 1;
  return Math.min(page, Math.max(1, Math.ceil(total / CONTACT_PAGE_SIZE)));
}
export function contactSearch(q: string): Prisma.ContactWhereInput {
  return q ? { OR: ['name','email','account','title'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {};
}
