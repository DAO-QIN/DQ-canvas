"use client";

import { useCallback, useReducer } from "react";

export type DesignEditorRightTab = "layers" | "inspector" | "agent";
export type DesignEditorViewState = {
    rightPanelOpen: boolean;
    rightTab: DesignEditorRightTab;
    shapeMenuOpen: boolean;
};

export type DesignEditorViewAction = { type: "toggle-right-panel" } | { type: "select-right-tab"; tab: DesignEditorRightTab } | { type: "toggle-shape-menu" } | { type: "close-shape-menu" };

export const initialDesignEditorViewState: DesignEditorViewState = {
    rightPanelOpen: true,
    rightTab: "layers",
    shapeMenuOpen: false,
};

export function reduceDesignEditorViewState(state: DesignEditorViewState, action: DesignEditorViewAction): DesignEditorViewState {
    if (action.type === "toggle-right-panel") return { ...state, rightPanelOpen: !state.rightPanelOpen };
    if (action.type === "select-right-tab") return { ...state, rightTab: action.tab };
    if (action.type === "toggle-shape-menu") return { ...state, shapeMenuOpen: !state.shapeMenuOpen };
    if (!state.shapeMenuOpen) return state;
    return { ...state, shapeMenuOpen: false };
}

export function useDesignEditorViewState() {
    const [state, dispatch] = useReducer(reduceDesignEditorViewState, initialDesignEditorViewState);
    const toggleRightPanel = useCallback(() => dispatch({ type: "toggle-right-panel" }), []);
    const setRightTab = useCallback((tab: DesignEditorRightTab) => dispatch({ type: "select-right-tab", tab }), []);
    const toggleShapeMenu = useCallback(() => dispatch({ type: "toggle-shape-menu" }), []);
    const closeShapeMenu = useCallback(() => dispatch({ type: "close-shape-menu" }), []);

    return { ...state, toggleRightPanel, setRightTab, toggleShapeMenu, closeShapeMenu };
}
