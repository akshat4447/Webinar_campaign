import {describe,it,expect} from 'vitest';
import {contactPage,contactQuery,contactSearch} from './contactPagination';
describe('contact pagination input boundaries',()=>{
 it('clamps invalid, excessive and empty page requests without losing the last page',()=>{for(const value of ['-1','0','oops','Infinity','1.5','9007199254740992',undefined])expect(contactPage(value,100)).toBe(1);expect(contactPage('999',51)).toBe(2);expect(contactPage('200',10000)).toBe(200);expect(contactPage('200',0)).toBe(1);});
 it('bounds search text and supplies parameterized case-insensitive contact filters',()=>{expect(contactQuery([' Alice ','ignored'])).toBe('Alice');expect(contactQuery('x'.repeat(500))).toHaveLength(160);expect(contactSearch('')).toEqual({});expect(contactSearch("O'Connor").OR).toContainEqual({name:{contains:"O'Connor",mode:'insensitive'}});});
});
