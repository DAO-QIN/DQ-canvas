import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./use-canvas-node-media-actions.tsx", import.meta.url), "utf8");
const emotionWorkspaceSource = readFileSync(new URL("../components/canvas-emotion-workspace.tsx", import.meta.url), "utf8");

describe("canvas derived image request flow", () => {
    it("revalidates the annotation source after upload and before appending a node", () => {
        const flow = functionSource("const saveAnnotatedImageNode", "const generatePortraitTextureNode");
        const upload = requiredIndex(flow, "await uploadCanvasImage(dataUrl)");
        const validation = requiredIndex(flow, "const currentSource = currentCanvasDerivedImageSource");
        const append = requiredIndex(flow, "appendDerivedImageNode(currentSource");

        expect(upload).toBeLessThan(validation);
        expect(validation).toBeLessThan(append);
        expect(flow).toContain('"annotation"');
    });

    it.each([
        ["crop", "const cropImageNode", "const splitImageNode", "await cropDataUrl", '"crop"'],
        ["split", "const splitImageNode", "const maskEditImageNode", "await splitDataUrl", '"split"'],
        ["upscale", "const upscaleImageNode", "const generateAngleNode", "await upscaleDataUrl", '"upscale"'],
        ["refine", "const refineBackgroundImageNode", "const cropImageNode", "await uploadCanvasImage(result)", '"refine-background"'],
    ])("guards %s processing with a request ticket and validates after async media work", (_name, startMarker, endMarker, asyncMarker, operationMarker) => {
        const flow = functionSource(startMarker, endMarker);
        const ticket = requiredIndex(flow, "beginCanvasDerivedImageRequest");
        const asyncWork = requiredIndex(flow, asyncMarker);
        const validationAfterWork = requiredIndex(flow.slice(asyncWork), "currentCanvasDerivedImageSource") + asyncWork;
        const finish = requiredIndex(flow, "finishCanvasDerivedImageRequest");

        expect(ticket).toBeLessThan(asyncWork);
        expect(asyncWork).toBeLessThan(validationAfterWork);
        expect(validationAfterWork).toBeLessThan(finish);
        expect(flow).toContain(operationMarker);
        expect(flow).toMatch(/appendDerivedImageNode|canvasDerivedImageProvenance/);
    });

    it("guards mask edit before node creation, before task submission, and after completion", () => {
        const flow = functionSource("const maskEditImageNode", "const upscaleImageNode");
        const ticket = requiredIndex(flow, "beginCanvasDerivedImageRequest");
        const initialValidation = requiredIndex(flow, "const sourceNode = currentCanvasDerivedImageSource");
        const childCreation = requiredIndex(flow, "childId = nanoid()");
        const task = requiredIndex(flow, "await startAndCompleteImageTask");
        const completionValidation = requiredIndex(flow, "const completedSource = currentCanvasDerivedImageSource");

        expect(ticket).toBeLessThan(initialValidation);
        expect(initialValidation).toBeLessThan(childCreation);
        expect(childCreation).toBeLessThan(task);
        expect(task).toBeLessThan(completionValidation);
        expect(flow.slice(task, completionValidation)).toContain("validateMaskEditSource");
        expect(flow).toContain('canvasDerivedImageProvenance(sourceNode, "mask-edit")');
        expect(flow).toContain("discardDerivedImageChild(childId)");
        expect(flow).toContain("finishCanvasDerivedImageRequest");
    });

    it("records the unified operation/source provenance for every derived image capability", () => {
        for (const operation of ["annotation", "crop", "split", "mask-edit", "remove-background", "refine-background", "upscale", "portrait-texture", "angle", "emotion"]) {
            expect(source, `Missing provenance operation: ${operation}`).toContain(`\"${operation}\"`);
        }
        expect(source).toContain("canvasDerivedImageProvenance");
    });

    it("revalidates the angle source around creation and task completion", () => {
        const flow = functionSource("const generateAngleNode", "const generateEmotionNode");
        const initialValidation = requiredIndex(flow, "const source = currentCanvasDerivedImageSource");
        const childCreation = requiredIndex(flow, "childId = nanoid()");
        const launchValidation = requiredIndex(flow, "const currentSource = currentCanvasDerivedImageSource");
        const task = requiredIndex(flow, "await startAndCompleteImageTask");
        const completionValidation = requiredIndex(flow, "const completedSource = currentCanvasDerivedImageSource");

        expect(initialValidation).toBeLessThan(childCreation);
        expect(childCreation).toBeLessThan(launchValidation);
        expect(launchValidation).toBeLessThan(task);
        expect(task).toBeLessThan(completionValidation);
        expect(flow).toContain("discardAngleChild(childId)");
        expect(flow).toContain('message.error("源图片已删除或替换，已丢弃多视角结果")');
    });

    it("returns an explicit rejection so emotion preflight failures restore the editor", () => {
        const flow = functionSource("const generateEmotionNode", "const handleFontSizeChange");
        const childCreation = requiredIndex(flow, "const childId = nanoid()");

        expect(flow.slice(0, childCreation)).toContain("return false");
        expect(flow.slice(childCreation)).toContain("return true");
        expect(emotionWorkspaceSource).toContain("const accepted = await onConfirm");
        expect(emotionWorkspaceSource).toContain('if (!accepted) setStatus("editing")');
    });

    it("refreshes the unified task panel as soon as background removal creates a task", () => {
        const flow = functionSource("const removeBackgroundImageNode", "const resumeBackgroundRemovalTask");

        expect(flow).toContain("onTaskCreated: (createdTask)");
        expect(flow).toContain("backgroundRemovalTaskIdsRef.current.set(node.id, createdTask.id)");
        expect(flow).toContain("notifyCanvasGenerationTaskCreated(requestProjectId)");
    });

    it("guards task creation and result application with confirmed cancellation", () => {
        const flow = functionSource("const removeBackgroundImageNode", "const resumeBackgroundRemovalTask");
        const create = requiredIndex(flow, "await createBackgroundRemovalTask");
        const cancellationAfterCreate = requiredIndex(flow, "await confirmBackgroundRemovalCancellation");
        const wait = requiredIndex(flow, "await waitForBackgroundRemovalTask");
        const apply = requiredIndex(flow, "const outcome = applyBackgroundRemovalResult");

        expect(create).toBeLessThan(cancellationAfterCreate);
        expect(cancellationAfterCreate).toBeLessThan(wait);
        expect(wait).toBeLessThan(apply);
        expect(flow.slice(wait, apply)).toContain("backgroundRemovalCancellationRequestedRef.current.has(node.id)");
    });

    it("confirms cancellation before task binding when stop was clicked before the task id arrived", () => {
        const flow = functionSource("const removeBackgroundImageNode", "const resumeBackgroundRemovalTask");
        const taskId = requiredIndex(flow, "backgroundRemovalTaskIdsRef.current.set(node.id, task.id)");
        const cancellation = requiredIndex(flow, "if (backgroundRemovalCancellationRequestedRef.current.has(node.id))");
        const attach = requiredIndex(flow, "attachGenerationTask(node.id, controller");

        expect(taskId).toBeLessThan(cancellation);
        expect(cancellation).toBeLessThan(attach);
    });
});

function functionSource(startMarker: string, endMarker: string) {
    const start = requiredIndex(source, startMarker);
    const end = requiredIndex(source, endMarker);
    return source.slice(start, end);
}

function requiredIndex(value: string, marker: string) {
    const index = value.indexOf(marker);
    expect(index, `Missing source marker: ${marker}`).toBeGreaterThanOrEqual(0);
    return index;
}
