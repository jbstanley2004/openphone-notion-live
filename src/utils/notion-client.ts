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
} from '../types/notion';
import { Logger } from './logger';

export class NotionClient {
  private client: NotionFetchClient;
  private callsDatabaseId: string;
  private messagesDatabaseId: string;
  private canvasDatabaseId: string | null;
  private logger: Logger;

  constructor(env: Env, logger: Logger) {
    const notionApiKey = env.NOTION_API_KEY?.trim();
    const callsDatabaseId = env.NOTION_CALLS_DATABASE_ID?.trim();
    const messagesDatabaseId = env.NOTION_MESSAGES_DATABASE_ID?.trim();
    const canvasDatabaseId = env.NOTION_CANVAS_DATABASE_ID?.trim();

    if (!notionApiKey) {
      throw new Error('NOTION_API_KEY is missing or empty');
    }

    if (!callsDatabaseId) {
      throw new Error('NOTION_CALLS_DATABASE_ID is missing or empty');
    }

    if (!messagesDatabaseId) {
      throw new Error('NOTION_MESSAGES_DATABASE_ID is missing or empty');
    }

    this.client = new NotionFetchClient(notionApiKey);
    this.callsDatabaseId = callsDatabaseId;
    this.messagesDatabaseId = messagesDatabaseId;
    this.canvasDatabaseId = canvasDatabaseId || null;
    this.logger = logger;

    if (!this.canvasDatabaseId) {
      this.logger.warn('NOTION_CANVAS_DATABASE_ID not configured - Canvas relationships will be skipped');
    }
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

    // Find Canvas relation by phone number
    // Look for the "other" participant (not the user's OpenPhone number)
    let canvasId: string | null = null;

    // Try to find the other participant's phone number
    // Typically, if there are 2 participants, one is the user's number
    if (call.participants.length >= 2) {
      // Find the participant that's not the phoneNumberId (user's number)
      const otherParticipant = call.participants.find(p => p !== call.phoneNumberId);
      if (otherParticipant) {
        canvasId = await this.findCanvasByPhone(otherParticipant);
      }
    } else if (call.participants.length === 1) {
      // If only one participant, use that
      canvasId = await this.findCanvasByPhone(call.participants[0]);
    }

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

    // Find Canvas relation by phone number
    // For incoming messages, use the "from" number
    // For outgoing messages, use the "to" number
    let canvasId: string | null = null;

    const phoneToLookup = message.direction === 'incoming'
      ? message.from
      : (message.to[0] || null);

    if (phoneToLookup) {
      canvasId = await this.findCanvasByPhone(phoneToLookup);
    }

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
  // Search and Query Operations
  // ========================================================================

  /**
   * Search for a page by resource ID (Call ID or Message ID)
   */
  async findPageByResourceId(
    databaseId: string,
    resourceId: string,
    titleProperty: string = 'Call ID'
  ): Promise<string | null> {
    try {
      const response = await this.client.databases.query({
        database_id: databaseId,
        filter: {
          property: titleProperty,
          title: {
            equals: resourceId,
          },
        },
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

  // ========================================================================
  // Canvas Database Operations
  // ========================================================================

  /**
   * Find a Canvas page by phone number
   * Cleans the phone number (removes +1, spaces, etc.) before searching
   */
  async findCanvasByPhone(phoneNumber: string): Promise<string | null> {
    // Skip if Canvas database is not configured
    if (!this.canvasDatabaseId) {
      return null;
    }

    // Clean phone number (remove +1, spaces, dashes, parentheses)
    const cleanPhone = phoneNumber.replace(/^\+1/, '').replace(/\D/g, '');

    this.logger.info('Searching for Canvas by phone', {
      original: phoneNumber,
      cleaned: cleanPhone
    });

    try {
      const response = await this.client.databases.query({
        database_id: this.canvasDatabaseId,
        filter: {
          property: 'Phone',
          rich_text: {
            contains: cleanPhone,
          },
        },
      });

      if (response.results.length > 0) {
        const canvasId = response.results[0].id;
        this.logger.info('Found Canvas record', {
          phoneNumber,
          canvasId
        });
        return canvasId;
      }

      this.logger.info('No Canvas record found for phone', { phoneNumber });
      return null;
    } catch (error) {
      this.logger.error('Error finding Canvas by phone', error);
      return null;
    }
  }

  /**
   * Find a Canvas page by email address
   */
  async findCanvasByEmail(email: string): Promise<string | null> {
    // Skip if Canvas database is not configured
    if (!this.canvasDatabaseId) {
      return null;
    }

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

      if (response.results.length > 0) {
        const canvasId = response.results[0].id;
        this.logger.info('Found Canvas record', {
          email: normalizedEmail,
          canvasId
        });
        return canvasId;
      }

      this.logger.info('No Canvas record found for email', { email: normalizedEmail });
      return null;
    } catch (error) {
      this.logger.error('Error finding Canvas by email', error);
      return null;
    }
  }
}
