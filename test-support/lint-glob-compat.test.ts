import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {getRootDirs}=require('@next/eslint-plugin-next/dist/utils/get-root-dirs') as {getRootDirs:(context:{cwd:string;settings:{next:{rootDir?:string|string[]}}})=>string[]};
it('retains Next lint monorepo directory discovery after replacing the vulnerable glob dependency',async()=>{
 const root=await mkdtemp(join(tmpdir(),'next-lint-roots-'));try{await mkdir(join(root,'apps','alpha'),{recursive:true});await mkdir(join(root,'apps','bravo'),{recursive:true});await writeFile(join(root,'apps','ignore.txt'),'not a directory');const context={cwd:root,settings:{next:{rootDir:join(root,'apps','{alpha,bravo}')}}};expect(getRootDirs(context).sort()).toEqual([join(root,'apps','alpha'),join(root,'apps','bravo')].sort());expect(getRootDirs({cwd:root,settings:{next:{rootDir:[join(root,'apps','*')]}}})).toHaveLength(2);expect(getRootDirs({cwd:root,settings:{next:{}}})).toEqual([root]);}finally{await rm(root,{recursive:true,force:true});}
});
