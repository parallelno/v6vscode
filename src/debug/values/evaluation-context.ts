/** Retained for clients that request typed expression evaluation in an ASM hover context. */
export const ASSEMBLER_HOVER_CONTEXT = 'v6-asm-hover';

export function isHoverEvaluation(context: unknown): boolean {
    return context === 'hover' || context === ASSEMBLER_HOVER_CONTEXT;
}

export function isAssemblerSource(file: string): boolean {
    return /\.(?:asm|s|inc)$/i.test(file);
}
