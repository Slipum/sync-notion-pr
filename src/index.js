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
		const query = new URLSearchParams();
		query.set('page_size', '100');
		if (startCursor) {
			query.set('start_cursor', startCursor);
		}

		const res = await notionRequest(`/v1/search?${query.toString()}`, {
			method: 'POST',
			body: JSON.stringify({
				filter: {
					property: 'object',
					value: 'data_source',
				},
			}),
		});

		all.push(...(res.results || []));
		startCursor = res.has_more ? res.next_cursor : undefined;
	} while (startCursor);

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

	const matches = [];

	for (const dataSource of dataSources) {
		const page = await findPageInDataSource(dataSource.id, taskNumber);

		if (page) {
			matches.push({
				dataSource,
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
			`Found multiple matching pages for TASK-${taskNumber}. Please keep only one source of truth. Matches: ${names}`,
		);
	}

	return matches[0].page;
}

async function getAllChildBlocks(pageId) {
	const allBlocks = [];
	let startCursor = undefined;

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

	const alreadyExists = blocks.some((block) => {
		if (block.type !== 'paragraph') {
			return false;
		}

		return blockContainsPrUrl(block, prUrl);
	});

	if (alreadyExists) {
		throw new Error(`PR link already exists in Notion page: ${prUrl}`);
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
								text: {
									content: '🔗 PR Link: ',
								},
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
		throw new Error(`No Notion page found for task number: TASK-${taskNumber}`);
	}

	await assertPrDoesNotExist(page.id, prUrl);
	await appendPrLink(page.id, prUrl);

	console.log(`✅ Updated Notion page: TASK-${taskNumber} → ${prUrl}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
