/**
 * Notion API Client using Fetch API
 * Compatible with Cloudflare Workers
 */

const NOTION_API_VERSION = '2022-06-28';
const NOTION_API_BASE = 'https://api.notion.com/v1';

export class NotionFetchClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey.trim();
  }

  private async request(method: string, endpoint: string, body?: any): Promise<any> {
    const url = `${NOTION_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  // Pages API
  pages = {
    create: async (params: any) => {
      return this.request('POST', '/pages', params);
    },

    update: async (params: { page_id: string; properties: any }) => {
      return this.request('PATCH', `/pages/${params.page_id}`, {
        properties: params.properties,
      });
    },
  };

  // Databases API
  databases = {
    query: async (params: { database_id: string; filter?: any }) => {
      return this.request('POST', `/databases/${params.database_id}/query`, {
        filter: params.filter,
      });
    },
  };
}
