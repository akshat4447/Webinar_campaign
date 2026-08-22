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
    { key: 'senderEmail', label: 'Sender email', secret: false, optional: true, placeholder: 'A real user email in your LSQ account — needed to send mail' },
  ],
  claude: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'Paste your Anthropic API key' }],
  apollo: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'Paste your Apollo API key' }],
  apify: [{ key: 'apiToken', label: 'API Token', secret: true, placeholder: 'Paste your Apify API token' }],
  zoom: [],
  linkedin: [],
};
