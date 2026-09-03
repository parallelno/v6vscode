import { DebugStopContext, PhysicalFrame } from '../metadata/debug-stop-context';
import { DapHandleStore } from './dap-handle-store';

export interface DapFrameContext {
    id: number;
    physicalFrame: PhysicalFrame;
    inlineDieIdentity?: number;
    /** Exact execution address; callers retain the verified return address. */
    instructionPc: number;
    /** Address used only for source presentation. */
    displayPc: number;
    source?: { file: string; line: number; column: number };
    name: string;
}

export interface StackTracePage {
    frames: readonly DapFrameContext[];
    totalFrames: number;
}

/**
 * Owns DAP frame IDs for one stopped generation. Only frames supplied by the
 * CFI unwinder are included; callers are never inferred from raw stack words.
 */
export class StackTraceService {
    private generation = -1;
    private frames: readonly DapFrameContext[] = [];
    private readonly handles = new DapHandleStore<DapFrameContext>();

    clear(): void {
        this.generation = -1;
        this.frames = [];
        this.handles.clear();
    }

    async capture(
        generation: number,
        context: DebugStopContext,
        resolveName: (pc: number) => string | undefined,
        resolveInlineNames: (pc: number) => readonly { id: number; name: string; source?: { file: string; line: number; column: number } }[],
        resolveDisplayPc: (frame: PhysicalFrame) => number,
    ): Promise<void> {
        if (this.generation === generation) { return; }

        const physicalFrames = await context.unwind();
        this.generation = generation;
        const frames: DapFrameContext[] = [];
        for (const physicalFrame of physicalFrames) {
            for (const inlineFrame of resolveInlineNames(physicalFrame.pc)) {
                frames.push({
                    id: generation * 1_000 + frames.length + 1,
                    physicalFrame,
                    inlineDieIdentity: inlineFrame.id,
                    instructionPc: physicalFrame.pc,
                    displayPc: physicalFrame.pc,
                    source: inlineFrame.source,
                    name: inlineFrame.name,
                });
            }
            frames.push({
                id: generation * 1_000 + frames.length + 1,
                physicalFrame,
                instructionPc: physicalFrame.pc,
                displayPc: resolveDisplayPc(physicalFrame),
                name: resolveName(physicalFrame.pc) ?? hex4(physicalFrame.pc),
            });
        }
        this.frames = frames;
        this.handles.reset(generation);
        for (const frame of frames) {
            this.handles.set(generation, frame.id, frame);
        }
    }

    page(startFrame: number | undefined, levels: number | undefined): StackTracePage {
        const start = Math.max(0, startFrame ?? 0);
        const end = levels === undefined || levels <= 0 ? undefined : start + levels;
        return { frames: this.frames.slice(start, end), totalFrames: this.frames.length };
    }

    frame(generation: number, id: number): DapFrameContext | undefined {
        return this.handles.get(generation, id);
    }
}

function hex4(address: number): string {
    return `0x${(address & 0xFFFF).toString(16).padStart(4, '0').toUpperCase()}`;
}