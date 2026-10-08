import { Icon } from '@/components/ui/Icon';

type Tone = 'success' | 'error' | 'warning' | 'neutral';

const ICON: Record<Tone, string> = {
  success: 'check-circle',
  error: 'x-circle',
  warning: 'warning',
  neutral: 'info',
};

/**
 * The one way this area reports the outcome of an action (test, save, register…):
 * an `lsq-banner` with a tone icon, an optional bold title and the detail text.
 * Errors use role="alert" so they are announced; everything else is a polite status.
 */
export function ResultBanner({
  tone,
  title,
  children,
  actions,
}: {
  tone: Tone;
  title?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`lsq-banner lsq-banner--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="lsq-banner__icon" aria-hidden="true">
        <Icon name={ICON[tone]} size={16} />
      </span>
      <div className="lsq-int-banner-text">
        {title && <p className="lsq-banner__title">{title}</p>}
        {children && <div className="lsq-banner__body">{children}</div>}
      </div>
      {actions}
    </div>
  );
}
