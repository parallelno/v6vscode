import { DebugMetadataIndex } from '../metadata/debug-metadata-index';
import { VariableNode } from '../metadata/dwarf-scopes';
import { DapFrameContext } from './stack-trace-service';

export type SemanticScopeKind = 'parameters' | 'locals' | 'statics' | 'globals';

export interface SemanticScope {
    kind: SemanticScopeKind;
    name: string;
    expensive: boolean;
    variables: readonly VariableNode[];
}

/**
 * Generated struct offset constants (`actor.update_ptr`, `char.size`, including
 * inherited aliases) are const-only DWARF variables with dotted names. They are
 * kept out of the Globals pane so instances and pools stay readable; they remain
 * available through the Symbols panel and Watch symbol fallback.
 */
function isGeneratedOffsetConstant(variable: VariableNode): boolean {
    return variable.constValue !== undefined && variable.name.includes('.');
}

/** Builds semantic C scopes for one selected stopped frame. */
export class ScopeService {
    scopes(metadata: DebugMetadataIndex, frame: Pick<DapFrameContext, 'instructionPc'>): SemanticScope[] {
        const visible = metadata.variablesAt(frame.instructionPc);
        const globals = metadata.scopes.variables
            .filter(variable => variable.kind === 'global')
            .filter(variable => !isGeneratedOffsetConstant(variable));
        return [
            this.scope('parameters', 'Parameters', visible.filter(variable => variable.kind === 'parameter')),
            this.scope('locals', 'Locals', visible.filter(variable => variable.kind === 'local')),
            this.scope('statics', 'Statics', visible.filter(variable => variable.kind === 'static')),
            this.scope('globals', 'Globals', globals, true),
        ];
    }

    private scope(
        kind: SemanticScopeKind,
        name: string,
        variables: readonly VariableNode[],
        expensive = false,
    ): SemanticScope {
        return { kind, name, expensive, variables };
    }
}