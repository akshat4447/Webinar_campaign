'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

// Goes to the wizard rather than creating a blank campaign on click. Creating
// first meant every mis-click left an "Untitled webinar" draft behind; the
// wizard only writes a row once there is a title and a date to write.
export function NewCampaignButton() {
  const router = useRouter();
  return (
    <Button icon={<Icon name="plus" size={16} />} onClick={() => router.push('/campaigns/new')}>
      New webinar
    </Button>
  );
}
