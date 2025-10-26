/**
 * OpenPhone API Type Definitions
 * Based on OpenPhone API v1 specification
 */

// ============================================================================
// Common Types
// ============================================================================

export type PhoneNumber = string; // E.164 format: +15555555555
export type ISO8601DateTime = string;
export type OpenPhoneID<T extends string> = `${T}${string}`;

// ============================================================================
// Call Types
// ============================================================================

export interface Call {
  id: OpenPhoneID<'AC'>;
  object: 'call';
  answeredAt: ISO8601DateTime | null;
  answeredBy: OpenPhoneID<'US'> | null;
  initiatedBy: OpenPhoneID<'US'> | null;
  direction: 'incoming' | 'outgoing';
  status:
    | 'queued'
    | 'initiated'
    | 'ringing'
    | 'in-progress'
    | 'completed'
    | 'busy'
    | 'failed'
    | 'no-answer'
    | 'canceled'
    | 'missed'
    | 'answered'
    | 'forwarded'
    | 'abandoned';
  completedAt: ISO8601DateTime | null;
  createdAt: ISO8601DateTime;
  callRoute: 'phone-number' | 'phone-menu' | null;
  duration: number; // seconds
  forwardedFrom: PhoneNumber | OpenPhoneID<'US'> | null;
  forwardedTo: PhoneNumber | OpenPhoneID<'US'> | null;
  phoneNumberId: OpenPhoneID<'PN'>;
  participants: PhoneNumber[];
  updatedAt: ISO8601DateTime;
  userId: OpenPhoneID<'US'> | null;
}

export interface CallRecording {
  id: string;
  duration: number | null;
  startTime: ISO8601DateTime | null;
  status:
    | 'absent'
    | 'completed'
    | 'deleted'
    | 'failed'
    | 'in-progress'
    | 'paused'
    | 'processing'
    | 'stopped'
    | 'stopping'
    | null;
  type: string | null; // MIME type e.g., 'audio/mpeg'
  url: string | null; // Download URL
}

export interface CallTranscript {
  callId: OpenPhoneID<'AC'>;
  object: 'callTranscript';
  createdAt: ISO8601DateTime;
  dialogue: CallTranscriptDialogue[] | null;
  duration: number; // seconds
  status: 'absent' | 'in-progress' | 'completed' | 'failed';
}

export interface CallTranscriptDialogue {
  content: string; // The transcribed text
  start: number; // Start time in seconds
  end: number; // End time in seconds
  identifier: PhoneNumber | null; // Speaker's phone number
  userId: OpenPhoneID<'US'> | null; // OpenPhone user ID if applicable
}

export interface CallSummary {
  callId: OpenPhoneID<'AC'>;
  object: 'callSummary';
  status: 'absent' | 'in-progress' | 'completed' | 'failed';
  summary: string[] | null; // Array of summary points
  nextSteps: string[] | null; // Array of action items
  jobs?: Array<{
    icon: string;
    name: string;
    result: {
      data: Array<{
        name: string;
        value: string | number | boolean;
      }>;
    };
  }> | null;
}

export interface CallVoicemail {
  id: string;
  duration: number | null;
  startTime: ISO8601DateTime | null;
  status:
    | 'absent'
    | 'completed'
    | 'deleted'
    | 'failed'
    | 'in-progress'
    | 'paused'
    | 'processing'
    | 'stopped'
    | 'stopping'
    | null;
  transcription: string | null;
  type: string | null; // MIME type
  url: string | null; // Download URL
}

// ============================================================================
// Message Types
// ============================================================================

export interface Message {
  id: OpenPhoneID<'AC'>;
  object: 'message';
  from: PhoneNumber;
  to: PhoneNumber[];
  direction: 'incoming' | 'outgoing';
  text: string; // Message content
  status: 'queued' | 'sent' | 'delivered' | 'undelivered';
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
  userId: OpenPhoneID<'US'> | null;
  phoneNumberId: OpenPhoneID<'PN'> | null;
  media?: MessageMedia[];
}

export interface MessageMedia {
  url: string;
  contentType: string;
  size: number;
}

// ============================================================================
// Contact Types
// ============================================================================

export interface Contact {
  id: string;
  object: 'contact';
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  role: string | null;
  emails: ContactEmail[];
  phoneNumbers: ContactPhoneNumber[];
  customFields: Record<string, any>;
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
}

export interface ContactEmail {
  name: string;
  value: string;
}

export interface ContactPhoneNumber {
  name: string;
  value: PhoneNumber;
}

// ============================================================================
// Phone Number Types
// ============================================================================

export interface OpenPhoneNumber {
  id: OpenPhoneID<'PN'>;
  object: 'phoneNumber';
  number: PhoneNumber;
  name: string;
  createdAt: ISO8601DateTime;
}

// ============================================================================
// User Types
// ============================================================================

export interface User {
  id: OpenPhoneID<'US'>;
  object: 'user';
  email: string;
  firstName: string;
  lastName: string;
  phoneNumbers: OpenPhoneID<'PN'>[];
  role: 'admin' | 'owner' | 'user';
  createdAt: ISO8601DateTime;
}

// ============================================================================
// Webhook Types
// ============================================================================

export type WebhookEventType =
  | 'call.ringing'
  | 'call.completed'
  | 'call.recording.completed'
  | 'call.transcript.completed'
  | 'call.summary.completed'
  | 'message.received'
  | 'message.delivered';

export interface WebhookEvent<T = any> {
  id: OpenPhoneID<'EV'>;
  object: 'event';
  apiVersion: string;
  createdAt: ISO8601DateTime;
  type: WebhookEventType;
  data: {
    object: T;
  };
}

// Specific webhook event types
export type CallRingingEvent = WebhookEvent<Call>;
export type CallCompletedEvent = WebhookEvent<Call>;
export type CallRecordingCompletedEvent = WebhookEvent<Call>;
export type CallTranscriptCompletedEvent = WebhookEvent<CallTranscript>;
export type CallSummaryCompletedEvent = WebhookEvent<CallSummary>;
export type MessageReceivedEvent = WebhookEvent<Message>;
export type MessageDeliveredEvent = WebhookEvent<Message>;

// ============================================================================
// API Response Types
// ============================================================================

export interface OpenPhoneAPIResponse<T> {
  data: T;
}

export interface OpenPhoneAPIListResponse<T> {
  data: T[];
  hasMore?: boolean;
  nextCursor?: string;
}

export interface OpenPhoneAPIError {
  message: string;
  code: string;
  status: number;
  docs: string;
  title: string;
  trace?: string;
  errors?: Array<{
    path: string;
    message: string;
    value?: any;
    schema?: {
      type: string;
    };
  }>;
}

// ============================================================================
// Pagination
// ============================================================================

export interface PaginationParams {
  limit?: number;
  cursor?: string;
}

// ============================================================================
// List Query Parameters
// ============================================================================

export interface CallsListParams extends PaginationParams {
  phoneNumberId?: OpenPhoneID<'PN'>;
  userId?: OpenPhoneID<'US'>;
  direction?: 'incoming' | 'outgoing';
  createdAfter?: ISO8601DateTime;
  createdBefore?: ISO8601DateTime;
}

export interface MessagesListParams extends PaginationParams {
  phoneNumberId?: OpenPhoneID<'PN'>;
  userId?: OpenPhoneID<'US'>;
  direction?: 'incoming' | 'outgoing';
  createdAfter?: ISO8601DateTime;
  createdBefore?: ISO8601DateTime;
}
