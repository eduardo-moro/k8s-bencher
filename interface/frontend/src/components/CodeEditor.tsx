import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

const sizeTheme = EditorView.theme({
  "&": { minHeight: "18rem", fontSize: "0.75rem" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" },
});

export function CodeEditor({
  value,
  onChange,
  language,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  language: "yaml" | "javascript";
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="overflow-hidden rounded-md border border-input"
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        theme={oneDark}
        extensions={[language === "yaml" ? yaml() : javascript(), sizeTheme]}
        basicSetup={{ foldGutter: false }}
      />
    </div>
  );
}
