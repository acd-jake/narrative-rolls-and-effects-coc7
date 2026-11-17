let coreApi;

export const MODULE_ID = "narrative-rolls-and-effects";

/** Stores the core API provided during adapter registration for later service access. */
export function setCoreApi(api) {
    coreApi = api;
}

function getCoreService(serviceName) {
    const service = coreApi?.[serviceName];
    if (!service) throw new Error(`Narrative Rolls core service "${serviceName}" is unavailable.`);
    return service;
}

function createServiceFacade(serviceName) {
    // Resolve services lazily so facades can be imported before the core API is available.
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
export const DiceVisualizer = createServiceFacade("diceVisualizer");

/** Creates a system prompt class through the registered core service. */
export function createPromptClass(definition) {
    return getCoreService("createPromptClass")(definition);
}

/** Extends a core prompt class while keeping prompt construction owned by the core module. */
export function extendPromptClass(baseClass, definition) {
    return getCoreService("extendPromptClass")(baseClass, definition);
}

/** Exposes the core prompt factories in the shape expected by the CoC7 adapter. */
export function getPromptFactory() {
    return {
        createPromptClass: (definition) => createPromptClass(definition),
        extendPromptClass: (baseClass, definition) => extendPromptClass(baseClass, definition)
    };
}
