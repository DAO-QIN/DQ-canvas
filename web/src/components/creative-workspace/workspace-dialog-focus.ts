export function captureWorkspaceDialogTrigger() {
    if (typeof document === "undefined") return null;
    return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export function restoreWorkspaceDialogTrigger(target: HTMLElement | null) {
    if (!target?.isConnected) return;
    try {
        target.focus({ preventScroll: true });
    } catch {
        target.focus();
    }
}
