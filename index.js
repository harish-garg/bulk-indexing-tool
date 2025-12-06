const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// Configuration
const KEY_FILE_PATH = path.join(__dirname, 'service_account.json');
const SCOPES = ['https://www.googleapis.com/auth/indexing'];
const BATCH_SIZE = 5; // Number of URLs to process in parallel
const BATCH_DELAY_MS = 1000; // Delay between batches to be nice to the API

async function getIndexingService() {
  if (!fs.existsSync(KEY_FILE_PATH)) {
    throw new Error(`Service account key file not found at: ${KEY_FILE_PATH}\n  Please download your JSON key from Google Cloud Console and save it as 'service_account.json' in this directory.`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE_PATH,
    scopes: SCOPES,
  });

  const authClient = await auth.getClient();
  return google.indexing({ version: 'v3', auth: authClient });
}

async function submitUrl(service, url, type) {
  try {
    const result = await service.urlNotifications.publish({
      requestBody: {
        url: url,
        type: type,
      },
    });
    console.log(`[SUCCESS] ${url}`);
  } catch (error) {
    console.error(`[ERROR]   ${url}`);
    if (error.response) {
      console.error(`  Code: ${error.response.status} - ${error.response.statusText}`);
      // console.error(JSON.stringify(error.response.data, null, 2)); // Uncomment for full debug
    } else {
      console.error(`  ${error.message}`);
    }
  }
}

async function processBatch(service, urls, type) {
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(urls.length / BATCH_SIZE)} (${batch.length} URLs)...`);
    
    // Execute batch in parallel
    await Promise.all(batch.map(url => submitUrl(service, url, type)));

    // Wait before next batch if there are more URLs
    if (i + BATCH_SIZE < urls.length) {
      console.log(`Waiting ${BATCH_DELAY_MS}ms...`);
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  Single URL:  node index.js <url> [URL_UPDATED|URL_DELETED]');
    console.log('  File Input:  node index.js <file_path> [URL_UPDATED|URL_DELETED]');
    console.log('\nExamples:');
    console.log('  node index.js https://www.mcpstack.org/');
    console.log('  node index.js urls.txt');
    return;
  }

  const input = args[0];
  const type = args[1] || 'URL_UPDATED';

  try {
    const service = await getIndexingService();

    // Check if input is a file or a URL
    if (fs.existsSync(input) && fs.lstatSync(input).isFile()) {
      console.log(`Reading URLs from file: ${input}`);
      const fileContent = fs.readFileSync(input, 'utf-8');
      
      // Filter valid URLs (non-empty, trimmed)
      const urls = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#')); // Ignore empty lines and comments

      if (urls.length === 0) {
        console.log('No URLs found in file.');
        return;
      }

      console.log(`Found ${urls.length} URLs to submit.`);
      await processBatch(service, urls, type);

    } else {
      // Treat as single URL
      if (!input.startsWith('http')) {
        console.warn('Warning: Input does not start with "http" and file was not found. Attempting to submit as URL anyway...');
      }
      await submitUrl(service, input, type);
    }

  } catch (error) {
    console.error('Fatal Error:', error.message);
  }
}

main();