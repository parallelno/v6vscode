import * as fs from 'fs';
import { Logger } from '../../platform/logging/logger';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';

export interface V6emulLocatorDeps {
    logger: Logger;
    getEnv: (name: string) => string | undefined;
}

/**
 * Resolves the v6emul executable exclusively through `V6EMUL`.
 */
export class V6emulLocator {
    private readonly deps: V6emulLocatorDeps;

    constructor(deps: V6emulLocatorDeps) {
        this.deps = deps;
    }

    resolve(): string {
        const envPath = this.deps.getEnv('V6EMUL');
        if (envPath) {
            this.deps.logger.debug(`v6emul-locator: checking env V6EMUL="${envPath}"`);
            if (fs.existsSync(envPath)) {
                this.deps.logger.info(`v6emul-locator: found via env V6EMUL="${envPath}"`);
                return envPath;
            }
            this.deps.logger.warn(`v6emul-locator: env V6EMUL path does not exist "${envPath}"`);
        }

        throw new V6Error(
            ErrorCode.EMULATOR_NOT_FOUND,
            'Could not locate v6emul. Set V6EMUL to the full path of the v6emul executable and restart VS Code.',
        );
    }
}
