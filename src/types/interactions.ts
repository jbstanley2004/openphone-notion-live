export type MerchantInteractionType = 'call' | 'message' | 'mail';

export interface MerchantInteraction {
  id: string;
  type: MerchantInteractionType;
  occurredAt: number;
  summary?: string | null;
  direction?: string | null;
  merchant: {
    canvasId: string | null;
    merchantUuid: string | null;
    merchantName: string | null;
  };
  notionPageId?: string | null;
  sources?: {
    openphoneId?: string | null;
    phoneNumberId?: string | null;
    mailThreadId?: string | null;
  };
  ai?: {
    summary?: string | null;
    sentiment?: string | null;
    sentimentScore?: number | null;
    actionItems?: string[];
    category?: string | null;
    leadScore?: number | null;
    keywords?: string[];
  };
  metadata?: Record<string, any> | null;
}
