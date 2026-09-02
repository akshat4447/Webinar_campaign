import { PageHeader } from '@/components/ui/PageHeader';
import { Placeholder } from '@/components/ui/Placeholder';

export default function TemplatesPage() {
  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 48px 40px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <PageHeader
          title="Message templates"
          subtitle="Reusable messages per channel, shared across every webinar"
        />
        <Placeholder
          checkpoint="C4"
          summary="One library for every channel, replacing the per-campaign copies. Email keeps subject and body; WhatsApp gains the fields Meta requires and an approval status; SMS gains its DLT template and sender IDs; LinkedIn stays assisted-only. Cadence steps will pick a template from here."
          currentHome={{ href: '/', label: 'a campaign’s Templates tab' }}
        />
      </div>
    </main>
  );
}
