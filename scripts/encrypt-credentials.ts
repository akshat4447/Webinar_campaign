import '../lib/loadEnv';
import { db } from '../lib/db';
import { INTEGRATION_FIELDS } from '../lib/integrationFields';
import { encryptCredential } from '../lib/credentialCipher';
async function main() {
  const keys = Object.entries(INTEGRATION_FIELDS).flatMap(([id, fields]) => fields.filter(f => f.secret).map(f => `integration.${id}.${f.key}`));
  keys.push('direct_sms_auth_token', 'direct_wa_auth_token');
  const rows = await db.appSetting.findMany({ where: { key: { in: keys } } });
  let changed = 0;
  await db.$transaction(async tx => {
    for (const row of rows) {
      if (!row.value || row.value.startsWith('enc:v1:')) continue;
      await tx.appSetting.update({ where: { key: row.key }, data: { value: encryptCredential(row.value) } }); changed++;
    }
  });
  console.log(`Encrypted ${changed} stored credential fields. No credential values were logged.`);
}
main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; }).finally(() => db.$disconnect());
