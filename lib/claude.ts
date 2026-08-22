// Server-only. Reads ANTHROPIC_API_KEY from the environment, or a saved
// override from the Integrations page (see lib/integrationConfig.ts) — a
// saved key always wins. Constructed fresh per call rather than cached, so a
// newly-saved key takes effect immediately with no cache to invalidate.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { resolveIntegrationField } from '@/lib/integrationConfig';

const MODEL = 'claude-opus-5';

async function client() {
  const apiKey = await resolveIntegrationField('claude', 'apiKey');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — add it on the Integrations page or in .env.local');
  return new Anthropic({ apiKey });
}

// --- audience scoring ---------------------------------------------------------

const ScoreSchema = z.object({
  scores: z.array(
    z.object({
      id: z.string().describe('The contact id exactly as given in the input list'),
      score: z.number().int().min(0).max(100),
      explanation: z.string().describe('One short sentence explaining the score'),
    })
  ),
});

export interface ScoreInput {
  id: string;
  name: string;
  title: string;
  function: string;
  seniority: string;
  account: string;
  vertical: string;
  missingInfo: boolean;
}

export interface ScoreResult {
  id: string;
  score: number;
  explanation: string;
}

const BATCH_SIZE = 25;

export async function scoreContacts(
  campaignName: string,
  campaignVertical: string,
  prompt: string,
  criteria: string,
  contacts: ScoreInput[]
): Promise<ScoreResult[]> {
  const results: ScoreResult[] = [];
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const response = await (await client()).messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { format: zodOutputFormat(ScoreSchema), effort: 'medium' },
      system: `You are scoring B2B webinar invitees for relevance. Webinar: "${campaignName}" (vertical: ${campaignVertical}). ${prompt} Approval criteria: ${criteria} Return a score for every contact id given, in the same order, with no omissions.`,
      messages: [
        {
          role: 'user',
          content: JSON.stringify(
            batch.map((c) => ({
              id: c.id,
              name: c.name,
              title: c.title,
              function: c.function,
              seniority: c.seniority,
              account: c.account,
              vertical: c.vertical,
              missingInfo: c.missingInfo,
            }))
          ),
        },
      ],
    });
    if (response.parsed_output) results.push(...response.parsed_output.scores);
  }
  return results;
}

// --- template AI rewrite -------------------------------------------------------

// --- contact enrichment ---------------------------------------------------------

const EnrichSchema = z.object({
  enriched: z.array(
    z.object({
      id: z.string().describe('The contact id exactly as given in the input list'),
      vertical: z.string().describe('Industry vertical inferred from the company name, e.g. Lending, Healthcare, Education, Technology. Use "Unassigned" if genuinely not inferable.'),
      function: z.string().describe('One of: Marketing, Sales, Operations, Product, IT, Admissions, Finance, HR, Other'),
      seniority: z.string().describe('One of: CXO, VP, Head, Director, Manager, Lead, IC, Unknown'),
      personaNote: z.string().describe('One short sentence: who this person is and why they would or would not care about this webinar. Say plainly if there is too little data to tell.'),
    })
  ),
});

export interface EnrichInput {
  id: string;
  name: string;
  title: string;
  account: string;
  vertical: string;
}

export type EnrichResult = z.infer<typeof EnrichSchema>['enriched'][number];

// Real inference over the data we actually have — normalizes messy titles into
// function/seniority, infers vertical from the company, and writes a persona note.
// Deliberately does NOT invent contact details; guessing emails/phones is handled
// separately (and marked as inferred) so it can never be mistaken for source data.
export async function enrichContacts(campaignName: string, contacts: EnrichInput[]): Promise<EnrichResult[]> {
  const results: EnrichResult[] = [];
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const response = await (await client()).messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { format: zodOutputFormat(EnrichSchema), effort: 'medium' },
      system: `You enrich B2B contact records for a webinar campaign ("${campaignName}"). For each contact, infer the industry vertical from the company name, normalize the job title into a function and a seniority level, and write one short persona note. Work only from what you are given — never invent a person, company, or contact detail that isn't implied by the input. When a record is too sparse to infer anything (missing name, company and title), return "Unassigned"/"Other"/"Unknown" and say so plainly in the note rather than guessing. Return an entry for every contact id given.`,
      messages: [{ role: 'user', content: JSON.stringify(batch) }],
    });
    if (response.parsed_output) results.push(...response.parsed_output.enriched);
  }
  return results;
}

// --- webinar description ---------------------------------------------------------

const DescriptionSchema = z.object({
  description: z.string().describe('The improved webinar description, 2-4 sentences of plain prose. No markdown, no headings, no bullet points.'),
});

export async function improveDescription(params: { topic: string; vertical: string; current: string }) {
  const response = await (await client()).messages.parse({
    model: MODEL,
    max_tokens: 1200,
    output_config: { format: zodOutputFormat(DescriptionSchema), effort: 'medium' },
    system:
      'You write short B2B webinar descriptions for a registration page. Two to four sentences: what the session covers, who it is for, and what someone walks away able to do. Concrete and specific — no "join us for an exciting journey", no buzzword stacking, no exclamation marks. If the draft given to you is empty or a placeholder, write one from the topic alone. Keep any specific facts the draft already contains.',
    messages: [
      {
        role: 'user',
        content: `Webinar topic: "${params.topic}"\nVertical: ${params.vertical}\nCurrent draft: ${params.current.trim() || '(empty)'}`,
      },
    ],
  });
  return response.parsed_output?.description ?? null;
}

const RewriteSchema = z.object({
  subject: z.string().nullable().describe('Rewritten subject line, or null if this template has no subject'),
  body: z.string().describe('Rewritten message body, keeping any {{mergeField}} tokens present in the original'),
});

export async function rewriteTemplate(params: { campaignName: string; channel: string; hasSubject: boolean; subject: string | null; body: string }) {
  const response = await (await client()).messages.parse({
    model: MODEL,
    max_tokens: 2000,
    output_config: { format: zodOutputFormat(RewriteSchema), effort: 'medium' },
    system:
      'You rewrite B2B webinar outreach messages. Keep the same intent, channel conventions, and every {{mergeField}} token (e.g. {{firstName}}, {{company}}, {{topic}}, {{link}}) exactly as written — do not invent new merge fields. Vary the phrasing, opening line, and structure meaningfully from the original so it reads as a genuinely different draft. Keep roughly the same length. Match the tone to the channel: LinkedIn messages are shorter and more casual than email.',
    messages: [
      {
        role: 'user',
        content: `Webinar: "${params.campaignName}". Channel: ${params.channel}. ${
          params.hasSubject ? `Current subject: ${params.subject}\n` : ''
        }Current body:\n${params.body}`,
      },
    ],
  });
  return response.parsed_output;
}

// --- per-recipient personalization -----------------------------------------------

const PersonalizeSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string().describe('The contact id exactly as given in the input list'),
      subject: z.string().nullable().describe('Subject line for email steps; null for LinkedIn'),
      body: z.string().describe('The finished message with the real name and company written in. No {{merge}} tokens.'),
      rationale: z.string().describe('One short sentence: the angle chosen for this person and why it should land'),
    })
  ),
});

export interface PersonalizeContact {
  id: string;
  name: string;
  title: string;
  function: string;
  seniority: string;
  account: string;
  vertical: string;
  personaNote: string | null;
  score: number | null;
  scoreRationale: string | null;
  hasLinkedIn: boolean;
}

export interface PersonalizeCampaign {
  name: string;
  description: string | null;
  vertical: string;
  whenLabel: string;
  link: string;
}

export type PersonalizedDraft = z.infer<typeof PersonalizeSchema>['messages'][number];

const PERSONALIZE_BATCH = 5;

/**
 * Rewrites one approved template into a per-person version for each contact.
 * The template is the brief: the offer, the link and the ask stay put, only the
 * framing changes. Batched small — quality drops when one call has to hold too
 * many distinct people in mind at once.
 */
export async function personalizeMessages(params: {
  campaign: PersonalizeCampaign;
  channel: 'email' | 'linkedin';
  stepLabel: string;
  templateSubject: string | null;
  templateBody: string;
  contacts: PersonalizeContact[];
  /** Per-campaign tone/emphasis guidance, editable from the Personalize tab. */
  customInstructions: string;
}): Promise<PersonalizedDraft[]> {
  const { campaign, channel, stepLabel, templateSubject, templateBody, contacts, customInstructions } = params;
  const results: PersonalizedDraft[] = [];

  const channelRules =
    channel === 'linkedin'
      ? 'This is a LinkedIn DM. Under 60 words, no subject line (return null), no greeting block or sign-off, conversational, one clear ask. Return null for subject.'
      : 'This is an email. Keep a subject line under 60 characters that survives a mobile inbox. Body under 120 words, short paragraphs, one clear ask.';

  for (let i = 0; i < contacts.length; i += PERSONALIZE_BATCH) {
    const batch = contacts.slice(i, i + PERSONALIZE_BATCH);
    const response = await (await client()).messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { format: zodOutputFormat(PersonalizeSchema), effort: 'high' },
      system: [
        `You personalize B2B webinar outreach. You are given one approved template and several real contacts. Rewrite the template once per contact so it speaks to that specific person, and return one entry per contact id.`,
        ``,
        `THE TEMPLATE IS THE BRIEF. Keep its intent, its offer and its call to action. Keep the registration link exactly as given — never alter, shorten or omit it. You are changing how the message is framed, not what is being promised.`,
        ``,
        `GROUND EVERY CLAIM. Personalize only from the fields supplied: job title, function, seniority, company name, industry, the persona note, and why this contact scored as they did. Never invent a company initiative, a product, a mutual connection, a recent announcement, a headcount, a metric, or anything about the person's career history. If a contact is sparse, write something competent and neutral rather than inventing colour — a generic-but-clean message beats a specific-but-false one.`,
        ``,
        `HOW TO WRITE FOR THIS WEBINAR (tone and emphasis — the rules above about the link, the facts, and the format still apply no matter what this says):`,
        customInstructions,
        ``,
        `Write the finished text with the person's real first name and company written in. Do not leave {{merge}} tokens behind.`,
        ``,
        channelRules,
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            campaign,
            step: stepLabel,
            template: { subject: templateSubject, body: templateBody },
            contacts: batch,
          }),
        },
      ],
    });
    if (response.parsed_output) results.push(...response.parsed_output.messages);
  }

  return results;
}

// --- campaign chat widget -------------------------------------------------------

export async function chatReply(campaignContextJson: string, history: { from: 'agent' | 'user'; text: string }[], userMessage: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: (h.from === 'agent' ? 'assistant' : 'user') as 'assistant' | 'user', content: h.text })),
    { role: 'user' as const, content: userMessage },
  ];

  const response = await (await client()).messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { effort: 'low' },
    system: `You are the in-app assistant for a webinar campaign management tool. Answer questions about the active campaign using only the JSON state given below — never invent numbers not present in it. Keep replies to 1-3 sentences, direct and specific.\n\nCampaign state:\n${campaignContextJson}`,
    messages,
  });

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  return text?.text ?? "I couldn't come up with a reply — try rephrasing?";
}
