const API_VERSION = process.env.NOTION_VERSION || '2026-03-11';

function requireEnv(name) {
	const value = process.env[name];
	console.log(value);

	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	return value;
}

function extractBranchId(branchName) {
	const clean = branchName.trim();

	if (!clean) {
		throw new Error('Branch name is empty');
	}

	return clean.includes('/') ? clean.split('/')[0].trim() : clean;
}

function extractTaskNumber(branchIdPart) {
	const match = branchIdPart.match(/\d+/);

	if (!match) {
		throw new Error(
			`Cannot extract numeric Notion ID from branch value: "${branchIdPart}". Expected something like TASK-1 or 1.`,
		);
	}

	return Number.parseInt(match[0], 10);
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

async function findPageByTaskNumber(dataSourceId, taskNumber) {
	const query = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, {
		method: 'POST',
		body: JSON.stringify({
			filter: {
				property: 'ID',
				unique_id: {
					equals: taskNumber,
				},
			},
			page_size: 1,
		}),
	});

	return query.results?.[0] ?? null;
}

async function appendPrLink(pageId, prUrl) {
	await notionRequest(`/v1/blocks/${pageId}/children`, {
		method: 'PATCH',
		body: JSON.stringify({
			children: [
				{
					object: 'block',
					type: 'paragraph',
					paragraph: {
						rich_text: [
							{
								type: 'text',
								text: {
									content: 'PR Link: ',
								},
							},
							{
								type: 'text',
								text: {
									content: prUrl,
									link: {
										url: prUrl,
									},
								},
							},
						],
					},
				},
			],
		}),
	});
}

async function main() {
	const dataSourceId = requireEnv('NOTION_DATABASE_ID');
	const prUrl = requireEnv('PR_URL');
	const branchName = requireEnv('BRANCH_NAME');

	const branchIdPart = extractBranchId(branchName);
	const taskNumber = extractTaskNumber(branchIdPart);

	const page = await findPageByTaskNumber(dataSourceId, taskNumber);

	if (!page) {
		throw new Error(`No Notion page found for task number: ${taskNumber} (from "${branchIdPart}")`);
	}

	await appendPrLink(page.id, prUrl);

	console.log(`Appended PR link to Notion page ${page.id} for task ${taskNumber} -> ${prUrl}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
