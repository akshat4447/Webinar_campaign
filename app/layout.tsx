import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'Webinar Studio',
  description: 'Run B2B webinar campaigns end to end — audience, messaging, cadence and reporting',
};

// Root: document + providers only. The internal shell lives in app/(studio)/layout.tsx and the
// public attendee shell in app/(public)/layout.tsx.
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
