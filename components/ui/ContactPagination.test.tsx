import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ContactPagination } from './ContactPagination';

const render = (props: Partial<Parameters<typeof ContactPagination>[0]> = {}) =>
  renderToString(<ContactPagination path="/campaigns/c1/messaging" page={1} total={3} q="" label="message recipients" {...props} />);

describe('ContactPagination', () => {
  it('uses the shared input and button styles, with a label for the search box', () => {
    const out = render();
    expect(out).toContain('class="lsq-input lsq-pager__input"');
    expect(out).toContain('lsq-btn lsq-btn--sm lsq-btn--secondary');
    expect(out.replace(/<!-- -->/g, '')).toMatch(/<label class="lsq-sr-only"[^>]*>Search message recipients<\/label>/);
    expect(out).not.toContain('style=');
  });

  it('says where you are in the list and links only the pages that exist', () => {
    const single = render({ total: 3 });
    expect(single).toContain('1–3 of 3');
    expect(single).not.toContain('Next page');
    expect(single).not.toContain('Previous page');

    const middle = render({ page: 2, total: 150 });
    expect(middle).toContain('51–100 of 150');
    expect(middle).toContain('Previous page');
    expect(middle).toContain('Next page');
    expect(middle).toContain('href="/campaigns/c1/messaging?page=3"');
  });

  it('keeps the search and the step when moving between pages, and offers to clear a search', () => {
    const out = render({ page: 1, total: 120, q: 'acme', params: { step: 'invite' } });
    expect(out).toContain('q=acme');
    expect(out).toContain('step=invite');
    expect(out).toContain('Clear search');
  });

  it('says so when nothing matches', () => {
    expect(render({ total: 0, q: 'zzz' })).toContain('No matching contacts');
  });
});
