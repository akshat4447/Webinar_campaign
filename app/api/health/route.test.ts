import {it,expect,vi} from 'vitest';
const query=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/db',()=>({db:{$queryRaw:query}}));
import {GET} from './route';
it('reports readiness only when the database is reachable',async()=>{query.mockResolvedValueOnce([{value:1}]);const response=await GET();expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true});expect(response.headers.get('Cache-Control')).toBe('no-store');});
it('returns unavailable without exposing connection details',async()=>{query.mockRejectedValueOnce(new Error('private connection detail'));const response=await GET();expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false});});
