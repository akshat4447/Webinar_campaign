import { redirect } from 'next/navigation';

export default async function SetupRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/campaigns/${id}/overview?edit=1`);
}
