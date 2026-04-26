# Notion PR Sync Action

Sync GitHub Pull Requests with Notion tasks automatically using branch-based IDs.
This action creates a **bi-directional sync between GitHub and Notion**:

- 🔗 PR → Notion (adds PR link into task)
- 🔗 Notion → PR (adds Notion link into PR description)
- 📊 Auto status update in Notion based on PR state
- 🔍 Automatically searches across all accessible Notion data sources (no DB ID required)

---

## 🚀 Usage

```yaml
name: Sync PR with Notion
on:
  pull_request:
    types: [opened, reopened, closed]
permissions:
  contents: read
  pull-requests: write
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Notion PR Sync
        uses: Slipum/sync-notion-pr@v1.3.1
        with:
          notion_token: ${{ secrets.NOTION_TOKEN }}
          notion_target_status: 'Review' # optional override (see below)
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

# ⚙️ What it does

## 🔍 Task resolution

- Takes branch name from github.head_ref
- Extracts task ID before /
- Example:
  - TASK-123/fix-login → 123

---

## 🔎 Notion search

- Automatically fetches all accessible Notion data sources
- Searches across them for matching ID
- Ensures only one source of truth
- Throws error if duplicates found

---

## 🔗 PR → Notion sync

- Appends PR link to Notion task (as paragraph block)
- Prevents duplicate PR links (idempotent check)

---

## 🔗 Notion → PR sync

- Updates PR description
- Adds Notion task link
- Skips update if link already exists

---

## 📊 Automatic status sync

If `notion_target_status` is NOT provided, status is resolved automatically:

| PR event            | Notion status |
| ------------------- | ------------- |
| opened              | In progress   |
| reopened            | In progress   |
| closed (merged)     | Done          |
| closed (not merged) | Blocked       |

You can override it manually:

```yaml
notion_target_status: 'Review'
```

---

## 🧠 Branch naming examples

- `TASK-123/fix-login`
- `TASK-45/add-auth`
- `TASK-7`

---

## 🔐 Required secrets

| Name         | Description                       |
| ------------ | --------------------------------- |
| NOTION_TOKEN | Notion Internal Integration Token |
| GITHUB_TOKEN | Auto-provided by GitHub Actions   |

---

## ⚙️ Inputs

- Input Required Description
- notion_token ✅ Notion API token
- notion_target_status ❌ Override status name
- notion_version ❌ API version (default: 2026-03-11)

---

## ⚠️ Requirements

- Notion database must be shared with integration
- Must have a ID (unique_id) property in database
- Must have a status property (Notion status type)

---

## 💡 Key features

- ❌ No DB ID required (auto-discovery)
- 🔁 Idempotent PR linking
- 🔍 Multi-database search with conflict detection
- 🧠 Smart status automation
- 🔗 Full PR ↔ Notion bidirectional sync
