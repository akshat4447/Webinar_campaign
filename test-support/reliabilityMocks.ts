/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
export function addReliabilityMocks(db: any) {
  const model = (name: string, defaults: Record<string, (...args: any[]) => any>) => {
    db[name] ??= {};
    for (const [key, fn] of Object.entries(defaults)) if (!db[name][key] || !db[name][key].getMockImplementation?.()) db[name][key] = vi.fn(fn);
  };
  const existingThrow = db.campaign?.findUniqueOrThrow;
  model('campaign', { findUnique: async (args: any) => (db.campaign.findUniqueOrThrow?.mock?.results?.at(-1)?.value ?? existingThrow?.(args) ?? null), update: async () => ({}), findUniqueOrThrow: async (args: any) => db.campaign.findUnique?.(args) });
  model('contact', { findUnique: async () => {const contact=(await db.cadenceSend?.findMany?.mock?.results?.at(-1)?.value)?.[0]?.contact;return contact?{approved:true,...contact}:null;} });
  model('campaignSuppression', { findMany: async () => [], deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) });
  model('registrationJob', { createMany: async () => ({ count: 0 }) });
  const attempts = new Map<string, any>();
  db.deliveryAttempt = {
    create: vi.fn(async ({data}: any) => { if (attempts.has(data.key)) throw Object.assign(new Error('Duplicate'), {code:'P2002'}); const row = {status:'dispatching', ...data}; attempts.set(data.key,row); return row; }),
    findUniqueOrThrow: vi.fn(async ({where}: any) => attempts.get(where.key)),
    update: vi.fn(async ({where,data}: any) => Object.assign(attempts.get(where.key), data)),
    updateMany: vi.fn(async ({where,data}: any) => { const row=attempts.get(where.key); if(row?.status!==where.status)return {count:0};Object.assign(row,data);return {count:1}; }),
  };
  model('appSetting' , { findUnique: async () => null });
  db.$queryRaw ??= vi.fn(async () => []);
  if (!db.$transaction?.getMockImplementation?.()) db.$transaction = vi.fn(async (cb: any) => typeof cb === 'function' ? cb(withTxDefaults(db, db)) : Promise.all(cb));
  const txImpl = db.$transaction?.getMockImplementation?.();
  if (txImpl && !txImpl.__reliability) {
    const wrapper = async (cb: any, ...args: any[]) => txImpl(typeof cb === 'function' ? (tx: any) => {
      tx.$queryRaw ??= vi.fn(async () => []);
      tx.campaign ??= db.campaign;
      tx.contact ??= db.contact;
      tx.contact.findUnique ??= db.contact.findUnique;
  tx.contact.findFirst ??= db.contact.findFirst;
  tx.contact.create ??= db.contact.create;
      tx.registrationJob ??= db.registrationJob;
      return cb(tx);
    } : cb, ...args);
    wrapper.__reliability = true;
    db.$transaction.mockImplementation(wrapper);
  }
}
export function withTxDefaults(tx: any, db: any) {
  tx.$queryRaw ??= vi.fn(async () => []);
  tx.campaign ??= db.campaign;
  tx.contact ??= db.contact;
  tx.contact.findUnique ??= db.contact.findUnique;
  tx.contact.findFirst ??= db.contact.findFirst;
  tx.contact.create ??= db.contact.create;
  tx.registrationJob ??= db.registrationJob ?? { createMany: vi.fn(async () => ({count:0})) };
  tx.cadenceStep ??= db.cadenceStep;
  return tx;
}
