/**
 * Domain-neutral capabilities exposed by a creative surface adapter.
 *
 * Capabilities describe what a surface can do, not how a particular editor
 * stores or executes it. Extension capabilities must use the `extension:`
 * namespace so shared UI can fail closed for unknown built-ins.
 */
export const WORKSPACE_SURFACE_CAPABILITY_IDS = [
    "history.undo",
    "history.redo",
    "viewport.pan",
    "viewport.zoom",
    "viewport.fit",
    "viewport.observe",
    "viewport.coordinate-conversion",
    "selection.read",
    "selection.bounds",
    "selection.observe",
    "selection.resize",
    "selection.align",
    "selection.distribute",
    "selection.delete",
    "selection.prompt",
    "content.create",
] as const;

export type WorkspaceBuiltInSurfaceCapability = (typeof WORKSPACE_SURFACE_CAPABILITY_IDS)[number];
export type WorkspaceSurfaceCapabilityId = WorkspaceBuiltInSurfaceCapability | `extension:${string}`;

/** Presence with the literal value `true` means the capability is supported. */
export type WorkspaceSurfaceCapabilities = Readonly<Partial<Record<WorkspaceSurfaceCapabilityId, true>>>;

export const WORKSPACE_COMMAND_GROUPS = ["history", "viewport", "selection", "create", "generate", "surface"] as const;
export type WorkspaceBuiltInCommandGroup = (typeof WORKSPACE_COMMAND_GROUPS)[number];
export type WorkspaceCommandGroup = WorkspaceBuiltInCommandGroup | `extension:${string}`;

/**
 * Classifies side effects without leaking an editor's operation or Store type.
 * This supports UI placement and later Agent write-policy gates.
 */
export type WorkspaceCommandEffect = "read" | "view" | "document";

export type WorkspaceCommandDescriptor<CommandId extends string = string> = Readonly<{
    id: CommandId;
    label: string;
    description?: string;
    group: WorkspaceCommandGroup;
    effect: WorkspaceCommandEffect;
    shortcut?: string;
    requiredCapabilities?: readonly WorkspaceSurfaceCapabilityId[];
}>;

export type WorkspaceSurfaceDescriptor<SurfaceId extends string = string, CommandId extends string = string> = Readonly<{
    id: SurfaceId;
    label: string;
    capabilities: WorkspaceSurfaceCapabilities;
    commands: readonly WorkspaceCommandDescriptor<CommandId>[];
}>;

export function defineWorkspaceSurfaceCapabilities(...capabilities: readonly WorkspaceSurfaceCapabilityId[]): WorkspaceSurfaceCapabilities {
    const entries = [...new Set(capabilities)].map((capability) => [capability, true] as const);
    return Object.freeze(Object.fromEntries(entries)) as WorkspaceSurfaceCapabilities;
}

export function workspaceSurfaceSupports(capabilities: WorkspaceSurfaceCapabilities, requiredCapabilities: readonly WorkspaceSurfaceCapabilityId[]): boolean {
    return requiredCapabilities.every((capability) => capabilities[capability] === true);
}

export function workspaceCommandIsSupported(capabilities: WorkspaceSurfaceCapabilities, command: Pick<WorkspaceCommandDescriptor, "requiredCapabilities">): boolean {
    return workspaceSurfaceSupports(capabilities, command.requiredCapabilities ?? []);
}

/**
 * Takes a defensive, frozen snapshot so a registry never observes later
 * mutations to adapter-owned descriptor arrays or capability objects.
 */
export function defineWorkspaceSurface<const SurfaceId extends string, const CommandId extends string>(descriptor: WorkspaceSurfaceDescriptor<SurfaceId, CommandId>): WorkspaceSurfaceDescriptor<SurfaceId, CommandId> {
    assertNonBlank(descriptor.id, "Surface id");
    assertNonBlank(descriptor.label, `Surface ${descriptor.id} label`);

    const capabilities = defineWorkspaceSurfaceCapabilities(...enabledCapabilities(descriptor.capabilities));
    const commandIds = new Set<string>();
    const commands = descriptor.commands.map((command) => {
        assertNonBlank(command.id, `Surface ${descriptor.id} command id`);
        assertNonBlank(command.label, `Surface ${descriptor.id} command ${command.id} label`);
        if (commandIds.has(command.id)) throw new Error(`Surface ${descriptor.id} contains duplicate command id: ${command.id}`);
        commandIds.add(command.id);
        const requiredCapabilities = Object.freeze([...new Set(command.requiredCapabilities ?? [])]);
        return Object.freeze({ ...command, requiredCapabilities });
    });

    return Object.freeze({
        ...descriptor,
        capabilities,
        commands: Object.freeze(commands),
    });
}

function enabledCapabilities(capabilities: WorkspaceSurfaceCapabilities) {
    return Object.entries(capabilities)
        .filter(([, enabled]) => enabled === true)
        .map(([capability]) => capability as WorkspaceSurfaceCapabilityId);
}

function assertNonBlank(value: string, field: string) {
    if (!value.trim()) throw new Error(`${field} must not be blank`);
}
