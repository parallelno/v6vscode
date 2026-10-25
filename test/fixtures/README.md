# Debug fixture contract

The ordinary unit/regression suite requires no emulator, assembler, compiler, or files under `temp/project`.

## Mandatory artifacts

- `baseline/demo1.elf`: small ASM v4 line/symbol/constant fixture with executable and data-only includes. Source is `baseline/main.asm` and `baseline/sub/*.asm`.
- `asmdbg/main.elf`: macro and nested-inline ASM metadata fixture.
- `asm-values/main.elf`: individual structs, pool fields and one-byte-versus-word writes.
- `cdbg/probe-O0.elf`, `probe-O1.elf`, `probe-O2.elf`: compact V6C producer fixtures for types, CFI, locations, optimized line ranges and inline frames. Their source and Makefile recipes are adjacent.

The small ELF files are checked in. Missing mandatory fixtures fail tests rather than silently skipping them. ROMs are ignored/generated from the ELF's loadable sections by the shared fixture helper, which is used by both ts-node and compiled Extension Host tests. No assembly/compiler step runs as a side effect of `npm test`.

The local `.gitattributes` preserves LF source bytes and binary ELF contents across checkouts. `debug-fixtures.json` pins SHA-256 hashes for the baseline and C source/artifacts and records producer versions. Embedded C compilation/include paths describe the original producer machine; source remapping and suffix-based index lookup are intentional and must not require those paths to exist. The load image is unchanged when source paths are remapped.

## Deliberate regeneration

1. Use the producer version recorded in the manifest (or review an intentional upgrade).
2. From `baseline`, run `v6asm -g main.asm -o demo1.rom`. Running from that directory keeps ASM source paths relative.
3. From `cdbg`, set `V6CLANG` to the `v6clang` compiler/driver and run `make -B -f Makefile.O0`, `Makefile.O1`, and `Makefile.O2`. Do not overwrite the C snapshots merely to exercise a transport change.
4. Inspect line/type/CFI behavior and run unit, metadata, conformance and Extension Host tests.
5. Run `node test/fixtures/update-debug-fixture-manifest.js` from the repository root, update producer information if changed, and review binary/hash changes together.

## Explicit live checks

- `npm run test:conformance` requires `V6EMUL` and fails if it is missing. It is the direct live memory/unwind check formerly run conditionally inside unit tests.
- `npm run test:integration` runs the VS Code Extension Host. Debug scenarios require `V6EMUL`; missing-emulator skips remain explicit in that integration-only suite.
- `npm run test:feature:debug` additionally rebuilds producer artifacts and records conformance results. It requires `V6CLANG` and the relevant external build tools.

Do not turn a required decoder test into an optional local-build test. Platform-specific tests may explicitly skip on unsupported platforms; live backend prerequisites belong in integration/conformance lanes.
