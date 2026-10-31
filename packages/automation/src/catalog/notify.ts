/**
 * Notify steps: tell people something. In-App Notification stays inside
 * PostGear; Slack, Teams, Discord and Email leave it, so they run dry in
 * tests unless switched on. Connections hold the webhook links; the graph
 * only ever holds the connection id.
 */
import { z } from 'zod';
import { LIMITS } from '../limits';
import { connectionIdField, connectionName, count, OUT, templateField } from './fields';
import { defineNode, type SummaryContext } from './types';

const NOTIFY_BASICS = {
  typeVersion: 1,
  category: 'notify',
  family: 'green',
  inputs: ['in'],
  outputs: OUT,
  sideEffect: 'external',
  retry: 'transient',
  timeoutClass: 'fast',
  canDisable: true,
  canHandleErrors: true,
} as const;

const WRITE_MESSAGE = { path: 'message', message: 'Write the message to send.' };

function sendsTo(app: string, connectionId: string, ctx: SummaryContext): string {
  const name = connectionName(connectionId, ctx);
  return name ? `Message to ${name}` : `Choose a ${app} connection`;
}

export const inApp = defineNode({
  ...NOTIFY_BASICS,
  type: 'notify.inApp',
  title: 'In-App Notification',
  description: 'Shows a notification in PostGear, and emails it to people who asked for that.',
  keywords: ['notify', 'bell', 'alert', 'notification', 'inbox'],
  icon: 'bell',
  status: 'ready',
  priority: 'P0',
  configSchema: z
    .object({
      title: templateField(200),
      message: templateField(2_000),
      link: templateField(500).optional(),
    })
    .strict(),
  defaultConfig: { title: '', message: '' },
  required: [{ path: 'title', message: 'Write a title for the notification.' }],
  outputShape: [
    { path: 'sent', label: 'Sent', type: 'boolean', sample: true },
    { path: 'title', label: 'Title', type: 'text', sample: 'New post published' },
  ],
  sideEffect: 'internal',
  retry: 'safe',
  summary: () => 'Notifies everyone in the workspace',
  form: {
    tabs: {
      setup: [],
      configure: [
        {
          path: 'title',
          kind: 'text',
          label: 'Title',
          placeholder: 'Enter your notification title',
          acceptsData: true,
          required: true,
        },
        {
          path: 'message',
          kind: 'longText',
          label: 'Message',
          placeholder: 'Enter your message',
          acceptsData: true,
        },
        {
          path: 'link',
          kind: 'text',
          label: 'Link',
          help: 'Optional. Opens when someone clicks the notification.',
          placeholder: 'Enter your link',
          acceptsData: true,
        },
      ],
    },
    notes: ['Everyone in this workspace gets this notification.'],
  },
});

const slackConfig = z
  .object({
    connectionId: connectionIdField,
    message: templateField(3_000),
    /** An optional button link. */
    includeLink: templateField(500).optional(),
    /** Adds "Sent by the workflow {name}". */
    footer: z.boolean(),
  })
  .strict();

export const slack = defineNode({
  ...NOTIFY_BASICS,
  type: 'notify.slack',
  title: 'Slack',
  description: 'Sends a message to a Slack channel.',
  keywords: ['slack', 'message', 'chat', 'team', 'channel'],
  icon: 'slack',
  status: 'ready',
  priority: 'P0',
  configSchema: slackConfig,
  defaultConfig: { connectionId: '', message: '', footer: true },
  required: [WRITE_MESSAGE],
  outputShape: [
    { path: 'sent', label: 'Sent', type: 'boolean', sample: true },
    { path: 'channel', label: 'Slack Channel', type: 'text', sample: 'Marketing Slack' },
    { path: 'preview', label: 'Message Preview', type: 'text', sample: 'New post on Instagram' },
  ],
  connection: { kind: 'slack', field: 'connectionId' },
  summary: (config, ctx) => sendsTo('Slack', config.connectionId, ctx),
  form: {
    tabs: {
      setup: [
        { path: 'connectionId', kind: 'connection', label: 'Slack connection', required: true },
      ],
      configure: [
        {
          path: 'message',
          kind: 'longText',
          label: 'Message',
          placeholder: 'Enter your message',
          acceptsData: true,
          required: true,
        },
        {
          path: 'includeLink',
          kind: 'text',
          label: 'Button link',
          help: 'Optional. Adds a button that opens this link.',
          placeholder: 'Enter your link',
          acceptsData: true,
        },
        {
          path: 'footer',
          kind: 'toggle',
          label: 'Say which workflow sent it',
          help: 'Adds a short line with this workflow’s name under the message.',
        },
      ],
    },
    preview: 'slack',
  },
});

/** Teams' fixed sentences: how to make the link, and who the message comes from. */
export const TEAMS_NOTES = [
  'To make the link, open the Workflows app in Teams and pick the template "Send webhook alerts to a channel".',
  'Choose the team and channel, finish the steps, then copy the link it shows into a Microsoft Teams connection.',
  'Messages appear as sent by the Workflows bot, not by PostGear.',
] as const;

export const teams = defineNode({
  ...NOTIFY_BASICS,
  type: 'notify.teams',
  title: 'Microsoft Teams',
  description: 'Posts a card to a Teams channel through the Teams Workflows app.',
  keywords: ['teams', 'microsoft', 'message', 'chat', 'office'],
  icon: 'teams',
  status: 'ready',
  priority: 'P1',
  configSchema: z
    .object({
      connectionId: connectionIdField,
      title: templateField(200).optional(),
      message: templateField(),
      includeLink: templateField(500).optional(),
    })
    .strict(),
  defaultConfig: { connectionId: '', message: '' },
  required: [WRITE_MESSAGE],
  outputShape: [
    { path: 'sent', label: 'Sent', type: 'boolean', sample: true },
    { path: 'preview', label: 'Message Preview', type: 'text', sample: 'New post on Instagram' },
    { path: 'result', label: 'Result', type: 'text', sample: 'Teams accepted the message.' },
  ],
  connection: { kind: 'teams', field: 'connectionId' },
  summary: (config, ctx) => sendsTo('Teams', config.connectionId, ctx),
  form: {
    tabs: {
      setup: [
        { path: 'connectionId', kind: 'connection', label: 'Teams connection', required: true },
      ],
      configure: [
        {
          path: 'title',
          kind: 'text',
          label: 'Title',
          help: 'Optional. Shown in bold above the message.',
          placeholder: 'Enter your title',
          acceptsData: true,
        },
        {
          path: 'message',
          kind: 'longText',
          label: 'Message',
          placeholder: 'Enter your message',
          acceptsData: true,
          required: true,
        },
        {
          path: 'includeLink',
          kind: 'text',
          label: 'Button link',
          help: 'Optional. Adds a button that opens this link.',
          placeholder: 'Enter your link',
          acceptsData: true,
        },
      ],
    },
    notes: TEAMS_NOTES,
    preview: 'teams',
  },
});

export const discord = defineNode({
  ...NOTIFY_BASICS,
  type: 'notify.discord',
  title: 'Discord',
  description: 'Sends a message to a Discord channel.',
  keywords: ['discord', 'message', 'chat', 'community', 'server'],
  icon: 'discord',
  status: 'ready',
  priority: 'P1',
  configSchema: z
    .object({ connectionId: connectionIdField, message: templateField(2_000) })
    .strict(),
  defaultConfig: { connectionId: '', message: '' },
  required: [WRITE_MESSAGE],
  outputShape: [
    { path: 'sent', label: 'Sent', type: 'boolean', sample: true },
    { path: 'messageId', label: 'Message Id', type: 'text', sample: '1290345678901234567' },
    { path: 'channelId', label: 'Discord Channel Id', type: 'text', sample: '1190345678901234567' },
  ],
  connection: { kind: 'discord', field: 'connectionId' },
  summary: (config, ctx) => sendsTo('Discord', config.connectionId, ctx),
  form: {
    tabs: {
      setup: [
        { path: 'connectionId', kind: 'connection', label: 'Discord connection', required: true },
      ],
      configure: [
        {
          path: 'message',
          kind: 'longText',
          label: 'Message',
          help: 'Up to 2,000 characters. Longer messages are cut to fit.',
          placeholder: 'Enter your message',
          acceptsData: true,
          required: true,
        },
      ],
    },
    notes: ['Mentions like @everyone in the message never ping anyone.'],
    preview: 'discord',
  },
});

export const email = defineNode({
  ...NOTIFY_BASICS,
  type: 'notify.email',
  title: 'Email',
  description: 'Sends a plain email to up to 10 people.',
  keywords: ['email', 'mail', 'send', 'inbox', 'gmail', 'outlook'],
  icon: 'email',
  status: 'ready',
  priority: 'P1',
  configSchema: z
    .object({
      /** Each a template that must resolve to an email address. */
      to: z.array(templateField(320)).max(LIMITS.maxEmailRecipients),
      subject: templateField(200),
      message: templateField(),
    })
    .strict(),
  defaultConfig: { to: [], subject: '', message: '' },
  required: [
    { path: 'to', message: 'Add at least one email address.' },
    { path: 'subject', message: 'Write a subject.' },
    WRITE_MESSAGE,
  ],
  outputShape: [
    { path: 'sent', label: 'Emails Sent', type: 'number', sample: 2 },
    {
      path: 'recipients',
      label: 'Recipients',
      type: 'list',
      of: 'text',
      sample: ['k***@example.com'],
    },
  ],
  summary: (config) =>
    config.to.length ? `Emails ${count(config.to.length, 'person', 'people')}` : 'Add who to email',
  form: {
    tabs: {
      setup: [],
      configure: [
        {
          path: 'to',
          kind: 'recipients',
          label: 'Send to',
          help: `Up to ${LIMITS.maxEmailRecipients} email addresses, typed or from earlier steps.`,
          placeholder: 'Enter your email address',
          acceptsData: true,
          required: true,
          max: LIMITS.maxEmailRecipients,
        },
        {
          path: 'subject',
          kind: 'text',
          label: 'Subject',
          placeholder: 'Enter your subject',
          acceptsData: true,
          required: true,
        },
        {
          path: 'message',
          kind: 'longText',
          label: 'Message',
          placeholder: 'Enter your message',
          acceptsData: true,
          required: true,
        },
      ],
    },
    notes: [
      'Emails are plain text from PostGear, with a line saying which workflow sent them.',
      `A workspace can send ${LIMITS.workflowEmailsPerDay} workflow emails a day.`,
    ],
    preview: 'email',
  },
});

export const whatsapp = defineNode({
  ...NOTIFY_BASICS,
  type: 'notify.whatsapp',
  title: 'WhatsApp',
  description: 'Sends a WhatsApp message from your business number.',
  keywords: ['whatsapp', 'message', 'sms', 'phone', 'meta'],
  icon: 'whatsapp',
  status: 'comingSoon',
  comingSoonReason: 'WhatsApp is coming soon.',
  priority: 'P2',
  configSchema: z.object({ to: templateField(40), message: templateField(1_000) }).strict(),
  defaultConfig: { to: '', message: '' },
  outputShape: [{ path: 'sent', label: 'Sent', type: 'boolean', sample: true }],
  summary: () => 'Coming soon',
});

export const NOTIFY_NODES = [inApp, slack, teams, discord, email, whatsapp];
