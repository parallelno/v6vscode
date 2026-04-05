import * as fs from 'fs';
import { IpcClient } from '../client/ipc-client';
import { IpcCommand, GetFddInfoResponse, GetFddImageResponse } from '../protocol/ipc-commands';
import { Logger } from '../../platform/logging/logger';

/**
 * Persist modified FDD images back to disk when the emulator stops.
 *
 * Workflow (per design §2.10):
 * 1. If `fddReadOnly` is true → skip entirely.
 * 2. Poll GET_FDD_INFO for each mounted drive.
 * 3. If `updated` is true → export via GET_FDD_IMAGE → write to file → RESET_UPDATE_FDD.
 */
export class FddPersistence {
    constructor(
        private readonly client: IpcClient,
        private readonly logger: Logger,
    ) {}

    /**
     * Check and persist FDD images for the given project.
     * Call this before stopping the emulator.
     *
     * @param fddReadOnly Whether the project disables FDD persistence.
     * @param executablePath The FDD file path (only relevant for .fdd executables).
     */
    async persistIfNeeded(fddReadOnly: boolean, executablePath: string): Promise<void> {
        if (fddReadOnly) {
            this.logger.debug('fdd-persistence: fddReadOnly=true, skipping');
            return;
        }

        if (!executablePath.endsWith('.fdd')) {
            this.logger.debug('fdd-persistence: not an FDD executable, skipping');
            return;
        }

        if (!this.client.connected) {
            this.logger.warn('fdd-persistence: client not connected, skipping');
            return;
        }

        try {
            await this.persistDrive(0, executablePath);
        } catch (err) {
            this.logger.error(
                `fdd-persistence: failed to persist drive 0: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    private async persistDrive(driveIdx: number, filePath: string): Promise<void> {
        const infoResp = await this.client.send<GetFddInfoResponse>(
            IpcCommand.GET_FDD_INFO,
            { driveIdx },
        );

        if (!infoResp.ok || !infoResp.data) {
            this.logger.debug(`fdd-persistence: drive ${driveIdx} info not available`);
            return;
        }

        if (!infoResp.data.mounted) {
            this.logger.debug(`fdd-persistence: drive ${driveIdx} not mounted`);
            return;
        }

        if (!infoResp.data.updated) {
            this.logger.debug(`fdd-persistence: drive ${driveIdx} not modified`);
            return;
        }

        this.logger.info(`fdd-persistence: drive ${driveIdx} has unsaved writes, exporting...`);

        const imageResp = await this.client.send<GetFddImageResponse>(
            IpcCommand.GET_FDD_IMAGE,
            { driveIdx },
        );

        if (!imageResp.ok || !imageResp.data) {
            this.logger.error(`fdd-persistence: failed to export drive ${driveIdx} image`);
            return;
        }

        const imageBuffer = Buffer.from(imageResp.data.data);
        fs.writeFileSync(filePath, imageBuffer);
        this.logger.info(`fdd-persistence: drive ${driveIdx} saved to "${filePath}" (${imageBuffer.length} bytes)`);

        await this.client.send(IpcCommand.RESET_UPDATE_FDD, { driveIdx });
        this.logger.debug(`fdd-persistence: drive ${driveIdx} dirty flag cleared`);
    }
}
