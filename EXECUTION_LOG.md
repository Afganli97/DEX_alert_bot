## Task: Fix critical bugs and implement remaining features from instruction
Step 1: Fix escapeHtml() - currently broken (no-op replacements) -> DONE
Step 2: Fix TelegramQueue - reject on failure causes unhandled rejection; add process crash guards -> DONE
Step 3: Switch to ADMIN_CHAT_IDS (comma-separated list instead of single ADMIN_ID) -> DONE
Step 4: Enable isChecking in runCycle() for graceful shutdown protection -> DONE
Step 5: Remove dead needRestart variable -> DONE
Step 6: Remove unique constraint from username index -> DONE
Step 7: Filter blocked users in runCycle() -> DONE

All steps completed. Code is ready for testing.