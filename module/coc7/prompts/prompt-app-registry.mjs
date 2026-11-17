let promptApps;

/** Stores prompt classes after adapter initialization. */
export function registerPromptApps(apps) {
    promptApps = apps;
}

/** Returns an initialized prompt class or reports an invalid initialization order. */
export function getPromptApp(name) {
    const PromptApp = promptApps?.[name];
    if (!PromptApp) throw new Error(`Call of Cthulhu prompt "${name}" has not been initialized.`);
    return PromptApp;
}
