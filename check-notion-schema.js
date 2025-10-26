// Replace these with your actual values from .dev.vars
const NOTION_API_KEY = process.env.NOTION_API_KEY || 'your_notion_api_key_here';
const MESSAGES_DB = process.env.NOTION_MESSAGES_DATABASE_ID || 'your_messages_database_id_here';
const CALLS_DB = process.env.NOTION_CALLS_DATABASE_ID || 'your_calls_database_id_here';

async function getDbSchema(dbId, name) {
  const response = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28'
    }
  });

  const data = await response.json();

  console.log(`\n========== ${name} DATABASE ==========`);
  console.log(`URL: https://www.notion.so/${dbId.replace(/-/g, '')}`);
  console.log(`\nProperties:`);

  if (data.properties) {
    Object.entries(data.properties).forEach(([name, prop]) => {
      console.log(`  - ${name}: ${prop.type}`);
    });
  } else {
    console.log('ERROR:', data);
  }
}

async function main() {
  await getDbSchema(MESSAGES_DB, 'MESSAGES');
  await getDbSchema(CALLS_DB, 'CALLS');
}

main();
