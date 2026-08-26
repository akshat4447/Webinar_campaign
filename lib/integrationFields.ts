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
    { key: 'smsStrategy', label: 'SMS strategy', secret: false, optional: true, placeholder: "trigger (default) | direct | auto" },
    { key: 'smsEndpoint', label: 'SMS endpoint', secret: false, optional: true, placeholder: 'Direct path e.g. /LeadManagement.svc/Sms.Sendsms (only for direct)' },
    { key: 'whatsappStrategy', label: 'WhatsApp strategy', secret: false, optional: true, placeholder: "trigger (default) | direct | auto" },
    { key: 'waEndpoint', label: 'WhatsApp endpoint', secret: false, optional: true, placeholder: 'Connector path for direct WhatsApp sends' },
  ],
  claude: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'Paste your Anthropic API key' }],
  apollo: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'Paste your Apollo API key' }],
  apify: [{ key: 'apiToken', label: 'API Token', secret: true, placeholder: 'Paste your Apify API token' }],
  zoom: [],
  linkedin: [
    { key: 'clientId', label: 'Client ID', secret: false, placeholder: 'LinkedIn app Client ID' },
    { key: 'clientSecret', label: 'Client Secret', secret: true, placeholder: 'Paste your LinkedIn app Client Secret' },
    { key: 'accessToken', label: 'Access Token', secret: true, optional: true, placeholder: 'Auto-filled by Connect (paste manually to skip OAuth)' },
    { key: 'refreshToken', label: 'Refresh Token', secret: true, optional: true, placeholder: 'Auto-filled by Connect' },
    { key: 'organizationUrn', label: 'Page URN', secret: false, optional: true, placeholder: 'urn:li:organization:1234567 (auto-detected on Connect)' },
    { key: 'tokenExpiresAt', label: 'Token expiry', secret: false, optional: true, placeholder: 'Managed automatically' },
    { key: 'organizationName', label: 'Page name', secret: false, optional: true, placeholder: 'Auto-detected on Connect' },
  ],
};
