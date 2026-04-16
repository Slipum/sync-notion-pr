const API_VERSION = process.env.NOTION_VERSION || '2026-03-11';

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function extractNotionId(branchName) {
	const clean = branchName.trim();

	if (!clean) {
		throw new Error('Branch name is empty');
	}

	// Supports:
	//   TASK-123/fix-login
	//   TASK-123
	// If there is no '/', the whole branch name becomes the ID.
	return clean.includes('/') ? clean.split('/')[0].trim() : clean;
}

async function notionRequest(path, options = {}) {
	const token = requireEnv('NOTION_TOKEN');

	const response = await fetch(`https://api.notion.com${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			'Notion-Version': API_VERSION,
			'Content-Type': 'application/json',
			...(options.headers || {}),
		},
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Notion API error ${response.status} ${response.statusText}: ${body}`);
	}

	return response.json();
}

async function main() {
	const databaseId = requireEnv('NOTION_DATABASE_ID');
	const prUrl = requireEnv('PR_URL');
	const branchName = requireEnv('BRANCH_NAME');

	const notionId = extractNotionId(branchName);

	const query = await notionRequest(`/v1/data_sources/${databaseId}/query`, {
		method: 'POST',
		body: JSON.stringify({
			filter: {
				property: 'ID',
				rich_text: {
					equals: notionId,
				},
			},
			page_size: 1,
		}),
	});

	const page = query.results?.[0];
	if (!page) {
		throw new Error(`No Notion page found for ID: ${notionId}`);
	}

	await notionRequest(`/v1/pages/${page.id}`, {
		method: 'PATCH',
		body: JSON.stringify({
			properties: {
				'PR Link': {
					url: prUrl,
				},
			},
		}),
	});

	console.log(`Updated Notion page ${page.id} for ${notionId} -> ${prUrl}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
