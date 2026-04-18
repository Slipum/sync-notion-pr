const core = require('@actions/core');
const github = require('@actions/github');

const API_VERSION = core.getInput('notion_version') || '2026-03-11';

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
	const token = core.getInput('notion_token');

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

async function getAllAccessibleDataSources() {
	const all = [];
	let startCursor;

	do {
		const body = {
			filter: {
				property: 'object',
				value: 'data_source',
			},
			page_size: 100,
		};

		if (startCursor) {
			body.start_cursor = startCursor;
		}

		const res = await notionRequest(`/v1/search`, {
			method: 'POST',
			body: JSON.stringify(body),
		});

		if (!Array.isArray(res.results)) {
			throw new Error('No data_source results (check Notion permissions)');
		}

		all.push(...res.results);
		startCursor = res.has_more ? res.next_cursor : undefined;
	} while (startCursor);

	console.log(`📦 Found ${all.length} data sources`);

	return all;
}

async function findPageInDataSource(dataSourceId, taskNumber) {
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

async function findPageByTaskNumber(taskNumber) {
	const dataSources = await getAllAccessibleDataSources();

	console.log(`🔍 Searching TASK-${taskNumber}...`);

	const matches = [];

	for (const ds of dataSources) {
		const page = await findPageInDataSource(ds.id, taskNumber);

		if (page) {
			console.log(`✅ Found in: ${ds.title?.[0]?.plain_text || 'Unnamed'} (${ds.id})`);

			matches.push({
				dataSource: ds,
				page,
			});
		}
	}

	if (matches.length === 0) {
		return null;
	}

	if (matches.length > 1) {
		const names = matches
			.map((m) => `${m.dataSource.title?.[0]?.plain_text || 'Unnamed'} (${m.dataSource.id})`)
			.join(', ');

		throw new Error(
			`Multiple TASK-${taskNumber} found. Keep one source of truth. Matches: ${names}`,
		);
	}

	return matches[0].page;
}

async function getAllChildBlocks(pageId) {
	const allBlocks = [];
	let startCursor;

	do {
		const query = new URLSearchParams();
		query.set('page_size', '100');
		if (startCursor) {
			query.set('start_cursor', startCursor);
		}

		const res = await notionRequest(`/v1/blocks/${pageId}/children?${query.toString()}`, {
			method: 'GET',
		});

		allBlocks.push(...(res.results || []));
		startCursor = res.has_more ? res.next_cursor : undefined;
	} while (startCursor);

	return allBlocks;
}

function blockContainsPrUrl(block, prUrl) {
	const richText = block?.paragraph?.rich_text || [];

	return richText.some((item) => {
		const linkedUrl = item?.text?.link?.url;
		const plainText = item?.plain_text;

		return linkedUrl === prUrl || plainText === prUrl;
	});
}

async function assertPrDoesNotExist(pageId, prUrl) {
	const blocks = await getAllChildBlocks(pageId);

	const exists = blocks.some(
		(block) => block.type === 'paragraph' && blockContainsPrUrl(block, prUrl),
	);

	if (exists) {
		throw new Error(`PR already exists in Notion: ${prUrl}`);
	}
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
								text: { content: '🔗 PR Link: ' },
							},
							{
								type: 'text',
								text: {
									content: prUrl,
									link: { url: prUrl },
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
	const prUrl =
		github.context.payload.pull_request?.html_url || github.context.payload.pull_request?.url;

	const branchName =
		github.context.payload.pull_request?.head?.ref ||
		github.context.ref?.replace('refs/heads/', '');

	if (!prUrl) {
		throw new Error('Cannot determine PR URL (not a pull_request event)');
	}

	if (!branchName) {
		throw new Error('Cannot determine branch name');
	}

	const branchIdPart = extractBranchId(branchName);
	const taskNumber = extractTaskNumber(branchIdPart);

	const page = await findPageByTaskNumber(taskNumber);

	if (!page) {
		throw new Error(`No Notion page found for TASK-${taskNumber}`);
	}

	await assertPrDoesNotExist(page.id, prUrl);
	await appendPrLink(page.id, prUrl);

	console.log(`✅ Updated Notion: TASK-${taskNumber} → ${prUrl}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
