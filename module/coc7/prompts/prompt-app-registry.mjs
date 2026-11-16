let promptApps;

export function registerPromptApps(apps) {
    promptApps = apps;
}

export function getPromptApp(name) {
    const PromptApp = promptApps?.[name];
    if (!PromptApp) throw new Error(`Call of Cthulhu prompt "${name}" has not been initialized.`);
    return PromptApp;
}
