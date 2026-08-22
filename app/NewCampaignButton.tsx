'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { createCampaignAction } from '@/lib/actions/campaigns';

export function NewCampaignButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function create() {
    setBusy(true);
    const id = await createCampaignAction();
    router.push(`/campaigns/${id}/setup`);
  }

  return (
    <Button icon={<Icon name="plus" size={16} />} onClick={create} disabled={busy}>
      {busy ? 'Creating…' : 'New webinar'}
    </Button>
  );
}
