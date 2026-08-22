'use client';

import { useRouter } from 'next/navigation';
import { Button } from './Button';
import { Icon } from './Icon';

export function NavButton({
  href,
  hierarchy = 'primary',
  fullWidth,
  trailingArrow = true,
  children,
}: {
  href: string;
  hierarchy?: 'primary' | 'secondary' | 'secondary-color' | 'tertiary' | 'destructive-outline';
  fullWidth?: boolean;
  trailingArrow?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Button
      hierarchy={hierarchy}
      fullWidth={fullWidth}
      icon={trailingArrow ? <Icon name="arrow-right" size={14} /> : undefined}
      iconPosition="trailing"
      onClick={() => router.push(href)}
    >
      {children}
    </Button>
  );
}
