import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('@/lib/actions/registration', () => ({ checkAttributionFieldAction: vi.fn(async () => ({ field: 'mx_Channel_Source', status: 'missing' })) }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import { ExternalRegistrationSetup } from './ExternalRegistrationSetup';

describe('ExternalRegistrationSetup first render', () => {
  // The browser's first render has to equal the server's HTML or React rejects the page (a hydration error). The
  // address warning therefore must not be part of it: it appears after the page has hydrated.
  it('has no address warning in the server HTML, whatever address the script points at', () => {
    for (const apiOrigin of ['http://localhost:3000', 'http://studio.example.com', 'https://studio.example.com', undefined]) {
      const html = renderToString(<ExternalRegistrationSetup script="<script></script>" apiOrigin={apiOrigin} />);
      expect(html, String(apiOrigin)).not.toContain('lsq-banner--warning');
      expect(html, String(apiOrigin)).not.toContain('cannot reach');
    }
  });

  it('renders the same HTML every time for the same input', () => {
    const render = () => renderToString(<ExternalRegistrationSetup script="<script></script>" apiOrigin="http://localhost:3000" channelLinks={[{ channel: 'website', label: 'Website', url: 'https://lp.example.com/?source=website' }]} />);
    expect(render()).toBe(render());
  });

  it('shows the setup steps and the links it was given', () => {
    const html = renderToString(<ExternalRegistrationSetup script="<script></script>" channelLinks={[{ channel: 'website', label: 'Website', url: 'https://lp.example.com/?source=website' }]} />);
    expect(html).toContain('Paste the script once, on every page');
    expect(html).toContain('Create the attribution field in LeadSquared, once');
    expect(html).toContain('https://lp.example.com/?source=website');
  });
});
