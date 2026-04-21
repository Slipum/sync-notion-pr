# Notion PR Sync Action

Sync GitHub Pull Requests with Notion tasks automatically using branch-based IDs.

This action creates a **bi-directional link**:

- Adds PR → Notion
- Adds Notion → PR description

---

## 🚀 Usage

```yaml
name: Sync PR with Notion

on:
  pull_request:
    types: [opened]

permissions:
  contents: read
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

			- name: Run Notion PR Sync
        uses: Slipum/sync-notion-pr@v1.2.0
        with:
          notion_token: ${{ secrets.NOTION_TOKEN }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
