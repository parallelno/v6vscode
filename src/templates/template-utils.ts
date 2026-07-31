import * as fs from 'fs';
import * as path from 'path';

/**
 * Expand `{{key}}` placeholders in template text.
 */
export function expandTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        return vars[key] !== undefined ? vars[key] : `{{${key}}}`;
    });
}

/**
 * Read a template file from the extension's templates directory.
 */
export function readTemplate(extensionPath: string, relativePath: string): string {
    const fullPath = path.join(extensionPath, 'src', 'templates', relativePath);
    return fs.readFileSync(fullPath, 'utf-8');
}

export type Language = 'asm' | 'c';
export type ExecType = 'rom' | 'fdd';

/**
 * Resolve the Makefile template path for a given language + exec type combo.
 */
export function getMakefileTemplatePath(language: Language, execType: ExecType): string {
    return `makefiles/${language}-${execType}.Makefile.template`;
}

/**
 * Resolve the source file template path for a given language.
 */
export function getSourceTemplatePath(language: Language): string {
    return language === 'asm' ? 'asm/main.asm.template' : 'c/main.c.template';
}

/**
 * Get the source file name for a given language.
 */
export function getSourceFileName(language: Language): string {
    return language === 'asm' ? 'main.asm' : 'main.c';
}

/**
 * Get the executable path for the project JSON template.
 */
export function getExecutablePath(name: string, execType: ExecType): string {
    return execType === 'rom' ? `out/${name}.rom` : `out/${name}.fdd`;
}

/**
 * Validate a project name: non-empty, filesystem-safe.
 */
export function validateProjectName(name: string): string | undefined {
    if (!name || name.trim().length === 0) {
        return 'Project name cannot be empty.';
    }
    const hasInvalidCharacter = [...name].some(character =>
        '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 0x20,
    );
    if (hasInvalidCharacter) {
        return 'Project name contains invalid characters.';
    }
    if (name.length > 100) {
        return 'Project name is too long (max 100 characters).';
    }
    return undefined;
}
