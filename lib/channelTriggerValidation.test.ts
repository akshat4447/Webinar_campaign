import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({details:vi.fn(),types:vi.fn(),push:vi.fn(),upsert:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{appSetting:{findUnique:vi.fn(async({where}:{where:{key:string}})=>where.key==='lsq_channel_trigger_activity_type_id'?{value:'202'}:null),upsert:mocks.upsert}}}));
vi.mock('@/lib/integrationConfig',()=>({resolveIntegrationField:vi.fn(async()=> 'test-tenant')}));
vi.mock('@/lib/leadsquared',()=>({getActivityTypeDetails:mocks.details,listActivityTypes:mocks.types,pushCustomActivities:mocks.push,createActivityType:vi.fn()}));
import {ensureTriggerActivityTypeId,deliverChannelMessage} from './channelDelivery';
it('repairs a stale trigger code by finding an existing activity with all required fields',async()=>{
 mocks.details.mockImplementation(async(id:number)=>id===302?{name:'WebinarAgent Channel Trigger 2',fields:['mx_Custom_1','mx_Custom_2','mx_Custom_3'].map(schemaName=>({schemaName}))}:null);mocks.types.mockResolvedValue({types:[{id:301,name:'WebinarAgent Channel Trigger'},{id:302,name:'WebinarAgent Channel Trigger 2'}]});expect(await ensureTriggerActivityTypeId()).toBe(302);expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({update:{value:'302'}}));
 mocks.push.mockRejectedValueOnce(new Error('Custom field is invalid'));await expect(deliverChannelMessage({channel:'sms',phone:'+12025550123',lsqLeadId:'lead-1',stepKey:'invite',campaignName:'Test',message:'Test'})).rejects.toThrow('Custom field');expect(mocks.push).toHaveBeenCalledTimes(1);expect(mocks.push.mock.calls[0][0][0].Fields).toHaveLength(3);
});
