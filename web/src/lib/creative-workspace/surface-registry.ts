import { defineWorkspaceSurface, workspaceCommandIsSupported, type WorkspaceCommandDescriptor, type WorkspaceSurfaceCapabilityId, type WorkspaceSurfaceDescriptor } from "./surface-contract";

export type WorkspaceSurfaceRegistry = Readonly<{
    surfaces: readonly WorkspaceSurfaceDescriptor[];
}>;

export function createWorkspaceSurfaceRegistry(surfaces: readonly WorkspaceSurfaceDescriptor[] = []): WorkspaceSurfaceRegistry {
    return surfaces.reduce(registerWorkspaceSurface, emptyWorkspaceSurfaceRegistry());
}

/** Returns a new registry and rejects accidental replacement. */
export function registerWorkspaceSurface(registry: WorkspaceSurfaceRegistry, descriptor: WorkspaceSurfaceDescriptor): WorkspaceSurfaceRegistry {
    const surface = defineWorkspaceSurface(descriptor);
    if (getWorkspaceSurface(registry, surface.id)) throw new Error(`Workspace surface is already registered: ${surface.id}`);
    return Object.freeze({ surfaces: Object.freeze([...registry.surfaces, surface]) });
}

export function unregisterWorkspaceSurface(registry: WorkspaceSurfaceRegistry, surfaceId: string): WorkspaceSurfaceRegistry {
    if (!getWorkspaceSurface(registry, surfaceId)) return registry;
    return Object.freeze({ surfaces: Object.freeze(registry.surfaces.filter((surface) => surface.id !== surfaceId)) });
}

export function getWorkspaceSurface(registry: WorkspaceSurfaceRegistry, surfaceId: string): WorkspaceSurfaceDescriptor | undefined {
    return registry.surfaces.find((surface) => surface.id === surfaceId);
}

export function workspaceRegistrySurfaceSupports(registry: WorkspaceSurfaceRegistry, surfaceId: string, requiredCapabilities: readonly WorkspaceSurfaceCapabilityId[]): boolean {
    const surface = getWorkspaceSurface(registry, surfaceId);
    return Boolean(surface && requiredCapabilities.every((capability) => surface.capabilities[capability] === true));
}

/**
 * Returns only commands whose declared requirements are supported. This is
 * the default capability gate used by shared controls; unsupported commands
 * remain descriptor metadata and cannot become accidental fake actions.
 */
export function listWorkspaceSurfaceCommands(registry: WorkspaceSurfaceRegistry, surfaceId: string): readonly WorkspaceCommandDescriptor[] {
    const surface = getWorkspaceSurface(registry, surfaceId);
    if (!surface) return EMPTY_COMMANDS;
    return Object.freeze(surface.commands.filter((command) => workspaceCommandIsSupported(surface.capabilities, command)));
}

export function getWorkspaceSurfaceCommand(registry: WorkspaceSurfaceRegistry, surfaceId: string, commandId: string): WorkspaceCommandDescriptor | undefined {
    return listWorkspaceSurfaceCommands(registry, surfaceId).find((command) => command.id === commandId);
}

const EMPTY_COMMANDS = Object.freeze([]) as readonly WorkspaceCommandDescriptor[];

function emptyWorkspaceSurfaceRegistry(): WorkspaceSurfaceRegistry {
    return Object.freeze({ surfaces: Object.freeze([]) });
}
