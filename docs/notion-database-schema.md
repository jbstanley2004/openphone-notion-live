# Notion Database Schema

This document describes the Notion database schemas required for the OpenPhone integration.

## Overview

The integration uses **two Notion databases**:
1. **Calls Database** - Stores all call data including recordings, transcripts, and summaries
2. **Messages Database** - Stores all SMS/text message data

---

## Calls Database

### Database Properties

Create a new database in Notion with the following properties:

| Property Name | Property Type | Description |
|--------------|---------------|-------------|
| **Call ID** | Title | Unique OpenPhone call identifier (e.g., AC3700e624...) |
| **Direction** | Select | `incoming` or `outgoing` |
| **Status** | Select | Call status (completed, missed, etc.) |
| **Duration** | Number | Call duration in seconds |
| **Participants** | Text | Comma-separated list of participant phone numbers |
| **OpenPhone User** | Text | OpenPhone user who answered/initiated the call |
| **Phone Number Used** | Text | OpenPhone number used for the call |
| **Phone Number ID** | Text | OpenPhone phone number ID |
| **Created At** | Date | When the call was created/started |
| **Answered At** | Date | When the call was answered |
| **Completed At** | Date | When the call ended |
| **Has Recording** | Checkbox | Whether a recording exists |
| **Recording URL** | URL | Link to the call recording (R2 storage) |
| **Recording Duration** | Number | Recording duration in seconds |
| **Has Transcript** | Checkbox | Whether a transcript exists |
| **Transcript** | Text | Full call transcript |
| **Transcript Status** | Select | `absent`, `in-progress`, `completed`, `failed` |
| **Has Summary** | Checkbox | Whether an AI summary exists |
| **Summary** | Text | AI-generated call summary |
| **Next Steps** | Text | Action items from the call |
| **Has Voicemail** | Checkbox | Whether a voicemail was left |
| **Voicemail URL** | URL | Link to the voicemail recording |
| **Voicemail Transcript** | Text | Voicemail transcription |
| **Call Route** | Text | How the call was routed (phone-number, phone-menu) |
| **Forwarded From** | Text | Who the call was forwarded from |
| **Forwarded To** | Text | Who the call was forwarded to |
| **Raw Data** | Text | Complete JSON data (for debugging) |
| **Synced At** | Date | When the data was synced to Notion |
| **Last Updated** | Date | When the Notion page was last updated |

### Select Options

**Direction:**
- incoming
- outgoing

**Status:**
- queued
- initiated
- ringing
- in-progress
- completed
- busy
- failed
- no-answer
- canceled
- missed
- answered
- forwarded
- abandoned

**Transcript Status:**
- absent
- in-progress
- completed
- failed

---

## Messages Database

### Database Properties

Create a new database in Notion with the following properties:

| Property Name | Property Type | Description |
|--------------|---------------|-------------|
| **Message ID** | Title | Unique OpenPhone message identifier |
| **Direction** | Select | `incoming` or `outgoing` |
| **From** | Phone number | Sender's phone number |
| **To** | Phone number | Recipient's phone number |
| **Content** | Text | Message text content |
| **Status** | Select | Message delivery status |
| **OpenPhone Number** | Text | OpenPhone number used |
| **Phone Number ID** | Text | OpenPhone phone number ID |
| **User ID** | Text | OpenPhone user ID |
| **Created At** | Date | When the message was created |
| **Updated At** | Date | When the message was last updated |
| **Has Media** | Checkbox | Whether the message includes media |
| **Media URLs** | Text | URLs of attached media |
| **Conversation ID** | Text | ID linking related messages |
| **Raw Data** | Text | Complete JSON data (for debugging) |
| **Synced At** | Date | When synced to Notion |

### Select Options

**Direction:**
- incoming
- outgoing

**Status:**
- queued
- sent
- delivered
- undelivered

---

## Creating the Databases

### Method 1: Manual Creation in Notion

1. **Open Notion** and navigate to the workspace where you want to create the databases

2. **Create Calls Database:**
   - Click "+" to create a new page
   - Select "Database" → "Table - Full page"
   - Name it "OpenPhone Calls"
   - Add each property listed above using the "+ Add property" button
   - Configure property types and select options as specified

3. **Create Messages Database:**
   - Repeat the process for "OpenPhone Messages"
   - Add all message properties as specified

4. **Get Database IDs:**
   - Open each database in Notion
   - Copy the database ID from the URL:
     - URL format: `https://notion.so/<database_id>?v=...`
     - The database ID is the 32-character string (with hyphens)
   - Save these IDs for your `.dev.vars` file

5. **Share with Integration:**
   - Click the "..." menu in the top right of each database
   - Select "Add connections"
   - Find and select your OpenPhone integration
   - Grant access

### Method 2: Using Notion API (Programmatic)

You can also create the databases programmatically. Here's a script template:

```typescript
// create-notion-databases.ts
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function createCallsDatabase(parentPageId: string) {
  const response = await notion.databases.create({
    parent: { page_id: parentPageId },
    title: [{ text: { content: 'OpenPhone Calls' } }],
    properties: {
      'Call ID': { title: {} },
      'Direction': { select: { options: [
        { name: 'incoming', color: 'blue' },
        { name: 'outgoing', color: 'green' }
      ]}},
      'Status': { select: { options: [
        { name: 'completed', color: 'green' },
        { name: 'missed', color: 'red' },
        { name: 'in-progress', color: 'yellow' },
        // ... add all status options
      ]}},
      'Duration': { number: { format: 'number' } },
      'Participants': { rich_text: {} },
      'OpenPhone User': { rich_text: {} },
      'Phone Number Used': { rich_text: {} },
      'Phone Number ID': { rich_text: {} },
      'Created At': { date: {} },
      'Answered At': { date: {} },
      'Completed At': { date: {} },
      'Has Recording': { checkbox: {} },
      'Recording URL': { url: {} },
      'Recording Duration': { number: {} },
      'Has Transcript': { checkbox: {} },
      'Transcript': { rich_text: {} },
      'Transcript Status': { select: { options: [
        { name: 'absent', color: 'gray' },
        { name: 'in-progress', color: 'yellow' },
        { name: 'completed', color: 'green' },
        { name: 'failed', color: 'red' },
      ]}},
      'Has Summary': { checkbox: {} },
      'Summary': { rich_text: {} },
      'Next Steps': { rich_text: {} },
      'Has Voicemail': { checkbox: {} },
      'Voicemail URL': { url: {} },
      'Voicemail Transcript': { rich_text: {} },
      'Call Route': { rich_text: {} },
      'Forwarded From': { rich_text: {} },
      'Forwarded To': { rich_text: {} },
      'Raw Data': { rich_text: {} },
      'Synced At': { date: {} },
      'Last Updated': { date: {} },
    },
  });

  console.log('Calls Database created:', response.id);
  return response.id;
}

async function createMessagesDatabase(parentPageId: string) {
  const response = await notion.databases.create({
    parent: { page_id: parentPageId },
    title: [{ text: { content: 'OpenPhone Messages' } }],
    properties: {
      'Message ID': { title: {} },
      'Direction': { select: { options: [
        { name: 'incoming', color: 'blue' },
        { name: 'outgoing', color: 'green' }
      ]}},
      'From': { phone_number: {} },
      'To': { phone_number: {} },
      'Content': { rich_text: {} },
      'Status': { select: { options: [
        { name: 'queued', color: 'gray' },
        { name: 'sent', color: 'yellow' },
        { name: 'delivered', color: 'green' },
        { name: 'undelivered', color: 'red' },
      ]}},
      'OpenPhone Number': { rich_text: {} },
      'Phone Number ID': { rich_text: {} },
      'User ID': { rich_text: {} },
      'Created At': { date: {} },
      'Updated At': { date: {} },
      'Has Media': { checkbox: {} },
      'Media URLs': { rich_text: {} },
      'Conversation ID': { rich_text: {} },
      'Raw Data': { rich_text: {} },
      'Synced At': { date: {} },
    },
  });

  console.log('Messages Database created:', response.id);
  return response.id;
}

// Usage:
// const parentPageId = 'your-notion-page-id-here';
// await createCallsDatabase(parentPageId);
// await createMessagesDatabase(parentPageId);
```

---

## Database Views (Optional)

You can create custom views in Notion to organize your data:

### Calls Database Views

1. **All Calls** (Default)
   - Show all calls sorted by Created At (descending)

2. **Recent Calls**
   - Filter: Created At is within the past 7 days
   - Sort: Created At (descending)

3. **Missed Calls**
   - Filter: Status equals "missed"
   - Sort: Created At (descending)

4. **Calls with Transcripts**
   - Filter: Has Transcript is checked
   - Sort: Created At (descending)

5. **Incomplete Syncs**
   - Filter: Has Recording is unchecked OR Has Transcript is unchecked
   - Filter: Status equals "completed"

### Messages Database Views

1. **All Messages** (Default)
   - Show all messages sorted by Created At (descending)

2. **Recent Messages**
   - Filter: Created At is within the past 7 days
   - Sort: Created At (descending)

3. **Incoming Messages**
   - Filter: Direction equals "incoming"
   - Sort: Created At (descending)

4. **Outgoing Messages**
   - Filter: Direction equals "outgoing"
   - Sort: Created At (descending)

---

## Relations (Optional Advanced Feature)

You can create relations between the two databases:

1. Add a **Relation** property to Messages Database called "Related Call"
2. Link it to the Calls Database
3. This allows you to connect messages to their associated call

This would require custom logic in the sync worker to identify and create these relations.

---

## Tips for Organization

1. **Use Tags**: Add a multi-select property for custom tags/labels
2. **Add Status Property**: Create a status property to track follow-ups (e.g., "Needs Follow-up", "Done", "Scheduled")
3. **Create Templates**: Set up Notion templates for common call types
4. **Board View**: Create a board view organized by Status for visual workflow management
5. **Calendar View**: Use calendar view to see calls by date

---

## Database Maintenance

The integration automatically:
- Creates new pages for new calls/messages
- Updates existing pages when new data becomes available (e.g., transcripts)
- Stores Raw Data field for debugging and data recovery

You should:
- Regularly review and archive old entries
- Monitor the "Last Updated" field to ensure sync is working
- Check failed syncs and manually investigate if needed
