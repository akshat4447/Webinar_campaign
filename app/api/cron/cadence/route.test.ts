import { it, expect, vi } from 'vitest';
vi.mock('@/lib/workerTick', () => ({runWorkerTick:vi.fn()}));
import { runWorkerTick } from '@/lib/workerTick';
import { GET } from './route';
it('runs the shared worker without operator authentication',async()=>{vi.mocked(runWorkerTick).mockResolvedValueOnce({ok:true,skipped:'Another worker holds the lease.'});expect((await GET()).status).toBe(200);});
it('reports worker failures',async()=>{vi.mocked(runWorkerTick).mockRejectedValueOnce(new Error('DB unavailable'));const res=await GET();expect(res.status).toBe(500);expect((await res.json()).ok).toBe(false);});
