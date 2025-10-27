/**
 * Inspect Notion databases to understand structure
 */

import { Client } from '@notionhq/client';

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
  notionVersion: '2022-06-28',
});

const CANVAS_DATABASE_ID = 'fc0e485b6570460e995b94431b08f0a7';
const CALLS_DATABASE_ID = process.env.NOTION_CALLS_DATABASE_ID || '';

async function main() {
  console.log('=== CANVAS DATABASE SCHEMA ===\n');

  try {
    const canvasDb = await notion.databases.retrieve({
      database_id: CANVAS_DATABASE_ID,
    });

    console.log('Canvas Properties:');
    for (const [name, prop] of Object.entries(canvasDb.properties)) {
      const p = prop as any;
      console.log(`  ${name}: ${p.type}`);
      if (p.type === 'phone_number') {
        console.log('    ^ PHONE NUMBER FIELD DETECTED');
      }
    }

    console.log('\n=== SAMPLE CANVAS RECORDS ===\n');

    const canvasRecords = await notion.databases.query({
      database_id: CANVAS_DATABASE_ID,
      page_size: 3,
    });

    for (const page of canvasRecords.results) {
      if ('properties' in page) {
        console.log(`\nCanvas Record ID: ${page.id}`);

        // Find title
        const titleProp = Object.entries(page.properties).find(([_, p]) => (p as any).type === 'title');
        if (titleProp && titleProp[1] && 'title' in titleProp[1]) {
          const title = titleProp[1].title.map((t: any) => t.plain_text).join('');
          console.log(`  Title: ${title}`);
        }

        // Show Phone property
        if (page.properties.Phone) {
          const phoneProp = page.properties.Phone as any;
          console.log(`  Phone field type: ${phoneProp.type}`);
          if (phoneProp.type === 'phone_number') {
            console.log(`  Phone value: ${phoneProp.phone_number}`);
          } else if (phoneProp.type === 'rich_text') {
            const phoneText = phoneProp.rich_text.map((t: any) => t.plain_text).join('');
            console.log(`  Phone value (rich_text): ${phoneText}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error inspecting Canvas:', error);
  }

  if (CALLS_DATABASE_ID) {
    console.log('\n\n=== RECENT CALLS DATABASE RECORDS ===\n');

    try {
      const callsRecords = await notion.databases.query({
        database_id: CALLS_DATABASE_ID,
        page_size: 3,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      });

      for (const page of callsRecords.results) {
        if ('properties' in page) {
          console.log(`\nCall Record ID: ${page.id}`);

          const props = page.properties;

          if (props['Call ID'] && 'title' in props['Call ID']) {
            const callId = props['Call ID'].title.map((t: any) => t.plain_text).join('');
            console.log(`  Call ID: ${callId}`);
          }

          if (props.Direction && 'select' in props.Direction && props.Direction.select) {
            console.log(`  Direction: ${props.Direction.select.name}`);
          }

          if (props.Participants && 'rich_text' in props.Participants) {
            const participants = props.Participants.rich_text.map((t: any) => t.plain_text).join('');
            console.log(`  Participants: ${participants}`);
          }

          if (props.Canvas && 'relation' in props.Canvas) {
            console.log(`  Canvas relation count: ${props.Canvas.relation.length}`);
            if (props.Canvas.relation.length > 0) {
              console.log(`  Canvas IDs: ${props.Canvas.relation.map((r: any) => r.id).join(', ')}`);
            } else {
              console.log('  ⚠️ NO CANVAS RELATION SET');
            }
          }
        }
      }
    } catch (error) {
      console.error('Error inspecting Calls:', error);
    }
  }
}

main().catch(console.error);
