import * as fs from 'fs';
import { Logger } from '../../platform/logging/logger';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';

export interface V6asmLocatorDeps {
    logger: Logger;
    getConfiguration: (section: string) => { get(key: string, defaultValue?: string): string | undefined };
    getEnv: (name: string) => string | undefined;
    which: (name: string) => string | undefined;
}

/**
 * Resolves the path to the v6asm executable using a three-tier strategy:
 *
 * 1. VS Code setting `v6.assemblerPath` — explicit workspace/user override.
 * 2. Environment variable `V6ASM` — useful for CI/CD pipelines and developers
 *    who also drive builds from the terminal with `V6ASM=/path/to/v6asm make`.
 * 3. PATH lookup — works if `v6asm` is installed globally.
 *
 * If none of the above succeed the locator throws with `ASSEMBLER_NOT_FOUND`
 * so the caller can surface an actionable error in VS Code.
 */
export class V6asmLocator {
    private readonly deps: V6asmLocatorDeps;

    constructor(deps: V6asmLocatorDeps) {
        this.deps = deps;
    }

    resolve(): string {
        // 1. VS Code setting override (workspace → user → default)
        const settingPath = this.deps.getConfiguration('v6').get('assemblerPath', '');
        if (settingPath) {
            this.deps.logger.debug(`v6asm-locator: checking setting "${settingPath}"`);
            if (fs.existsSync(settingPath)) {
                this.deps.logger.info(`v6asm-locator: found via setting "${settingPath}"`);
                return settingPath;
            }
            this.deps.logger.warn(`v6asm-locator: setting path does not exist "${settingPath}"`);
        }

        // 2. Environment variable V6ASM
        const envPath = this.deps.getEnv('V6ASM');
        if (envPath) {
            this.deps.logger.debug(`v6asm-locator: checking env V6ASM="${envPath}"`);
            if (fs.existsSync(envPath)) {
                this.deps.logger.info(`v6asm-locator: found via env V6ASM="${envPath}"`);
                return envPath;
            }
            this.deps.logger.warn(`v6asm-locator: env V6ASM path does not exist "${envPath}"`);
        }

        // 3. PATH lookup
        const pathResult = this.deps.which('v6asm');
        if (pathResult) {
            this.deps.logger.info(`v6asm-locator: found on PATH "${pathResult}"`);
            return pathResult;
        }

        throw new V6Error(
            ErrorCode.ASSEMBLER_NOT_FOUND,
            'Could not locate v6asm. Set v6.assemblerPath in settings, set the V6ASM environment variable, or add v6asm to PATH.',
        );
    }
}
