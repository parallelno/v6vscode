import * as path from 'path';
import type { CommandSender } from '../../emulator/session/session-operations';
import type { OperationScope } from '../../platform/async/scoped-task-queue';
import { IpcCommand, GetRegsResponse } from '../../emulator/protocol/ipc-commands';
import { BreakpointOperand, DebugCondition, makeBreakpointAdd, BreakpointEntry } from '../../emulator/protocol/debug-models';
import { DebugIndex } from '../metadata/debug-index';
import { evaluateSymbolExpression, validateSymbolExpression } from '../utilities/symbol-expression';
import { hexAddress } from '../values/value-format';
import { BYTE_REGISTER_EXPRESSIONS } from '../values/value-evaluation-service';
import { StepBreakpointStore } from './step-breakpoint-store';

export interface RequestedBreakpoint { line?: number; condition?: string; hitCondition?: string; logMessage?: string; instructionReference?: string }
export interface SourceBreakpointArguments { source?: { path?: string; name?: string }; breakpoints?: RequestedBreakpoint[] }
export interface InstructionBreakpointArguments { breakpoints?: RequestedBreakpoint[] }
export interface BreakpointResult { id: number; verified: boolean; message?: string; line?: number; instructionReference?: string }
export interface BreakpointContext { index?: DebugIndex | null; metadataError: string; registers?: GetRegsResponse | null }
export interface BreakpointChange { reason: 'new' | 'removed'; id: number; breakpoint?: BreakpointEntry }
const hex4 = hexAddress;
const hex2 = (value: number) => hexAddress(value, 1);

const BYTE_BREAKPOINT_OPERANDS = new Set<BreakpointOperand>(['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L']);
const WORD_BREAKPOINT_OPERANDS = new Set<BreakpointOperand>(['BC', 'DE', 'HL', 'SP']);
const BREAKPOINT_OPERANDS = new Set<BreakpointOperand>([
    'A', 'F', 'B', 'C', 'D', 'E', 'H', 'L', 'BC', 'DE', 'HL', 'SP',
]);
const CONDITION_OPERATORS: ReadonlyArray<readonly [string, DebugCondition]> = [
    ['==', 'EQU'], ['!=', 'NOT_EQU'], ['<=', 'LESS_EQU'], ['>=', 'GREATER_EQU'],
    ['<', 'LESS'], ['>', 'GREATER'],
];

interface ParsedBreakpointCondition {
    operand: BreakpointOperand;
    condition: DebugCondition;
    value: number;
    text: string;
}

type LogMessageSegment = { literal: string } | { expression: string };

interface ParsedLogMessage {
    text: string;
    segments: readonly LogMessageSegment[];
}

export interface AdapterBreakpoint {
    id: number;
    address: number;
    condition?: ParsedBreakpointCondition;
    hitCondition?: number;
    logMessage?: ParsedLogMessage;
}

/** One owner for source/instruction/user/temporary breakpoint reconciliation. */
export class BreakpointCoordinator {
    private nextBpId = 1;
    private readonly bpAddrToId = new Map<number, number>();
    private readonly bpIdToAddr = new Map<number, number>();
    private readonly breakpointsByAddress = new Map<number, AdapterBreakpoint>();
    private readonly sourceBpAddresses = new Map<string, Set<number>>();
    private instructionBpAddresses = new Set<number>();
    private readonly serverBreakpointIds = new Map<number, number>();
    private tail: Promise<unknown> = Promise.resolve();
    private revision = 0;
    private readonly temporary: StepBreakpointStore;
    temporaryError: string | undefined;

    constructor(private readonly sender: () => CommandSender | null,
        private readonly context: () => BreakpointContext,
        private readonly warn: (message: string) => void = () => {}) {
        this.temporary = new StepBreakpointStore({
            add: async address => {
                const response = await this.client?.send(IpcCommand.DEBUG_BREAKPOINT_ADD, makeBreakpointAdd(address, '__dap_next', { autoDelete: true }));
                this.temporaryError = response?.error;
                return response?.ok === true;
            },
            remove: async address => { await this.client?.send(IpcCommand.DEBUG_BREAKPOINT_DEL, { addr: address }); },
        });
    }

    private operationClient: CommandSender | null = null;
    private operationScope: OperationScope | undefined;
    private assertCurrent(): void { this.operationScope?.assertCurrent(); }
    private get client(): CommandSender | null { return this.operationClient ?? this.sender(); }
    private enqueue<T>(action: () => Promise<T>): Promise<T> {
        const client = this.sender();
        const revision = this.revision;
        const scope: OperationScope = { key: this, assertCurrent: () => {
            if (revision !== this.revision || client !== this.sender()) { throw new Error('Breakpoint operation belongs to an inactive session'); }
        } };
        const result = this.tail.catch(() => {}).then(async () => {
            scope.assertCurrent();
            this.operationScope = scope;
            this.operationClient = client && { send: async <T>(command: IpcCommand, data?: unknown, timeout?: number, priority?: 'critical' | 'high' | 'normal' | 'low') => {
                scope.assertCurrent();
                const response = await client.send<T>(command, data, timeout, priority, scope);
                scope.assertCurrent();
                return response;
            } };
            try { const result = await action(); scope.assertCurrent(); return result; }
            finally { this.operationClient = null; this.operationScope = undefined; }
        });
        this.tail = result;
        return result;
    }

    setSource(args: SourceBreakpointArguments): Promise<BreakpointResult[]> { return this.enqueue(() => this.setSourceNow(args)); }
    setInstructions(args: InstructionBreakpointArguments): Promise<BreakpointResult[]> { return this.enqueue(() => this.setInstructionsNow(args)); }
    allocateId(): number { return this.nextBpId++; }
    idAt(address: number): number | undefined { return this.bpAddrToId.get(address); }
    at(address: number): Readonly<AdapterBreakpoint> | undefined { return this.breakpointsByAddress.get(address); }
    acquireTemporary(address: number): Promise<boolean> { return this.enqueue(() => this.temporary.acquire(address)); }
    releaseTemporary(address: number): Promise<void> { return this.enqueue(() => this.temporary.release(address)); }
    ownedAddresses(): readonly number[] { return [...this.bpAddrToId.keys()]; }

    clear(): void {
        this.revision++;
        this.bpAddrToId.clear(); this.bpIdToAddr.clear(); this.breakpointsByAddress.clear();
        this.sourceBpAddresses.clear(); this.instructionBpAddresses.clear(); this.serverBreakpointIds.clear();
        this.temporary.reset();
    }

    synchronize(): Promise<BreakpointChange[]> {
        return this.enqueue(async () => {
            if (!this.client) { return []; }
            const response = await this.client.send<BreakpointEntry[]>(IpcCommand.DEBUG_BREAKPOINT_GET_ALL);
            if (!response.ok || !Array.isArray(response.data)) { return []; }
            const changes: BreakpointChange[] = [];
            const serverAddresses = new Set(response.data.map(breakpoint => breakpoint.addr));
            for (const breakpoint of response.data) {
                if (this.bpAddrToId.has(breakpoint.addr) || this.serverBreakpointIds.has(breakpoint.addr)) { continue; }
                const id = this.allocateId();
                this.serverBreakpointIds.set(breakpoint.addr, id);
                changes.push({ reason: 'new', id, breakpoint });
            }
            for (const [address, id] of this.serverBreakpointIds) {
                if (serverAddresses.has(address)) { continue; }
                this.serverBreakpointIds.delete(address);
                changes.push({ reason: 'removed', id });
            }
            return changes;
        });
    }

    private parseBreakpointConfiguration(requested: RequestedBreakpoint, allowLogpoint: boolean): Omit<AdapterBreakpoint, 'id' | 'address'> {
        const conditionText = String(requested.condition ?? '').trim();
        const hitText = String(requested.hitCondition ?? '').trim();
        const logMessageText = String(requested.logMessage ?? '');
        if (logMessageText && !allowLogpoint) {
            throw new Error('Logpoints are supported only for source breakpoints.');
        }
        const logMessage = logMessageText ? this.parseLogMessage(logMessageText) : undefined;

        let condition: ParsedBreakpointCondition | undefined;
        if (conditionText) {
            const match = /^([A-Za-z]+)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(conditionText);
            if (!match) {
                throw new Error('Unsupported breakpoint condition. Expected: REGISTER comparison value.');
            }
            const operand = match[1].toUpperCase() as BreakpointOperand;
            if (!BREAKPOINT_OPERANDS.has(operand)) {
                throw new Error(`Unsupported breakpoint register: ${match[1].toUpperCase()}.`);
            }
            const operator = CONDITION_OPERATORS.find(([text]) => text === match[2])?.[1];
            if (!operator) {
                throw new Error('Unsupported breakpoint comparison operator.');
            }
            const value = evaluateSymbolExpression(match[3], name => {
                const symbol = this.context().index?.symbol(name);
                if (!symbol) { throw new Error(`Unknown symbol: ${name}`); }
                return symbol.address;
            });
            const max = BYTE_BREAKPOINT_OPERANDS.has(operand) ? 0xFF
                : WORD_BREAKPOINT_OPERANDS.has(operand) ? 0xFFFF : Number.MAX_SAFE_INTEGER;
            if (value < 0 || value > max) {
                throw new Error(`Breakpoint value ${hex4(value)} does not fit register ${operand}.`);
            }
            condition = { operand, condition: operator, value, text: `${operand} ${match[2]} ${match[3].trim()}` };
        }

        let hitCondition: number | undefined;
        if (hitText) {
            if (!/^[1-9][0-9]*$/.test(hitText)) {
                throw new Error('Hit condition must be a positive decimal integer.');
            }
            hitCondition = Number(hitText);
            if (!Number.isSafeInteger(hitCondition)) {
                throw new Error('Hit condition is outside the safe integer range.');
            }
        }
        return { condition, hitCondition, ...(logMessage ? { logMessage } : {}) };
    }

    private parseLogMessage(logMessage: string): ParsedLogMessage {
        const segments: LogMessageSegment[] = [];
        let literal = '';
        const appendLiteral = () => {
            if (literal) { segments.push({ literal }); literal = ''; }
        };
        for (let index = 0; index < logMessage.length; index++) {
            const char = logMessage[index];
            if (char === '{' && logMessage[index + 1] === '{') { literal += '{'; index++; continue; }
            if (char === '}' && logMessage[index + 1] === '}') { literal += '}'; index++; continue; }
            if (char === '}') { throw new Error("Log message contains an unmatched '}'."); }
            if (char !== '{') { literal += char; continue; }
            const end = logMessage.indexOf('}', index + 1);
            if (end < 0) { throw new Error("Log message contains an unmatched '{'."); }
            const expression = logMessage.slice(index + 1, end).trim();
            if (!expression) { throw new Error('Log message contains an empty expression.'); }
            const error = validateSymbolExpression(expression);
            if (error) { throw new Error(`Unsupported logpoint expression: ${expression}.`); }
            appendLiteral();
            segments.push({ expression });
            index = end;
        }
        appendLiteral();
        return { text: logMessage, segments };
    }

    formatLogMessage(logMessage: ParsedLogMessage): string {
        const registers = this.context().registers;
        const values: Record<string, number> = registers ? {
            A: (registers.af >> 8) & 0xFF, F: registers.af & 0xFF,
            B: (registers.bc >> 8) & 0xFF, C: registers.bc & 0xFF,
            D: (registers.de >> 8) & 0xFF, E: registers.de & 0xFF,
            H: (registers.hl >> 8) & 0xFF, L: registers.hl & 0xFF,
            PSW: registers.af, BC: registers.bc, DE: registers.de, HL: registers.hl,
            SP: registers.sp, PC: registers.pc, CC: registers.cc,
        } : {};
        let output = '';
        for (const segment of logMessage.segments) {
            if ('literal' in segment) { output += segment.literal; continue; }
            const expression = segment.expression;
            const value = evaluateSymbolExpression(expression, name => {
                const register = values[name.toUpperCase()];
                if (register !== undefined) { return register; }
                const symbol = this.context().index?.symbol(name);
                if (!symbol) { throw new Error(`Unknown symbol: ${name}`); }
                return symbol.address;
            });
            output += BYTE_REGISTER_EXPRESSIONS.has(expression.toUpperCase()) ? hex2(value) : hex4(value);
        }
        return output.endsWith('\n') ? output : `${output}\n`;
    }

    private sameBackendConfiguration(
        first: Pick<AdapterBreakpoint, 'condition' | 'hitCondition'>,
        second: Pick<AdapterBreakpoint, 'condition' | 'hitCondition'>,
    ): boolean {
        return first.hitCondition === second.hitCondition
            && first.condition?.operand === second.condition?.operand
            && first.condition?.condition === second.condition?.condition
            && first.condition?.value === second.condition?.value;
    }

    private sameBreakpointConfiguration(
        first: Pick<AdapterBreakpoint, 'condition' | 'hitCondition' | 'logMessage'>,
        second: Pick<AdapterBreakpoint, 'condition' | 'hitCondition' | 'logMessage'>,
    ): boolean {
        return this.sameBackendConfiguration(first, second)
            && first.logMessage?.text === second.logMessage?.text;
    }

    private hasOtherSourceReference(address: number, sourceKey: string): boolean {
        return [...this.sourceBpAddresses.entries()]
            .some(([key, addresses]) => key !== sourceKey && addresses.has(address));
    }

    private breakpointMessage(breakpoint: AdapterBreakpoint): string {
        const details = [`CPU address: ${hex4(breakpoint.address)}`];
        if (breakpoint.condition) { details.push(`condition: ${breakpoint.condition.text}`); }
        if (breakpoint.hitCondition) { details.push(`hit count: ${breakpoint.hitCondition}`); }
        if (breakpoint.logMessage) { details.push('logpoint'); }
        return details.join('; ');
    }

    private makeBreakpointRequest(breakpoint: AdapterBreakpoint): ReturnType<typeof makeBreakpointAdd> {
        return makeBreakpointAdd(breakpoint.address, `dap:${breakpoint.id}`, {
            operand: breakpoint.condition?.operand,
            condition: breakpoint.condition?.condition,
            value: breakpoint.condition?.value,
            counter: breakpoint.hitCondition,
        });
    }

    private async setSourceNow(args: SourceBreakpointArguments): Promise<BreakpointResult[]> {
        const source: string = args.source?.path ?? args.source?.name ?? '';
        const sourceBreakpoints: RequestedBreakpoint[] = args.breakpoints ?? [];

        if (!this.context().index) {
            const breakpoints = sourceBreakpoints.map((_bp) => ({
                id: this.nextBpId++,
                verified: false,
                message: this.context().metadataError,
                line: _bp.line,
            }));
            return breakpoints;
        }

        if (!source) {
            const breakpoints = sourceBreakpoints.map((_bp) => ({
                id: this.nextBpId++,
                verified: false,
                message: 'The breakpoint request did not include a source file path.',
                line: _bp.line,
            }));
            return breakpoints;
        }

        if (!this.client) { return []; }

        const sourceKey = process.platform === 'win32'
            ? path.normalize(source).toLowerCase()
            : path.normalize(source);
        const resolvedBreakpoints = sourceBreakpoints.map(bp => ({
            requested: bp,
            resolved: this.context().index!.resolveBreakpoint(source, bp.line ?? 0),
        }));
        const previousAddresses = this.sourceBpAddresses.get(sourceKey) ?? new Set<number>();
        const desiredAddresses = new Set<number>();
        const requestedConfigurations = new Map<number, Omit<AdapterBreakpoint, 'id' | 'address'>>();

        const result: BreakpointResult[] = [];
        for (const { requested: bp, resolved } of resolvedBreakpoints) {
            if (!resolved) {
                result.push({
                    id: this.nextBpId++,
                    verified: false,
                    message: `No executable code at line ${bp.line}`,
                    line: bp.line,
                });
                continue;
            }
            if (previousAddresses.has(resolved.address)) { desiredAddresses.add(resolved.address); }
            let configuration: Omit<AdapterBreakpoint, 'id' | 'address'>;
            try {
                configuration = this.parseBreakpointConfiguration(bp, true);
            } catch (error) {
                result.push({ id: this.nextBpId++, verified: false, message: String(error instanceof Error ? error.message : error), line: bp.line });
                continue;
            }

            const priorRequest = requestedConfigurations.get(resolved.address);
            if (priorRequest && !this.sameBreakpointConfiguration(priorRequest, configuration)) {
                const existing = this.breakpointsByAddress.get(resolved.address);
                result.push({
                    id: existing?.id ?? this.nextBpId++,
                    verified: false,
                    message: `Breakpoint address ${hex4(resolved.address)} already has a different configuration.`,
                    line: bp.line,
                });
                continue;
            }
            requestedConfigurations.set(resolved.address, configuration);

            const existing = this.breakpointsByAddress.get(resolved.address);
            if (existing && !this.sameBreakpointConfiguration(existing, configuration)
                && (!previousAddresses.has(resolved.address)
                    || this.hasOtherSourceReference(resolved.address, sourceKey)
                    || this.instructionBpAddresses.has(resolved.address))) {
                result.push({
                    id: existing.id,
                    verified: false,
                    message: `Breakpoint address ${hex4(resolved.address)} already has a different configuration.`,
                    line: bp.line,
                });
                continue;
            }
            const breakpoint: AdapterBreakpoint = {
                id: existing?.id ?? this.nextBpId++, address: resolved.address, ...configuration,
            };
            const backendChanged = !existing || !this.sameBackendConfiguration(existing, configuration);
            if (backendChanged) {
                const addResp = await this.client.send(
                    IpcCommand.DEBUG_BREAKPOINT_ADD,
                    this.makeBreakpointRequest(breakpoint),
                ).catch(() => { this.assertCurrent(); return { ok: false }; });
                if (!addResp.ok) {
                    result.push({ id: breakpoint.id, verified: false, message: 'Backend rejected breakpoint', line: bp.line });
                    continue;
                }
                this.breakpointsByAddress.set(resolved.address, breakpoint);
                this.temporary.setUserOwned(resolved.address, true);
                this.bpAddrToId.set(resolved.address, breakpoint.id);
                this.bpIdToAddr.set(breakpoint.id, resolved.address);
            } else if (existing) {
                existing.logMessage = configuration.logMessage;
            }
            desiredAddresses.add(resolved.address);
            result.push({
                id: breakpoint.id,
                verified: true,
                line: resolved.verifiedLine,
                instructionReference: hex4(resolved.address),
                message: this.breakpointMessage(breakpoint),
            });
        }
        this.sourceBpAddresses.set(sourceKey, desiredAddresses);
        for (const addr of previousAddresses) {
            if (!desiredAddresses.has(addr) && !this.isBreakpointAddressReferenced(addr)) {
                try { await this.deleteBackendBreakpoint(addr); }
                catch (error) { this.assertCurrent(); desiredAddresses.add(addr); throw error; }
            }
        }
        if (desiredAddresses.size === 0) {
            this.sourceBpAddresses.delete(sourceKey);
        }
        return result;
    }

    // -----------------------------------------------------------------------
    // setInstructionBreakpoints — direct address breakpoints (working now)
    // -----------------------------------------------------------------------

    private async setInstructionsNow(args: InstructionBreakpointArguments): Promise<BreakpointResult[]> {
        if (!this.client) {
            return [];
        }

        const requestedBreakpoints = (args.breakpoints ?? []).map((requested) => ({
            requested,
            address: parseInt(String(requested.instructionReference ?? '0x0'), 16) & 0xFFFF,
        }));
        const desired = requestedBreakpoints.map((breakpoint: { address: number }) => breakpoint.address);

        // Remove instruction breakpoints that are no longer desired and are not source-owned.
        const previousAddresses = this.instructionBpAddresses;
        this.instructionBpAddresses = new Set(desired);
        for (const addr of previousAddresses) {
            if (!this.instructionBpAddresses.has(addr) && !this.isBreakpointAddressReferenced(addr)) {
                try { await this.deleteBackendBreakpoint(addr); }
                catch (error) { this.assertCurrent(); this.instructionBpAddresses.add(addr); throw error; }
            }
        }

        // Add newly requested breakpoints
        const result: BreakpointResult[] = [];
        for (const { requested, address: addr } of requestedBreakpoints) {
            let configuration: Omit<AdapterBreakpoint, 'id' | 'address'>;
            try {
                configuration = this.parseBreakpointConfiguration(requested, false);
            } catch (error) {
                result.push({
                    id: this.nextBpId++,
                    verified: false,
                    message: String(error instanceof Error ? error.message : error),
                    instructionReference: hex4(addr),
                });
                if (!previousAddresses.has(addr)) { this.instructionBpAddresses.delete(addr); }
                continue;
            }
            const existing = this.breakpointsByAddress.get(addr);
            if (existing && !this.sameBreakpointConfiguration(existing, configuration)
                && (!previousAddresses.has(addr)
                    || [...this.sourceBpAddresses.values()].some(addresses => addresses.has(addr)))) {
                result.push({
                    id: existing.id,
                    verified: false,
                    message: `Breakpoint address ${hex4(addr)} already has a different configuration.`,
                    instructionReference: hex4(addr),
                });
                if (!previousAddresses.has(addr)) { this.instructionBpAddresses.delete(addr); }
                continue;
            }
            const breakpoint: AdapterBreakpoint = { id: existing?.id ?? this.nextBpId++, address: addr, ...configuration };
            if (!existing || !this.sameBackendConfiguration(existing, configuration)) {
                const addResp = await this.client.send(
                    IpcCommand.DEBUG_BREAKPOINT_ADD,
                    this.makeBreakpointRequest(breakpoint),
                ).catch(() => { this.assertCurrent(); return { ok: false }; });

                if (addResp.ok) {
                    this.breakpointsByAddress.set(addr, breakpoint);
                    this.temporary.setUserOwned(addr, true);
                    this.bpAddrToId.set(addr, breakpoint.id);
                    this.bpIdToAddr.set(breakpoint.id, addr);
                    result.push({
                        id: breakpoint.id,
                        verified: true,
                        instructionReference: hex4(addr),
                        message: this.breakpointMessage(breakpoint),
                    });
                } else {
                    if (!previousAddresses.has(addr)) { this.instructionBpAddresses.delete(addr); }
                    result.push({
                        id: breakpoint.id,
                        verified: false,
                        message: 'Failed to set breakpoint in emulator.',
                        instructionReference: hex4(addr),
                    });
                }
            } else {
                existing.logMessage = configuration.logMessage;
                result.push({
                    id: breakpoint.id,
                    verified: true,
                    instructionReference: hex4(addr),
                    message: this.breakpointMessage(breakpoint),
                });
            }
        }

        return result;
    }

    private isBreakpointAddressReferenced(addr: number): boolean {
        if (this.instructionBpAddresses.has(addr)) { return true; }
        return [...this.sourceBpAddresses.values()].some(addresses => addresses.has(addr));
    }

    private async deleteBackendBreakpoint(addr: number): Promise<void> {
        const response = await this.client?.send(IpcCommand.DEBUG_BREAKPOINT_DEL, { addr });
        if (!response?.ok) { throw new Error(response?.error ?? 'Backend rejected breakpoint removal'); }
        const id = this.bpAddrToId.get(addr);
        this.bpAddrToId.delete(addr);
        if (id !== undefined) { this.bpIdToAddr.delete(id); }
        this.breakpointsByAddress.delete(addr);
        this.temporary.setUserOwned(addr, false);
        if (!await this.temporary.restoreTemporary(addr)) {
            this.warn(`v6-debug: unable to restore temporary breakpoint at ${hex4(addr)}`);
        }
    }

}
