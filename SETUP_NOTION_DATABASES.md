# 🔴 CRITICAL: Set Up Notion Database Properties

## THE ACTUAL PROBLEM

Your Notion databases exist, but they **don't have the required properties (columns)** that the worker needs to create pages.

The error from Notion says:
```
"Message ID is not a property that exists.
From is not a property that exists.
To is not a property that exists.
Content is not a property that exists.
..."
```

You need to manually create these properties in your Notion databases.

---

## MESSAGES DATABASE SETUP

### Database URL
https://www.notion.so/40e7c6356ce046a186cf095801399fc8

### Required Properties (Columns)

Open the database and add these properties:

1. **Message ID** - Type: **Title**
2. **Direction** - Type: **Select** (options: incoming, outgoing)
3. **Status** - Type: **Select** (options: queued, sent, delivered, failed)
4. **From** - Type: **Phone Number** (or Text)
5. **To** - Type: **Text**
6. **Content** - Type: **Text** (make it long text/paragraph)
7. **OpenPhone Number** - Type: **Text**
8. **User ID** - Type: **Text**
9. **Created At** - Type: **Date**
10. **Updated At** - Type: **Date**
11. **Has Media** - Type: **Checkbox**
12. **Media URLs** - Type: **Text** (long text)
13. **Conversation ID** - Type: **Text**

---

## CALLS DATABASE SETUP

### Database URL
https://www.notion.so/fd2b189cdfc44f46813d4035960e7e15

### Required Properties (Columns)

Open the database and add these properties:

1. **Call ID** - Type: **Title**
2. **Direction** - Type: **Select** (options: incoming, outgoing)
3. **Status** - Type: **Select** (options: completed, missed, busy, no-answer, canceled)
4. **Duration** - Type: **Number**
5. **Participants** - Type: **Text**
6. **OpenPhone User** - Type: **Text**
7. **Phone Number Used** - Type: **Text**
8. **Phone Number ID** - Type: **Text**
9. **Created At** - Type: **Date**
10. **Answered At** - Type: **Date**
11. **Completed At** - Type: **Date**
12. **Has Recording** - Type: **Checkbox**
13. **Recording URL** - Type: **URL**
14. **Recording Duration** - Type: **Number**
15. **Has Transcript** - Type: **Checkbox**
16. **Transcript** - Type: **Text** (long text)
17. **Has Summary** - Type: **Checkbox**
18. **Summary** - Type: **Text** (long text)
19. **Next Steps** - Type: **Text** (long text)
20. **Has Voicemail** - Type: **Checkbox**
21. **Voicemail URL** - Type: **URL**

---

## MAIL DATABASE SETUP

### Database URL
Provide the URL to your Mail database (copy the ID from the address bar just like the other databases).

### Required Properties (Columns)

Add these properties to the Mail database with the exact names and types:

1. **Subject** - Type: **Title**
2. **Message ID** - Type: **Text** (rich text)
3. **From** - Type: **Email**
4. **To** - Type: **Text**
5. **CC** - Type: **Text**
6. **BCC** - Type: **Text**
7. **Body** - Type: **Text** (long text)
8. **Conversation ID** - Type: **Text**
9. **MIME Message ID** - Type: **Text**
10. **Direction** - Type: **Select** (options: incoming, outgoing)
11. **Status** - Type: **Select** (options: queued, sent, delivered, failed, bounced)
12. **Created At** - Type: **Date**
13. **Updated At** - Type: **Date**
14. **Has Attachments** - Type: **Checkbox**
15. **Attachments** - Type: **Text** (long text)
16. **Canvas** - Type: **Relation** (link to Canvas database)
17. **Raw Data** - Type: **Text** (long text)
18. **Synced At** - Type: **Date**

These identifiers (**Message ID**, **Conversation ID**, **MIME Message ID**) are required so repeat webhook events update the same page instead of creating duplicates.

---

## HOW TO ADD PROPERTIES IN NOTION

1. Open the database in Notion
2. Look at the top row (the header row with column names)
3. Click the **"+"** button at the far right to add a new property
4. Enter the **exact property name** from the list above
5. Select the **correct property type**
6. Repeat for all properties

**IMPORTANT:** The property names must match EXACTLY (case-sensitive, spacing matters)

---

## ALSO: SHARE DATABASES WITH INTEGRATION

Don't forget to share both databases with your integration:

1. Click **"⋯"** menu in each database
2. Click **"Connections"**
3. Add your integration (token: `ntn_66898179631b...`)

---

## AFTER SETUP

Once you've added all properties to both databases:

1. Send a test message to (336) 518-5544
2. Wait 10 seconds
3. Check the Messages database - you should see a new entry!

---

## VERIFY IT WORKS

```bash
npm run tail
```

You should see:
- ✅ "Creating message page in Notion"
- ✅ "Message page created" (not "Failed to create")
- ✅ No "validation_error" from Notion

---

This is the ACTUAL problem - the databases need their schema configured first.
