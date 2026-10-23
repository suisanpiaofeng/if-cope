"use client";

import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { indentWithTab } from "@codemirror/commands";

/** 字号主题：用 Compartment 包起来，缩放时动态重配，不重建编辑器 */
const fontTheme = (px: number) =>
  EditorView.theme({
    "&": { fontSize: `${px}px` },
    ".cm-gutters": { fontSize: `${px}px` },
  });

/** CodeMirror 6 编辑器：按扩展名懒加载语法包；Ctrl/Cmd+S 保存；zoom 控制字号 */
export default function CodeEditor({
  value, ext, onChange, onSave, className, zoom = 1,
}: {
  value: string;
  ext: string;
  onChange: (v: string) => void;
  onSave: () => void;
  className?: string;
  zoom?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fontComp = useRef(new Compartment());
  // 回调用 ref 持有，避免重建编辑器
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const zoomRef = useRef(zoom);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  zoomRef.current = zoom;

  useEffect(() => {
    let disposed = false;
    let view: EditorView | null = null;

    void (async () => {
      const extensions: Extension[] = [
        basicSetup,
        EditorView.lineWrapping,
        fontComp.current.of(fontTheme(13 * zoomRef.current)),
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current(); return true; } },
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
        EditorView.theme({
          "&": { height: "100%", backgroundColor: "#ffffff" },
          ".cm-scroller": { fontFamily: "var(--font-mono)", height: "100%", overflow: "auto" },
          ".cm-content": { padding: "12px 0", caretColor: "#171717" },
          ".cm-gutters": { backgroundColor: "#ffffff", borderRight: "1px solid #f5f5f5" },
          ".cm-activeLine": { backgroundColor: "rgba(250, 250, 250, 0.6)" },
          ".cm-activeLineGutter": { backgroundColor: "transparent" },
          "&.cm-focused": { outline: "none" },
        }),
      ];

      // 按扩展名懒加载语法高亮
      const desc = LanguageDescription.matchLanguageName(languages, ext.toLowerCase());
      if (desc) {
        try { extensions.push(await desc.load()); } catch { /* 未安装对应语言包 → 纯文本 */ }
      }

      if (disposed || !host.current) return;
      view = new EditorView({
        state: EditorState.create({ doc: value, extensions }),
        parent: host.current,
      });
      viewRef.current = view;
    })();

    return () => { disposed = true; view?.destroy(); viewRef.current = null; };
    // 切文件时由父组件用 key={tab.key} 重挂载
  }, [ext]); // eslint-disable-line react-hooks/exhaustive-deps

  // 缩放：只重配字号 compartment
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: fontComp.current.reconfigure(fontTheme(13 * zoom)),
    });
  }, [zoom]);

  return <div ref={host} className={className} />;
}
