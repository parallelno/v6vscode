# Feature Prompt

Act as an experienced software architect responsible for execution.
Create an implementation plan of a new functionality we discussed earlier.
It must be maintainable, test-driven addition to the existing codebase.

Address development sequencing, dependency management, validation strategies, regression coverage, performance verification, and documentation updates.


## The implementation plan must include, at minimum:

- ## 1. Problem
- ### Current behavior
- ### Desired behavior
- ### Root cause
- ## 2. Strategy
- ### Approach: ...
- ### Why this works ...
- ### Summary of changes
- ## 3. Implementation Steps
- ### Step 3.1 — ... [ ]
- <step details>
- > **Design Notes**: ... <if necessary> ...
- > **Implementation Notes**: <empty. filled after completion>
- ### ...
- ### Step 3.. — Build [ ]
- ### Step 3.. — Lit test: ... [ ]
- ### Step ...
- ### Step 3.. — Run regression tests [ ]
- ### Step 3.. — Verification assembly steps from `tests\features\README.md` [ ]
- ### Step 3.. — Make sure result.txt is created. `tests\features\README.md` [ ]
- ### Step 3.. — Sync mirror [ ]
- ## 4. Expected Results
- ### Example1 of how this feature benefits the project
- ### Example2 ...
- ### ...
- ## 5. Risks & Mitigations
- | Risk | Mitigation |
- |------|------------|
- ...
- ---
- ## 6. Relationship to Other Improvements
- ## 7. Future Enhancements
- ## 8. References


## Implementation must:

- Begin with reading reference documents
- Describe the concrete implementation steps required for implementation
- Conclude with expanded test coverage (unit, integration, and regression)
- Include result verification against design expectations
- Require corresponding documentation updates
- Explicitly mark the relevant plan sections and steps as complete


Emphasize a strong test strategy, with unit, integration, and regression tests.

## Dependency

Test dependencies must include at least:
* v6emul - CLI emulator for Vector 06c machine. Great for debugging and gold unit testing. [CLI Reference](..\tools\v6emul\docs\cli.md)
* tools\v6asm - CLI assembler for Vector 06c machine. Great for ASM syntax documentation, intermediate ASM output comparison and testing, and for ASM to ROM assembling for testing purposes. [CLI Reference](..\tools\v6asm\docs\cli.md)


## Plan Format

Use `TODO: update this` as a plan format reference.