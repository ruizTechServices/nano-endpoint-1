# GitHub publishing guide

This directory is not currently inside a Git repository, so the first publication requires repository initialization. Run these commands from Git Bash in `nano-endpoint-1`.

## 1. Protect local-only data

The repository `.gitignore` excludes:

- `.env*` credential files
- `.venv/`
- Python caches and bytecode
- `logs/`
- Local test screenshots at the repository root

A Brave credential was present locally during the documentation audit. Rotate that credential before publishing, then verify that no credential file is staged. Never paste the replacement value into source code, documentation, a commit message, or a GitHub issue.

## 2. Run verification

```bash
PYTHONPATH='src:.' python -m unittest discover -s tests -v
node --test web/tests/*.test.mjs
```

The live endpoint test is opt-in and is not required for a documentation commit.

## 3. Initialize Git

```bash
git init
git branch -M main
```

## 4. Verify ignored files

```bash
git check-ignore -v .env.local .venv/ logs/orin-text.jsonl cali-test.png sprinfield-test.png
```

Each existing local-only path should print the matching `.gitignore` rule. Do not continue if `.env.local`, `.venv/`, or `logs/` is not ignored.

## 5. Stage and inspect

```bash
git add .
git status --short
git diff --cached --stat
git diff --cached --name-only
```

Confirm that the staged list does not contain:

- `.env.local` or any `.env` file
- `.venv/`
- `logs/`
- `__pycache__/` or `.pyc` files
- Local screenshots that are not intentional project assets

If a sensitive file is staged, remove only that path from the index and fix `.gitignore` before continuing:

```bash
git restore --staged -- path/to/file
```

## 6. Commit

Use this commit message for the current implementation and documentation:

```bash
git commit -m "feat: add secure tool-enabled Qwen3 local chat"
```

## 7. Connect GitHub

Create an empty GitHub repository without adding a README, license, or `.gitignore`. Then replace the placeholder below with its URL:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git remote -v
```

If `origin` already exists, use:

```bash
git remote set-url origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
```

## 8. Push

```bash
git push -u origin main
```

For later updates:

```bash
git add .
git status --short
git diff --cached --stat
git commit -m "docs: keep Qwen3 endpoint and tool guidance current"
git push
```
