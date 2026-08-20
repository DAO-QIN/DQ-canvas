import { describe, expect, it } from "vitest";

import { initialDesignEditorViewState, reduceDesignEditorViewState } from "./use-design-editor-view-state";

describe("reduceDesignEditorViewState", () => {
    it("owns non-persistent rail and legacy shape-menu state", () => {
        const railClosed = reduceDesignEditorViewState(initialDesignEditorViewState, { type: "toggle-right-panel" });
        const inspectorSelected = reduceDesignEditorViewState(railClosed, { type: "select-right-tab", tab: "inspector" });
        const menuOpen = reduceDesignEditorViewState(inspectorSelected, { type: "toggle-shape-menu" });

        expect(menuOpen).toEqual({ rightPanelOpen: false, rightTab: "inspector", shapeMenuOpen: true });
        expect(reduceDesignEditorViewState(menuOpen, { type: "close-shape-menu" })).toEqual({ ...menuOpen, shapeMenuOpen: false });
    });

    it("returns the same state when an already closed shape menu is closed", () => {
        expect(reduceDesignEditorViewState(initialDesignEditorViewState, { type: "close-shape-menu" })).toBe(initialDesignEditorViewState);
    });
});
