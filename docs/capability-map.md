# Capability Map - SigmaOS v1

| UI Action | UI Location | Agent Tool | System Prompt | Status |
| --- | --- | --- | --- | --- |
| Browse NAS root | Files pane | `list_dir` | "list files and folders inside the selected NAS root" | Done |
| Inspect current folder from chat | Chat pane | `list_dir` | "inspect configured NAS roots through read-only tools" | Done |
| Search filenames | Search box | `search_files` | "find matching filenames under the selected NAS root" | Done |
| Query indexed content | Search endpoint | `query_index` | "query the SQLite FTS index when available" | Done |
| Read text preview | Agent timeline | `preview_file`, `read_text` | "read a bounded UTF-8 text file" | Done |
| Propose mkdir, move, copy, rename, tag, trash | Chat pane | `propose_changes` | "create an approval proposal and wait for the API approval gate" | Done |
| Approve proposed file operations | Approvals pane | `apply_approved_changes`, `trash_path` | "No filesystem changes happen until apply_approved_changes runs after user approval" | Done |
| Reject proposed file operations | Approvals pane | `complete_task` | "No files were changed" | Done |
| Restore trash entry | Operations pane, Trash API | `restore_path` | "restore persisted SigmaOS trash entries" | Done |
| Roll back reversible operation | Operations pane | `rollback_operation`, `restore_path`, `trash_path` | "roll back reversible applied operations through the API" | Done |
| Compute hash and metadata | Indexer service | `hash_file`, `extract_metadata` | "compute file hashes for indexing and duplicate detection" | Done |
| Detect duplicates | Scheduler service, future chat skill | `detect_duplicates` | "query duplicate indexed hashes" | Done |
| OCR documents | Indexer service | `ocr_document` | "reserved OCR hook; unavailable documents should be reported plainly" | Stubbed |

## Enforcement Notes

- Browser users and agents share the same API-backed capability path for mutations.
- The worker can only create `pending_approvals`; it does not call filesystem mutation tools directly.
- Approval, restore, and rollback endpoints are the only mutation execution paths.
- Permanent delete is intentionally absent; trash and rollback use SigmaOS-managed quarantine paths.
