import Editor from "@monaco-editor/react";
import { useStore } from "../store";
import { useSettingsStore } from "../stores/settings";

export function CodeEditor() {
    const { activeFileContent, activeFile } = useStore();
    const { theme, fontFamily, fontSize } = useSettingsStore();

    return (
        <div className="h-full w-full">
            <Editor
                height="100%"
                defaultLanguage="typescript"
                path={activeFile || undefined}
                value={activeFileContent}
                theme={theme === 'light' ? 'light' : 'vs-dark'}
                options={{
                    minimap: { enabled: false },
                    fontSize: fontSize,
                    fontFamily: fontFamily,
                    readOnly: true,
                    automaticLayout: true,
                    padding: { top: 20 },
                    scrollbar: {
                        vertical: 'hidden',
                        horizontal: 'hidden'
                    }
                }}
            />
        </div>
    );
}
