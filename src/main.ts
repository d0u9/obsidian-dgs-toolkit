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
		for (const property of [
			'--dgs-font-family',
			'--dgs-font-size',
			'--dgs-line-width',
			'--dgs-letter-spacing',
			'--dgs-word-spacing',
			'--dgs-line-height',
			'--dgs-paragraph-spacing',
			'--dgs-editing-font-family',
			'--dgs-editing-font-size',
			'--dgs-editing-line-width',
			'--dgs-editing-letter-spacing',
			'--dgs-editing-word-spacing',
			'--dgs-editing-line-height',
			'--dgs-editing-paragraph-spacing',
		]) {
			workspace.style.removeProperty(property);
		}
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

		const values: Record<string, string | null> = {
			'--dgs-font-family': this.settings.enableTypography && this.settings.fontFamily
				? this.settings.fontFamily
				: null,
			'--dgs-font-size': this.settings.enableTypography ? `${this.settings.fontSize}px` : null,
			'--dgs-line-width': this.settings.enableTypography ? `${this.settings.lineWidth}px` : null,
			'--dgs-letter-spacing': this.settings.enableTypography ? `${this.settings.letterSpacing}em` : null,
			'--dgs-word-spacing': this.settings.enableTypography ? `${this.settings.wordSpacing}em` : null,
			'--dgs-line-height': this.settings.enableTypography ? String(this.settings.lineHeight) : null,
			'--dgs-paragraph-spacing': this.settings.enableTypography ? `${this.settings.paragraphSpacing}em` : null,
			'--dgs-editing-font-family': this.settings.enableEditingTypography && this.settings.editingFontFamily
				? this.settings.editingFontFamily
				: null,
			'--dgs-editing-font-size': this.settings.enableEditingTypography ? `${this.settings.editingFontSize}px` : null,
			'--dgs-editing-line-width': this.settings.enableEditingTypography ? `${this.settings.editingLineWidth}px` : null,
			'--dgs-editing-letter-spacing': this.settings.enableEditingTypography ? `${this.settings.editingLetterSpacing}em` : null,
			'--dgs-editing-word-spacing': this.settings.enableEditingTypography ? `${this.settings.editingWordSpacing}em` : null,
			'--dgs-editing-line-height': this.settings.enableEditingTypography ? String(this.settings.editingLineHeight) : null,
			'--dgs-editing-paragraph-spacing': this.settings.enableEditingTypography ? `${this.settings.editingParagraphSpacing}em` : null,
		};
		for (const [property, value] of Object.entries(values)) {
			if (value === null) workspace.style.removeProperty(property);
			else workspace.style.setProperty(property, value);
		}
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
