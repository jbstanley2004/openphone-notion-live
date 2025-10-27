/**
 * Notion API Client using Fetch API
 * Compatible with Cloudflare Workers
 * Uses Notion API version 2025-09-03 with data sources support
 */

const NOTION_API_VERSION = '2025-09-03';
const NOTION_API_BASE = 'https://api.notion.com/v1';

export class NotionFetchClient {
  private apiKey: string;
  private dataSourceCache: Map<string, string> = new Map();

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

  /**
   * Get the data source ID from a database ID
   * Caches the result to avoid repeated API calls
   */
  async getDataSourceId(databaseId: string): Promise<string> {
    // Check cache first
    if (this.dataSourceCache.has(databaseId)) {
      return this.dataSourceCache.get(databaseId)!;
    }

    // Retrieve database to get data sources
    const database = await this.request('GET', `/databases/${databaseId}`);

    // Extract the first data source ID (for single-source databases)
    if (!database.data_sources || database.data_sources.length === 0) {
      throw new Error(`No data sources found for database ${databaseId}`);
    }

    const dataSourceId = database.data_sources[0].id;

    // Cache the result
    this.dataSourceCache.set(databaseId, dataSourceId);

    return dataSourceId;
  }

  // Pages API
  pages = {
    create: async (params: any) => {
      // If parent uses database_id, convert to data_source_id
      if (params.parent?.database_id) {
        const databaseId = params.parent.database_id;
        const dataSourceId = await this.getDataSourceId(databaseId);
        params.parent = { data_source_id: dataSourceId };
      }
      return this.request('POST', '/pages', params);
    },

    update: async (params: { page_id: string; properties: any }) => {
      return this.request('PATCH', `/pages/${params.page_id}`, {
        properties: params.properties,
      });
    },
  };

  // Databases API (now uses data sources in 2025-09-03)
  databases = {
    query: async (params: { database_id: string; filter?: any }) => {
      // Convert database_id to data_source_id and use data source API
      const dataSourceId = await this.getDataSourceId(params.database_id);
      return this.request('POST', `/data_sources/${dataSourceId}/query`, {
        filter: params.filter,
      });
    },
  };
}
