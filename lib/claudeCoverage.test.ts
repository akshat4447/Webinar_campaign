import {it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({parse:vi.fn()}));
vi.mock('@anthropic-ai/sdk',()=>({default:class{messages={parse:mocks.parse};}}));
vi.mock('@/lib/integrationConfig',()=>({resolveIntegrationField:vi.fn(async()=> 'test-key')}));
vi.mock('@/lib/personaLearning',()=>({getPersonaLearningInsights:vi.fn(async()=>null)}));
import {scoreContacts,enrichContacts,personalizeMessages} from './claude';
const contacts=['a','b'].map(id=>({id,name:'Test Person',title:'Director',function:'Marketing',seniority:'Director',account:'Example',vertical:'Test',missingInfo:false,personaNote:null,score:80,scoreRationale:null,hasLinkedIn:false}));
beforeEach(()=>vi.clearAllMocks());
it.each([{ids:['a']},{ids:['a','a']},{ids:['a','foreign']}])('rejects incomplete, duplicate, or foreign scoring ids: %j',async ({ids})=>{
 mocks.parse.mockResolvedValue({parsed_output:{scores:ids.map(id=>({id,score:80,explanation:'Relevant'}))}});
 const r=await scoreContacts('Topic','Test','','',contacts);expect(r.failedBatches).toBe(1);expect(r.results).toEqual([]);
});
it.each([{ids:['a']},{ids:['a','a']},{ids:['a','foreign']}])('rejects invalid enrichment coverage: %j',async ({ids})=>{
 mocks.parse.mockResolvedValue({parsed_output:{enriched:ids.map(id=>({id,vertical:'Test',function:'Marketing',seniority:'Director',personaNote:'Relevant'}))}});
 const r=await enrichContacts('Topic',contacts);expect(r.failedBatches).toBe(1);expect(r.results).toEqual([]);
});
it.each([{ids:['a']},{ids:['a','a']},{ids:['a','foreign']}])('rejects invalid personalized draft coverage: %j',async ({ids})=>{
 mocks.parse.mockResolvedValue({parsed_output:{messages:ids.map(id=>({id,subject:'Invite',body:'Join',rationale:'Relevant'}))}});
 const r=await personalizeMessages({campaign:{name:'Topic'},channel:'email',stepLabel:'Invite',templateSubject:'Invite',templateBody:'Join',contacts,customInstructions:''});expect(r.failedBatches).toBe(1);expect(r.drafts).toEqual([]);
});
it('accepts a complete batch with exactly the requested identities',async()=>{
 mocks.parse.mockResolvedValue({parsed_output:{scores:contacts.map(c=>({id:c.id,score:80,explanation:'Relevant'}))}});const r=await scoreContacts('Topic','Test','','',contacts);expect(r.failedBatches).toBe(0);expect(r.results).toHaveLength(2);
});
