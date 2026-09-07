// Pure data, no server-only imports — safe for both client and server code.
// lib/integrationConfig.ts (server-only, touches the DB) imports this too, so
// the schema itself has exactly one source of truth.

export interface IntegrationField {
  key: string;
  label: string;
  secret: boolean;
  placeholder: string;
  optional?: boolean;
}

// Connectors with an empty array have no real API in this build (Zoom is
// CSV-only, LinkedIn automation is ToS-forbidden) — their panel is
// explanatory-only, never a credential form.
export const INTEGRATION_FIELDS: Record<string, IntegrationField[]> = {
  lsq: [
    { key: 'accessKey', label: 'Access Key', secret: true, placeholder: 'Paste your LeadSquared Access Key' },
    { key: 'secretKey', label: 'Secret Key', secret: true, placeholder: 'Paste your LeadSquared Secret Key' },
    { key: 'host', label: 'API Host', secret: false, placeholder: 'e.g. api-in21.leadsquared.com' },
    { key: 'senderEmail', label: 'Sender email', secret: false, optional: true, placeholder: 'Exact email of an ACTIVE LSQ user — becomes the verified From address' },
  ],
  claude: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'Paste your Anthropic API key' }],
  apollo: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'Paste your Apollo API key' }],
  apify: [
    { key: 'apiToken', label: 'API Token', secret: true, placeholder: 'Paste your Apify API token' },
    {
      key: 'actorId',
      label: 'Actor ID',
      secret: false,
      optional: true,
      placeholder: 'apify/google-search-scraper (default) — or your own Actor, e.g. username/actor-name',
    },
  ],
  // User-managed OAuth, same shape as the linkedin entry below — the
  // operator's own Zoom Marketplace app credentials, then Connect does the
  // real three-legged OAuth to a specific Zoom account.
  zoom: [
    { key: 'clientId', label: 'Client ID', secret: false, placeholder: 'Zoom OAuth app Client ID' },
    { key: 'clientSecret', label: 'Client Secret', secret: true, placeholder: 'Zoom OAuth app Client Secret' },
    { key: 'mode', label: 'Mode (live | sandbox)', secret: false, optional: true, placeholder: 'live (default when connected) or sandbox' },
    { key: 'redirectUri', label: 'Redirect URI (HTTPS)', secret: false, optional: true, placeholder: 'https://.../api/auth/zoom/callback' },
    { key: 'accessToken', label: 'Access Token', secret: true, optional: true, placeholder: 'Auto-filled by Connect' },
    { key: 'refreshToken', label: 'Refresh Token', secret: true, optional: true, placeholder: 'Auto-filled by Connect' },
    { key: 'connectedEmail', label: 'Connected account', secret: false, optional: true, placeholder: 'Auto-detected on Connect' },
    { key: 'tokenExpiresAt', label: 'Token expiry', secret: false, optional: true, placeholder: 'Managed automatically' },
  ],
  linkedin: [
    { key: 'clientId', label: 'Client ID', secret: false, placeholder: 'LinkedIn app Client ID' },
    { key: 'clientSecret', label: 'Client Secret', secret: true, placeholder: 'Paste your LinkedIn app Client Secret' },
    { key: 'mode', label: 'Mode (live | sandbox)', secret: false, optional: true, placeholder: 'live (default when connected) or sandbox' },
    { key: 'accessToken', label: 'Access Token', secret: true, optional: true, placeholder: 'Auto-filled by Connect (paste manually to skip OAuth)' },
    { key: 'refreshToken', label: 'Refresh Token', secret: true, optional: true, placeholder: 'Auto-filled by Connect' },
    { key: 'organizationUrn', label: 'Page URN', secret: false, optional: true, placeholder: 'urn:li:organization:1234567 (auto-detected on Connect)' },
    { key: 'tokenExpiresAt', label: 'Token expiry', secret: false, optional: true, placeholder: 'Managed automatically' },
    { key: 'organizationName', label: 'Page name', secret: false, optional: true, placeholder: 'Auto-detected on Connect' },
  ],
  messaging: [
    { key: 'dltEntityId', label: 'DLT Entity ID', secret: false, optional: true, placeholder: 'Your registered TRAI DLT Entity ID' },
    { key: 'dltSenderIds', label: 'DLT Sender IDs', secret: false, optional: true, placeholder: 'Approved 6-character sender IDs, comma-separated' },
    { key: 'dltRoute', label: 'SMS route / template ID', secret: false, optional: true, placeholder: 'Registered DLT template ID for the route in use' },
    { key: 'wabaId', label: 'WhatsApp Business Account ID', secret: false, optional: true, placeholder: 'Meta WABA ID' },
    { key: 'wabaPhoneNumberId', label: 'WhatsApp Phone Number ID', secret: false, optional: true, placeholder: 'Meta phone number ID sends come from' },
    { key: 'wabaTemplateNamespace', label: 'Message template namespace', secret: false, optional: true, placeholder: 'WABA template namespace' },
  ],
};

/** Ids with a credential form but no live API of their own to test against —
 *  the Integrations page hides "Test connection" for these and shows a note
 *  instead, rather than a button whose result would always be meaningless. */
export const REFERENCE_ONLY: string[] = [];

