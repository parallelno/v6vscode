import * as fs from 'fs';
import * as path from 'path';
import { parseElf32, SHF_ALLOC, SHT_PROGBITS } from '../debug/metadata/elf32-reader';

/** Resolve fixtures from either ts-node source or compiled out/test execution. */
export function repositoryRoot(from = __dirname): string {
    let current = path.resolve(from);
    for (;;) {
        if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'test', 'fixtures'))) { return current; }
        const parent = path.dirname(current);
        if (parent === current) { throw new Error(`Cannot find v6vscode fixture root from ${from}`); }
        current = parent;
    }
}

export function fixturePath(...parts: string[]): string {
    const file = path.join(repositoryRoot(), 'test', 'fixtures', ...parts);
    if (!fs.existsSync(file)) { throw new Error(`Required test fixture is missing: ${file}`); }
    return file;
}

/** Reconstruct ignored ROMs from mandatory ELF fixtures; no external tools. */
export function fixtureRom(elfPath: string): string {
    const elf = parseElf32(fs.readFileSync(elfPath));
    const sections = elf.sections.filter(section => section.type === SHT_PROGBITS && (section.flags & SHF_ALLOC) !== 0 && section.size > 0);
    if (!sections.length) { throw new Error(`Fixture has no loadable sections: ${elfPath}`); }
    const start = Math.min(...sections.map(section => section.addr));
    const end = Math.max(...sections.map(section => section.addr + section.size));
    if (start < 0 || end > 0x10000 || end <= start) { throw new Error(`Invalid fixture load image: ${elfPath}`); }
    const rom = Buffer.alloc(end - start);
    for (const section of sections) { section.data.copy(rom, section.addr - start); }
    const romPath = elfPath.replace(/\.elf$/i, '.rom');
    if (romPath === elfPath) { throw new Error('Expected an ELF fixture path'); }
    if (!fs.existsSync(romPath) || !fs.readFileSync(romPath).equals(rom)) { fs.writeFileSync(romPath, rom); }
    return romPath;
}
