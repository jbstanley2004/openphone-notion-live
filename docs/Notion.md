# Notion

```markdown
# Project Instructions: Data Architecture & Workflows for Notion

## Overview

This document provides comprehensive guidance for querying, adding, and analyzing data in Jacob Stanley's Notion workspace. The system centers around merchant funding operations, with Canvas serving as the primary operational hub that connects to all other data sources.

---

## Core Business Context

**Company:** Partnership Payments (ISO of Payroc) - merchant services and funding provider

**Two Service Lines:**

1. **Credit card processing** - All merchants receive payment processing services
2. **Merchant cash advance (MCA) funding** - Subset of merchants receive capital advances with split-funding repayment

**Funding Structure:**

- Factor rate: Typically 1.14-1.16x (average deals) to 1.59x (standard rates)
- Origination fee: 20% of funded amount (standard)
- Holdback/split percentage: 8%-50%, average ~26-27% (standard is 30%)
- Deal sizes: Average $3,500-$5,000 principal
- Repayment: 4-6 months average duration via automatic deductions from daily credit card batches
- Active portfolio: 49-62 funded merchants, $195K-$264K deployed capital

---

## Database Architecture & Relationships

### 1. **Canvas Database** (Primary Operations Hub)

**Data Source URL:** [Canvas](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/88536563188d469ca5b1cd108d5a4433?db=fc0e485b6570460e995b94431b08f0a7&pvs=21)

**Purpose:** Swiss army knife - tracks merchant pipeline, outreach, action items, daily notes, and serves as the central linking point for all communications

**Schema:**

- **Merchant Name** (title) - Business name OR date for daily notes (e.g., "October 15, 2025")
- **Contact Name** (text) - Primary contact person
- **Phone** (phone_number) - Contact phone
- **Email** (email) - Contact email
- **Status** (status) - Pipeline stages:
    - To-do group: Declined, Not started, No response
    - In-progress group: Steve, Follow Up, Other, Docs Out, Signed
    - Complete group: Notes, Funded
- **Recen Notes** (text) - Freeform operational details, action items, updates
- **Owner** (person, limit 1) - Assigned team member (default: Jacob Stanley [user://1c0d872b-594c-8133-9de9-000233073116](user://1c0d872b-594c-8133-9de9-000233073116))
- **Terms** (text) - Financial terms summary
- **Appointment Date** (date) - Scheduled meetings/deadlines
- **Offer amount ($)** (number) - Proposed funding amount
- **Last contacted** (date) - Most recent outreach
- **Next action** (text) - Next step
- **Attachments** (file) - Related documents
- **Created time** / **Last edited time** (timestamps)

**Relations (Critical for Cross-Database Queries):**

- **Call Transcriptions** → links to [ Transcripts ](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/9a626780e16841138e06d567b53cbca0?db=aef0d7f9b67343e29f597e6b3bcd48b0&pvs=21)
- **Mail Records** → links to [Mail](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/20af9371362f8059b824000bd25bde35?db=20af9371362f8031b737fda7c8c9797d&pvs=21)
- **OpenPhone Messages** → links to [OpenPhone Messages](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/8449ab082767409599651df389cd8f90?db=fd2b189cdfc44f46813d4035960e7e15&pvs=21)
- **DBA** → links to [OpenPhone Calls](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/9fafb0d40d344045af43cfa8202b962a?db=40e7c6356ce046a186cf095801399fc8&pvs=21)

**Two Record Types:**

1. **Merchant records** - Named after business (e.g., "Scotty's Tires", "Freddy B's BBQ LLC")
2. **Daily note records** - Named by date (e.g., "October 15, 2025") containing meeting notes and team action items

---

### 2. **Mail Database** (Email Communications)

**Data Source URL:** [Mail](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/20af9371362f8059b824000bd25bde35?db=20af9371362f8031b737fda7c8c9797d&pvs=21)

**Purpose:** Stores all email communications, synced from Outlook/Microsoft 365

**Key Properties:**

- **Subject** (title) - Email subject line
- **From** (email) - Sender email address
- **To** (text) - Recipients
- **Cc/Bcc** (text) - Copy recipients
- **Body** (text) - Full email content
- **Body Preview** (text) - Short preview
- **Date Received** / **DateTimeReceived** (date) - When email arrived
- **DateTimeSent** (date) - When email sent
- **Attachments** (file) - Email attachments
- **Has Attachments** (formula) - Boolean flag
- **Canvas** (relation) → Links back to Canvas records
- **Merchant Name** (rollup) - Rolls up merchant name from Canvas relation
- **Read Status** (checkbox) - Read/unread
- **Flag** (select) - Needs Response, Follow Up, Awaiting Info, Urgent, Important, Completed, No Action Needed
- **Categories** (multi-select) - Important, Personal, Work, Finance, Shopping, Travel, Social, Newsletter, Follow-up
- **Web Link** (url) - Link to original email in Outlook
- **Message ID**, **Conversation ID**, **MIME Message ID** - Email threading identifiers

**Usage Pattern:**

- Emails are automatically synced from Microsoft 365
- When creating/updating Canvas merchant records, query Mail database by merchant email or name to find all relevant communications
- Add "Email Communication Summary" section to Canvas pages with count and key threads

---

### 3. **Call Transcriptions Database** (Phone Calls & SMS)

**Data Source URL:** [ Transcripts ](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/9a626780e16841138e06d567b53cbca0?db=aef0d7f9b67343e29f597e6b3bcd48b0&pvs=21)

**Purpose:** Stores call recordings, transcriptions, and SMS messages from OpenPhone/Quo telephony system

**Key Properties:**

- **Call Title** (title) - Brief description or phone number
- **From** (phone_number) - Caller phone number
- **To** (text) - Recipient phone number(s)
- **Direction** (select) - Incoming, Outgoing, inbound
- **Call Date** (date) - When call occurred
- **Created at** (date) - Source system timestamp
- **Text** (text) - SMS message body or call summary
- **Transcription** (text) - Full call transcription content
- **dialogue** (text) - Raw dialogue text
- **Recordings** (text) - Recording file references
- **Duration (seconds)** (number) - Call length
- **Participants** (text) - Team members on call
- **Attachments** (file) - Audio files, documents
- **Canvas Record** (relation) → Links to merchant Canvas pages
- **Call URL** (url) - Link to original call in OpenPhone
- **Message URL** (text) - Link to message
- **Status** (status) - To review, Processing, Resolved

**Usage Pattern:**

- Calls and SMS sync automatically from OpenPhone/Quo via webhook
- Each merchant Canvas page includes an inline filtered view showing only their calls
- Filter: `Canvas Record = [current page URL]`
- Inline database added using: `<database url="[](https://www.notion.so/aef0d7f9b67343e29f597e6b3bcd48b0?pvs=21)" inline="true" data-source-url="[ Transcripts ](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/9a626780e16841138e06d567b53cbca0?db=aef0d7f9b67343e29f597e6b3bcd48b0&pvs=21)">Call Transcriptions</database>`

---

### 4. **Contacts Database**

**Data Source URL:** [Contacts](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/250f9371362f818e837c000bb4d4c2ef?db=250f9371362f8028b783eaa3afa2152f&pvs=21)

**Purpose:** Central contact directory for all merchant contacts

**Schema:**

- **Company** (title) - Business name
- **Name** (text) - Contact person name
- **Phone** (phone_number) - Contact phone
- **Email** (email) - Contact email

**Usage Pattern:**

- Query by merchant name or email when creating Canvas records
- Cross-reference to populate contact information fields

---

### 5. **Funding Database**

**Data Source URL:** [Funding](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/27cf9371362f80c48545000bd81d25fb?db=27cf9371362f8078985fdee861f71292&pvs=21)

**Purpose:** Tracks all MCA funding agreements and repayment status

**Key Properties:**

- **Merchant** (title) - Merchant name (canonical source for merchant naming)
- **Principal Amount** (number, dollar) - Amount funded
- **Payback Amount** (number, dollar) - Total owed back
- **CC Split %** (number, percent) - Holdback percentage (as decimal, e.g., 0.30 for 30%)
- **Payments** (number, dollar) - Total collected to date
- **Payback Balance** (number, dollar) - Remaining balance
- **Principle Balance** (number, dollar) - Remaining principal
- **Percentage Paid** (number, percent) - Completion rate
- **Ideal Daily Payment** (formula) - Payback Balance ÷ 45
- **Ideal Daily Payment (Display)** (number, dollar) - Formatted display
- **Funding Status** (select) - First, Current, Overpay Balance Applied to Next Fund, Overpay Balance Refunded, Default - Sent to Collections, Active, Completed, Defaulted
- **Confirmation Date** (date) - Funding date
- **Processor Submission Date** (date) - When submitted to processor
- **Last Batch Date** (date) - Most recent batch
- **Processing Company** (select) - Paynt, Payroc, Maverick
- **Durration of Funding** (number) - Term in months
- **Days Active** (number) - Days since funding
- **DBA** (text) - Doing business as name
- **Overpay Amount** (number, dollar) - Overpayment collected
- **Charges Accrued** (number, dollar) - Additional charges
- **Reupped** (checkbox) - Whether renewed
- **Active** / **Complete** (checkbox) - Status flags
- **Weekly Contact** (select) - Contact tracking

**Usage Pattern:**

- Source of truth for merchant names (use this for canonical naming)
- Query when creating Canvas records to populate funding terms
- Used for payback balance analysis and collections tracking

---

### 6. **Batches Database**

**Data Source URL:** [Batches](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/288f9371362f80ff878d000b2fb41f70?db=288f9371362f80c09b02ede1ba22e255&pvs=21)

**Purpose:** Daily credit card processing batch data from Paynt and Payroc processors

**Schema:**

- **Name** (title) - Merchant name (from "Master Company Name" or "DBA Name")
- **MID** (number) - Merchant ID
- **Batch No** (number) - Batch number
- **Batch Date** (date) - Processing date
- **ACH Date** (date) - Settlement date
- **Sales Amt.** (number, dollar) - Gross credit card sales
- **Sales Ct.** (number) - Transaction count
- **Payments** (number, dollar) - **CRITICAL FIELD** - MCA repayment collected from this batch
- **Daily Discount (Fees for MC, Visa, Etc.)** (number) - Processing fees
- **ACH Amount** (number) - Net deposit to merchant
- **Actual Running Totals** (number) - Cumulative payments
- **Actual Funding Balance** (number) - Remaining balance
- **Cr. Ct.** (number) - Credit count
- **Created By** (person) - Who created the record

**Two Processor Formats:**

*Paynt Format:*

- Source columns: Master Company Name, DBA Name, MID, Batch No, Date, Close Date, Net Total, Sales Ct., Sales Amt., Cr. Ct., Received Processor Payment, Daily Discount, ACH Amount, Actual Running Totals, Actual Funding Balance

*Payroc Format:*

- Source columns: Master Company Name, DBA Name, MID, Batches, Batch Date, ACH Date, According to Email Report Net Sales, Sales Ct., Sales Amt., Cr. Ct., According to Email Report Received Processor Payment, Daily Discount, ACH Amount, Actual Running Totals, Actual Funding Balance, Expected Daily Fee Amount

**Usage Pattern:**

- Query for merchant payment history, processing volumes, transaction patterns
- Historical data since July 2025 (1,431+ batches, 81 merchants)
- Daily updates added in batches of 10 via create-pages tool

---

## Canvas as the Swiss Army Knife

**Why Canvas is Central:**

Canvas serves as the operational control center where all data streams converge. It's not just a pipeline tracker - it's a multi-purpose workspace that supports:

1. **Merchant Relationship Management**
    - Track every merchant from initial contact through funding and beyond
    - Store comprehensive operational notes about merchant behavior, processing patterns, special circumstances
    - Link to all communications (emails, calls, SMS) via relations
2. **Daily Operations Log**
    - Date-based records capture daily meeting notes, team discussions, action items
    - Example: "October 15, 2025" record contains notes from 5am meeting with Jamie and Jade
3. **Action Item Tracking**
    - Status-based workflow (Not started, Follow Up, Docs Out, Signed, Funded, etc.)
    - Owner assignment for accountability
    - Next action field for clarity
4. **Communications Hub Rollup**
    - Mail Records relation brings in email threads
    - Call Transcriptions relation brings in call recordings and transcripts
    - Inline filtered databases show only relevant communications per merchant
5. **Contract & Document Repository**
    - Parsed agreement data stored as JSON in page content
    - Attachments field for related files
    - DocuSign web form links
6. **Cross-Database Intelligence**
    - When analyzing a merchant, Canvas provides the single entry point
    - From Canvas, you can see their funding terms (via Funding DB lookup), payment history (via Batches DB), email history (via Mail relation), call history (via Call Transcriptions relation)

---

## Common Workflow Patterns

### Workflow 1: Creating Merchant Canvas Record from Meeting Notes

**Trigger:** User provides meeting notes mentioning merchants

**Process:**

1. **Extract merchant information** from notes (names, contacts, action items, financial terms)
2. **Cross-reference all databases:**
    - Query Funding DB by merchant name → get canonical name, funding terms
    - Query Batches DB by merchant name → get payment activity
    - Query Contacts DB by merchant name/email → get contact details
    - Query Mail DB by merchant email/name in From/To/Subject/Body → get email history
    - Query Call Transcriptions DB → get call records
3. **Search Canvas** for existing record using merchant name
4. **If exists:** Update with new info using update-page (append to Notes, add email summary if new emails found)
5. **If doesn't exist:** Create using full Canvas Merchant Page Template with all cross-referenced data

**Template Structure:**

```markdown
▶ Quick Reference
▶ Contact Information
▶ Funding Terms Summary
▶ Action Items & Timeline
▶ Operational Notes
▶ Email Communication Summary
▶ Open Questions
▶ Parsed Agreement Data
▶ Call Transcriptions (inline filtered database)
```

### Workflow 2: Adding Batch Data

**Trigger:** User provides processor batch report (Paynt or Payroc)

**Process:**

1. **Identify processor format** by examining column headers
2. **Parse each row** and map to Batches schema
3. **Convert dates** to ISO-8601 format (YYYY-MM-DD)
4. **Create pages in batches of 10** with parentDataSourceUrl: [Funding](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/27cf9371362f80c48545000bd81d25fb?db=27cf9371362f8078985fdee861f71292&pvs=21)
5. **Field mappings:**
    - Paynt: "Batch No" → "Batch No", "Date" → Batch Date, "Close Date" → ACH Date, "Received Processor Payment" → Payments
    - Payroc: "Batches" → "Batch No", "Batch Date" → Batch Date, "ACH Date" → ACH Date, "According to Email Report Received Processor Payment" → Payments

### Workflow 3: Parsing Funding Contracts

**Trigger:** User sends contract PDF or image

**Process:**

1. **Extract all contract data** into structured JSON format
2. **Calculate financial terms:**
    - Standard rates: 20% origination, 1.59 factor, 30% holdback
    - origination_fee = funded_amount × 0.20 (dollar amount, not percentage)
    - net_funded_amount = funded_amount - origination_fee
    - total_purchased_amount = funded_amount × factor_rate
    - daily_initial_periodic_amount = total_purchased_amount ÷ 30
3. **Search Canvas** for merchant record
4. **Add parsed JSON** to Canvas page in toggle section with DocuSign link
5. **Create Funding record** if deal is funded

### Workflow 4: Querying Merchant Performance

**Question Types & Database Selection:**

**Payment history, sales, transactions:**

→ Query Batches DB

- Key fields: Name, Sales Amt., Sales Ct., Payments, Batch Date, ACH Date
- Example: "Show me Scotty's Tires payment history for last 30 days"

**Payback balances, principal, total owed:**

→ Query Funding DB

- Key fields: Merchant, Principal Amount, Payback Amount, Payments, Payback Balance, Percentage Paid, Confirmation Date
- Example: "What's the payback balance for Iron Bird Fit?"

**Contact information:**

→ Query Contacts DB or Canvas DB

- Example: "What's the phone number for PDQ Graphics?"

**Email communications:**

→ Query Mail DB, filter by From/To/Subject/Body containing merchant email or name

- Example: "Show me all emails with Bogue Sound Distillery"

**Call history:**

→ Query Call Transcriptions DB, filter by Canvas Record relation or From/To phone numbers

- Example: "Find call transcripts for Chariot Auto"

---

## Example Prompts & Expected Actions

**Prompt 1:** "Add these batch records from Paynt"

→ Action: Parse table, map fields (Date→Batch Date, Received Processor Payment→Payments), create 10 pages at a time in [Batches](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/288f9371362f80ff878d000b2fb41f70?db=288f9371362f80c09b02ede1ba22e255&pvs=21)

**Prompt 2:** "Create Canvas record for Freddy B's BBQ - equipment signed, need to gather bank info and KYC"

→ Action: Search Canvas for "Freddy B's BBQ", if exists update, if not create with Status="Docs Out", Notes="Equipment signed. Need to gather bank info and KYC", query Funding/Batches/Contacts/Mail to populate all available data

**Prompt 3:** "Parse this funding agreement for $5,000 at standard rates"

→ Action: Extract contract data, calculate (origination=$1,000, net=$4,000, payback=$7,950, holdback=30%, daily=$265), format as JSON, search for merchant Canvas page, add to page with DocuSign link

**Prompt 4:** "Show me merchants with payback balance over $3,000 sorted by ideal daily payment"

→ Action: Query Funding DB with WHERE "Payback Balance " > 3000, ORDER BY "Ideal Daily Payment (Display)" DESC

**Prompt 5:** "What was PDQ Graphics total sales volume in October?"

→ Action: Query Batches DB with WHERE "Name" = 'PDQ Graphics' AND "Batch Date" BETWEEN '2025-10-01' AND '2025-10-31', SUM("Sales Amt.")

**Prompt 6:** "Create daily note for October 23 meeting - discussed collections targets and terminal setup for new merchants"

→ Action: Create Canvas record with Merchant Name="October 23, 2025", Status="Not started", Owner=[user://1c0d872b-594c-8133-9de9-000233073116](user://1c0d872b-594c-8133-9de9-000233073116), Recen Notes=[formatted meeting notes with sections: Overall Summary, Key Points, Action Items with assignees, Open Questions]

**Prompt 7:** "Update Scotty's Tires Canvas page with latest call transcript and email summary"

→ Action: Search Canvas for "Scotty's Tires", query Mail DB for emails with merchant, query Call Transcriptions DB for calls, if page uses template format update relevant sections, if not restructure to full template, append new content

---

## Key Retrieval Patterns for Vector Database

**1. Merchant Name Normalization:**

- Primary source: Funding DB and Batches DB (canonical names)
- Handle variations: "Car Wash" = "Harv's Car Wash", legal name vs DBA
- Fix transcription errors: "Lavina's" → "Las Vinas", "Paisley" → "Payzli"

**2. Cross-Database Joins:**

```sql
-- Get merchant with funding and latest batch
SELECT f.*, b."Sales Amt.", b."Payments", b."Batch Date"
FROM "[Funding](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/27cf9371362f80c48545000bd81d25fb?db=27cf9371362f8078985fdee861f71292&pvs=21)" f
LEFT JOIN "[Batches](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/288f9371362f80ff878d000b2fb41f70?db=288f9371362f80c09b02ede1ba22e255&pvs=21)" b ON b."Name" = f."Merchant"
WHERE f."Merchant" = 'Scotty\'s Tires'
ORDER BY b."date:Batch Date:start" DESC
```

**3. Relation-Based Queries:**

- Mail → Canvas: Query Mail DB, check Canvas relation column (JSON array of Canvas page URLs)
- Canvas → Calls: Query Canvas page, parse Call Transcriptions relation field
- Always view related data sources before attempting JOIN queries

**4. Date Filtering:**

- Date properties use expanded keys: `date:Batch Date:start`, `date:Batch Date:end`, `date:Batch Date:is_datetime`
- Use ISO-8601 format: '2025-10-15' for dates, '2025-10-15T14:30:00.000Z' for datetimes

**5. Status-Based Segmentation:**

- Canvas Status for pipeline stage: Not started (action needed), Docs Out (waiting), Signed (ready to fund), Funded (complete)
- Funding Status for deal state: First, Current, Active, Completed, Defaulted

---

## Team Member Context

- **Jacob** - Funding analyst, merchant contact, system architect
- **Jamie** - Approvals, status checks, LLC reinstatement
- **Jade** - Client communications, templates, terminal setup
- **Sham** - Terminals, ACH, activations
- **Steven/Steve** - Daily funding lists, targets

---

## Terminology & Abbreviations

- **MCA** - Merchant Cash Advance
- **ISO** - Independent Sales Organization (Partnership Payments is ISO of Payroc)
- **Holdback/Split** - Percentage of daily card sales retained for repayment
- **Factor Rate** - Pricing multiplier (1.14-1.59x)
- **Origination Fee** - Upfront fee (typically 20%)
- **MPA** - MERCHANT PROCESSING AGREEMENT 
- **RTR** - Remaining To Receive (same as Payback Amount)
- **SPF** - Context-dependent: either email authentication (SPF/DKIM/DMARC) or internal funding split percentage
- **Tranche** - Weekly funding increment
- **10DLC** - A2P (Application-to-Person) texting compliance
- **TPN** - Terminal Profile Number
- **VAR** - Value-Added Reseller file
- **MID** - Merchant ID at processor
- **ZBL** - Zero Balance Letter (bank statement showing account balance)

---

## Data Quality & Validation Rules

1. **Always check for existing records before creating** - Search Canvas, Funding, Contacts first
2. **Use canonical merchant names from Funding/Batches databases**
3. **Percentages as decimals** - CC Split % of 30% = 0.30
4. **Date format consistency** - ISO-8601 (YYYY-MM-DD)
5. **Origination fee is dollar amount** - Not percentage in JSON
6. **Relations require viewing target data source** - Must view [ Transcripts ](https://www.notion.so/d8afd7e8634b40529cc99eec1a164226/ds/9a626780e16841138e06d567b53cbca0?db=aef0d7f9b67343e29f597e6b3bcd48b0&pvs=21) before querying Call Transcriptions relation in Canvas
7. **Batch creation in groups of 10** - Performance optimization
8. **Email Communication Summary only includes NEW emails** when updating existing Canvas pages

---

This architecture enables comprehensive merchant operations management with Canvas as the central hub connecting all data streams for complete operational visibility and efficient cross-database analysis.
```
