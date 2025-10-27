/**
 * Debug script to inspect Canvas database structure
 */

import { Client } from '@notionhq/client';

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const CANVAS_DATABASE_ID = 'fc0e485b6570460e995b94431b08f0a7';

async function debugCanvas() {
  console.log('Fetching Canvas database schema...\n');

  // Get database schema
  const database = await notion.databases.retrieve({
    database_id: CANVAS_DATABASE_ID,
  });

  console.log('Canvas Database Properties:');
  console.log('============================');
  for (const [propName, propDef] of Object.entries(database.properties)) {
    console.log(`\n${propName}:`);
    console.log(`  Type: ${(propDef as any).type}`);
    if ((propDef as any).type === 'relation') {
      console.log(`  Related DB: ${(propDef as any).relation.database_id}`);
    }
  }

  console.log('\n\nFetching sample Canvas records...\n');

  // Get some sample records
  const queryResponse = await notion.databases.query({
    database_id: CANVAS_DATABASE_ID,
    page_size: 5,
  });

  console.log(`Found ${queryResponse.results.length} records\n`);

  for (const page of queryResponse.results) {
    if ('properties' in page) {
      console.log('\n--- Record ---');
      console.log(`Page ID: ${page.id}`);

      const props = page.properties;

      // Show Phone property
      if (props.Phone) {
        console.log(`Phone property type: ${props.Phone.type}`);
        console.log(`Phone property value:`, JSON.stringify(props.Phone, null, 2));
      }

      // Show Name/Title property
      const titleProp = Object.values(props).find((p: any) => p.type === 'title');
      if (titleProp && 'title' in titleProp) {
        const title = titleProp.title.map((t: any) => t.plain_text).join('');
        console.log(`Title: ${title}`);
      }
    }
  }
}

debugCanvas().catch(console.error);
