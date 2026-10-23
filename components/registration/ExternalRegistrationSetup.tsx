'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { checkAttributionFieldAction, type AttributionFieldStatus } from '@/lib/actions/registration';
import { scriptOriginProblem } from '@/lib/scriptOrigin';

export interface SetupChannelLink {
  channel: string;
  label: string;
  url: string;
}

async function copyText(text: string, showToast: (m: string) => void, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${what} copied.`);
  } catch {
    showToast('Copy is blocked in this browser. Select the text and copy it manually.');
  }
}

const FIELD_BADGE: Record<AttributionFieldStatus['status'], { color: string; text: string }> = {
  found: { color: 'success', text: 'Field found' },
  missing: { color: 'warning', text: 'Create this field' },
  unknown: { color: 'gray', text: 'Not checked' },
};

/**
 * Everything someone does to connect their own landing page: paste one script on every page, create one field in
 * LeadSquared, and (when `channelLinks` is given) copy the links for the places they share a link themselves.
 */
export function ExternalRegistrationSetup({
  script,
  channelLinks,
  apiOrigin,
}: {
  script: string;
  /** The address the script sends registrations to, checked here so a script that cannot work is flagged before it is pasted. */
  apiOrigin?: string;
  /** The channels this webinar tracks by a link someone shares by hand. Omit where the page lists them elsewhere. */
  channelLinks?: SetupChannelLink[];
}) {
  const { showToast } = useToast();
  const [field, setField] = useState<AttributionFieldStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setField(await checkAttributionFieldAction());
    } catch {
      setField({ field: 'mx_Channel_Source', status: 'unknown' });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads LeadSquared once on arrival
    void check();
  }, [check]);

  const fieldName = field?.field ?? 'mx_Channel_Source';
  // Worked out after the page has hydrated, so the server's HTML and the browser's first render are identical
  // whatever address each one sees; the warning then appears.
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberately after hydration, see above
    setProblem(scriptOriginProblem(apiOrigin));
  }, [apiOrigin]);
  const badge = FIELD_BADGE[field?.status ?? 'unknown'];

  return (
    <div className="lsq-stack lsq-stack--lg">
      {problem && (
        <div className="lsq-banner lsq-banner--warning" role="alert">
          <Icon name="warning" size={18} />
          <p className="lsq-banner__body">{problem}</p>
        </div>
      )}
      <ol className="lsq-reg-steps">
        <li className="lsq-reg-step">
          <span className="lsq-reg-step__n" aria-hidden="true">1</span>
          <div className="lsq-reg-step__body">
            <h4 className="lsq-reg-step__title">Paste the script once, on every page</h4>
            <p className="lsq-hint">
              The script has to run on your landing page and on your thank-you page, the page LeadSquared opens after someone
              submits. In Framer, paste it once in Site Settings, General, Custom Code, End of body tag: it then runs on every page of
              the site. On other builders, paste the same script at the end of the body on both pages.
            </p>
            <p className="lsq-hint">
              It works with Framer&apos;s own forms, custom components and code embeds, forms that load late, and pages that change
              without reloading. It cannot see a form inside an iframe, such as an embedded LeadSquared form: use a Framer form or
              component instead. Other forms on your site, like a newsletter box, are left alone.
            </p>
            <div className="lsq-cluster">
              <Button size="sm" hierarchy="secondary" icon={<Icon name="copy" size={14} />} onClick={() => copyText(script, showToast, 'Script')}>
                Copy Script
              </Button>
            </div>
            <details className="lsq-wiz-details">
              <summary>View script</summary>
              <div className="lsq-wiz-details__body">
                <pre className="lsq-code lsq-wiz-script" tabIndex={0} aria-label="Landing page script">{script}</pre>
              </div>
            </details>
          </div>
        </li>

        <li className="lsq-reg-step">
          <span className="lsq-reg-step__n" aria-hidden="true">2</span>
          <div className="lsq-reg-step__body">
            <div className="lsq-cluster">
              <h4 className="lsq-reg-step__title">Create the attribution field in LeadSquared, once</h4>
              <Badge color={badge.color} text={badge.text} dot />
            </div>
            <p className="lsq-hint">
              Each registration&apos;s channel is saved on the lead in <span className="lsq-wiz-code-inline">{fieldName}</span>, so you can
              report on it in LeadSquared. In LeadSquared open Settings, Leads, Customize Lead Fields and add a field with the display
              name Channel Source, the schema name <span className="lsq-wiz-code-inline">{fieldName}</span> and the type Single line text.
              {field?.status === 'unknown' && ' LeadSquared could not be checked from here. Connect it on Integrations to see whether the field exists.'}
            </p>
            <div className="lsq-cluster">
              <Button size="sm" hierarchy="tertiary-color" icon={<Icon name="refresh" size={14} />} onClick={check} loading={checking}>
                Check Again
              </Button>
            </div>
          </div>
        </li>

        <li className="lsq-reg-step">
          <span className="lsq-reg-step__n" aria-hidden="true">3</span>
          <div className="lsq-reg-step__body">
            <h4 className="lsq-reg-step__title">What people see</h4>
            <p className="lsq-hint">
              They submit your form, LeadSquared records the lead and opens your thank-you page, and the script there opens a pop-up:
              &ldquo;You are registered&rdquo; with Google Calendar, Outlook, Microsoft 365 and Apple (.ics) buttons. Their joining details
              arrive by email.
            </p>
          </div>
        </li>
      </ol>

      {channelLinks && (
        <div className="lsq-stack lsq-stack--sm">
          <h4 className="lsq-reg-step__title">Links for your channels</h4>
          <p className="lsq-hint">
            Email, SMS, WhatsApp and LinkedIn need nothing from you: Studio puts the right link in every message it sends or drafts.
            For anywhere else you share this webinar, copy the link for that place so its registrations are credited to it.
          </p>
          {channelLinks.length === 0 ? (
            <p className="lsq-hint">No shared channels are turned on. Turn them on in Step 1 to get a link for each.</p>
          ) : (
            <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
              <table className="lsq-table">
                <thead>
                  <tr>
                    <th scope="col">Channel</th>
                    <th scope="col">Link</th>
                    <th scope="col"><span className="lsq-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {channelLinks.map((l) => (
                    <tr key={l.channel}>
                      <th scope="row" className="lsq-cell-primary">{l.label}</th>
                      <td><span className="lsq-wiz-url" suppressHydrationWarning>{l.url}</span></td>
                      <td>
                        <Button size="sm" hierarchy="secondary" icon={<Icon name="copy" size={14} />} ariaLabel={`Copy ${l.label} link`} onClick={() => copyText(l.url, showToast, `${l.label} link`)}>
                          Copy
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
