let coreApi;

export const MODULE_ID = "narrative-rolls-and-effects";

export function setCoreApi(api) {
    coreApi = api;
}

function getCoreService(serviceName) {
    const service = coreApi?.[serviceName];
    if (!service) throw new Error(`Narrative Rolls core service "${serviceName}" is unavailable.`);
    return service;
}

function createServiceFacade(serviceName) {
    return new Proxy({}, {
        get(_target, property) {
            const service = getCoreService(serviceName);
            const value = service[property];
            return typeof value === "function" ? value.bind(service) : value;
        },
        construct(_target, argumentsList) {
            return Reflect.construct(getCoreService(serviceName), argumentsList);
        }
    });
}

export const SessionStore = createServiceFacade("session");
export const UniversalRollOrchestrator = createServiceFacade("orchestrator");
export const RollVisibilityPolicy = createServiceFacade("visibility");
export const EffectsEngine = createServiceFacade("effects");
export const ActorTargetSelectorApp = createServiceFacade("actorSelector");

export function createPromptClass(definition) {
    return getCoreService("createPromptClass")(definition);
}

export function extendPromptClass(baseClass, definition) {
    return getCoreService("extendPromptClass")(baseClass, definition);
}

export function getPromptFactory() {
    return {
        createPromptClass: (definition) => createPromptClass(definition),
        extendPromptClass: (baseClass, definition) => extendPromptClass(baseClass, definition)
    };
}
