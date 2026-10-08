import { buildGoogleCalendarUrl, buildOutlookCalendarUrl } from '@/lib/calendar';

export interface BuildLandingUrlOptions {
  landingPageUrl: string;
  campaign: {
    id: string;
    name?: string | null;
    zoomMeetingId?: string | null;
  };
  contact: {
    id: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    account?: string | null;
    title?: string | null;
  };
  channel?: string;
  apiOrigin?: string;
  /**
   * Copy the contact's name/email/phone/company/title into the URL (for landing-page forms that
   * pre-fill from the query string). Pass false to keep personal data OUT of the URL — the signed
   * `token` still identifies the contact, and the hosted snippet can resolve details from it.
   * Defaults to true so existing callers behave exactly as before.
   */
  prefill?: boolean;
  registrationToken?: string;
}

/**
 * Builds a dynamic landing page URL with pre-filled contact parameters,
 * cryptographic registration token, and channel tracking parameters.
 */
export function buildLandingPageUrl({
  landingPageUrl,
  campaign,
  contact,
  channel = 'email',
  apiOrigin,
  prefill = true,
  registrationToken,
}: BuildLandingUrlOptions): string {
  const trimmed = (landingPageUrl || '').trim();
  if (!trimmed) return '';

  const normalizedChannel = (channel || 'email').toLowerCase();
  const token = registrationToken;

  const nameParts = (contact.name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ');

  const campaignSlug = campaign.name
    ? campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : campaign.id;

  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);

    if (prefill) {
      parsed.searchParams.set('FirstName', firstName);
      if (lastName) parsed.searchParams.set('LastName', lastName);
      if (contact.email) parsed.searchParams.set('EmailAddress', contact.email);
      if (contact.phone) parsed.searchParams.set('Phone', contact.phone);
      if (contact.account) parsed.searchParams.set('Company', contact.account);
      if (contact.title) parsed.searchParams.set('JobTitle', contact.title);
    }

    if (token) parsed.searchParams.set('token', token);
    parsed.searchParams.set('campaignId', campaign.id);
    if (campaign.zoomMeetingId) {
      parsed.searchParams.set('zoomId', campaign.zoomMeetingId);
    }
    parsed.searchParams.set('source', normalizedChannel);
    parsed.searchParams.set('utm_source', normalizedChannel);
    parsed.searchParams.set('utm_medium', 'outreach');
    parsed.searchParams.set('utm_campaign', campaignSlug);

    if (apiOrigin) {
      parsed.searchParams.set('apiOrigin', apiOrigin.replace(/\/$/, ''));
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, construct cleanly with query separator
    const sep = trimmed.includes('?') ? '&' : '?';
    const params = new URLSearchParams({
      ...(prefill ? { FirstName: firstName } : {}),
      ...(prefill && lastName ? { LastName: lastName } : {}),
      ...(prefill && contact.email ? { EmailAddress: contact.email } : {}),
      ...(prefill && contact.phone ? { Phone: contact.phone } : {}),
      ...(prefill && contact.account ? { Company: contact.account } : {}),
      ...(token ? { token } : {}),
      campaignId: campaign.id,
      ...(campaign.zoomMeetingId ? { zoomId: campaign.zoomMeetingId } : {}),
      source: normalizedChannel,
      utm_source: normalizedChannel,
      utm_medium: 'outreach',
      utm_campaign: campaignSlug,
      ...(apiOrigin ? { apiOrigin: apiOrigin.replace(/\/$/, '') } : {}),
    });
    return `${trimmed}${sep}${params.toString()}`;
  }
}

export type MergeTagProvider = 'sample' | 'leadsquared' | 'netcore' | 'whatsapp';

export interface ChannelTrackingLinksResult {
  email: string;
  whatsapp: string;
  sms: string;
  linkedin: string;
  linkedin_event: string;
  sdr_sales: string;
  third_parties: string;
  website: string;
}

/**
 * Generates sample channel attribution links for previewing in the UI,
 * with support for LeadSquared/Netcore merge tag syntax or sample values.
 */
export function buildChannelTrackingLinks(
  landingPageUrl: string,
  campaign: { id: string; name?: string | null; zoomMeetingId?: string | null },
  sampleContact?: {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    account?: string;
    title?: string;
  },
  apiOrigin?: string,
  mergeTagFormat: MergeTagProvider = 'sample'
): ChannelTrackingLinksResult {
  const trimmed = (landingPageUrl || '').trim();
  const sep = trimmed.includes('?') ? '&' : '?';
  const zoomParam = campaign.zoomMeetingId ? `&zoomId=${encodeURIComponent(campaign.zoomMeetingId)}` : '';
  const campParam = `&campaignId=${encodeURIComponent(campaign.id)}`;
  const originParam = apiOrigin ? `&apiOrigin=${encodeURIComponent(apiOrigin.replace(/\/$/, ''))}` : '';

  if (mergeTagFormat === 'leadsquared') {
    const lsqTags = `FirstName={{FirstName}}&LastName={{LastName}}&EmailAddress={{EmailAddress}}&Phone={{Phone}}&Company={{Company}}`;
    return {
      email: `${trimmed}${sep}${lsqTags}&source=email${campParam}${zoomParam}${originParam}`,
      whatsapp: `${trimmed}${sep}${lsqTags}&source=whatsapp${campParam}${zoomParam}${originParam}`,
      sms: `${trimmed}${sep}${lsqTags}&source=sms${campParam}${zoomParam}${originParam}`,
      linkedin: `${trimmed}${sep}${lsqTags}&source=linkedin${campParam}${zoomParam}${originParam}`,
      linkedin_event: `${trimmed}${sep}source=linkedin_event${campParam}${zoomParam}${originParam}`,
      sdr_sales: `${trimmed}${sep}${lsqTags}&source=sdr_sales${campParam}${zoomParam}${originParam}`,
      third_parties: `${trimmed}${sep}source=third_parties${campParam}${zoomParam}${originParam}`,
      website: `${trimmed}${sep}source=website${campParam}${zoomParam}${originParam}`,
    };
  }

  if (mergeTagFormat === 'netcore') {
    const netcoreTags = `FirstName=[NAME]&EmailAddress=[EMAIL]&Phone=[MOBILE]`;
    return {
      email: `${trimmed}${sep}${netcoreTags}&source=email${campParam}${zoomParam}${originParam}`,
      whatsapp: `${trimmed}${sep}${netcoreTags}&source=whatsapp${campParam}${zoomParam}${originParam}`,
      sms: `${trimmed}${sep}${netcoreTags}&source=sms${campParam}${zoomParam}${originParam}`,
      linkedin: `${trimmed}${sep}${netcoreTags}&source=linkedin${campParam}${zoomParam}${originParam}`,
      linkedin_event: `${trimmed}${sep}source=linkedin_event${campParam}${zoomParam}${originParam}`,
      sdr_sales: `${trimmed}${sep}${netcoreTags}&source=sdr_sales${campParam}${zoomParam}${originParam}`,
      third_parties: `${trimmed}${sep}source=third_parties${campParam}${zoomParam}${originParam}`,
      website: `${trimmed}${sep}source=website${campParam}${zoomParam}${originParam}`,
    };
  }

  const contact = {
    id: sampleContact?.id || '',
    name: sampleContact?.name || '',
    email: sampleContact?.email || '',
    phone: sampleContact?.phone || '',
    account: sampleContact?.account || '',
    title: sampleContact?.title || '',
  };

  return {
    email: buildLandingPageUrl({ landingPageUrl, campaign, contact, channel: 'email', apiOrigin }),
    whatsapp: buildLandingPageUrl({ landingPageUrl, campaign, contact, channel: 'whatsapp', apiOrigin }),
    sms: buildLandingPageUrl({ landingPageUrl, campaign, contact, channel: 'sms', apiOrigin }),
    linkedin: buildLandingPageUrl({ landingPageUrl, campaign, contact, channel: 'linkedin', apiOrigin }),
    linkedin_event: buildLandingPageUrl({ landingPageUrl, campaign, contact, channel: 'linkedin_event', apiOrigin }),
    sdr_sales: buildLandingPageUrl({ landingPageUrl, campaign, contact, channel: 'sdr_sales', apiOrigin }),
    third_parties: buildLandingPageUrl({ landingPageUrl, campaign, contact, channel: 'third_parties', apiOrigin }),
    website: buildLandingPageUrl({ landingPageUrl, campaign, contact, channel: 'website', apiOrigin }),
  };
}

/**
 * Generates sample channel-wise 1-click magic registration links for normal registration mode.
 */
export function buildNormalChannelRegistrationLinks(
  campaign: { id: string },
  contactId = 'sample-contact-id',
  apiOrigin?: string
): {
  email: string;
  whatsapp: string;
  sms: string;
  linkedin: string;
} {
  const origin = apiOrigin ? apiOrigin.replace(/\/$/, '') : '';
  const base = `${origin}/register/${encodeURIComponent(campaign.id)}`;
  void contactId;
  return {
    email: `${base}?c=email`,
    whatsapp: `${base}?c=whatsapp`,
    sms: `${base}?c=sms`,
    linkedin: `${base}?c=linkedin`,
  };
}

export type LandingPlatform = 'universal' | 'framer' | 'wordpress' | 'leadsquared' | 'webflow';

export interface EmbedScriptOptions {
  apiOrigin?: string;
  campaignId?: string;
  zoomId?: string;
  webinarTitle?: string;
  scheduledAt?: string | Date | null;
  durationMinutes?: number;
  description?: string;
  location?: string;
  autoOpenGoogleCalendar?: boolean;
  platform?: LandingPlatform;
}

/**
 * Generates the complete, production-ready universal embed script.
 * Works across Framer, WordPress (Elementor, CF7, Gravity, WPForms),
 * LeadSquared FormTracker, Webflow, and custom HTML.
 */
export function generateUniversalEmbedScript(options: EmbedScriptOptions = {}): string {
  const platform = options.platform || 'universal';
  const originPlaceholder = options.apiOrigin ? JSON.stringify(options.apiOrigin.replace(/\/$/, '')) : `window.location.origin`;
  const defaultCampaignId = JSON.stringify(options.campaignId || '');
  const defaultZoomId = JSON.stringify(options.zoomId || '');

  let defaultGoogleCalUrl = '';
  let defaultOutlookCalUrl = '';
  if (options.scheduledAt && options.webinarTitle) {
    try {
      defaultGoogleCalUrl = buildGoogleCalendarUrl({
        title: options.webinarTitle,
        description: options.description || options.webinarTitle,
        location: options.location || 'Online Webinar',
        startTime: options.scheduledAt,
        durationMinutes: options.durationMinutes || 60,
      });
      defaultOutlookCalUrl = buildOutlookCalendarUrl({
        title: options.webinarTitle,
        description: options.description || options.webinarTitle,
        location: options.location || 'Online Webinar',
        startTime: options.scheduledAt,
        durationMinutes: options.durationMinutes || 60,
      });
    } catch {
      // safe fallback if date is invalid
    }
  }


  const platformHeader =
    platform === 'framer'
      ? `<!-- Paste in Framer: Project Settings -> Custom Code -> End of <body> tag -->`
      : platform === 'wordpress'
      ? `<!-- Paste in WordPress: Elementor Custom Code or WPCode Plugin -> End of <body> -->`
      : platform === 'leadsquared'
      ? `<!-- Paste in LeadSquared LP Builder: Page Settings -> Custom HTML/Script Embed -->`
      : platform === 'webflow'
      ? `<!-- Paste in Webflow: Page Settings -> Custom Code -> Before </body> tag -->`
      : `<!-- Paste before </body> on any landing page (Framer, WordPress, Webflow, LeadSquared) -->`;

  return `<!-- ======================================================================= -->
<!-- Universal Webinar Studio + LeadSquared + Zoom Seamless Registration    -->
${platformHeader}
<!-- ======================================================================= -->
<script>
(function() {
  'use strict';

  // 1. Parse URL Parameters
  var params = new URLSearchParams(window.location.search);

  // Remember where the visitor came from for this browser tab. A landing page with more than one step, or a
  // redirect before the form, would otherwise lose the channel and the personal link, and the registration
  // would be counted under "website".
  var attrKey = 'webinar_attribution_' + ${defaultCampaignId};
  var saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(attrKey) || '{}') || {}; } catch (e) { saved = {}; }
  var arrivedWith = {
    source: params.get('source') || params.get('utm_source') || '',
    token: params.get('token') || '',
    campaignId: params.get('campaignId') || ''
  };
  if (arrivedWith.source || arrivedWith.token) {
    saved = { source: arrivedWith.source || saved.source || '', token: arrivedWith.token || saved.token || '', campaignId: arrivedWith.campaignId || saved.campaignId || '' };
    try { sessionStorage.setItem(attrKey, JSON.stringify(saved)); } catch (e) {}
  }

  var config = {
    campaignId: params.get('campaignId') || saved.campaignId || ${defaultCampaignId},
    zoomId: params.get('zoomId') || params.get('webinarId') || ${defaultZoomId},
    source: arrivedWith.source || saved.source || 'website',
    // SECURITY: the submit endpoint is baked in when the snippet is generated. It must NOT be read from
    // the page URL — a crafted link (?apiOrigin=https://evil.example) would otherwise make the form post
    // every visitor's name and email to an attacker.
    apiOrigin: ${originPlaceholder},
    token: arrivedWith.token || saved.token || ''
  };

  var leadData = {
    firstName: params.get('FirstName') || params.get('first_name') || params.get('name') || '',
    lastName: params.get('LastName') || params.get('last_name') || '',
    email: params.get('EmailAddress') || params.get('email') || '',
    phone: params.get('Phone') || params.get('phone') || params.get('mobile') || '',
    company: params.get('Company') || params.get('company') || '',
    jobTitle: params.get('JobTitle') || params.get('title') || ''
  };

  var googleCalUrl = ${JSON.stringify(defaultGoogleCalUrl || '')};
  var outlookCalUrl = ${JSON.stringify(defaultOutlookCalUrl || '')};

  // Cross-Platform Input Setter (React 18/19 Synthetic Events + Standard DOM)
  function setReactInputValue(input, val) {
    if (!input || !val) return;
    try {
      var proto = Object.getPrototypeOf(input);
      var protoDesc = Object.getOwnPropertyDescriptor(proto, 'value');
      var inputProtoDesc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      var setter = (protoDesc && protoDesc.set) || (inputProtoDesc && inputProtoDesc.set);
      if (setter) {
        setter.call(input, val);
      } else {
        input.value = val;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (e) {
      input.value = val;
    }
  }
  var setVal = setReactInputValue;

  // Multi-Framework Input Locator (Framer, Elementor, CF7, Gravity, WPForms, LeadSquared)
  function findInput(type, context) {
    var root = context || document;
    var selectors = {
      firstName: [
        'input[name="FirstName" i]',
        'input[name*="first" i]',
        'input[name*="fname" i]',
        'input[name="form_fields[name]"]',
        'input[name="your-name"]',
        'input[name="input_1"]',
        'input[placeholder*="First Name" i]',
        'input[placeholder*="Your Name" i]',
        'input[placeholder*="Full Name" i]'
      ],
      lastName: [
        'input[name="LastName" i]',
        'input[name*="last" i]',
        'input[name*="lname" i]',
        'input[name="form_fields[last_name]"]',
        'input[name="input_2"]',
        'input[placeholder*="Last Name" i]'
      ],
      email: [
        'input[type="email"]',
        'input[name="EmailAddress" i]',
        'input[name*="email" i]',
        'input[name="form_fields[email]"]',
        'input[name="your-email"]',
        'input[name="input_3"]',
        'input[placeholder*="Email" i]'
      ],
      phone: [
        'input[type="tel"]',
        'input[name="Phone" i]',
        'input[name*="phone" i]',
        'input[name*="mobile" i]',
        'input[name="form_fields[phone]"]',
        'input[name="your-tel"]',
        'input[placeholder*="Phone" i]',
        'input[placeholder*="Mobile" i]'
      ],
      company: [
        'input[name="Company" i]',
        'input[name*="company" i]',
        'input[name*="organization" i]',
        'input[name="form_fields[company]"]',
        'input[placeholder*="Company" i]',
        'input[placeholder*="Organization" i]'
      ],
      jobTitle: [
        'input[name="JobTitle" i]',
        'input[name="title" i]',
        'input[name*="designation" i]',
        'input[name="form_fields[title]"]',
        'input[name="form_fields[job_title]"]',
        'input[placeholder*="Job Title" i]',
        'input[placeholder*="Designation" i]',
        'input[placeholder*="Role" i]'
      ],
      zoomId: [
        'input[name="mx_WebinarID" i]',
        'input[name*="webinar_id" i]',
        'input[name*="zoom_id" i]'
      ],
      source: [
        'input[name="mx_Channel_Source" i]',
        'input[name="source" i]',
        'input[name="utm_source" i]'
      ]
    };

    var list = selectors[type] || [];
    for (var i = 0; i < list.length; i++) {
      var el = root.querySelector(list[i]);
      if (el) return el;
    }
    if (root !== document) {
      for (var j = 0; j < list.length; j++) {
        var docEl = document.querySelector(list[j]);
        if (docEl) return docEl;
      }
    }
    return null;
  }

  // Auto-Fill Form Fields on Page Load
  function autoFill() {
    if (leadData.firstName) setVal(findInput('firstName'), leadData.firstName);
    if (leadData.lastName) setVal(findInput('lastName'), leadData.lastName);
    if (leadData.email) setVal(findInput('email'), leadData.email);
    if (leadData.phone) setVal(findInput('phone'), leadData.phone);
    if (leadData.company) setVal(findInput('company'), leadData.company);
    if (leadData.jobTitle) setVal(findInput('jobTitle'), leadData.jobTitle);
    if (config.zoomId) setVal(findInput('zoomId'), config.zoomId);
    if (config.source) setVal(findInput('source'), config.source);
  }

  // Dual-Dispatch on Submission (Webinar Studio + LeadSquared / WordPress)
  var hasSubmitted = false;
  function handleSubmission(e) {
    if (hasSubmitted) return;

    // Guard: Prevent firing on invalid form inputs (Elementor / HTML5 validation)
    var target = e.target;
    var form = target.tagName === 'FORM' ? target : target.closest('form');
    if (form && form.checkValidity && !form.checkValidity()) return;

    var emailEl = findInput('email', form);
    // A form without an email field (search box, newsletter signup, a login) is not a webinar registration.
    if (!(emailEl && emailEl.value) && !leadData.email) return;

    hasSubmitted = true;

    var nameEl = findInput('firstName', form);
    var lastEl = findInput('lastName', form);
    var phoneEl = findInput('phone', form);
    var companyEl = findInput('company', form);
    var jobTitleEl = findInput('jobTitle', form);

    var emailVal = ((emailEl && emailEl.value) || leadData.email || '').trim();
    var nameVal = ((nameEl && nameEl.value) || leadData.firstName || '').trim();
    var lastNameVal = ((lastEl && lastEl.value) || leadData.lastName || '').trim();
    var phoneVal = ((phoneEl && phoneEl.value) || leadData.phone || '').trim();
    var companyVal = ((companyEl && companyEl.value) || leadData.company || '').trim();
    var jobTitleVal = ((jobTitleEl && jobTitleEl.value) || leadData.jobTitle || '').trim();

    // Persist registration session for the post-webinar thank-you page
    try {
      var originStr = config.apiOrigin ? config.apiOrigin.replace(/\\/$/, '') : window.location.origin;
      var icsUrl = originStr + '/api/calendar/' + config.campaignId + (config.token ? '?t=' + encodeURIComponent(config.token) : '');
      sessionStorage.setItem('webinar_attendee', JSON.stringify({
        campaignId: config.campaignId,
        email: emailVal,
        firstName: nameVal,
        jobTitle: jobTitleVal,
        googleCalUrl: googleCalUrl,
        outlookCalUrl: outlookCalUrl,
        icsUrl: icsUrl,
        registeredAt: new Date().toISOString()
      }));
    } catch (storErr) {}

    var payload = JSON.stringify({
      campaignId: config.campaignId,
      token: config.token,
      email: emailVal,
      firstName: nameVal,
      lastName: lastNameVal,
      phone: phoneVal,
      company: companyVal,
      jobTitle: jobTitleVal,
      source: config.source,
      zoomId: config.zoomId,
      submittedAt: new Date().toISOString()
    });

    var endpoint = (config.apiOrigin ? config.apiOrigin.replace(/\\/$/, '') : window.location.origin) + '/api/landing/submit';

    // Send the registration to Webinar Studio. keepalive lets it finish even if the page navigates away.
    if (window.fetch) {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).then(function(res) { return res.json().catch(function() { return {}; }).then(function(body) { return { status: res.status, body: body }; }); })
        .then(function(r) {
          if (r.body && r.body.ok) { showCalendarWidget(emailVal, nameVal, r.body.token); }
          else if (r.status === 409) { showNotice('Registration for this webinar is closed.'); }
          else { hasSubmitted = false; }
        })
        .catch(function() { hasSubmitted = false; });
    } else if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
      showCalendarWidget(emailVal, nameVal);
    }
  }

  function showNotice(text) {
    var n = document.createElement('div');
    n.setAttribute('role', 'status');
    n.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#172738;color:#fff;padding:12px 20px;border-radius:12px;z-index:999999;font-family:system-ui,-apple-system,sans-serif;font-size:14px;';
    n.textContent = text;
    document.body.appendChild(n);
  }

  function showCalendarWidget(email, name, serverToken) {
    if (document.getElementById('webinar-cal-banner')) return;
    var origin = config.apiOrigin ? config.apiOrigin.replace(/\\/$/, '') : window.location.origin;
    // The calendar file is only available with the signed token. An email address alone gets no attendee
    // access, so without a token the banner just confirms and points to the email.
    var token = serverToken || config.token;
    var banner = document.createElement('div');
    banner.id = 'webinar-cal-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#172738;color:#fff;padding:12px 20px;border-radius:12px;z-index:999999;display:flex;align-items:center;gap:14px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;';
    var msg = document.createElement('span');
    msg.textContent = 'You are registered' + (name ? ', ' + name : '') + '.' + (token ? '' : ' Joining details will be sent by email.');
    banner.appendChild(msg);
    if (token) {
      var link = document.createElement('a');
      link.href = origin + '/api/calendar/' + config.campaignId + '?t=' + encodeURIComponent(token);
      link.textContent = 'Add to calendar';
      link.style.cssText = 'background:#1463ff;color:#fff;text-decoration:none;padding:6px 12px;border-radius:6px;font-weight:600;';
      banner.appendChild(link);
    }
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = 'Close';
    close.style.cssText = 'background:transparent;border:none;color:#c0cad6;cursor:pointer;font-size:13px;padding:0 4px;';
    close.onclick = function() { banner.remove(); };
    banner.appendChild(close);
    document.body.appendChild(banner);
  }

  // 4. Attach Listeners
  function attachListeners() {
    autoFill();

    var forms = document.querySelectorAll('form');
    forms.forEach(function(f) {
      f.addEventListener('submit', handleSubmission, { capture: true });
    });

    var submitBtns = document.querySelectorAll('button[type="submit"], input[type="submit"], [data-framer-name*="Submit" i], [data-framer-name*="Register" i], .elementor-button, .wpcf7-submit');
    submitBtns.forEach(function(b) {
      b.addEventListener('click', handleSubmission, { capture: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachListeners);
  } else {
    attachListeners();
  }

  // Retry after delay for Framer/Elementor dynamic client-side hydration
  setTimeout(attachListeners, 500);
  setTimeout(attachListeners, 1500);
})();
</script>`;
}

/**
 * Backward-compatible wrapper for Framer-specific embedding.
 */
export function generateFramerEmbedScript(options: EmbedScriptOptions = {}): string {
  return generateUniversalEmbedScript({ ...options, platform: 'framer' });
}
