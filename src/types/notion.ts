/**
 * Notion API Type Definitions
 * Simplified types for our specific use case
 */

// ============================================================================
// Notion Database Property Types
// ============================================================================

export interface NotionDatabaseProperties {
  [key: string]: NotionProperty;
}

export type NotionProperty =
  | TitleProperty
  | RichTextProperty
  | NumberProperty
  | SelectProperty
  | MultiSelectProperty
  | DateProperty
  | CheckboxProperty
  | UrlProperty
  | PhoneNumberProperty
  | EmailProperty
  | FilesProperty;

export interface TitleProperty {
  title: Array<{
    text: {
      content: string;
    };
  }>;
}

export interface RichTextProperty {
  rich_text: Array<{
    text: {
      content: string;
    };
  }>;
}

export interface NumberProperty {
  number: number | null;
}

export interface SelectProperty {
  select: {
    name: string;
  } | null;
}

export interface MultiSelectProperty {
  multi_select: Array<{
    name: string;
  }>;
}

export interface DateProperty {
  date: {
    start: string; // ISO 8601
    end?: string | null;
  } | null;
}

export interface CheckboxProperty {
  checkbox: boolean;
}

export interface UrlProperty {
  url: string | null;
}

export interface PhoneNumberProperty {
  phone_number: string | null;
}

export interface EmailProperty {
  email: string | null;
}

export interface FilesProperty {
  files: Array<{
    name: string;
    type: 'external';
    external: {
      url: string;
    };
  }>;
}

// ============================================================================
// Notion Page Types
// ============================================================================

export interface NotionPage {
  object: 'page';
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: NotionDatabaseProperties;
}

export interface NotionCreatePageRequest {
  parent: {
    database_id: string;
  };
  properties: NotionDatabaseProperties;
  children?: Array<any>; // Block children (for page content)
}

export interface NotionUpdatePageRequest {
  properties: NotionDatabaseProperties;
}

// ============================================================================
// Call Database Schema
// ============================================================================

export interface CallPageProperties {
  // Title
  'Call ID': TitleProperty;

  // Basic call info
  Direction: SelectProperty;
  Status: SelectProperty;
  Duration: NumberProperty;
  Participants: RichTextProperty;

  // OpenPhone identifiers
  'OpenPhone User': RichTextProperty;
  'Phone Number Used': RichTextProperty;
  'Phone Number ID': RichTextProperty;

  // Timestamps
  'Created At': DateProperty;
  'Answered At': DateProperty;
  'Completed At': DateProperty;

  // Recording
  'Has Recording': CheckboxProperty;
  'Recording URL': UrlProperty;
  'Recording Duration': NumberProperty;

  // Transcript
  'Has Transcript': CheckboxProperty;
  'Transcript': RichTextProperty;
  'Transcript Status': SelectProperty;

  // Summary
  'Has Summary': CheckboxProperty;
  Summary: RichTextProperty;
  'Next Steps': RichTextProperty;

  // Voicemail
  'Has Voicemail': CheckboxProperty;
  'Voicemail URL': UrlProperty;
  'Voicemail Transcript': RichTextProperty;

  // Metadata
  'Call Route': RichTextProperty;
  'Forwarded From': RichTextProperty;
  'Forwarded To': RichTextProperty;
  'Raw Data': RichTextProperty; // JSON blob for debugging

  // Sync tracking
  'Synced At': DateProperty;
  'Last Updated': DateProperty;
}

// ============================================================================
// Message Database Schema
// ============================================================================

export interface MessagePageProperties {
  // Title
  'Message ID': TitleProperty;

  // Basic message info
  Direction: SelectProperty;
  From: PhoneNumberProperty;
  To: PhoneNumberProperty;
  Content: RichTextProperty;
  Status: SelectProperty;

  // OpenPhone identifiers
  'OpenPhone Number': RichTextProperty;
  'Phone Number ID': RichTextProperty;
  'User ID': RichTextProperty;

  // Timestamps
  'Created At': DateProperty;
  'Updated At': DateProperty;

  // Media
  'Has Media': CheckboxProperty;
  'Media URLs': RichTextProperty;

  // Metadata
  'Conversation ID': RichTextProperty;
  'Raw Data': RichTextProperty; // JSON blob for debugging

  // Sync tracking
  'Synced At': DateProperty;
}

// ============================================================================
// Helper Functions for Creating Properties
// ============================================================================

export function createTitle(content: string): TitleProperty {
  return {
    title: [
      {
        text: {
          content: content.substring(0, 2000), // Notion title limit
        },
      },
    ],
  };
}

export function createRichText(content: string): RichTextProperty {
  if (!content) {
    return { rich_text: [] };
  }
  // Split into chunks of 2000 characters (Notion limit per text block)
  const chunks = content.match(/.{1,2000}/gs) || [];
  return {
    rich_text: chunks.slice(0, 100).map((chunk) => ({
      text: {
        content: chunk,
      },
    })),
  };
}

export function createNumber(value: number | null): NumberProperty {
  return {
    number: value,
  };
}

export function createSelect(value: string | null): SelectProperty {
  return {
    select: value ? { name: value } : null,
  };
}

export function createMultiSelect(values: string[]): MultiSelectProperty {
  return {
    multi_select: values.map((name) => ({ name })),
  };
}

export function createDate(
  start: string | null,
  end?: string | null
): DateProperty {
  return {
    date: start
      ? {
          start,
          end: end || null,
        }
      : null,
  };
}

export function createCheckbox(value: boolean): CheckboxProperty {
  return {
    checkbox: value,
  };
}

export function createUrl(url: string | null): UrlProperty {
  return {
    url: url,
  };
}

export function createPhoneNumber(
  number: string | null
): PhoneNumberProperty {
  return {
    phone_number: number,
  };
}

export function createEmail(email: string | null): EmailProperty {
  return {
    email: email,
  };
}

export function createFiles(
  files: Array<{ name: string; url: string }>
): FilesProperty {
  return {
    files: files.map((file) => ({
      name: file.name,
      type: 'external' as const,
      external: {
        url: file.url,
      },
    })),
  };
}
