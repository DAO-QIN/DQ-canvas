import type { DesignEditorSaveStatus } from "../store/design-editor-store";

export type DesignSaveNavigationFailure = {
    status: DesignEditorSaveStatus;
    error?: unknown;
};

export type DesignSaveNavigationDependencies = {
    getStatus: () => DesignEditorSaveStatus;
    flush: () => Promise<void>;
    navigate: () => void | Promise<void>;
    onFailure?: (failure: DesignSaveNavigationFailure) => void;
};

export type DesignSaveNavigationCoordinator = {
    navigate: () => Promise<boolean>;
};

/**
 * Coordinates an explicit editor exit without owning editor or router state.
 * Concurrent exit attempts share one run so a successful exit navigates once.
 */
export function createDesignSaveNavigationCoordinator(dependencies: DesignSaveNavigationDependencies): DesignSaveNavigationCoordinator {
    let inFlight: Promise<boolean> | null = null;

    const run = async () => {
        const initialStatus = dependencies.getStatus();
        if (initialStatus === "error" || initialStatus === "conflict") {
            dependencies.onFailure?.({ status: initialStatus });
            return false;
        }
        if (initialStatus === "dirty" || initialStatus === "saving") {
            try {
                await dependencies.flush();
            } catch (error) {
                dependencies.onFailure?.({ status: dependencies.getStatus(), error });
                return false;
            }
        }

        const finalStatus = dependencies.getStatus();
        if (finalStatus !== "saved") {
            dependencies.onFailure?.({ status: finalStatus });
            return false;
        }

        await dependencies.navigate();
        return true;
    };

    return {
        navigate: () => {
            if (inFlight) return inFlight;
            inFlight = run().finally(() => {
                inFlight = null;
            });
            return inFlight;
        },
    };
}
