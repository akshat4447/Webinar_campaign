// Public shell for people who are NOT Studio users: attendees registering for a webinar and
// reading their confirmation. A plain canvas — no sidebar, no assistant, no internal navigation.
export default function PublicLayout({ children }: LayoutProps<'/'>) {
  return (
    <main className="lsq-home-public">
      <div className="lsq-home-public__col">{children}</div>
    </main>
  );
}
