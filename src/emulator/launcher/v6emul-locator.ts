import * as fs from 'fs';
import { Logger } from '../../platform/logging/logger';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';

export interface V6emulLocatorDeps {
    logger: Logger;
    getConfiguration: (section: string) => { get(key: string, defaultValue?: string): string | undefined };
    getEnv: (name: string) => string | undefined;
    which: (name: string) => string | undefined;
}

/**
 * Resolves the path to the v6emul executable using a three-tier strategy:
 *
 * 1. VS Code setting `v6.emulatorPath` — explicit workspace/user override.
 * 2. Environment variable `V6EMUL` — useful for CI/CD pipelines and developers
 *    who manage toolchain paths via the environment.
 * 3. PATH lookup — works if `v6emul` is installed globally.
 *
 * If none of the above succeed the locator throws with `EMULATOR_NOT_FOUND`
 * so the caller can surface an actionable error in VS Code.
 */
export class V6emulLocator {
    private readonly deps: V6emulLocatorDeps;

    constructor(deps: V6emulLocatorDeps) {
        this.deps = deps;
    }

    resolve(): string {
        // 1. VS Code setting override (workspace → user → default)
        const settingPath = this.deps.getConfiguration('v6').get('emulatorPath', '');
        if (settingPath) {
            this.deps.logger.debug(`v6emul-locator: checking setting "${settingPath}"`);
            if (fs.existsSync(settingPath)) {
                this.deps.logger.info(`v6emul-locator: found via setting "${settingPath}"`);
                return settingPath;
            }
            this.deps.logger.warn(`v6emul-locator: setting path does not exist "${settingPath}"`);
        }

        // 2. Environment variable V6EMUL
        const envPath = this.deps.getEnv('V6EMUL');
        if (envPath) {
            this.deps.logger.debug(`v6emul-locator: checking env V6EMUL="${envPath}"`);
            if (fs.existsSync(envPath)) {
                this.deps.logger.info(`v6emul-locator: found via env V6EMUL="${envPath}"`);
                return envPath;
            }
            this.deps.logger.warn(`v6emul-locator: env V6EMUL path does not exist "${envPath}"`);
        }

        // 3. PATH lookup
        const pathResult = this.deps.which('v6emul');
        if (pathResult) {
            this.deps.logger.info(`v6emul-locator: found on PATH "${pathResult}"`);
            return pathResult;
        }

        throw new V6Error(
            ErrorCode.EMULATOR_NOT_FOUND,
            'Could not locate v6emul. Set v6.emulatorPath in settings, set the V6EMUL environment variable, or add v6emul to PATH.',
        );
    }
}
