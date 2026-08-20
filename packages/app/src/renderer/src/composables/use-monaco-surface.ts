import { onBeforeUnmount, onMounted, watch } from "vue";
import type { EditorSettings } from "../../../settings.js";
import { editorFontOptions } from "../editor-options.js";
import { setupMonacoWorkers } from "../monaco.js";

/** Narrow enough that a code editor and a diff editor both satisfy it. */
interface FontConfigurable {
  updateOptions(options: { fontFamily: string; fontSize: number }): void;
}

/**
 * What every Monaco surface in the app does the same way: bring the workers up, follow the
 * reviewer's editor font, and take the editor down on the way out.
 *
 * What each surface *renders* stays with the surface — the diff decides for itself when a
 * rebuild is warranted, and that reasoning does not survive being made generic.
 */
export function useMonacoSurface(surface: {
  settings: () => EditorSettings;
  editor: () => FontConfigurable | null;
  dispose: () => void;
}): void {
  onMounted(setupMonacoWorkers);

  // The font is the one setting that can be applied to a live editor, so it never costs a
  // rebuild — the reviewer keeps their scroll position while trying sizes out.
  watch(
    () => [surface.settings().fontFamily, surface.settings().fontSize] as const,
    () => surface.editor()?.updateOptions(editorFontOptions(surface.settings())),
  );

  onBeforeUnmount(surface.dispose);
}
