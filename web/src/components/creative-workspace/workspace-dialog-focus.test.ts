// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { captureWorkspaceDialogTrigger, restoreWorkspaceDialogTrigger } from "./workspace-dialog-focus";

describe("workspace dialog focus return", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it("captures the command trigger and restores it after a dialog closes", () => {
        const trigger = document.createElement("button");
        const dialogControl = document.createElement("button");
        document.body.append(trigger, dialogControl);
        trigger.focus();

        const captured = captureWorkspaceDialogTrigger();
        dialogControl.focus();
        restoreWorkspaceDialogTrigger(captured);

        expect(document.activeElement).toBe(trigger);
    });

    it("does not move focus to a trigger that is no longer connected", () => {
        const trigger = document.createElement("button");
        const fallback = document.createElement("button");
        document.body.append(trigger, fallback);
        trigger.focus();
        const captured = captureWorkspaceDialogTrigger();
        trigger.remove();
        fallback.focus();

        restoreWorkspaceDialogTrigger(captured);

        expect(document.activeElement).toBe(fallback);
    });
});
