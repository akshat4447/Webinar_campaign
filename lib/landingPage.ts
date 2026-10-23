import { validateLandingUrl } from '@/lib/landingUrl';

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
  // The same rule the wizard and the Registration tab apply: nothing built from an address that is not a web address.
  if (!trimmed || !validateLandingUrl(trimmed).ok) return '';

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
    // Not a usable web address: no link at all is safer than a made-up one (javascript:, a bare word) that
    // would go into every message. The wizard and the Registration tab refuse such an address up front.
    return '';
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

/** The LeadSquared lead field that records which channel a registration came through. Created once in LeadSquared. */
export const ATTRIBUTION_FIELD_SCHEMA_NAME = 'mx_Channel_Source';

export interface EmbedScriptOptions {
  apiOrigin?: string;
  campaignId?: string;
  zoomId?: string;
  platform?: LandingPlatform;
  /**
   * The landing page address. Lets the script tell the registration form apart from other forms on the same site
   * (a newsletter box in the footer): a form counts when it is on this page's path, or the visitor arrived from a
   * campaign link, or it carries LeadSquared's own hidden fields.
   */
  landingUrl?: string;
}

/**
 * Generates the complete, production-ready universal embed script.
 * Works across Framer, WordPress (Elementor, CF7, Gravity, WPForms),
 * LeadSquared FormTracker, Webflow, and custom HTML.
 */
export function generateUniversalEmbedScript(options: EmbedScriptOptions = {}): string {
  const platform = options.platform || 'universal';
  // Values are written into a <script> block: a "<" is escaped so no value can close the block early.
  const literal = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c');
  const originPlaceholder = options.apiOrigin ? literal(options.apiOrigin.replace(/\/$/, '')) : `window.location.origin`;
  const defaultCampaignId = literal(options.campaignId || '');
  const defaultZoomId = literal(options.zoomId || '');
  let landingPath = '';
  try {
    if (options.landingUrl) landingPath = new URL(/^https?:\/\//i.test(options.landingUrl) ? options.landingUrl : `https://${options.landingUrl}`).pathname.replace(/\/+$/, '');
  } catch {
    landingPath = '';
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

  var origin = config.apiOrigin ? config.apiOrigin.replace(/\\/$/, '') : window.location.origin;

  // The LeadSquared lead field that records the channel, and the hand-off to the thank-you page.
  var ATTRIBUTION_FIELD = ${literal(ATTRIBUTION_FIELD_SCHEMA_NAME)};
  var REG_COOKIE = 'webinar_reg';
  var REG_PARAM = 'webinar_reg';
  var REG_TTL_SECONDS = 1800;

  // The channel as Webinar Studio names it, so LeadSquared holds the same values Studio reports.
  function channelKey(source) {
    var s = String(source || '').toLowerCase().replace(/^\\s+|\\s+$/g, '');
    if (!s) return 'website';
    return s === 'email' ? 'email_campaign' : s;
  }

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
  // Each field is filled once, so a field the visitor has typed in, or one that appears later, is never overwritten.
  var filledEls = [];
  function fillOnce(input, val) {
    if (!input || !val || filledEls.indexOf(input) !== -1) return;
    filledEls.push(input);
    if (input.type !== 'hidden' && input.value) return;
    setReactInputValue(input, val);
  }
  var setVal = fillOnce;

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

  // ---- Cookies shared across the subdomains of one site, so the thank-you page can pick up where the form left off.
  function readCookie(name) {
    var all = String(document.cookie || '').split(';');
    for (var i = 0; i < all.length; i++) {
      var part = all[i].replace(/^\\s+/, '');
      if (part.indexOf(name + '=') === 0) {
        try { return decodeURIComponent(part.substring(name.length + 1)); } catch (e) { return ''; }
      }
    }
    return '';
  }

  function cookieAttrs(maxAge, domain) {
    return '; Max-Age=' + maxAge + '; Path=/; SameSite=Lax' + (window.location.protocol === 'https:' ? '; Secure' : '') + (domain ? '; Domain=' + domain : '');
  }

  function cookieDomains() {
    var host = window.location.hostname || '';
    var parts = host.split('.');
    var list = [];
    if (parts.length < 2 || /^[0-9.]+$/.test(host)) return list;
    for (var i = parts.length - 1; i >= 0; i--) list.push(parts.slice(i).join('.'));
    return list;
  }

  function writeSharedCookie(name, value, maxAge) {
    var encoded = encodeURIComponent(value);
    var domains = cookieDomains();
    document.cookie = name + '=' + encoded + cookieAttrs(0);
    // The broadest domain the browser accepts (the site, not just this subdomain).
    for (var i = 0; i < domains.length; i++) {
      document.cookie = name + '=' + encoded + cookieAttrs(maxAge, domains[i]);
      if (readCookie(name)) return;
    }
    document.cookie = name + '=' + encoded + cookieAttrs(maxAge);
  }

  function clearSharedCookie(name) {
    document.cookie = name + '=' + cookieAttrs(0);
    var domains = cookieDomains();
    for (var i = 0; i < domains.length; i++) document.cookie = name + '=' + cookieAttrs(0, domains[i]);
  }

  function rememberRegistration(form) {
    try {
      // Only the webinar and the time: no personal token travels between pages, so a forwarded link cannot lend its owner's details.
      writeSharedCookie(REG_COOKIE, JSON.stringify({ c: config.campaignId, at: Date.now() }), REG_TTL_SECONDS);
    } catch (e) {}
    // If the thank-you page is on another site the cookie cannot follow, so mark the redirect address as well.
    try {
      var redirect = form && form.querySelector && form.querySelector('input[name="MXHRedirectUrl" i]');
      if (redirect && redirect.value) {
        var next = new URL(redirect.value, window.location.href);
        if (!next.searchParams.get(REG_PARAM)) {
          next.searchParams.set(REG_PARAM, config.campaignId);
          redirect.value = next.toString();
        }
      }
    } catch (e) {}
  }

  // The form carries the channel to LeadSquared in its own field (added to the form when it has none).
  function setAttribution(form) {
    if (!form || !form.querySelector) return;
    var field = form.querySelector('input[name="' + ATTRIBUTION_FIELD + '" i]');
    if (!field) {
      try {
        field = document.createElement('input');
        field.type = 'hidden';
        field.name = ATTRIBUTION_FIELD;
        form.appendChild(field);
      } catch (e) { return; }
    }
    field.value = channelKey(config.source);
  }

  // The script runs on every page of the site, so it has to tell the registration form from any other form with an
  // email box. It acts on a form when the page was opened from a campaign link, when the page is the landing page (or
  // under it), or when the form carries LeadSquared's own hidden fields. Having followed a campaign link earlier in
  // the tab is not enough: a newsletter box visited afterwards must not become a registration.
  var LANDING_PATH = ${literal(landingPath)};
  function isRegistrationForm(form) {
    if (arrivedWith.source || arrivedWith.token) return true;
    var path = (window.location.pathname || '').replace(/\\/+$/, '');
    if (!LANDING_PATH || path === LANDING_PATH || path.indexOf(LANDING_PATH + '/') === 0) return true;
    try {
      if (form && form.querySelector && (form.querySelector('input[name="MXHRedirectUrl" i]') || form.querySelector('input[name="mx_WebinarID" i]') || form.querySelector('input[name="' + ATTRIBUTION_FIELD + '" i]'))) return true;
    } catch (e) {}
    return false;
  }

  // Dual-Dispatch on Submission (Webinar Studio + LeadSquared / WordPress)
  var hasSubmitted = false;
  function handleSubmission(e) {
    if (hasSubmitted) return;

    // Guard: Prevent firing on invalid form inputs (Elementor / HTML5 validation)
    var target = e.target;
    if (!target) return;
    var form = target.tagName === 'FORM' ? target : (target.closest ? target.closest('form') : null);
    if (form && form.checkValidity && !form.checkValidity()) return;
    if (!isRegistrationForm(form)) return;

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

    setAttribution(form);
    rememberRegistration(form);

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

    var endpoint = origin + '/api/landing/submit';

    // Send the registration to Webinar Studio. keepalive lets it finish even if the page navigates away.
    if (window.fetch) {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).then(function(res) { return res.json().catch(function() { return {}; }).then(function(body) { return { status: res.status, body: body }; }); })
        .then(function(r) {
          // A form that keeps the visitor on this page gets the calendar pop-up right away; one that sends them
          // to a thank-you page shows it there instead.
          if (r.body && r.body.ok) { showRegisteredPopup(config.campaignId, r.body.token); }
          else if (r.status === 409) { clearSharedCookie(REG_COOKIE); showNotice('Registration for this webinar is closed.'); }
          else { hasSubmitted = false; }
        })
        .catch(function() { hasSubmitted = false; });
    } else if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
    }
  }

  function showNotice(text) {
    var n = document.createElement('div');
    n.setAttribute('role', 'status');
    n.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#172738;color:#fff;padding:12px 20px;border-radius:12px;z-index:2147483000;font-family:system-ui,-apple-system,sans-serif;font-size:14px;';
    n.textContent = text;
    document.body.appendChild(n);
  }

  // ---- The calendar pop-up: shown on the thank-you page (or on the form page when it does not navigate away).
  var popupRequested = false;

  function makeEl(tag, css, text) {
    var node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text) node.textContent = text;
    return node;
  }

  function icsHref(text) {
    try {
      if (window.Blob && window.URL && URL.createObjectURL) return URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    } catch (e) {}
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(text);
  }

  function showRegisteredPopup(campaignId, token) {
    if (popupRequested || !/^[A-Za-z0-9_-]{8,64}$/.test(String(campaignId || ''))) return;
    popupRequested = true;
    clearSharedCookie(REG_COOKIE);
    if (!window.fetch) { renderPopup(null); return; }
    var url = origin + '/api/landing/event?c=' + encodeURIComponent(campaignId) + (token ? '&t=' + encodeURIComponent(token) : '');
    fetch(url)
      .then(function(res) { return res.json().catch(function() { return null; }); })
      .then(function(data) { renderPopup(data && data.ok && data.event ? data : null); })
      .catch(function() { renderPopup(null); });
  }

  function renderPopup(data) {
    if (document.getElementById('webinar-reg-popup')) return;
    var font = 'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;';
    var overlay = makeEl('div', 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:16px;' + font);
    overlay.id = 'webinar-reg-popup';

    var box = makeEl('div', 'background:#fff;color:#172738;border-radius:16px;max-width:420px;width:100%;padding:24px;box-shadow:0 24px 60px rgba(15,23,42,0.35);');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'webinar-reg-title');

    var title = makeEl('h2', 'margin:0 0 6px;font-size:22px;line-height:1.25;', 'You are registered');
    title.id = 'webinar-reg-title';
    box.appendChild(title);

    var close = makeEl('button', 'margin-top:16px;width:100%;background:transparent;border:1px solid #c0cad6;color:#172738;border-radius:10px;padding:10px 14px;font-size:14px;font-weight:600;cursor:pointer;' + font, 'Close');
    close.type = 'button';

    if (data && data.event) {
      box.appendChild(makeEl('p', 'margin:0;font-size:15px;font-weight:600;', data.event.title || ''));
      var when = '';
      try {
        when = new Date(data.event.start).toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      } catch (e) {}
      if (when) box.appendChild(makeEl('p', 'margin:4px 0 0;font-size:14px;color:#52606d;', when));
      if (!data.event.personal) box.appendChild(makeEl('p', 'margin:8px 0 0;font-size:13px;color:#52606d;', 'Your joining details will be sent by email.'));
      var cal = data.calendar || {};
      box.appendChild(makeEl('p', 'margin:16px 0 8px;font-size:13px;font-weight:600;', 'Add it to your calendar'));
      var grid = makeEl('div', 'display:grid;grid-template-columns:1fr 1fr;gap:8px;');
      var btn = 'display:block;text-align:center;text-decoration:none;background:#1463ff;color:#fff;border-radius:10px;padding:10px 12px;font-size:14px;font-weight:600;' + font;
      var items = [
        { label: 'Google Calendar', href: cal.google, blank: true },
        { label: 'Outlook', href: cal.outlookLive, blank: true },
        { label: 'Microsoft 365', href: cal.outlookOffice, blank: true },
        { label: 'Apple (.ics)', href: cal.ics ? icsHref(cal.ics) : '', download: 'webinar.ics' }
      ];
      for (var i = 0; i < items.length; i++) {
        if (!items[i].href) continue;
        var link = makeEl('a', btn, items[i].label);
        link.href = items[i].href;
        if (items[i].blank) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        if (items[i].download) link.setAttribute('download', items[i].download);
        grid.appendChild(link);
      }
      box.appendChild(grid);
    } else {
      box.appendChild(makeEl('p', 'margin:0;font-size:14px;color:#52606d;', 'Your joining details will be sent by email.'));
    }

    box.appendChild(close);
    overlay.appendChild(box);

    function dismiss() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(ev) { if (ev && ev.key === 'Escape') dismiss(); }
    close.onclick = dismiss;
    overlay.onclick = function(ev) { if (ev && ev.target === overlay) dismiss(); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    try { close.focus(); } catch (e) {}
  }

  // The thank-you page: the visitor just registered on another page and the script remembered it.
  function checkThankYou() {
    if (popupRequested) return;
    var record = null;
    try { var raw = readCookie(REG_COOKIE); record = raw ? JSON.parse(raw) : null; } catch (e) { record = null; }
    if (record && (!record.at || Date.now() - record.at > REG_TTL_SECONDS * 1000)) record = null;
    var campaignId = (record && record.c) || params.get(REG_PARAM) || '';
    if (!campaignId) return;
    // A page that still holds the registration form is the landing page, not the thank-you page.
    if (document.querySelector('input[type="email"]')) return;
    // Used once: take the marker out of the address bar so a refresh or a shared link does not open it again.
    try {
      if (params.get(REG_PARAM) && window.history && window.history.replaceState) {
        var clean = new URL(window.location.href);
        clean.searchParams.delete(REG_PARAM);
        window.history.replaceState(null, '', clean.toString());
      }
    } catch (e) {}
    showRegisteredPopup(campaignId, '');
  }

  // 4. Listen for submissions on the whole document, so a form that appears late (Framer loads sections as they are
  // reached) or a page reached without a reload is handled exactly like one present at load.
  var SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"], [data-framer-name*="Submit" i], [data-framer-name*="Register" i], .elementor-button, .wpcf7-submit';
  document.addEventListener('submit', function(e) { handleSubmission(e); }, true);
  document.addEventListener('click', function(e) {
    var node = e && e.target;
    var button = node && node.closest ? node.closest(SUBMIT_SELECTOR) : null;
    if (button) handleSubmission({ target: button });
  }, true);

  function onPageChange() {
    autoFill();
    checkThankYou();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageChange);
  } else {
    onPageChange();
  }

  // Framer and similar builders change page without reloading: watch for new content and for a new address.
  var changeTimer = 0;
  if (window.MutationObserver && document.documentElement) {
    new MutationObserver(function() {
      if (changeTimer) return;
      changeTimer = setTimeout(function() { changeTimer = 0; onPageChange(); }, 300);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  var lastHref = window.location.href;
  setInterval(function() {
    if (window.location.href === lastHref) return;
    lastHref = window.location.href;
    params = new URLSearchParams(window.location.search);
    onPageChange();
  }, 500);
  setTimeout(onPageChange, 500);
  setTimeout(onPageChange, 1500);
})();
</script>`;
}

/**
 * Backward-compatible wrapper for Framer-specific embedding.
 */
export function generateFramerEmbedScript(options: EmbedScriptOptions = {}): string {
  return generateUniversalEmbedScript({ ...options, platform: 'framer' });
}
