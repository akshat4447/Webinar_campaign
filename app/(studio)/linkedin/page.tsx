import { getLinkedInToolEventsAction, getLinkedInToolQueueAction } from '@/lib/actions/linkedin';
import { LinkedInHubClient } from './LinkedInHubClient';

export default async function LinkedInHubPage({
  searchParams,
}: {
  searchParams?: Promise<{ event?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const { events } = await getLinkedInToolEventsAction();

  // Find preferred default event:
  // 1. Specified in searchParams ?event=...
  // 2. First campaign with hasLinkedInStep === true
  // 3. First campaign in list
  let selectedEventId = resolvedSearchParams.event || '';
  if (!selectedEventId || !events.some((e) => e.id === selectedEventId)) {
    const withStep = events.find((e) => e.hasLinkedInStep);
    selectedEventId = withStep?.id || events[0]?.id || '';
  }

  let queue: Awaited<ReturnType<typeof getLinkedInToolQueueAction>>['participants'] = [];
  if (selectedEventId) {
    const queueRes = await getLinkedInToolQueueAction(selectedEventId);
    if (queueRes.ok) {
      queue = queueRes.participants;
    }
  }

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <LinkedInHubClient
        events={events}
        initialSelectedEventId={selectedEventId}
        initialQueue={queue}
      />
    </main>
  );
}
