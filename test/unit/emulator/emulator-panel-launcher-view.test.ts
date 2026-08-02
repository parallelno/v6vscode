import { expect } from 'chai';
import { EmulatorPanelLauncherView } from '../../../src/emulator/panel/emulator-panel-launcher-view';

describe('EmulatorPanelLauncherView', () => {
    it('lists all standalone panels in the requested order', () => {
        const view = new EmulatorPanelLauncherView();
        expect(view.getChildren().map(item => item.label)).to.deep.equal([
            'Settings', 'Display', 'Hex Viewer', 'Memory Edits', 'Symbols', 'Ports', 'Watchpoints',
        ]);
    });

    it('reflects panel open and closed state', () => {
        const view = new EmulatorPanelLauncherView();
        view.setOpen('v6emul.toggleDisplay', true);
        const openDisplay = view.getChildren()[1];
        expect(openDisplay.description).to.equal('Open');
        expect((openDisplay.iconPath as any).id).to.equal('check');
        expect(openDisplay.tooltip).to.equal('Close Display');

        view.setOpen('v6emul.toggleDisplay', false);
        const closedDisplay = view.getChildren()[1];
        expect(closedDisplay.description).to.equal('');
        expect(closedDisplay.tooltip).to.equal('Open Display');
    });
});