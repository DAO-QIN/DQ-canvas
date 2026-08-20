import { describe, expect, it } from "vitest";

import type { AgentSkill } from "@/lib/auth/store-types";

import { expandDirectCreationPrompt, prependDirectCreationSkillInstructions, resolveDirectCreationSkills } from "./direct-creation-skill";

const imageSkill: AgentSkill = {
    id: "image-style",
    name: "Image style",
    description: "Keep the product framing consistent.",
    instructions: "Use a clean studio background.",
    enabled: true,
    keywords: [],
    workspaces: ["image"],
};
const disabledSkill: AgentSkill = { ...imageSkill, id: "disabled", enabled: false };
const videoSkill: AgentSkill = { ...imageSkill, id: "video-motion", workspaces: ["video"] };

describe("direct creation skills", () => {
    it("filters disabled and incompatible skills", () => {
        expect(resolveDirectCreationSkills(["image-style", "disabled", "video-motion"], [imageSkill, disabledSkill, videoSkill], "image")).toEqual([imageSkill]);
    });

    it("expands selected instructions on the server", () => {
        const prompt = expandDirectCreationPrompt("A glass bottle", ["image-style"], [imageSkill], "image");
        expect(prompt).toContain("Use a clean studio background.");
        expect(prompt).toContain("User request:\nA glass bottle");
    });

    it("prepends text skill instructions without exposing them to the client", () => {
        const messages = prependDirectCreationSkillInstructions([{ role: "user", content: "Write a caption" }], ["image-style"], [imageSkill]);
        expect(messages[0]).toMatchObject({ role: "system" });
        expect(messages[0].content).toContain("Use a clean studio background.");
    });
});
