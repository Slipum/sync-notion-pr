# Notion PR sync action

Sync GitHub pull requests with Notion tasks using branch names.

## Usage

```yaml
uses: Slipum/sync-notion-pr@v1.0.3
with:
  notion_token: ${{ secrets.NOTION_TOKEN }}
  notion_database_id: ${{ secrets.NOTION_DATABASE_ID }}
```

## What it does

- Runs on GitHub pull requests.
- Takes the branch name from `github.head_ref`.
- Uses the part before `/` as the Notion ID.
- If there is no `/`, the whole branch name is used as the ID.
- Finds the matching Notion page by the `ID` property.
- Writes the PR link into the `PR Link` property.

## Branch naming examples

- `TASK-123/fix-login`
- `TASK-123`

## Required repository secrets

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`

## Optional repository variable

- `NOTION_VERSION` (default: `2026-03-11`)

```

```
