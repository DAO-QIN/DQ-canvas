// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { isDesignEditorModalActive, resolveDesignEditorShortcut } from "./use-design-editor-shortcuts";

afterEach(() => {
    document.body.replaceChildren();
});

describe("resolveDesignEditorShortcut", () => {
    it.each([
        [{ key: "z", ctrlKey: true, metaKey: false, shiftKey: false }, "undo"],
        [{ key: "Z", ctrlKey: false, metaKey: true, shiftKey: false }, "undo"],
        [{ key: "z", ctrlKey: true, metaKey: false, shiftKey: true }, "redo"],
        [{ key: "y", ctrlKey: true, metaKey: false, shiftKey: false }, "redo"],
        [{ key: "e", ctrlKey: true, metaKey: false, shiftKey: true }, "open-export"],
        [{ key: "E", ctrlKey: false, metaKey: true, shiftKey: true }, "open-export"],
        [{ key: "Escape", ctrlKey: false, metaKey: false, shiftKey: false }, "clear-selection"],
        [{ key: "Delete", ctrlKey: false, metaKey: false, shiftKey: false }, "delete-selection"],
        [{ key: "Backspace", ctrlKey: false, metaKey: false, shiftKey: false }, "delete-selection"],
    ] as const)("maps %o to %s", (input, expected) => {
        expect(resolveDesignEditorShortcut(input)).toBe(expected);
    });

    it("ignores unowned keys and unmodified history keys", () => {
        expect(resolveDesignEditorShortcut({ key: "z", ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
        expect(resolveDesignEditorShortcut({ key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
    });
});

describe("isDesignEditorModalActive", () => {
    it.each(['<div role="dialog" aria-modal="true"></div>', "<dialog open></dialog>"])("detects an open modal dialog: %s", (markup) => {
        document.body.innerHTML = markup;

        expect(isDesignEditorModalActive()).toBe(true);
    });

    it.each([
        '<div aria-hidden="true"><div role="dialog" aria-modal="true"></div></div>',
        "<div inert><dialog open></dialog></div>",
        '<div style="display: none"><div role="dialog" aria-modal="true"></div></div>',
        '<div role="dialog" aria-modal="false"></div>',
        "<dialog></dialog>",
    ])("ignores a closed or inactive modal dialog: %s", (markup) => {
        document.body.innerHTML = markup;

        expect(isDesignEditorModalActive()).toBe(false);
    });

    it("uses the original event path while a closing modal is being removed", () => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        const trigger = document.createElement("button");
        dialog.append(trigger);

        expect(isDesignEditorModalActive({ composedPath: () => [trigger, dialog] })).toBe(true);
    });
});
