---
name: commit-notes
description: 'Write a git_<YYYY-MM-DD>_<index>.txt file in the workspace root containing a bullet-point list of the local changes made, ready to be used later as a commit message. Use when: the user asks for commit notes, a change summary, a changelog entry, or to record what changed after a request.'
argument-hint: 'Optional: a short label to append to the summary'
user-invocable: true
---

# Commit Notes

After completing a coding request, produce a plain-text file in the **workspace root** that summarizes the local changes as a bullet-point list. The file is meant to be reused later as a commit message.

## When to Use
- The user asks for "commit notes", "a change summary", "a changelog entry", or "what changed".
- The user wants the local changes recorded for a later commit.
- Invoked on-demand (e.g. `/commit-notes`) after a set of edits is finished.

## Output File
- **Location:** the workspace root (the project folder), never a subfolder.
- **Name:** `git_<date>_<index>.txt`
  - `<date>` = today's date in `YYYY-MM-DD` (e.g. `2026-08-19`).
  - `<index>` = a per-date counter starting at `1`, incremented for each new file created on the same date so files never overwrite each other.
- **Encoding:** UTF-8, plain text, no frontmatter.

## Procedure

1. **Determine the date.**
   Use today's date in `YYYY-MM-DD`. If a reliable date source is available (e.g. the session date or `Get-Date`), use it; otherwise use the current date.

2. **Determine the next index for that date.**
   List the workspace root for files matching `git_<date>_*.txt`.
   - If none exist, use `1`.
   - Otherwise, take the highest existing numeric index and add `1`.
   - Example: with `git_2026-08-19_1.txt` and `git_2026-08-19_2.txt` present, the next file is `git_2026-08-19_3.txt`.

3. **Gather the local changes.**
   Prefer the authoritative source over memory:
   - Run `git status --porcelain` to list added/modified/deleted/untracked files.
   - For each changed file, run `git diff -- <path>` (and `git diff --cached -- <path>` for staged changes) to understand *what* changed, not just *that* it changed.
   - Cross-reference with the files actually edited during this request so the summary reflects the work just done.
   - If git is unavailable or the repo is not initialized, fall back to the set of files created/modified/deleted during the request.

4. **Write the bullet-point list.**
   Create the file with a short header line followed by one bullet per meaningful change. Keep bullets concise and imperative (they will read as a commit message). Group by file or by feature, whichever is clearer.

   Suggested shape:
   ```
   <date> — <short label of the change>

   - <file or area>: <what changed and why>
   - <file or area>: <what changed and why>
   - Added/removed/updated <thing> to <effect>
   ```

   Rules for the bullets:
   - One bullet per logical change; avoid one giant bullet.
   - Name the file or module so the change is locatable.
   - State the *effect* (behavior, API, UI), not just "edited file".
   - Do not include secrets, tokens, or credentials.
   - Do not include the raw diff; summarize it.

5. **Confirm.**
   Report the exact file path created and the number of bullets written. Do not print the whole file contents unless asked.

## Examples

**Example 1 — new feature**
```
2026-08-19 — add per-date commit notes skill

- .github/skills/commit-notes/SKILL.md: added skill that writes git_<date>_<index>.txt change summaries
- src/extension.ts: registered the new command entry point
- package.json: declared the commit-notes command contribution
```

**Example 2 — bug fix**
```
2026-08-19 — fix null reference in parser

- src/language/assembly-highlighter.ts: guard against undefined token before reading .type
- test/unit/highlighter.test.ts: added regression test for empty input
```

## Notes
- This skill only *writes the notes file*; it does not stage, commit, or push.
- If the user provides an argument (a short label), use it as the header label in step 4.
- Keep the file small and human-readable; it is a commit-message draft, not a full changelog.
