import type { Env } from '../types/env';
import type { Logger } from './logger';

export interface MerchantUpsertContext {
  interactionTimestamp?: number | null;
  interactionType?: 'call' | 'message' | 'mail';
  summary?: string | null;
}

export interface InteractionRecordInput {
  id: string;
  canvasId: string;
  interactionType: 'call' | 'message' | 'mail';
  occurredAt: number;
  summary?: string | null;
  direction?: string | null;
  sentiment?: string | null;
  leadScore?: number | null;
  notionPageId?: string | null;
  openphoneId?: string | null;
  mailThreadId?: string | null;
  metadata?: Record<string, any> | null;
}

export interface MailThreadRecordInput {
  threadId: string;
  canvasId: string;
  subject?: string | null;
  lastMessagePreview?: string | null;
  lastMessageAt?: number | null;
  messageCount?: number | null;
  participants?: string[] | null;
  metadata?: Record<string, any> | null;
}

export interface MerchantRow {
  canvas_id: string;
  merchant_uuid: string | null;
  name: string | null;
  primary_phone: string | null;
  primary_phone_normalized: string | null;
  primary_email: string | null;
  primary_email_normalized: string | null;
  status: string | null;
  segment: string | null;
  owner: string | null;
  first_interaction_at: number | null;
  last_interaction_at: number | null;
  total_calls: number;
  total_messages: number;
  total_mail: number;
  last_interaction_type: string | null;
  last_summary: string | null;
  last_synced_at: number;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

export interface InteractionRow {
  id: string;
  canvas_id: string;
  interaction_type: 'call' | 'message' | 'mail';
  direction: string | null;
  summary: string | null;
  sentiment: string | null;
  lead_score: number | null;
  occurred_at: number;
  notion_page_id: string | null;
  openphone_id: string | null;
  mail_thread_id: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

export interface MailThreadRow {
  thread_id: string;
  canvas_id: string;
  subject: string | null;
  last_message_preview: string | null;
  last_message_at: number | null;
  message_count: number;
  participants: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits;
  }
  if (digits.length === 10) {
    return `1${digits}`;
  }
  return digits;
}

function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return normalized || null;
}

function getTitleText(property: any): string | null {
  if (!property) return null;
  if (Array.isArray(property.title)) {
    return property.title.map((t: any) => t.plain_text).join('').trim() || null;
  }
  return null;
}

function getRichText(property: any): string | null {
  if (!property) return null;
  if (Array.isArray(property.rich_text)) {
    return property.rich_text.map((t: any) => t.plain_text).join('').trim() || null;
  }
  return null;
}

function toJson(value: Record<string, any> | null | undefined): string | null {
  if (!value) return null;
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.warn('Failed to serialize metadata for D1', error);
    return null;
  }
}

export async function upsertMerchantFromCanvasPage(
  env: Env,
  logger: Logger,
  canvasPage: any,
  context: MerchantUpsertContext = {}
): Promise<void> {
  if (!canvasPage?.id) {
    logger.warn('Cannot upsert merchant without Canvas ID');
    return;
  }

  const properties = canvasPage.properties || {};
  const name = getTitleText(properties.Name);
  const phone = properties.Phone?.phone_number ?? getRichText(properties.Phone);
  const email = properties.Email?.email ?? getRichText(properties.Email);
  const status = properties.Status?.select?.name ?? properties.Status?.status?.name ?? null;
  const segment = properties.Segment?.select?.name ?? null;
  const owner = properties.Owner?.people?.[0]?.name
    ?? properties.Owner?.people?.[0]?.email
    ?? getRichText(properties.Owner);

  const tags = Array.isArray(properties.Tags?.multi_select)
    ? properties.Tags.multi_select.map((tag: any) => tag.name)
    : undefined;

  const metadata = toJson({
    tags,
    url: canvasPage.url,
    rawProperties: {
      statusType: properties.Status?.type ?? null,
      segmentType: properties.Segment?.type ?? null,
    },
  });

  const normalizedPhone = normalizePhone(phone ?? undefined);
  const normalizedEmail = normalizeEmail(email ?? undefined);
  const now = Date.now();
  const interactionTimestamp = context.interactionTimestamp ?? null;

  const createdAt = canvasPage.created_time ? new Date(canvasPage.created_time).getTime() : now;

  await env.DB.prepare(
    `INSERT INTO merchants (
      canvas_id,
      merchant_uuid,
      name,
      primary_phone,
      primary_phone_normalized,
      primary_email,
      primary_email_normalized,
      status,
      segment,
      owner,
      first_interaction_at,
      last_interaction_at,
      total_calls,
      total_messages,
      total_mail,
      last_interaction_type,
      last_summary,
      last_synced_at,
      metadata,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canvas_id) DO UPDATE SET
      merchant_uuid = excluded.merchant_uuid,
      name = excluded.name,
      primary_phone = excluded.primary_phone,
      primary_phone_normalized = excluded.primary_phone_normalized,
      primary_email = excluded.primary_email,
      primary_email_normalized = excluded.primary_email_normalized,
      status = excluded.status,
      segment = excluded.segment,
      owner = excluded.owner,
      first_interaction_at = CASE
        WHEN merchants.first_interaction_at IS NULL THEN excluded.first_interaction_at
        WHEN excluded.first_interaction_at IS NULL THEN merchants.first_interaction_at
        WHEN excluded.first_interaction_at < merchants.first_interaction_at THEN excluded.first_interaction_at
        ELSE merchants.first_interaction_at
      END,
      last_interaction_at = CASE
        WHEN excluded.last_interaction_at IS NULL THEN merchants.last_interaction_at
        WHEN merchants.last_interaction_at IS NULL THEN excluded.last_interaction_at
        WHEN excluded.last_interaction_at > merchants.last_interaction_at THEN excluded.last_interaction_at
        ELSE merchants.last_interaction_at
      END,
      last_interaction_type = CASE
        WHEN excluded.last_interaction_at IS NOT NULL AND (merchants.last_interaction_at IS NULL OR excluded.last_interaction_at >= merchants.last_interaction_at)
          THEN excluded.last_interaction_type
        ELSE merchants.last_interaction_type
      END,
      last_summary = CASE
        WHEN excluded.last_interaction_at IS NOT NULL AND (merchants.last_interaction_at IS NULL OR excluded.last_interaction_at >= merchants.last_interaction_at)
          THEN excluded.last_summary
        ELSE merchants.last_summary
      END,
      last_synced_at = excluded.last_synced_at,
      metadata = COALESCE(excluded.metadata, merchants.metadata),
      updated_at = excluded.updated_at;
    `
  )
    .bind(
      canvasPage.id,
      canvasPage.id,
      name,
      phone,
      normalizedPhone,
      email,
      normalizedEmail,
      status,
      segment,
      owner,
      interactionTimestamp,
      interactionTimestamp,
      context.interactionType ?? null,
      context.summary ?? null,
      now,
      metadata,
      createdAt,
      now
    )
    .run();
}

export async function recordInteraction(
  env: Env,
  logger: Logger,
  record: InteractionRecordInput
): Promise<void> {
  logger.debug('Recording interaction in D1', {
    interactionId: record.id,
    canvasId: record.canvasId,
    type: record.interactionType,
  });
  const now = Date.now();
  const metadataJson = toJson(record.metadata ?? undefined);

  const existing = await env.DB.prepare(
    'SELECT id, occurred_at FROM interactions WHERE id = ?'
  ).bind(record.id).first<{ id: string; occurred_at: number }>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE interactions SET
        interaction_type = ?,
        direction = ?,
        summary = ?,
        sentiment = ?,
        lead_score = ?,
        occurred_at = ?,
        notion_page_id = COALESCE(?, notion_page_id),
        openphone_id = COALESCE(?, openphone_id),
        mail_thread_id = COALESCE(?, mail_thread_id),
        metadata = COALESCE(?, metadata),
        updated_at = ?
      WHERE id = ?`
    )
      .bind(
        record.interactionType,
        record.direction ?? null,
        record.summary ?? null,
        record.sentiment ?? null,
        record.leadScore ?? null,
        record.occurredAt,
        record.notionPageId ?? null,
        record.openphoneId ?? null,
        record.mailThreadId ?? null,
        metadataJson,
        now,
        record.id
      )
      .run();

    await env.DB.prepare(
      `UPDATE merchants SET
        last_interaction_at = CASE
          WHEN ? > IFNULL(last_interaction_at, 0) THEN ?
          ELSE last_interaction_at
        END,
        last_interaction_type = CASE
          WHEN ? > IFNULL(last_interaction_at, 0) THEN ?
          ELSE last_interaction_type
        END,
        last_summary = CASE
          WHEN ? > IFNULL(last_interaction_at, 0) THEN ?
          ELSE last_summary
        END,
        updated_at = ?
      WHERE canvas_id = ?`
    )
      .bind(
        record.occurredAt,
        record.occurredAt,
        record.occurredAt,
        record.interactionType,
        record.occurredAt,
        record.summary ?? null,
        now,
        record.canvasId
      )
      .run();

    return;
  }

  await env.DB.prepare(
    `INSERT INTO interactions (
      id,
      canvas_id,
      interaction_type,
      direction,
      summary,
      sentiment,
      lead_score,
      occurred_at,
      notion_page_id,
      openphone_id,
      mail_thread_id,
      metadata,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      record.id,
      record.canvasId,
      record.interactionType,
      record.direction ?? null,
      record.summary ?? null,
      record.sentiment ?? null,
      record.leadScore ?? null,
      record.occurredAt,
      record.notionPageId ?? null,
      record.openphoneId ?? null,
      record.mailThreadId ?? null,
      metadataJson,
      now,
      now
    )
    .run();

  await env.DB.prepare(
    `UPDATE merchants SET
      total_calls = total_calls + CASE WHEN ? = 'call' THEN 1 ELSE 0 END,
      total_messages = total_messages + CASE WHEN ? = 'message' THEN 1 ELSE 0 END,
      total_mail = total_mail + CASE WHEN ? = 'mail' THEN 1 ELSE 0 END,
      last_interaction_at = CASE
        WHEN ? > IFNULL(last_interaction_at, 0) THEN ?
        ELSE last_interaction_at
      END,
      last_interaction_type = CASE
        WHEN ? > IFNULL(last_interaction_at, 0) THEN ?
        ELSE last_interaction_type
      END,
      last_summary = CASE
        WHEN ? > IFNULL(last_interaction_at, 0) THEN ?
        ELSE last_summary
      END,
      updated_at = ?
    WHERE canvas_id = ?`
  )
    .bind(
      record.interactionType,
      record.interactionType,
      record.interactionType,
      record.occurredAt,
      record.occurredAt,
      record.occurredAt,
      record.interactionType,
      record.occurredAt,
      record.summary ?? null,
      now,
      record.canvasId
    )
    .run();
}

export async function upsertMailThread(
  env: Env,
  logger: Logger,
  thread: MailThreadRecordInput
): Promise<void> {
  logger.debug('Upserting mail thread in D1', {
    threadId: thread.threadId,
    canvasId: thread.canvasId,
  });
  const now = Date.now();
  const metadataJson = toJson(thread.metadata ?? undefined);
  const participants = thread.participants?.join(', ') ?? null;

  await env.DB.prepare(
    `INSERT INTO mail_threads (
      thread_id,
      canvas_id,
      subject,
      last_message_preview,
      last_message_at,
      message_count,
      participants,
      metadata,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      canvas_id = excluded.canvas_id,
      subject = excluded.subject,
      last_message_preview = excluded.last_message_preview,
      last_message_at = CASE
        WHEN excluded.last_message_at IS NULL THEN mail_threads.last_message_at
        WHEN mail_threads.last_message_at IS NULL THEN excluded.last_message_at
        WHEN excluded.last_message_at > mail_threads.last_message_at THEN excluded.last_message_at
        ELSE mail_threads.last_message_at
      END,
      message_count = CASE
        WHEN excluded.message_count IS NULL THEN mail_threads.message_count
        ELSE excluded.message_count
      END,
      participants = COALESCE(excluded.participants, mail_threads.participants),
      metadata = COALESCE(excluded.metadata, mail_threads.metadata),
      updated_at = excluded.updated_at;
    `
  )
    .bind(
      thread.threadId,
      thread.canvasId,
      thread.subject ?? null,
      thread.lastMessagePreview ?? null,
      thread.lastMessageAt ?? null,
      thread.messageCount ?? 0,
      participants,
      metadataJson,
      now,
      now
    )
    .run();
}

export async function getMerchantRow(
  env: Env,
  canvasId: string
): Promise<MerchantRow | null> {
  return env.DB.prepare(
    'SELECT * FROM merchants WHERE canvas_id = ?'
  ).bind(canvasId).first<MerchantRow>();
}

export async function getInteractionsForMerchant(
  env: Env,
  canvasId: string
): Promise<InteractionRow[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM interactions WHERE canvas_id = ? ORDER BY occurred_at DESC'
  ).bind(canvasId).all<InteractionRow>();
  return Array.isArray(result.results) ? (result.results as InteractionRow[]) : [];
}

export async function getMailThreadsForMerchant(
  env: Env,
  canvasId: string
): Promise<MailThreadRow[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM mail_threads WHERE canvas_id = ? ORDER BY last_message_at DESC'
  ).bind(canvasId).all<MailThreadRow>();
  return Array.isArray(result.results) ? (result.results as MailThreadRow[]) : [];
}

export async function findCanvasByNormalizedPhone(
  env: Env,
  phoneNumber: string
): Promise<string | null> {
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return null;
  }
  const row = await env.DB.prepare(
    'SELECT canvas_id FROM merchants WHERE primary_phone_normalized = ?'
  ).bind(normalized).first<{ canvas_id: string }>();
  return row?.canvas_id ?? null;
}

export async function findCanvasByNormalizedEmail(
  env: Env,
  email: string
): Promise<string | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }
  const row = await env.DB.prepare(
    'SELECT canvas_id FROM merchants WHERE primary_email_normalized = ?'
  ).bind(normalized).first<{ canvas_id: string }>();
  return row?.canvas_id ?? null;
}

export async function searchMerchantsInD1(
  env: Env,
  query: string,
  limit: number
): Promise<Array<{ canvasId: string; score: number; preview: string }>> {
  const likeQuery = `%${query.toLowerCase()}%`;
  const result = await env.DB.prepare(
    `SELECT canvas_id, MAX(occurred_at) as last_occurred, GROUP_CONCAT(summary, ' \u2022 ') as snippets
     FROM interactions
     WHERE LOWER(COALESCE(summary, '')) LIKE ?
     GROUP BY canvas_id
     ORDER BY last_occurred DESC
     LIMIT ?`
  ).bind(likeQuery, limit).all<{ canvas_id: string; last_occurred: number; snippets: string }>();

  if (!Array.isArray(result.results)) {
    return [];
  }

  return (result.results as Array<{ canvas_id: string; last_occurred: number; snippets: string }>).map((row) => ({
    canvasId: row.canvas_id,
    score: row.last_occurred ?? 0,
    preview: row.snippets || '',
  }));
}
