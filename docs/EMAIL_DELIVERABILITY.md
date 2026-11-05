# Email deliverability

"Netcore accepted it" only means Netcore took the message. Whether it reaches an inbox is decided afterwards by the
recipient's mail system, which Studio cannot see. This page lists what keeps invites out of Junk, quarantine and
"unauthenticated source" warnings, who does each part, and how to test.

## What Studio does by itself

Nothing here adds anything to a screen.

- **Chooses the address a message shows** (`lib/inviteLink.ts`, `lib/linkHost.ts`). Each address is rated as the operator's own
  domain, a free address that comes with a page builder (`my-site.framer.app`) or a temporary one (a tunnel, this machine, a
  page not served over https). For a webinar with an external landing page, an invite carries the landing page directly, unless
  Studio's own address is strictly better, in which case it carries Studio's short link `<studio>/r/<token>`, which redirects to
  that same landing page with the person's token, channel and Zoom id. Equal addresses keep the direct link. A registered
  person always gets their Zoom join link.
- **Sends every web address as a real hyperlink with words as its text** (`lib/emailHtml.ts`): "Register here", "Join the
  webinar", "Add to calendar". No address is shown as text. The invite, reminders, broadcasts and test previews all use it.
- **Applies the same rule everywhere a link is built:** the invite itself, a template's `{{registrationLink}}` (Studio's own
  `/register/<id>` link, which redirects to the landing page, when that is the better address), and the LinkedIn queue.
- **Registers on a Netcore click only if `NETCORE_CLICK_REGISTRATION=true`.** Mail scanners click every link and Netcore reports
  those clicks like a person's. Off by default; never applies to a webinar with its own landing page.
- **Stops using a saved temporary Zoom return address** (a tunnel) once Studio is reached on a real address, so a deployed copy never
  inherits a dead tunnel from the database it was set up with. A saved address that is not temporary is never overridden.
- **Never lets a click register someone for a webinar with its own landing page.** Studio's short link only takes the person to
  the page; they register through its form. Mail scanners click links, so Netcore's click events are ignored for those webinars.
- **Never puts Studio's own address inside a link as a parameter.** A web address inside another web address is what filters
  read as phishing, and a tunnel address there got mail held.
- **Leaves open and click tracking to the sending domain's own Netcore setting** (set `NETCORE_OPEN_TRACKING` /
  `NETCORE_CLICK_TRACKING` to `true` or `false` to force one). Forcing click tracking rewrites every link through a shared
  tracking address.
- **Keeps the unsubscribe link on, and refuses to send to anyone on the suppression list.**
- **Writes what is likely to keep mail out of an inbox to the server log when a cadence launches** (`lib/deliverability.ts`, lines
  starting `[deliverability]`): the address the links will show if it is free or temporary, and recipients at the sender's own
  company. It never blocks a launch.
- The short link is safe for a mail scanner to follow first: it only redirects, never registers anyone.

## What has to be right outside Studio

| Where | What | Who |
|---|---|---|
| DNS | The sending domain's DKIM record (`nc2048._domainkey.<domain>` pointing to Netcore) and bounce domain (`delivery.<domain>`) are valid. Netcore's Domains page shows both as valid. | Whoever owns DNS |
| DNS | An explicit DMARC record for the sending domain (`_dmarc.<domain>`), starting at `p=none` with a report address, so you can see what passes before enforcing. | Whoever owns DNS |
| Netcore | Open and click tracking on the domain are set as you want them. Prefer a tracking address on your own domain over the shared one. | Netcore admin |
| Your company's mail system | If staff are recipients: allow the sending domain (an inbound connector or allow-list entry for Netcore's sending addresses). Mail a company sends "as itself" from outside is flagged by default. | IT |
| Sender domain choice | Send marketing and webinar mail from a domain that is separate from your day-to-day staff mail, so its reputation stands alone. | You |

Outside recipients are not affected by your own company's filter. A test to a colleague proves less than a test to a
personal address.

## Testing before a real send

1. Pre-flight: Integrations, Netcore, Test Connection. It must say the domain is verified and DKIM verified.
2. Send a test message to yourself from the Messaging step, and to one address outside your company.
3. If it does not arrive in a few minutes: check Junk, then your mail system's quarantine, then look up the Netcore message
   ID in Netcore's reports. Open the message source and read the `Authentication-Results` header: it shows whether SPF,
   DKIM and DMARC passed and which one failed.
4. Change one thing at a time (sender, tracking, link domain) so the result tells you the cause.

## What a real test showed (4 Nov 2026)

Invites sent through Netcore to a colleague at the sending company's own mail system, which scans links with a security
gateway. Only the link changed between these emails:

| Link in the email | Reached the inbox |
|---|---|
| No link at all | yes |
| `my-site.framer.app/` (free builder address, no query) | yes |
| `www.company.com/page?token=…&campaignId=…` (company domain, personal token) | yes |
| `my-site.framer.app/?token=…&campaignId=…` plus the company's own domain inside the link | yes |
| `my-site.framer.app/?token=…&campaignId=…` and nothing else, shown as text | **held** |
| The same address as a clickable hyperlink with the text "Save your seat" | yes |
| The same hyperlink with Netcore click tracking on | yes |
| The same address as text with Netcore click tracking on | **held** (click tracking does not help) |
| The same with a temporary tunnel address inside the link | **held** |

A personal-token address shown as text, to a free builder address with no domain the company recognises, is what got held;
the identical address behind a clickable label was delivered. Studio now shows
its own short link instead when it is on a better address (see above), and logs a note at launch when it cannot. The lasting
fix is the same either way: a landing page on the company's own domain, and Studio on its own domain.

## Expect a delay, not only a pass or fail

A gateway that scans links can hold the first message with a new link for several minutes (one test email arrived about ten
minutes late). Judge a test after ten to fifteen minutes before calling it lost, and change one thing at a time. Further tests
confirmed that the hyperlink format, the labels, the subject and Netcore's tags are all fine as the real cadence sends them.

## Before the first real send on a deployed copy

1. `APP_ORIGIN` is your own https address (not a tunnel, not `localhost`). On Render it falls back to the host's assigned address.
2. The landing page is on your own domain, or Studio is: either one makes the invite show an address your recipients' filters
   know. Studio picks the better of the two by itself.
3. Netcore: Test Connection says the sender domain is verified and DKIM verified.
4. Send a test to yourself and to one address outside your company, and wait ten to fifteen minutes.
5. Zoom: if the app was connected during setup through a tunnel, connect again from the deployed address and add its callback to
   the Zoom app's OAuth redirect URL and allow list.
6. If recipients' mail systems scan links, keep one-click registration off (the hosted form asks for one confirmation) for
   webinars that register through Studio itself: with one-click on, a scanner opening the link registers the person.
