import { AddressRange, DebugIndex, StatementRow } from '../metadata/debug-index';
import { DebugMetadataIndex } from '../metadata/debug-metadata-index';

export interface LogicalLocation {
    physicalFrameId: string;
    inlineChain: readonly number[];
    file: string;
    line: number;
    column: number;
    discriminator?: number;
    isStmt: boolean;
}

export interface LogicalStatement {
    location: LogicalLocation;
    ranges: readonly AddressRange[];
}

export class LogicalLocationIndex {
    constructor(
        private readonly debugIndex: DebugIndex,
        private readonly metadata: Pick<DebugMetadataIndex, 'inlineChainAt'>,
    ) {}

    at(address: number, physicalFrameId: string): LogicalStatement | undefined {
        const row = this.rowAt(address);
        return row ? this.statementFor(row, physicalFrameId) : undefined;
    }

    next(statement: LogicalStatement, physicalRanges: readonly AddressRange[]): readonly LogicalStatement[] {
        const candidates = new Map<string, LogicalStatement>();
        for (const row of this.debugIndex.statementRows) {
            if (row.address <= this.lastAddress(statement.ranges) || !inRanges(row.address, physicalRanges)) { continue; }
            const candidate = this.statementFor(row, statement.location.physicalFrameId);
            if (!sameLocation(candidate.location, statement.location)) {
                candidates.set(locationKey(candidate.location), candidate);
            }
        }
        return [...candidates.values()];
    }

    private rowAt(address: number): StatementRow | undefined {
        return this.debugIndex.statementRows.find(row => row.address === address);
    }

    private statementFor(row: StatementRow, physicalFrameId: string): LogicalStatement {
        const location: LogicalLocation = {
            physicalFrameId,
            inlineChain: this.metadata.inlineChainAt(row.address).map(scope => scope.id),
            file: row.file,
            line: row.line,
            column: row.column,
            ...(row.discriminator === undefined ? {} : { discriminator: row.discriminator }),
            isStmt: row.isStmt,
        };
        const ranges = this.debugIndex.statementRows
            .filter(candidate => sameLocation(this.locationFor(candidate, physicalFrameId), location))
            .map(candidate => ({ start: candidate.address, end: candidate.address + 1 }));
        return { location, ranges };
    }

    private locationFor(row: StatementRow, physicalFrameId: string): LogicalLocation {
        return {
            physicalFrameId,
            inlineChain: this.metadata.inlineChainAt(row.address).map(scope => scope.id),
            file: row.file,
            line: row.line,
            column: row.column,
            ...(row.discriminator === undefined ? {} : { discriminator: row.discriminator }),
            isStmt: row.isStmt,
        };
    }

    private lastAddress(ranges: readonly AddressRange[]): number {
        return Math.max(...ranges.map(range => range.end - 1));
    }
}

function inRanges(address: number, ranges: readonly AddressRange[]): boolean {
    return ranges.some(range => address >= range.start && address < range.end);
}

function sameLocation(left: LogicalLocation, right: LogicalLocation): boolean {
    return left.physicalFrameId === right.physicalFrameId
        && left.file === right.file
        && left.line === right.line
        && left.column === right.column
        && left.discriminator === right.discriminator
        && left.isStmt === right.isStmt
        && left.inlineChain.length === right.inlineChain.length
        && left.inlineChain.every((id, index) => id === right.inlineChain[index]);
}

function locationKey(location: LogicalLocation): string {
    return `${location.physicalFrameId}:${location.inlineChain.join(',')}:${location.file}:${location.line}:${location.column}:${location.discriminator ?? ''}`;
}