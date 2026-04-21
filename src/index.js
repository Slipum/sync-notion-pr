const core = require('@actions/core');
const github = require('@actions/github');

const API_VERSION = core.getInput('notion_version') || '2026-03-11';

function extractBranchId(branchName) {
	const clean = branchName.trim();

	if (!clean) throw new Error('Branch name is empty');

	return clean.includes('/') ? clean.split('/')[0].trim() : clean;
}

function extractTaskNumber(branchIdPart) {
	const match = branchIdPart.match(/\d+/);

	if (!match) {
		throw new Error(`Cannot extract numeric Notion ID from branch: "${branchIdPart}"`);
	}

	return Number.parseInt(match[0], 10);
}

async function notionRequest(path, options = {}) {
	const token = core.getInput('notion_token');

	const res = await fetch(`https://api.notion.com${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			'Notion-Version': API_VERSION,
			'Content-Type': 'application/json',
			...(options.headers || {}),
		},
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Notion API ${res.status}: ${body}`);
	}

	return res.json();
}

async function getAllDataSources() {
	const all = [];
	let cursor;

	do {
		const body = {
			filter: { property: 'object', value: 'data_source' },
			page_size: 100,
			...(cursor ? { start_cursor: cursor } : {}),
		};

		const res = await notionRequest('/v1/search', {
			method: 'POST',
			body: JSON.stringify(body),
		});

		if (!Array.isArray(res.results)) {
			throw new Error('No data_source results (check permissions)');
		}

		all.push(...res.results);
		cursor = res.has_more ? res.next_cursor : undefined;
	} while (cursor);

	return all;
}

async function findPageInDataSource(dataSourceId, taskNumber) {
	const res = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, {
		method: 'POST',
		body: JSON.stringify({
			filter: {
				property: 'ID',
				unique_id: { equals: taskNumber },
			},
			page_size: 1,
		}),
	});

	return res.results?.[0] ?? null;
}

async function findPageByTaskNumber(taskNumber) {
	const sources = await getAllDataSources();
	const matches = [];

	for (const ds of sources) {
		const page = await findPageInDataSource(ds.id, taskNumber);
		if (page) matches.push({ ds, page });
	}

	if (matches.length === 0) return null;

	if (matches.length > 1) {
		throw new Error(`Multiple TASK-${taskNumber} found across data sources`);
	}

	return matches[0].page;
}

async function getAllBlocks(pageId) {
	const all = [];
	let cursor;

	do {
		const params = new URLSearchParams({
			page_size: '100',
			...(cursor ? { start_cursor: cursor } : {}),
		});

		const res = await notionRequest(`/v1/blocks/${pageId}/children?${params}`, {
			method: 'GET',
		});

		all.push(...(res.results || []));
		cursor = res.has_more ? res.next_cursor : undefined;
	} while (cursor);

	return all;
}

function blockContainsUrl(block, url) {
	const texts = block?.paragraph?.rich_text || [];

	return texts.some((t) => t?.text?.link?.url === url || t?.plain_text === url);
}

async function assertPrNotExists(pageId, prUrl) {
	const blocks = await getAllBlocks(pageId);

	const exists = blocks.some((b) => b.type === 'paragraph' && blockContainsUrl(b, prUrl));

	if (exists) {
		throw new Error(`PR already exists in Notion: ${prUrl}`);
	}
}

async function appendPrToNotion(pageId, prUrl) {
	await notionRequest(`/v1/blocks/${pageId}/children`, {
		method: 'PATCH',
		body: JSON.stringify({
			children: [
				{
					object: 'block',
					type: 'paragraph',
					paragraph: {
						rich_text: [
							{ type: 'text', text: { content: '🔗 PR Link: ' } },
							{
								type: 'text',
								text: { content: prUrl, link: { url: prUrl } },
							},
						],
					},
				},
			],
		}),
	});
}

async function updateTaskStatus(page, targetStatusName) {
	if (!targetStatusName) {
		console.log('ℹ️ No target status provided, skipping status update');
		return;
	}

	const properties = page.properties;

	const statusEntry = Object.entries(properties).find(([_, prop]) => prop.type === 'status');

	if (!statusEntry) {
		throw new Error('No status property found in Notion page');
	}

	const [statusKey, statusValue] = statusEntry;

	const currentStatus = statusValue.status?.name;

	console.log(`📊 Current status: ${currentStatus}`);

	if (currentStatus === targetStatusName) {
		console.log('ℹ️ Status already set, skipping');
		return;
	}
	await notionRequest(`/v1/pages/${page.id}`, {
		method: 'PATCH',
		body: JSON.stringify({
			properties: {
				[statusKey]: {
					status: {
						name: targetStatusName,
					},
				},
			},
		}),
	});
	console.log(`✅ Status updated → ${targetStatusName}`);
}

async function updatePrDescriptionIfNeeded(prUrl, notionUrl) {
	const token = process.env.GITHUB_TOKEN;

	if (!token) {
		throw new Error('Missing GITHUB_TOKEN');
	}

	const octokit = github.getOctokit(token);

	const { owner, repo } = github.context.repo;
	const pr = github.context.payload.pull_request;

	const currentBody = pr.body || '';

	if (currentBody.includes(notionUrl)) {
		console.log('ℹ️ Notion link already in PR description');
		return;
	}

	const newBody = currentBody + `\n\n---\n🔗 Notion: ${notionUrl}\n`;

	await octokit.rest.pulls.update({
		owner,
		repo,
		pull_number: pr.number,
		body: newBody,
	});

	console.log('✅ PR description updated');
}

async function main() {
	const pr = github.context.payload.pull_request;

	if (!pr) {
		throw new Error('Not a pull_request event');
	}

	const prUrl = pr.html_url;
	const branchName = pr.head.ref;

	const targetStatus = core.getInput('notion_target_status');

	const branchIdPart = extractBranchId(branchName);
	const taskNumber = extractTaskNumber(branchIdPart);

	const page = await findPageByTaskNumber(taskNumber);

	if (!page) {
		throw new Error(`No Notion page for TASK-${taskNumber}`);
	}

	const notionUrl = page.url;

	await assertPrNotExists(page.id, prUrl);
	await appendPrToNotion(page.id, prUrl);

	await updateTaskStatus(page, targetStatus);

	await updatePrDescriptionIfNeeded(prUrl, notionUrl);

	console.log(`✅ Synced TASK-${taskNumber}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
