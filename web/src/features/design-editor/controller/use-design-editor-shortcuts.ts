"use client";

import { useEffect } from "react";

import type { DesignEditorStore } from "../store/design-editor-store";

type DesignEditorShortcutNotifier = {
    info: (content: string) => unknown;
};

type UseDesignEditorShortcutsOptions = {
    store: DesignEditorStore;
    notify: DesignEditorShortcutNotifier;
    removeSelection: () => void;
    openExport: () => void;
};

export type DesignEditorShortcutAction = "undo" | "redo" | "open-export" | "clear-selection" | "delete-selection";
export type DesignEditorShortcutInput = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">;

const MODAL_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"], dialog[open]';

export function useDesignEditorShortcuts({ store, notify, removeSelection, openExport }: UseDesignEditorShortcutsOptions) {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (isDesignEditorModalActive(event)) return;
            if (isDesignEditorEditableTarget(event.target)) return;
            const action = resolveDesignEditorShortcut(event);
            if (!action) return;

            if (action === "undo" || action === "redo" || action === "open-export" || action === "delete-selection") event.preventDefault();
            if (action === "undo") {
                if (!store.getState().undo()) notify.info("没有可撤销的操作");
                return;
            }
            if (action === "redo") {
                if (!store.getState().redo()) notify.info("没有可重做的操作");
                return;
            }
            if (action === "clear-selection") {
                store.getState().select(null);
                return;
            }
            if (action === "open-export") {
                openExport();
                return;
            }
            removeSelection();
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [notify, openExport, removeSelection, store]);
}

export function resolveDesignEditorShortcut(input: DesignEditorShortcutInput): DesignEditorShortcutAction | null {
    const modifier = input.ctrlKey || input.metaKey;
    const key = input.key.toLowerCase();
    if (modifier && key === "z") return input.shiftKey ? "redo" : "undo";
    if (modifier && key === "y") return "redo";
    if (modifier && input.shiftKey && key === "e") return "open-export";
    if (input.key === "Escape") return "clear-selection";
    if (input.key === "Delete" || input.key === "Backspace") return "delete-selection";
    return null;
}

export function isDesignEditorEditableTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || target.matches("input, textarea, select") || Boolean(target.closest("[contenteditable='true']"));
}

export function isDesignEditorModalActive(event?: Pick<Event, "composedPath">, root?: ParentNode) {
    if (typeof Element !== "undefined" && event?.composedPath().some((entry) => entry instanceof Element && entry.matches(MODAL_DIALOG_SELECTOR))) {
        return true;
    }

    const queryRoot = root ?? (typeof document === "undefined" ? null : document);
    if (!queryRoot) return false;
    return Array.from(queryRoot.querySelectorAll(MODAL_DIALOG_SELECTOR)).some(isVisibleModalDialog);
}

function isVisibleModalDialog(dialog: Element) {
    for (let current: Element | null = dialog; current; current = current.parentElement) {
        if (current.hasAttribute("hidden") || current.hasAttribute("inert") || current.getAttribute("aria-hidden") === "true") return false;
        if (typeof window === "undefined") continue;
        const style = window.getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
}
