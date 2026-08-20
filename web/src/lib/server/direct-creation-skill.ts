import type { AgentSkill } from "@/lib/auth/store-types";
import type { AiTextMessage } from "@/types/ai";

export type DirectCreationSkillMode = "text" | "image" | "video";

const MAX_SKILLS_PER_REQUEST = 8;
const MAX_INSTRUCTIONS_LENGTH = 12_000;

/** Resolve only enabled skills that are valid for the direct-creation surface. */
export function resolveDirectCreationSkills(skillIds: unknown, skills: readonly AgentSkill[] | undefined, mode: DirectCreationSkillMode) {
    if (!Array.isArray(skillIds) || !skills?.length) return [];
    const requestedIds = new Set(
        skillIds
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean)
            .slice(0, MAX_SKILLS_PER_REQUEST),
    );
    if (!requestedIds.size) return [];
    return skills.filter((skill) => skill.enabled && requestedIds.has(skill.id) && isSkillAvailableInMode(skill, mode));
}

export function directCreationSkillInstructions(skillIds: unknown, skills: readonly AgentSkill[] | undefined, mode: DirectCreationSkillMode) {
    return resolveDirectCreationSkills(skillIds, skills, mode)
        .map((skill) => renderDirectCreationSkillPrompt(skill))
        .join("\n\n---\n\n");
}

export function requiredDirectCreationReferenceSkill(skillIds: unknown, skills: readonly AgentSkill[] | undefined, mode: DirectCreationSkillMode) {
    return resolveDirectCreationSkills(skillIds, skills, mode).find((skill) => skill.requiresReference);
}

export function expandDirectCreationPrompt(prompt: string, skillIds: unknown, skills: readonly AgentSkill[] | undefined, mode: DirectCreationSkillMode) {
    const instructions = directCreationSkillInstructions(skillIds, skills, mode);
    return instructions ? `${instructions}\n\nUser request:\n${prompt}` : prompt;
}

export function prependDirectCreationSkillInstructions(messages: AiTextMessage[], skillIds: unknown, skills: readonly AgentSkill[] | undefined) {
    const instructions = directCreationSkillInstructions(skillIds, skills, "text");
    if (!instructions) return messages;
    const systemIndex = messages.findIndex((message) => message.role === "system");
    const skillMessage: AiTextMessage = { role: "system", content: `[Selected creation skills]\n${instructions}` };
    if (systemIndex < 0) return [skillMessage, ...messages];
    return messages.map((message, index) => (index === systemIndex ? { ...message, content: `${skillMessage.content}\n\n${textContent(message.content)}` } : message));
}

function isSkillAvailableInMode(skill: AgentSkill, mode: DirectCreationSkillMode) {
    const workspaces = skill.workspaces || ["image"];
    if (mode === "text") return workspaces.some((workspace) => workspace === "image" || workspace === "video" || workspace === "canvas" || workspace === "drama");
    return workspaces.includes(mode);
}

function renderDirectCreationSkillPrompt(skill: Pick<AgentSkill, "name" | "description" | "instructions">) {
    const instructions = skill.instructions.trim().slice(0, MAX_INSTRUCTIONS_LENGTH);
    return [`[Skill: ${skill.name}]`, skill.description ? `Purpose: ${skill.description}` : "", instructions ? `Instructions:\n${instructions}` : "", "Follow this skill's instructions closely."].filter(Boolean).join("\n\n");
}

function textContent(content: AiTextMessage["content"]) {
    if (typeof content === "string") return content;
    return content.map((item) => (item.type === "text" ? item.text : "[image reference]")).join("\n");
}
