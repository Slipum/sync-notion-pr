# Notion PR sync action

Sync GitHub pull requests with Notion tasks using branch names.

## Usage

```yaml
uses: Slipum/sync-notion-pr@v1.1.0
with:
  notion_token: ${{ secrets.NOTION_TOKEN }}
```

## What it does

- Runs on GitHub pull requests.
- Takes the branch name from github.head_ref.
- Uses the part before / as the task ID.
- If there is no /, the whole branch name is used as the task ID.
- Searches through all accessible Notion data sources for a matching task.
- Finds the matching Notion page by the ID property.
- Appends the PR link to the end of the Notion page as a new paragraph block.
- Throws an error if the same PR link is already added to that page.
- Throws an error if the task is found in more than one accessible data source.

## Branch naming examples

- TASK-123/fix-login
* TASK-123

## Required repository secrets

- NOTION_TOKEN

## Optional repository variable

- NOTION_VERSION (default: 2026-03-11)
