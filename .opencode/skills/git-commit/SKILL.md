---
name: git-commit
description: Use when the user asks to create a commit or needs help with git commit. Checks status, stages changes when appropriate, reviews the diff, and writes a concise, search-friendly commit message.
---

# Git Commit Skill

## Workflow

1. **Check status**
   ```bash
   git status
   ```
   - If nothing is staged and nothing is modified/untracked, stop.
   - If all changes are already staged, proceed to commit without asking.
   - If nothing is staged but there are modified/untracked files, automatically stage all changes and proceed to commit.
   - If some changes are staged and some are not, ask the user whether to commit only the staged changes or stage the rest first.
   - If the planned changes (staged plus any to-be-staged) seem unrelated or belong in separate commits (e.g., source code and unrelated config/skills/docs mixed together), ask whether to split them before committing.

2. **Review the diff**
   ```bash
   git diff --cached
   git log --oneline -10
   ```
   Understand the change and match the repo's commit-message style.

3. **Write the message**
   - Summary line (50–72 chars): what changed and why
   - Body: a concise, search-friendly description of the changes
     - Mention affected files, functions, components, or APIs
     - Include the reason for the change and any trade-offs
     - Avoid noise, filler, or restating the summary
   - Use the user's message if they provided one

4. **Commit**
   ```bash
   git commit -m "summary" -m "body"
   ```
   Report the commit hash and message.

## Rules

- Do not ask for confirmation when all changes are already staged.
- If nothing is staged, automatically stage all modified and untracked files and commit.
- Ask for confirmation only when some changes are staged and some are not, or when the staged changes appear unrelated and should be split.
- Review `--cached`/`--staged` diff before writing the message.
- Keep commits focused; suggest splitting mixed changes.
- Write messages so a future AI search can quickly find what changed.
