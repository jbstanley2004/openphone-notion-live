/**
 * Notion API Client
 * Handles all interactions with Notion databases
 */

import { NotionFetchClient } from './notion-fetch-client';
import type {
  Call,
  CallRecording,
  CallTranscript,
  CallSummary,
  CallVoicemail,
  Message,
  Mail,
} from '../types/openphone';
import type { Env } from '../types/env';
import {
  createTitle,
  createRichText,
  createNumber,
  createSelect,
  createDate,
  createCheckbox,
  createUrl,
  createPhoneNumber,
  createRelation,
  createEmail,
} from '../types/notion';
import { Logger } from './logger';

export class NotionClient {
  private client: NotionFetchClient;
  private callsDatabaseId: string;
  private messagesDatabaseId: string;
  private canvasDatabaseId: string;
  private mailDatabaseId: string;
  private fundingDatabaseId?: string;
  private batchesDatabaseId?: string;
  private logger: Logger;
  private selfPhoneNumbers: Set<string>;

  constructor(env: Env, logger: Logger) {
    this.logger = logger;
    const notionApiKey = env.NOTION_API_KEY?.trim();
    const callsDatabaseId = env.NOTION_CALLS_DATABASE_ID?.trim();
    const messagesDatabaseId = env.NOTION_MESSAGES_DATABASE_ID?.trim();
    const canvasDatabaseId = env.NOTION_CANVAS_DATABASE_ID?.trim();
    const mailDatabaseId = env.NOTION_MAIL_DATABASE_ID?.trim();
    const fundingDatabaseId = env.NOTION_FUNDING_DATABASE_ID?.trim();
    const batchesDatabaseId = env.NOTION_BATCHES_DATABASE_ID?.trim();

    if (!notionApiKey) {
      throw new Error('NOTION_API_KEY is missing or empty');
    }

    if (!callsDatabaseId) {
      throw new Error('NOTION_CALLS_DATABASE_ID is missing or empty');
    }

    if (!messagesDatabaseId) {
      throw new Error('NOTION_MESSAGES_DATABASE_ID is missing or empty');
    }

    if (!canvasDatabaseId) {
      throw new Error('NOTION_CANVAS_DATABASE_ID is missing or empty');
    }

    if (!mailDatabaseId) {
      throw new Error('NOTION_MAIL_DATABASE_ID is missing or empty');
    }

    this.client = new NotionFetchClient(notionApiKey);
    this.callsDatabaseId = callsDatabaseId;
    this.messagesDatabaseId = messagesDatabaseId;
    this.canvasDatabaseId = canvasDatabaseId;
    this.mailDatabaseId = mailDatabaseId;
    this.fundingDatabaseId = fundingDatabaseId || undefined;
    this.batchesDatabaseId = batchesDatabaseId || undefined;
    this.selfPhoneNumbers = this.parseSelfPhoneNumbers(env.SELF_PHONE_NUMBERS);

    if (this.selfPhoneNumbers.size === 0) {
      this.logger.info(
        'SELF_PHONE_NUMBERS not configured; Canvas resolution will not filter out internal numbers'
      );
    } else {
      this.logger.debug('Loaded SELF_PHONE_NUMBERS configuration', {
        count: this.selfPhoneNumbers.size,
      });
    }
  }

  private normalizeIdentifier(value: unknown): string | null {
    if (Array.isArray(value)) {
      for (const item of value) {
        const normalized = this.normalizeIdentifier(item);
        if (normalized) {
          return normalized;
        }
      }
      return null;
    }

    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return null;
  }

  private extractMailConversationId(mail: Mail): string | null {
    const metadata = (mail.metadata ?? {}) as any;
    const candidates: unknown[] = [
      mail.threadId,
      metadata?.threadId,
      metadata?.thread_id,
      metadata?.conversationId,
      metadata?.conversation_id,
      metadata?.conversation?.id,
      metadata?.conversation?.conversationId,
      metadata?.conversation?.threadId,
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeIdentifier(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private extractMailMimeMessageId(mail: Mail): string | null {
    const metadata = (mail.metadata ?? {}) as any;
    const candidates: unknown[] = [
      metadata?.mimeMessageId,
      metadata?.mime_message_id,
      metadata?.messageId,
      metadata?.message_id,
      metadata?.gmailMessageId,
      metadata?.gmail_message_id,
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeIdentifier(candidate);
      if (normalized) {
        return normalized;
      }
    }

    const headers = metadata?.headers;
    if (headers && typeof headers === 'object') {
      const headerCandidates: unknown[] = [
        headers['Message-ID'],
        headers['Message-Id'],
        headers['message-id'],
      ];

      for (const candidate of headerCandidates) {
        const normalized = this.normalizeIdentifier(candidate);
        if (normalized) {
          return normalized;
        }
      }
    }

    return null;
  }

  getCallsDatabaseId(): string {
    return this.callsDatabaseId;
  }

  getMessagesDatabaseId(): string {
    return this.messagesDatabaseId;
  }

  getCanvasDatabaseId(): string {
    return this.canvasDatabaseId;
  }

  getMailDatabaseId(): string {
    return this.mailDatabaseId;
  }

  getFundingDatabaseId(required = false): string | null {
    if (!this.fundingDatabaseId) {
      if (required) {
        throw new Error('NOTION_FUNDING_DATABASE_ID is required for this operation');
      }
      return null;
    }
    return this.fundingDatabaseId;
  }

  getBatchesDatabaseId(required = false): string | null {
    if (!this.batchesDatabaseId) {
      if (required) {
        throw new Error('NOTION_BATCHES_DATABASE_ID is required for this operation');
      }
      return null;
    }
    return this.batchesDatabaseId;
  }

  /**
   * Retrieve a Notion page by ID
   */
  async getPage(pageId: string): Promise<any | null> {
    try {
      return await this.client.pages.retrieve({ page_id: pageId });
    } catch (error) {
      this.logger.error('Failed to retrieve Notion page', error);
      return null;
    }
  }

  /**
   * Query a database with optional filters, sorts, and pagination
   */
  async queryDatabase(
    databaseId: string,
    options: { filter?: any; sorts?: any; pageSize?: number; startCursor?: string } = {}
  ): Promise<any> {
    try {
      return await this.client.databases.query({
        database_id: databaseId,
        filter: options.filter,
        sorts: options.sorts,
        page_size: options.pageSize,
        start_cursor: options.startCursor,
      });
    } catch (error) {
      this.logger.error('Failed to query Notion database', error);
      throw error;
    }
  }

  /**
   * Resolve Canvas relation for a call
   */
  async resolveCanvasForCall(call: Call): Promise<string | null> {
    const otherParticipants = call.participants.filter(
      (participant) => !this.isSelfPhoneNumber(participant)
    );

    if (otherParticipants.length !== call.participants.length) {
      const skippedParticipants = call.participants.filter((participant) =>
        this.isSelfPhoneNumber(participant)
      );
      this.logger.debug('Skipping Canvas lookup for internal phone numbers', {
        skippedParticipants,
      });
    }

    this.logger.info('Resolving Canvas for call participants', {
      callId: call.id,
      direction: call.direction,
      participants: otherParticipants,
    });

    for (const participant of otherParticipants) {
      const found = await this.findCanvasByPhone(participant);
      if (found) {
        this.logger.info('Found Canvas for call participant', {
          participant,
          canvasId: found,
          direction: call.direction,
        });
        return found;
      }
    }

    this.logger.warn('No Canvas match found for call', {
      callId: call.id,
      participants: otherParticipants,
    });
    return null;
  }

  /**
   * Resolve Canvas relation for a message
   */
  async resolveCanvasForMessage(message: Message): Promise<string | null> {
    const phoneToLookup = message.direction === 'incoming'
      ? message.from
      : (message.to[0] || null);

    if (!phoneToLookup) {
      this.logger.warn('No phone number available to resolve message Canvas', {
        messageId: message.id,
        direction: message.direction,
      });
      return null;
    }

    if (this.isSelfPhoneNumber(phoneToLookup)) {
      this.logger.warn('Skipping Canvas lookup for configured internal phone number', {
        phoneNumber: phoneToLookup,
      });
      return null;
    }

    const canvasId = await this.findCanvasByPhone(phoneToLookup);
    if (!canvasId) {
      this.logger.warn('No Canvas match found for message phone number', {
        phoneNumber: phoneToLookup,
        direction: message.direction,
      });
    }

    return canvasId;
  }

  /**
   * Resolve Canvas relation for mail
   */
  async resolveCanvasForMail(mail: { direction?: string | null; from?: string | null; to?: string[] | null }): Promise<string | null> {
    const emailToLookup = mail.direction === 'incoming'
      ? mail.from
      : (mail.to?.[0] ?? null);

    if (!emailToLookup) {
      this.logger.warn('No email address available to resolve mail Canvas');
      return null;
    }

    const canvasId = await this.findCanvasByEmail(emailToLookup);
    if (!canvasId) {
      this.logger.warn('No Canvas match found for email address', {
        email: emailToLookup,
      });
    }

    return canvasId;
  }

  // ========================================================================
  // Call Database Operations
  // ========================================================================

  /**
   * Create a call page in Notion
   */
  async createCallPage(data: {
    call: Call;
    recordings: CallRecording[];
    transcript: CallTranscript | null;
    summary: CallSummary | null;
    voicemail: CallVoicemail | null;
    recordingUrl?: string; // R2 URL if recording was uploaded
    voicemailUrl?: string; // R2 URL if voicemail was uploaded
  }): Promise<string> {
    const { call, recordings, transcript, summary, voicemail, recordingUrl, voicemailUrl } = data;

    this.logger.info('Creating call page in Notion', { callId: call.id });

    const canvasId = await this.resolveCanvasForCall(call);

    // Format transcript dialogue
    const transcriptText = transcript?.dialogue
      ? transcript.dialogue
          .map((d) => {
            const speaker = d.userId ? `User ${d.userId}` : d.identifier || 'Unknown';
            const time = `[${d.start.toFixed(1)}s - ${d.end.toFixed(1)}s]`;
            return `${time} ${speaker}: ${d.content}`;
          })
          .join('\n\n')
      : '';

    // Format summary
    const summaryText = summary?.summary?.join('\n\n') || '';
    const nextStepsText = summary?.nextSteps?.join('\n') || '';

    // Format participants
    const participantsText = call.participants.join(', ');

    const properties = {
      'Call ID': createTitle(call.id),
      Direction: createSelect(call.direction),
      Status: createSelect(call.status),
      Duration: createNumber(call.duration),
      Participants: createRichText(participantsText),
      'OpenPhone User': createRichText(call.userId || ''),
      'Phone Number Used': createRichText(call.phoneNumberId),
      'Phone Number ID': createRichText(call.phoneNumberId),
      'Created At': createDate(call.createdAt),
      'Answered At': createDate(call.answeredAt),
      'Completed At': createDate(call.completedAt),

      // Recording
      'Has Recording': createCheckbox(recordings.length > 0),
      'Recording URL': createUrl(recordingUrl || recordings[0]?.url || null),
      'Recording Duration': createNumber(recordings[0]?.duration || null),

      // Transcript
      'Has Transcript': createCheckbox(transcript !== null && transcript.status === 'completed'),
      Transcript: createRichText(transcriptText),
      'Transcript Status': createSelect(transcript?.status || 'absent'),

      // Summary
      'Has Summary': createCheckbox(summary !== null && summary.status === 'completed'),
      Summary: createRichText(summaryText),
      'Next Steps': createRichText(nextStepsText),

      // Voicemail
      'Has Voicemail': createCheckbox(voicemail !== null),
      'Voicemail URL': createUrl(voicemailUrl || voicemail?.url || null),
      'Voicemail Transcript': createRichText(voicemail?.transcription || ''),

      // Metadata
      'Call Route': createRichText(call.callRoute || ''),
      'Forwarded From': createRichText(
        typeof call.forwardedFrom === 'string' ? call.forwardedFrom : ''
      ),
      'Forwarded To': createRichText(
        typeof call.forwardedTo === 'string' ? call.forwardedTo : ''
      ),
      'Raw Data': createRichText(
        JSON.stringify(
          {
            call,
            recordings: recordings.map((r) => ({ ...r, url: recordingUrl || r.url })),
            transcript,
            summary,
            voicemail: voicemail ? { ...voicemail, url: voicemailUrl || voicemail.url } : null,
          },
          null,
          2
        )
      ),

      // Canvas Relation
      Canvas: createRelation(canvasId ? [canvasId] : []),

      // Sync tracking
      'Synced At': createDate(new Date().toISOString()),
      'Last Updated': createDate(new Date().toISOString()),
    };

    try {
      const response = await this.client.pages.create({
        parent: {
          database_id: this.callsDatabaseId,
        },
        properties: properties as any,
      });

      this.logger.info('Call page created successfully', {
        callId: call.id,
        notionPageId: response.id,
      });

      return response.id;
    } catch (error) {
      this.logger.error('Failed to create call page', error);
      throw error;
    }
  }

  /**
   * Update an existing call page
   */
  async updateCallPage(
    pageId: string,
    data: {
      call: Call;
      recordings: CallRecording[];
      transcript: CallTranscript | null;
      summary: CallSummary | null;
      voicemail: CallVoicemail | null;
      recordingUrl?: string;
      voicemailUrl?: string;
    }
  ): Promise<void> {
    const { call, recordings, transcript, summary, voicemail, recordingUrl, voicemailUrl } = data;

    this.logger.info('Updating call page in Notion', { callId: call.id, pageId });

    // Format transcript dialogue
    const transcriptText = transcript?.dialogue
      ? transcript.dialogue
          .map((d) => {
            const speaker = d.userId ? `User ${d.userId}` : d.identifier || 'Unknown';
            const time = `[${d.start.toFixed(1)}s - ${d.end.toFixed(1)}s]`;
            return `${time} ${speaker}: ${d.content}`;
          })
          .join('\n\n')
      : '';

    const summaryText = summary?.summary?.join('\n\n') || '';
    const nextStepsText = summary?.nextSteps?.join('\n') || '';

    const properties = {
      Status: createSelect(call.status),
      Duration: createNumber(call.duration),
      'Completed At': createDate(call.completedAt),

      // Recording
      'Has Recording': createCheckbox(recordings.length > 0),
      'Recording URL': createUrl(recordingUrl || recordings[0]?.url || null),
      'Recording Duration': createNumber(recordings[0]?.duration || null),

      // Transcript
      'Has Transcript': createCheckbox(transcript !== null && transcript.status === 'completed'),
      Transcript: createRichText(transcriptText),
      'Transcript Status': createSelect(transcript?.status || 'absent'),

      // Summary
      'Has Summary': createCheckbox(summary !== null && summary.status === 'completed'),
      Summary: createRichText(summaryText),
      'Next Steps': createRichText(nextStepsText),

      // Voicemail
      'Has Voicemail': createCheckbox(voicemail !== null),
      'Voicemail URL': createUrl(voicemailUrl || voicemail?.url || null),
      'Voicemail Transcript': createRichText(voicemail?.transcription || ''),

      'Last Updated': createDate(new Date().toISOString()),
    };

    try {
      await this.client.pages.update({
        page_id: pageId,
        properties: properties as any,
      });

      this.logger.info('Call page updated successfully', { callId: call.id, pageId });
    } catch (error) {
      this.logger.error('Failed to update call page', error);
      throw error;
    }
  }

  // ========================================================================
  // Message Database Operations
  // ========================================================================

  /**
   * Create a message page in Notion
   */
  async createMessagePage(message: Message): Promise<string> {
    this.logger.info('Creating message page in Notion', { messageId: message.id });

    const canvasId = await this.resolveCanvasForMessage(message);

    const properties = {
      'Message ID': createTitle(message.id),
      Direction: createSelect(message.direction),
      From: createPhoneNumber(message.from),
      To: createPhoneNumber(message.to[0] || null),
      Content: createRichText(message.text),
      Status: createSelect(message.status),
      'OpenPhone Number': createRichText(message.phoneNumberId || ''),
      'Phone Number ID': createRichText(message.phoneNumberId || ''),
      'User ID': createRichText(message.userId || ''),
      'Created At': createDate(message.createdAt),
      'Updated At': createDate(message.updatedAt),
      'Has Media': createCheckbox(!!message.media && message.media.length > 0),
      'Media URLs': createRichText(
        message.media?.map((m) => m.url).join('\n') || ''
      ),
      'Conversation ID': createRichText(''), // Could be extracted from related calls/messages
      Canvas: createRelation(canvasId ? [canvasId] : []),
      'Raw Data': createRichText(JSON.stringify(message, null, 2)),
      'Synced At': createDate(new Date().toISOString()),
    };

    try {
      const response = await this.client.pages.create({
        parent: {
          database_id: this.messagesDatabaseId,
        },
        properties: properties as any,
      });

      this.logger.info('Message page created successfully', {
        messageId: message.id,
        notionPageId: response.id,
      });

      return response.id;
    } catch (error) {
      this.logger.error('Failed to create message page', error);
      throw error;
    }
  }

  /**
   * Update an existing message page
   */
  async updateMessagePage(pageId: string, message: Message): Promise<void> {
    this.logger.info('Updating message page in Notion', { messageId: message.id, pageId });

    const properties = {
      Status: createSelect(message.status),
      'Updated At': createDate(message.updatedAt),
      Content: createRichText(message.text),
    };

    try {
      await this.client.pages.update({
        page_id: pageId,
        properties: properties as any,
      });

      this.logger.info('Message page updated successfully', { messageId: message.id, pageId });
    } catch (error) {
      this.logger.error('Failed to update message page', error);
      throw error;
    }
  }

  // ========================================================================
  // Mail Database Operations
  // ========================================================================

  /**
   * Create a mail page in Notion
   */
  async createMailPage(mail: Mail): Promise<string> {
    this.logger.info('Creating mail page in Notion', { mailId: mail.id });

    const canvasId = await this.resolveCanvasForMail({
      direction: mail.direction,
      from: mail.from,
      to: mail.to,
    });

    const conversationId = this.extractMailConversationId(mail);
    const mimeMessageId = this.extractMailMimeMessageId(mail);

    const properties = {
      'Subject': createTitle(mail.subject || '(No Subject)'),
      'Message ID': createRichText(mail.id),
      'From': createEmail(mail.from),
      'To': createRichText(mail.to.join(', ')),
      'CC': createRichText(mail.cc?.join(', ') || ''),
      'BCC': createRichText(mail.bcc?.join(', ') || ''),
      'Body': createRichText(mail.body),
      'Conversation ID': createRichText(conversationId ?? ''),
      'MIME Message ID': createRichText(mimeMessageId ?? ''),
      'Direction': createSelect(mail.direction),
      'Status': createSelect(mail.status),
      'Created At': createDate(mail.createdAt),
      'Updated At': createDate(mail.updatedAt),
      'Has Attachments': createCheckbox(!!mail.attachments && mail.attachments.length > 0),
      'Attachments': createRichText(
        mail.attachments?.map(a => `${a.filename} (${a.contentType}, ${a.size} bytes)`).join('\n') || ''
      ),
      'Canvas': createRelation(canvasId ? [canvasId] : []),
      'Raw Data': createRichText(JSON.stringify(mail, null, 2)),
      'Synced At': createDate(new Date().toISOString()),
    };

    try {
      const response = await this.client.pages.create({
        parent: {
          database_id: this.mailDatabaseId,
        },
        properties: properties as any,
      });

      this.logger.info('Mail page created successfully', {
        mailId: mail.id,
        notionPageId: response.id,
      });

      return response.id;
    } catch (error) {
      this.logger.error('Failed to create mail page', error);
      throw error;
    }
  }

  /**
   * Update an existing mail page
   */
  async updateMailPage(pageId: string, mail: Mail): Promise<void> {
    this.logger.info('Updating mail page in Notion', { mailId: mail.id, pageId });

    const conversationId = this.extractMailConversationId(mail);
    const mimeMessageId = this.extractMailMimeMessageId(mail);

    const properties = {
      'Status': createSelect(mail.status),
      'Updated At': createDate(mail.updatedAt),
      'Body': createRichText(mail.body),
      'Message ID': createRichText(mail.id),
      'Conversation ID': createRichText(conversationId ?? ''),
      'MIME Message ID': createRichText(mimeMessageId ?? ''),
    };

    try {
      await this.client.pages.update({
        page_id: pageId,
        properties: properties as any,
      });

      this.logger.info('Mail page updated successfully', { mailId: mail.id, pageId });
    } catch (error) {
      this.logger.error('Failed to update mail page', error);
      throw error;
    }
  }

  // ========================================================================
  // Search and Query Operations
  // ========================================================================

  /**
   * Search for a page by resource ID (Call ID or Message ID)
   */
  async findPageByResourceId(
    databaseId: string,
    resourceId: string,
    titleProperty: string = 'Call ID',
    propertyType: 'title' | 'rich_text' = 'title'
  ): Promise<string | null> {
    try {
      const filter: any = { property: titleProperty };

      if (propertyType === 'rich_text') {
        filter.rich_text = {
          equals: resourceId,
        };
      } else {
        filter.title = {
          equals: resourceId,
        };
      }

      const response = await this.client.databases.query({
        database_id: databaseId,
        filter,
      });

      if (response.results.length > 0) {
        return response.results[0].id;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to search for page', error);
      return null;
    }
  }

  /**
   * Check if a call page exists
   */
  async callPageExists(callId: string): Promise<string | null> {
    return this.findPageByResourceId(this.callsDatabaseId, callId, 'Call ID');
  }

  /**
   * Check if a message page exists
   */
  async messagePageExists(messageId: string): Promise<string | null> {
    return this.findPageByResourceId(this.messagesDatabaseId, messageId, 'Message ID');
  }

  /**
   * Check if a mail page exists
   */
  async mailPageExists(mailId: string): Promise<string | null> {
    return this.findPageByResourceId(this.mailDatabaseId, mailId, 'Message ID', 'rich_text');
  }

  // ========================================================================
  // Canvas Database Operations
  // ========================================================================

  /**
   * Find a Canvas page by phone number
   * Cleans the phone number (removes +1, spaces, etc.) before searching
   */
  async findCanvasByPhone(phoneNumber: string): Promise<string | null> {
    this.logger.info('Searching for Canvas by phone', { original: phoneNumber });

    try {
      // Format phone number to match Canvas format: XXX-XXX-XXXX
      // OpenPhone sends: +13214436893
      // Canvas stores: 321-443-6893
      const digitsOnly = phoneNumber.replace(/\D/g, '');

      // Remove leading 1 if present (US country code)
      const withoutCountryCode = digitsOnly.startsWith('1') && digitsOnly.length === 11
        ? digitsOnly.substring(1)
        : digitsOnly;

      // Format as XXX-XXX-XXXX if we have 10 digits
      let formattedPhone = '';
      if (withoutCountryCode.length === 10) {
        formattedPhone = `${withoutCountryCode.substring(0, 3)}-${withoutCountryCode.substring(3, 6)}-${withoutCountryCode.substring(6)}`;
      }

      // Try multiple phone number formats
      const formats = [
        formattedPhone,              // 321-443-6893 (Canvas format)
        withoutCountryCode,          // 3214436893
        phoneNumber,                 // +13214436893 (original)
        phoneNumber.replace(/^\+1/, ''), // 3214436893
      ].filter(f => f); // Remove empty strings

      // Remove duplicates
      const uniqueFormats = [...new Set(formats)];
      this.logger.info('Trying phone formats', { formats: uniqueFormats });

      for (const format of uniqueFormats) {
        this.logger.info('Trying phone format', { format });

        // Try phone_number field type (exact match) - PRIMARY method for Canvas
        try {
          const phoneResponse = await this.client.databases.query({
            database_id: this.canvasDatabaseId,
            filter: {
              property: 'Phone',
              phone_number: {
                equals: format,
              },
            },
          });

          this.logger.info('Phone number query completed', {
            format,
            resultsCount: phoneResponse.results.length
          });

          if (phoneResponse.results.length > 0) {
            const canvasId = phoneResponse.results[0].id;
            this.logger.info('Found Canvas record (phone_number field)', {
              phoneNumber,
              format,
              canvasId,
              totalResults: phoneResponse.results.length
            });
            return canvasId;
          }
        } catch (phoneError) {
          this.logger.error('Phone field search failed', {
            format,
            error: String(phoneError),
            stack: phoneError instanceof Error ? phoneError.stack : undefined
          });
        }

        // Try rich_text field type as fallback (contains match)
        try {
          const textResponse = await this.client.databases.query({
            database_id: this.canvasDatabaseId,
            filter: {
              property: 'Phone',
              rich_text: {
                contains: format,
              },
            },
          });

          this.logger.info('Rich text query completed', {
            format,
            resultsCount: textResponse.results.length
          });

          if (textResponse.results.length > 0) {
            const canvasId = textResponse.results[0].id;
            this.logger.info('Found Canvas record (rich_text field)', {
              phoneNumber,
              format,
              canvasId,
              totalResults: textResponse.results.length
            });
            return canvasId;
          }
        } catch (textError) {
          this.logger.error('Rich text search failed for format', {
            format,
            error: String(textError),
            stack: textError instanceof Error ? textError.stack : undefined
          });
        }
      }

      this.logger.warn('No Canvas record found for phone after trying all formats', {
        phoneNumber,
        formatsAttempted: uniqueFormats.length
      });
      return null;
    } catch (error) {
      this.logger.error('Fatal error finding Canvas by phone', {
        phoneNumber,
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return null;
    }
  }

  /**
   * Find a Canvas page by email address
   */
  async findCanvasByEmail(email: string): Promise<string | null> {
    const normalizedEmail = email.toLowerCase().trim();

    this.logger.info('Searching for Canvas by email', { email: normalizedEmail });

    try {
      const response = await this.client.databases.query({
        database_id: this.canvasDatabaseId,
        filter: {
          property: 'Email',
          email: {
            equals: normalizedEmail,
          },
        },
      });

      this.logger.info('Email query completed', {
        email: normalizedEmail,
        resultsCount: response.results.length
      });

      if (response.results.length > 0) {
        const canvasId = response.results[0].id;
        this.logger.info('Found Canvas record by email', {
          email: normalizedEmail,
          canvasId,
          totalResults: response.results.length
        });
        return canvasId;
      }

      this.logger.warn('No Canvas record found for email', { email: normalizedEmail });
      return null;
    } catch (error) {
      this.logger.error('Error finding Canvas by email', {
        email: normalizedEmail,
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return null;
    }
  }

  // ========================================================================
  // Debug / Schema Inspection
  // ========================================================================

  /**
   * Get database schema and sample records for debugging
   */
  async getDebugInfo(): Promise<any> {
    const result: any = {};

    try {
      // Get Canvas schema
      const canvasDb = await this.client.databases.retrieve({
        database_id: this.canvasDatabaseId,
      });

      this.logger.info('Canvas database retrieved', { canvasDb: JSON.stringify(canvasDb).substring(0, 500) });

      result.canvas = {
        raw: canvasDb,
        properties: canvasDb.properties ? Object.entries(canvasDb.properties).map(([name, prop]) => ({
          name,
          type: (prop as any).type,
        })) : [],
        sampleRecords: [],
      };

      // Get sample Canvas records
      const canvasRecords = await this.client.databases.query({
        database_id: this.canvasDatabaseId,
        page_size: 3,
      });

      result.canvas.sampleRecords = canvasRecords.results.map((page: any) => {
        const props = page.properties;
        const title = Object.values(props).find((p: any) => p.type === 'title');
        const titleSegments =
          title && typeof title === 'object' && title !== null && 'title' in (title as any)
            ? (title as any).title
            : [];
        const titleText = Array.isArray(titleSegments)
          ? titleSegments.map((t: any) => t.plain_text).join('')
          : '';

        let phoneValue = null;
        let phoneType = null;
        if (props.Phone) {
          phoneType = props.Phone.type;
          if (props.Phone.type === 'phone_number') {
            phoneValue = props.Phone.phone_number;
          } else if (props.Phone.type === 'rich_text') {
            phoneValue = props.Phone.rich_text.map((t: any) => t.plain_text).join('');
          }
        }

        return {
          id: page.id,
          title: titleText,
          phoneType,
          phoneValue,
        };
      });

      // Get recent Calls records
      const callsRecords = await this.client.databases.query({
        database_id: this.callsDatabaseId,
        page_size: 3,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      });

      result.recentCalls = callsRecords.results.map((page: any) => {
        const props = page.properties;
        return {
          id: page.id,
          callId: props['Call ID']?.title?.[0]?.plain_text,
          direction: props.Direction?.select?.name,
          participants: props.Participants?.rich_text?.map((t: any) => t.plain_text).join(''),
          canvasRelationCount: props.Canvas?.relation?.length || 0,
          canvasIds: props.Canvas?.relation?.map((r: any) => r.id) || [],
        };
      });
    } catch (error) {
      result.error = String(error);
      result.errorStack = error instanceof Error ? error.stack : undefined;
    }

    return result;
  }

  private parseSelfPhoneNumbers(rawValue?: string): Set<string> {
    const normalizedNumbers = new Set<string>();

    if (!rawValue) {
      return normalizedNumbers;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      return normalizedNumbers;
    }

    let entries: string[] = [];

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          entries = parsed
            .map((value) => (typeof value === 'string' ? value : value != null ? String(value) : ''))
            .filter((value) => value.trim().length > 0);
        } else {
          this.logger.warn('SELF_PHONE_NUMBERS JSON value is not an array; falling back to comma parsing');
        }
      } catch (error) {
        this.logger.warn('Failed to parse SELF_PHONE_NUMBERS as JSON array; falling back to comma parsing', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (entries.length === 0) {
      entries = trimmed
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    }

    for (const entry of entries) {
      const variants = this.normalizePhoneNumberVariants(entry);
      for (const variant of variants) {
        normalizedNumbers.add(variant);
      }
    }

    return normalizedNumbers;
  }

  private normalizePhoneNumberVariants(phoneNumber: string): string[] {
    if (!phoneNumber) {
      return [];
    }

    const digitsOnly = phoneNumber.replace(/\D/g, '');
    if (!digitsOnly) {
      return [];
    }

    const variants = new Set<string>();
    variants.add(digitsOnly);

    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      variants.add(digitsOnly.substring(1));
    }

    return Array.from(variants);
  }

  private isSelfPhoneNumber(phoneNumber?: string | null): boolean {
    if (!phoneNumber || this.selfPhoneNumbers.size === 0) {
      return false;
    }

    const variants = this.normalizePhoneNumberVariants(phoneNumber);
    return variants.some((variant) => this.selfPhoneNumbers.has(variant));
  }
}
