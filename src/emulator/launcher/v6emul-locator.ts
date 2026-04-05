import * as fs from 'fs';
import { PathService } from '../../platform/files/path-service';
import { Logger } from '../../platform/logging/logger';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';
import { SETTING_EMULATOR_PATH } from '../../config/contribution-ids';

export interface V6emulLocatorDeps {
    pathService: PathService;
    logger: Logger;
    getConfiguration: (section: string) => { get(key: string, defaultValue?: string): string | undefined };
    which: (name: string) => string | undefined;
}

export class V6emulLocator {
    private readonly deps: V6emulLocatorDeps;

    constructor(deps: V6emulLocatorDeps) {
        this.deps = deps;
    }

    resolve(): string {
        // 1. User setting override
        const settingPath = this.deps.getConfiguration('v6').get('emulatorPath', '');
        if (settingPath) {
            this.deps.logger.debug(`v6emul-locator: checking setting "${settingPath}"`);
            if (fs.existsSync(settingPath)) {
                this.deps.logger.info(`v6emul-locator: found via setting "${settingPath}"`);
                return settingPath;
            }
            this.deps.logger.warn(`v6emul-locator: setting path does not exist "${settingPath}"`);
        }

        // 2. Bundled path
        const bundledPath = this.deps.pathService.resolveExtensionPath('res/v6emul/v6emul');
        this.deps.logger.debug(`v6emul-locator: checking bundled "${bundledPath}"`);
        if (fs.existsSync(bundledPath)) {
            this.deps.logger.info(`v6emul-locator: found bundled "${bundledPath}"`);
            return bundledPath;
        }

        // Also try with .exe on Windows
        const bundledPathExe = bundledPath + '.exe';
        if (fs.existsSync(bundledPathExe)) {
            this.deps.logger.info(`v6emul-locator: found bundled "${bundledPathExe}"`);
            return bundledPathExe;
        }

        // 3. PATH lookup
        const pathResult = this.deps.which('v6emul');
        if (pathResult) {
            this.deps.logger.info(`v6emul-locator: found on PATH "${pathResult}"`);
            return pathResult;
        }

        throw new V6Error(
            ErrorCode.EMULATOR_NOT_FOUND,
            'Could not locate v6emul. Set v6.emulatorPath in settings or add v6emul to PATH.',
        );
    }
}
