import * as crypto from 'crypto';
import * as vscode from 'vscode';

function escape(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function webviewDocument(webview: vscode.Webview, assets: vscode.Uri, options: {
    title: string; asset: string; token: string; body: string; module?: boolean; styles?: readonly string[];
}): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const resource = (name: string) => escape(webview.asWebviewUri(vscode.Uri.joinPath(assets, name)).toString());
    const styles = [...options.styles ?? [], `${options.asset}.css`].map(name => `<link rel="stylesheet" href="${resource(name)}">`).join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">${styles}<title>${escape(options.title)}</title></head>
<body data-panel-token="${escape(options.token)}">${options.body}
<script ${options.module ? 'type="module" ' : ''}nonce="${nonce}" src="${resource(`${options.asset}.js`)}"></script></body></html>`;
}