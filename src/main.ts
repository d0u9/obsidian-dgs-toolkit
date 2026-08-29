import { MarkdownView, Notice, Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { colonBlockEditorExtension } from './editor/block-decorations';
import { ColonBlockSuggest } from './editor/block-suggest';
import {
	containsCrossSectionDelimiter,
	renderCustomContainers,
	restoreCustomContainers,
} from './render/custom-container';
import {
	DEFAULT_SETTINGS,
	DgsToolkitSettingTab,
	normalizePublishingTarget,
	type DgsToolkitSettings,
} from './settings';
import { applyVariables, typographyVariables } from './typography';

export default class DgsToolkitPlugin extends Plugin {
	settings!: DgsToolkitSettings;
	private crossSectionContainerObserver: MutationObserver | null = null;
	private readonly disabledReadingViews = new WeakSet<HTMLElement>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyTypographySettings();

		this.registerMarkdownPostProcessor((element) => {
			if (!this.shouldRenderCustomContainers(element)) return;
			renderCustomContainers(element, this.settings.defaultType);
		});

		registerCommands(this);
		this.registerEditorSuggest(new ColonBlockSuggest(this.app));
		this.registerEditorExtension(colonBlockEditorExtension(this));
		this.addSettingTab(new DgsToolkitSettingTab(this.app, this));
		this.observeCrossSectionContainers();
		this.renderMountedCrossSectionContainers();
	}

	onunload(): void {
		this.crossSectionContainerObserver?.disconnect();
		this.crossSectionContainerObserver = null;
		this.clearTypographySettings();
	}

	private clearTypographySettings(): void {
		const workspace = this.app.workspace.containerEl;
		workspace.removeClasses(['dgs-page-typography', 'dgs-editor-typography']);
		applyVariables(workspace, {
			...blankWhenOff(typographyVariables(this.settings, 'reading', '--dgs-'), false),
			...blankWhenOff(typographyVariables(this.settings, 'editing', '--dgs-editing-'), false),
		});
	}

	private hasCrossSectionContainer(preview: HTMLElement): boolean {
		// A compact block leaves no newline in textContent (the line break is a
		// <br>), so match the delimiter wherever it lands.
		return containsCrossSectionDelimiter(preview.textContent ?? '');
	}

	private observeCrossSectionContainers(): void {
		this.crossSectionContainerObserver = new MutationObserver((mutations) => {
			if (!this.settings.enableCustomContainers) return;
			const previews = new Set<HTMLElement>();
			for (const mutation of mutations) {
				const mutationElement = mutation.target.instanceOf(HTMLElement)
					? mutation.target
					: mutation.target.parentElement;
				const mutationPreview = mutationElement?.closest<HTMLElement>(
					'.markdown-preview-sizer',
				);
				if (
					mutationPreview &&
					this.hasCrossSectionContainer(mutationPreview)
				) {
					previews.add(mutationPreview);
				}
				if (mutation.type === 'characterData') {
					const preview = mutation.target.parentElement?.closest<HTMLElement>(
						'.markdown-preview-sizer',
					);
					if (preview && this.hasCrossSectionContainer(preview)) {
						previews.add(preview);
					}
				}
				for (const node of Array.from(mutation.addedNodes)) {
					if (!node.instanceOf(HTMLElement)) continue;
					const preview = node.closest<HTMLElement>('.markdown-preview-sizer');
					if (preview && this.hasCrossSectionContainer(preview)) {
						previews.add(preview);
					}
				}
			}

			for (const preview of previews) {
				if (!this.shouldRenderCustomContainers(preview)) continue;
				this.renderPreviewContainers(preview);
			}
		});
		this.crossSectionContainerObserver.observe(this.app.workspace.containerEl, {
			childList: true,
			characterData: true,
			subtree: true,
		});
	}

	private shouldRenderCustomContainers(element: HTMLElement): boolean {
		if (!this.settings.enableCustomContainers) return false;
		const readingView = element.closest<HTMLElement>('.markdown-preview-view');
		return readingView === null || !this.disabledReadingViews.has(readingView);
	}

	private renderPreviewContainers(preview: HTMLElement): void {
		for (const section of Array.from(
			preview.querySelectorAll<HTMLElement>('.markdown-preview-section'),
		)) {
			renderCustomContainers(section, this.settings.defaultType);
		}
		for (const block of Array.from(
			preview.querySelectorAll<HTMLElement>('.el-p'),
		)) {
			renderCustomContainers(block, this.settings.defaultType);
		}
		renderCustomContainers(preview, this.settings.defaultType);
	}

	toggleColonBlocksInActiveReadingView(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view === null || view.getMode() !== 'preview') {
			new Notice('Open a Markdown note in reading view first.');
			return;
		}
		if (!this.settings.enableCustomContainers) {
			new Notice('Enable colon blocks in the plugin settings first.');
			return;
		}

		const readingView = view.previewMode.containerEl;
		const preview = readingView.querySelector<HTMLElement>('.markdown-preview-sizer');
		if (this.disabledReadingViews.has(readingView)) {
			this.disabledReadingViews.delete(readingView);
			if (preview !== null) this.renderPreviewContainers(preview);
			new Notice('Colon blocks enabled in this reading view.');
			return;
		}

		this.disabledReadingViews.add(readingView);
		if (preview !== null) restoreCustomContainers(preview);
		new Notice('Colon blocks disabled in this reading view.');
	}

	private renderMountedCrossSectionContainers(): void {
		if (!this.settings.enableCustomContainers) return;
		for (const preview of Array.from(
			this.app.workspace.containerEl.querySelectorAll<HTMLElement>(
				'.markdown-preview-sizer',
			),
		)) {
			if (
				this.shouldRenderCustomContainers(preview) &&
				this.hasCrossSectionContainer(preview)
			) {
				this.renderPreviewContainers(preview);
			}
		}
	}

	refreshCustomContainers(): void {
		// Editor decorations read the settings as they build, so ask CodeMirror
		// to reconfigure alongside the rendered previews.
		this.app.workspace.updateOptions();
		for (const preview of Array.from(
			this.app.workspace.containerEl.querySelectorAll<HTMLElement>(
				'.markdown-preview-sizer',
			),
		)) {
			const readingView = preview.closest<HTMLElement>('.markdown-preview-view');
			if (
				this.settings.enableCustomContainers &&
				(readingView === null || !this.disabledReadingViews.has(readingView))
			) {
				this.renderPreviewContainers(preview);
			} else {
				restoreCustomContainers(preview);
			}
		}
	}

	applyTypographySettings(): void {
		const workspace = this.app.workspace.containerEl;
		workspace.toggleClass('dgs-page-typography', this.settings.enableTypography);
		workspace.toggleClass('dgs-editor-typography', this.settings.enableEditingTypography);

		applyVariables(workspace, {
			...blankWhenOff(
				typographyVariables(this.settings, 'reading', '--dgs-'),
				this.settings.enableTypography,
			),
			...blankWhenOff(
				typographyVariables(this.settings, 'editing', '--dgs-editing-'),
				this.settings.enableEditingTypography,
			),
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<DgsToolkitSettings>,
		);
		const target = normalizePublishingTarget(this.settings.publishingTargetFolder);
		if (target !== this.settings.publishingTargetFolder) {
			this.settings.publishingTargetFolder = target;
			await this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/** A view that is switched off contributes no variables of its own. */
function blankWhenOff(
	variables: Record<string, string | null>,
	enabled: boolean,
): Record<string, string | null> {
	if (enabled) return variables;
	return Object.fromEntries(Object.keys(variables).map((name) => [name, null]));
}
