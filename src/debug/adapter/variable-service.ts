import { DebugStopContext } from '../metadata/debug-stop-context';
import { TypedValue } from '../values/value-format';
import { ValueReader } from '../values/value-reader';
import { DebugMetadataIndex } from '../metadata/debug-metadata-index';
import { PhysicalFrame } from '../metadata/debug-stop-context';
import { VariableNode } from '../metadata/dwarf-scopes';
import { DapVariableValue, dapVariableValue } from './dap-value-presenter';

/** DAP adapter over domain values; handles remain owned by V6DebugAdapter. */
export class VariableService {
    constructor(private readonly reader = new ValueReader()) {}

    evaluate(...args: Parameters<ValueReader['evaluate']>): ReturnType<ValueReader['evaluate']> { return this.reader.evaluate(...args); }
    readAt(...args: Parameters<ValueReader['readAt']>): ReturnType<ValueReader['readAt']> { return this.reader.readAt(...args); }
    async dapVariables(
        metadata: DebugMetadataIndex,
        context: DebugStopContext,
        frame: PhysicalFrame,
        variables: readonly VariableNode[],
        start = 0,
        count?: number,
    ): Promise<DapVariableValue[]> {
        const page = variables.slice(Math.max(0, start), count === undefined ? undefined : Math.max(0, start) + Math.max(0, count));
        const values = await Promise.all(page.map(variable => this.evaluate(metadata, context, frame, variable)));
        return values.map(({ variable, value }) => dapVariableValue(value, variable.name || `<anonymous@${variable.id.toString(16)}>`));
    }

    async children(context: DebugStopContext, value: TypedValue, start = 0, count?: number): Promise<DapVariableValue[]> {
        return (await this.reader.childValues(context, value, start, count)).map(child => dapVariableValue(child.value, child.name));
    }
}
