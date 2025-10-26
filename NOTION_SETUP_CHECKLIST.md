# ✅ Notion Setup Checklist

## Issue Resolved: Database IDs Updated

The correct database IDs have been set:
- **Calls Database:** `fd2b189c-dfc4-4f46-813d-4035960e7e15`
- **Messages Database:** `40e7c635-6ce0-46a1-86cf-095801399fc8`

---

## 🔑 CRITICAL: Share Databases with Integration

Your Notion integration **MUST** have access to both databases. Follow these steps:

### Step 1: Open Each Database

**Calls Database:**
https://www.notion.so/fd2b189cdfc44f46813d4035960e7e15

**Messages Database:**
https://www.notion.so/40e7c6356ce046a186cf095801399fc8

### Step 2: Share with Integration

For **EACH** database:

1. Click the **"⋯"** menu in the top right
2. Click **"Connections"** or **"Add connections"**
3. Find your integration (should be named something like "OpenPhone Sync" or similar)
4. Click to add the connection
5. Confirm

### Step 3: Verify Integration Has Access

Your integration token starts with: `ntn_66898179631b...`

Make sure this integration is listed in the connections for both databases!

---

## 📋 Required Database Properties

### Calls Database Properties

Your Calls database should have these properties (columns):
- **Call ID** (Title)
- **Direction** (Select: incoming/outgoing)
- **Status** (Select: completed/missed/busy/etc)
- **Duration** (Number)
- **Participants** (Text)
- **OpenPhone User** (Text)
- **Phone Number Used** (Text)
- **Phone Number ID** (Text)
- **Created At** (Date)
- **Answered At** (Date)
- **Completed At** (Date)
- **Has Recording** (Checkbox)
- **Recording URL** (URL)
- **Recording Duration** (Number)
- **Has Transcript** (Checkbox)
- **Transcript** (Text)
- **Has Summary** (Checkbox)
- **Summary** (Text)
- **Next Steps** (Text)
- **Has Voicemail** (Checkbox)
- **Voicemail URL** (URL)

### Messages Database Properties

Your Messages database should have these properties:
- **Message ID** (Title)
- **Direction** (Select: incoming/outgoing)
- **Status** (Select)
- **From** (Phone Number or Text)
- **To** (Text)
- **Content** (Text)
- **OpenPhone User** (Text)
- **Phone Number ID** (Text)
- **Created At** (Date)
- **Has Media** (Checkbox)
- **Media URLs** (Text)

---

## 🧪 Testing

After sharing the databases, test by:

1. **Send a test message** to your OpenPhone number (336-518-5544)
2. **Wait 5-10 seconds**
3. **Check the Messages database** in Notion
4. You should see a new entry!

Or:

1. **Make a test call** to/from your OpenPhone number
2. **Wait for the call to complete**
3. **Check the Calls database** in Notion

---

## 🔍 Troubleshooting

### If you see "No entries appearing":

1. **Check logs:**
   ```bash
   npm run tail
   ```

2. **Verify integration access:**
   - Open each database in Notion
   - Check "Connections" menu
   - Ensure your integration is listed

3. **Check webhook is configured:**
   - Go to: https://app.openphone.com/settings/api
   - Verify webhook URL: `https://openphone-notion-sync.jstanley82.workers.dev/webhooks/openphone`
   - Ensure all event types are selected

### If you see errors in logs:

- **401 Unauthorized:** Integration doesn't have database access
- **404 Not Found:** Database ID is wrong (but we just fixed this!)
- **Invalid properties:** Database is missing required columns

---

## ✅ Current Status

- ✅ Database IDs corrected
- ✅ Secrets updated in Cloudflare
- ✅ Worker redeployed
- ⚠️ **ACTION REQUIRED:** Share databases with integration (see above)

---

## 📞 Your Configuration

- **OpenPhone Number:** (336) 518-5544
- **OpenPhone Number ID:** PNoAZwuWmB
- **Worker URL:** https://openphone-notion-sync.jstanley82.workers.dev
- **Webhook Path:** /webhooks/openphone

---

**Once you've shared the databases with your integration, send a test message or make a call to test!**
