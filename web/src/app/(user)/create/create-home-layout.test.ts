import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("create home layout", () => {
    it("keeps the unified composer, recent work and reusable public inspiration in one flow", async () => {
        const [page, composer, directCreation, overview, inspiration, previewModal] = await Promise.all([
            readFile(resolve(process.cwd(), "src/app/(user)/create/page.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/create/components/creative-composer.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/create/use-direct-creation.ts"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/create/components/create-workbench-overview.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/create/components/create-inspiration-gallery.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/components/works/public-work-preview-modal.tsx"), "utf8"),
        ]);

        expect(page).toContain("creationModeLabels[mode]");
        expect(page).toContain('useState<CreationMode>("agent")');
        expect(page).toContain("useDirectCreation(config, currentUser?.id)");
        expect(page).toContain('mode === "agent" ? agent.sending : direct.busy');
        expect(page).toContain("DirectCreationMessages");
        expect(page).toContain("createAgentPromptFromHash");
        expect(page).not.toContain("最近创作");
        expect(page).toContain("<CreateInspirationGallery");
        expect(page.indexOf("<CreateWorkbenchOverview")).toBeLessThan(page.indexOf("<CreateInspirationGallery"));
        expect(page).toContain("usePublicImage");
        expect(composer).toContain('centered ? "max-w-[960px]"');
        expect(composer).toContain('{ id: "agent", label: "Agent"');
        expect(composer).toContain("function QBrandIcon()");
        expect(composer).toContain('className="size-6 shrink-0 object-contain dark:invert"');
        expect(composer).toContain('{ id: "text", label: "文本创作"');
        expect(composer).toContain('{ id: "image", label: "图片生成"');
        expect(composer).toContain('{ id: "video", label: "视频生成"');
        expect(composer).not.toContain('id: "music"');
        expect(composer).toContain("onAttachment");
        expect(composer).toContain("参考内容");
        expect(composer).toContain("SkillPicker");
        expect(composer).toContain("RecentAssetMentionPicker");
        expect(composer).toContain("mentionDraftAt");
        expect(composer).toContain('icon={<AtSign className="size-4" />}');
        expect(composer).toContain("function ComposerReferenceMedia");
        expect(composer).toContain("aria-label={`放大查看 ${title}`}");
        expect(composer).toContain("setPreviewOpen(true)");
        expect(composer).toContain('placement="bottomRight"');
        expect(composer).toContain("autoAdjustOverflow={false}");
        expect(page).toContain("onMentionRecentAsset={importRecentAsset}");
        expect(page).toContain("recentOverviewAssetToCreativeAsset");
        expect(page).toContain("agent.referenceExistingAsset");
        expect(page).not.toContain("importReferenceMedia({ url: asset.url");
        expect(page).toContain('setVideoMethod("reference")');
        expect((composer.match(/placement=\"bottomLeft\"/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(composer.indexOf("<ComposerReferences")).toBeLessThan(composer.indexOf("<Input.TextArea"));
        expect(composer).toContain('<span className="truncate">Skill</span>');
        expect(composer).toContain("CreativeImageSettingsPanel");
        expect(composer).toContain("CreativeVideoSettingsPanel");
        expect(composer).toContain("creativeVideoResolutionOptions");
        expect(composer).toContain("VideoDurationPicker");
        expect(composer).toContain("step={1}");
        expect(composer).toContain('if (aspect === "auto") return "auto";');
        expect(composer).toContain('title="选择比例"');
        expect(composer.indexOf("<VoiceInputButton")).toBeLessThan(composer.lastIndexOf('aria-label={busy ? "停止生成" : "发送"}'));
        expect(directCreation).toContain("createTextGenerationTask");
        expect(directCreation).toContain("createImageGenerationTask");
        expect(directCreation).toContain("createServerVideoGenerationTask");
        expect(directCreation).toContain("createTrackedTasks");
        expect(composer).not.toContain("CreativeImageSizeControl");
        expect(composer).not.toContain("Paperclip");
        expect(composer).not.toContain("Lightbulb");
        expect(composer).not.toContain("CreativeAgentTextModelPicker");
        expect(composer).not.toContain("Orbit");
        expect(page).not.toContain("selectedModelIds");
        expect(inspiration).toContain("灵感发现");
        expect(inspiration).toContain("使用提示词");
        expect(inspiration).toContain("复制提示词");
        expect(inspiration).toContain("使用图片");
        expect(inspiration).toContain("listPublicGallery");
        expect(inspiration).toContain("columns-2");
        expect(inspiration).toContain("xl:columns-6");
        expect(inspiration).not.toContain("max-h-[560px]");
        expect(inspiration).toContain("<Dropdown");
        expect(inspiration).toContain("<PublicWorkPreviewModal");
        expect(inspiration).toContain("<LazyMediaImage");
        expect(inspiration).toContain("<PublicWorkCardTitle");
        expect(inspiration).not.toContain("href={`/share/");
        expect(overview).toContain('aria-label="引用到 Agent"');
        expect(overview.indexOf('aria-labelledby="create-assets-heading"')).toBeLessThan(overview.indexOf('aria-labelledby="create-projects-heading"'));
        expect(overview).toContain("recentAssets.slice(0, recentAssetVisibilityClasses.length)");
        expect(overview).toContain("grid-cols-2");
        expect(overview).toContain("2xl:grid-cols-6");
        expect(overview).toContain('"hidden sm:block"');
        expect(overview).not.toContain("grid-flow-col");
        expect(overview).not.toContain("overflow-x-auto");
        expect(overview).not.toContain("lg:grid-cols-5");
        expect(overview).toContain('"group grid h-32');
        expect(overview).toContain("sm:h-44");
        expect(overview).toContain('title="引用到 Agent"');
        expect(overview).not.toMatch(/>\s*引用\s*</);
        expect(overview).not.toContain("absolute bottom-2 right-2");
        expect(previewModal).toContain('aria-label="引用提示词到 Agent"');
        expect(previewModal).toContain('aria-label="引用图片到 Agent"');
        expect(previewModal).not.toMatch(/>\s*引用到 Agent\s*</);
        expect(previewModal).toContain("复制提示词");
        expect(previewModal).toContain('aria-label="关闭作品详情"');
        expect(previewModal).toContain("lg:grid-cols-[minmax(0,1fr)_340px]");
        expect(previewModal).toContain("xl:grid-cols-[minmax(0,1fr)_360px]");
        expect(previewModal).toContain('asset.mediaType === "image" || asset.mediaType === "video"');
    });

    it("keeps skill selection available for every mode", async () => {
        const [page, composer] = await Promise.all([readFile(resolve(process.cwd(), "src/app/(user)/create/page.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/app/(user)/create/components/creative-composer.tsx"), "utf8")]);

        expect(page).toContain("selectedSkillIds");
        expect(page).toContain("skillIds: selectedSkillId ? [selectedSkillId] : []");
        expect(composer).toContain("const visibleSkills = skills.filter");
        expect(composer).toContain('mode === "agent"');
        expect(composer).toContain('mode === "text"');
        expect(composer).toContain('mode === "image"');
        expect(composer).toContain('mode === "video"');
    });
});
