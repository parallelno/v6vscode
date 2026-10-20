import { TypedValue, format, hexAddress, unwrap } from '../values/value-format';

export interface DapVariable {
    name: string;
    value: string;
    type?: string;
    memoryReference?: string;
    variablesReference: number;
    namedVariables?: number;
    indexedVariables?: number;
    presentationHint?: { kind: string };
}

export interface DapVariableValue extends DapVariable {
    valueData: TypedValue;
}

/** Child counts for an expandable value (pointer targets, array elements, members). */
export function childCounts(value: TypedValue): Pick<DapVariable, 'namedVariables' | 'indexedVariables'> {
    if (value.availability !== 'available' || !value.type) { return {}; }
    const type = unwrap(value.type);
    if (type.kind === 'pointer' || type.kind === 'reference') {
        return type.of && type.of.byteSize > 0 ? { namedVariables: 1 } : {};
    }
    if (type.kind === 'array' && type.count !== undefined) { return { indexedVariables: type.count }; }
    if ((type.kind === 'structure' || type.kind === 'union') && type.members) { return { namedVariables: type.members.length }; }
    return {};
}

/** Builds the DAP variable representation for a typed value. */
export function dapVariableValue(value: TypedValue, name = ''): DapVariableValue {
    return {
        name,
        value: format(value),
        type: value.type?.name,
        memoryReference: value.address === undefined ? undefined : hexAddress(value.address),
        variablesReference: 0,
        ...childCounts(value),
        valueData: value,
    };
}
