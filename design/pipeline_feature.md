# Feature Development Pipeline

This document defines the end-to-end workflow for implementing a new
optimization or feature in the V6C backend. Each phase must complete
before moving to the next.

---

## Phase 1 — Preparation

The user provides a feature description — one of the files in
`design\future_plans\`.

1. Read the feature description file to understand the problem and the proposed solution.
2. Read `design\future_plans\README.md` to know what is already implemented or in progress.
3. Read `docs\V6CBuildGuide.md` for build commands, tool paths, and mirror sync procedure.
4. Explore the relevant parts of the codebase to verify the proposed solution is feasible.
5. Follow `design\feature_plan_prompt.md` and create a feature implementation plan.
   Save it as `design\plan_<feature_name>.md`.
6. Follow **Preparation steps** from `tests\features\README.md` — create the test folder,
   baseline C files, and reference assembly.
7. Inform the user about what was done (plan file, test folder, baseline assembly).

---

## Phase 2 — Pause

1. **Pause** — let the user review the plan, test cases, and baseline assembly before proceeding.

---

## Phase 3 — Implementation Cycles

Repeat the following cycle for each step in the implementation plan.
Keep in mind `llvm` is a mirror folder. Changes must go to `llvm-project`. Details  - docs\V6CBuildGuide.md.

### Build Cycle
1. Implement the next plan step (modify source files as described).
2. Build:
   ```
   cmd /c "call ""C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"" -arch=amd64 >nul 2>&1 && ninja -C llvm-build clang llc 2>&1"
   ```
3. If the build fails, diagnose and fix, then go back to 2.
4. Mark the plan step as complete (`[x]`).
5. Fill up or update `Implementation Notes` in the plan step.
6. Repeat from 1 for the next plan step.

### Lit / Unit Tests (after each meaningful code change)
1. Run the relevant lit test if the plan step includes one.
2. If the test fails, diagnose and fix, then rebuild (Build Cycle step 2).

---

## Phase 4 — Verification & Analysis

Enter this phase after all implementation plan steps are complete.

1. Run the full regression test suite:
   ```
   python tests\run_all.py
   ```
2. If any test fails, diagnose and fix, then rebuild and rerun.
3. Follow **Verification assembly steps** from `tests\features\README.md` —
   compile the feature test case, analyze the assembly, iterate if needed.
4. Explain the resulting assembly to the user, highlighting the improvement.
5. Sync the mirror:
   ```
   powershell -ExecutionPolicy Bypass -File scripts\sync_llvm_mirror.ps1
   ```
6. Make sure result.txt is created. It must contain:
- The C test case code.
- c8080 asm, but only the main func and dependent funcs body converted from Z80 asm to i8080 asm.
- c8080 stats: worst CPU cycles, length in bytes for each function.
- v6llvmc old asm.
- v6llvmc new asm.
- Comparisen table for c8080, v6llvmc old, v6llvmc new that includes CPU cycles, length in bytes for each function.
Details in `tests\features\result.md`.

---

## Phase 5 — Completion

1. Mark all plan steps as complete in `design\plan_<feature_name>.md`.
2. Mark the feature complete in `design\future_plans\README.md` (set `[x]`).
3. Update any affected documentation under `docs\`.
4. Inform the user of the final results (cycle savings, code-size delta, test status).

---

## References

- [Feature Plan Prompt](design\feature_plan_prompt.md) — template for creating implementation plans
- [Feature Test Cases](tests\features\README.md) — test case structure and verification steps
- [Future Optimizations](design\future_plans\README.md) — feature backlog and status
- [V6C Build Guide](docs\V6CBuildGuide.md) — build commands and mirror sync
- [Plan Format Reference](design\plan_cmp_based_comparison.md) — example of a completed plan