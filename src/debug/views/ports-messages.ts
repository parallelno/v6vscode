import { PortDirection } from '../ports/ports-service';

export interface PortsViewModel {
    generation: number;
    ports: Partial<Record<PortDirection, readonly number[]>>;
    changed: Partial<Record<PortDirection, readonly number[]>>;
    errors: Partial<Record<PortDirection, string>>;
}

export type PortsWebviewMessage =
    | { type: 'ready' }
    | { type: 'refresh'; generation: number };

export type PortsHostMessage =
    | { type: 'state'; state: 'noSession' | 'unsupported' | 'loading' | 'ready' | 'running' | 'error'; message: string }
    | { type: 'snapshot'; model: PortsViewModel }
    | { type: 'reset'; generation: number };