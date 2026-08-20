export const creationModes = ["agent", "text", "image", "video"] as const;

export type CreationMode = (typeof creationModes)[number];
export type DirectCreationMode = Exclude<CreationMode, "agent">;

export const creationModeLabels: Record<CreationMode, string> = {
    agent: "Agent",
    text: "文本",
    image: "图片",
    video: "视频",
};

export const creationModePlaceholders: Record<CreationMode, string> = {
    agent: "描述你的想法，或添加参考素材",
    text: "描述要创作、改写或继续完善的文本",
    image: "描述画面、人物、场景、构图与风格",
    video: "描述镜头内容、运动、光线与节奏",
};
