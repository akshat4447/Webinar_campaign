import '@/lib/loadEnv';
import {Client} from 'pg';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp,chmod,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decryptCredential} from '@/lib/credentialCipher';

async function main(){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required for the read-only backup rehearsal.');
 const sourceURL=new URL(process.env.DATABASE_URL);sourceURL.searchParams.delete('schema');const adminURL=new URL(process.env.TEST_DATABASE_ADMIN_URL||sourceURL.toString());adminURL.pathname='/postgres';
 const name='webinar_test_restore_'+randomBytes(6).toString('hex');const restoredURL=new URL(adminURL);restoredURL.pathname='/'+name;
 const source=new Client({connectionString:sourceURL.toString()}),admin=new Client({connectionString:adminURL.toString()}),restored=new Client({connectionString:restoredURL.toString()});
 const directory=await mkdtemp(join(tmpdir(),'webinar-recovery-'));await chmod(directory,0o700);const dump=join(directory,'backup.dump');
 let created=false,connected=false;
 const command=(program:string,args:string[])=>{const result=spawnSync(program,args,{encoding:'utf8',env:{...process.env,DATABASE_URL:restoredURL.toString()}});if(result.status!==0)throw new Error(`${program} failed; exit ${result.status}. ${result.stderr.replaceAll(sourceURL.toString(),'[SOURCE DATABASE]').replaceAll(restoredURL.toString(),'[RESTORE DATABASE]').slice(0,300)}`);return result.stdout;};
 const manifest=async(client:Client)=>{
  const tables=await client.query<{tablename:string}>(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const entries:Record<string,{rows:number;hash:string}>={};
  for(const {tablename} of tables.rows){const quoted='"'+tablename.replaceAll('"','""')+'"';const result=await client.query<{rows:number;hash:string}>(`SELECT count(*)::int AS rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${quoted} t`);entries[tablename]=result.rows[0];}
  return entries;
 };
 try{
  await source.connect();await admin.connect();await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const exported=await source.query<{snapshot:string}>('SELECT pg_export_snapshot() AS snapshot');
  const original=await manifest(source);command('pg_dump',['--format=custom','--no-owner','--no-privileges','--snapshot='+exported.rows[0].snapshot,'--file='+dump,sourceURL.toString()]);await chmod(dump,0o600);await source.query('COMMIT');
  await admin.query(`CREATE DATABASE "${name}"`);created=true;command('pg_restore',['--exit-on-error','--no-owner','--no-privileges','--dbname='+restoredURL.toString(),dump]);await restored.connect();connected=true;
  const recovered=await manifest(restored);if(JSON.stringify(original)!==JSON.stringify(recovered))throw new Error('Restored table counts or content hashes differ from the backup snapshot.');
  const credentials=await restored.query<{value:string}>(`SELECT value FROM "AppSetting" WHERE value LIKE 'enc:v1:%'`);for(const row of credentials.rows){if(!decryptCredential(row.value))throw new Error('Recovered credential was empty.');}
  command('npx',['prisma','migrate','deploy']);command('npx',['prisma','migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--exit-code']);
  const report={verifiedAt:new Date().toISOString(),sourceModified:false,disposableRestore:true,tables:Object.keys(original).length,allTableCountsAndHashesMatch:true,encryptedCredentialsRecovered:credentials.rows.length,migrationsAndSchemaParity:'passed',tableCounts:Object.fromEntries(Object.entries(original).map(([table,entry])=>[table,entry.rows]))};await mkdir('artifacts/verification',{recursive:true});await writeFile('artifacts/verification/backup-recovery.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{await source.end();if(connected)await restored.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();await rm(directory,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
