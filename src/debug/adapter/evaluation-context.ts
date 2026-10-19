/** Language-owned ASM hovers use the same evaluator, but not the native debug widget. */
export const ASSEMBLER_HOVER_CONTEXT = 'v6-asm-hover';

export function isHoverEvaluation(context: unknown): boolean {
    return context === 'hover' || context === ASSEMBLER_HOVER_CONTEXT;
}

export function isAssemblerSource(file: string): boolean {
    return /\.(?:asm|s)$/i.test(file);
}
