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

/** Builds semantic C scopes for one selected stopped frame. */
export class ScopeService {
    scopes(metadata: DebugMetadataIndex, frame: DapFrameContext): SemanticScope[] {
        const visible = metadata.variablesAt(frame.instructionPc);
        const globals = metadata.scopes.variables.filter(variable => variable.kind === 'global');
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