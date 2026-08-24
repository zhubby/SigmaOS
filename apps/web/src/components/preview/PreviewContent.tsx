import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AlertTriangle, File, FileText, Folder, Image as ImageIcon, Music, PanelRight, Play, Video } from "lucide-react";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { FileMeta, FilePreviewKind, TextPreview } from "../../api.js";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { isPreviewOverFileSizeLimit } from "../../lib/preview-settings.js";
import {
  describeTextPreview,
  highlightSource,
  parseDelimitedTablePreview,
  type DelimitedTablePreview,
  type TextPreviewDescriptor
} from "../../preview-utils.js";

export function PreviewContent({
  blobUrl,
  loading,
  meta,
  error,
  textPreview,
  previewFileSizeLimitBytes,
  locale
}: {
  blobUrl: string;
  loading: boolean;
  meta: FileMeta | null;
  error: string | null;
  textPreview: TextPreview | null;
  previewFileSizeLimitBytes: number;
  locale: SupportedLocale;
}) {
  const { t } = useTranslation();

  if (loading) {
    return <div className="preview-empty">{t("preview.loading")}</div>;
  }
  if (error) {
    return (
      <div className="preview-empty preview-error">
        <AlertTriangle aria-hidden="true" size={20} />
        <span>{error}</span>
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="preview-empty">
        <PanelRight aria-hidden="true" size={24} />
        <span>{t("preview.chooseFile")}</span>
      </div>
    );
  }
  if (isPreviewOverFileSizeLimit(meta, previewFileSizeLimitBytes)) {
    return (
      <div className="preview-empty">
        <AlertTriangle aria-hidden="true" size={24} />
        <strong>{meta.mimeType}</strong>
        <span>
          {t("preview.tooLarge", {
            size: formatBytes(meta.sizeBytes, locale),
            limit: formatBytes(previewFileSizeLimitBytes, locale)
          })}
        </span>
      </div>
    );
  }
  if (meta.previewKind === "text") {
    return <TextPreviewPanel meta={meta} textPreview={textPreview} locale={locale} />;
  }
  if (meta.previewKind === "image") {
    return (
      <div className="media-preview">
        <img src={blobUrl} alt={meta.name} />
      </div>
    );
  }
  if (meta.previewKind === "audio") {
    return (
      <div className="media-preview media-preview-centered">
        <Music aria-hidden="true" size={42} />
        <audio src={blobUrl} controls />
      </div>
    );
  }
  if (meta.previewKind === "video") {
    return (
      <div className="media-preview">
        <video src={blobUrl} controls />
      </div>
    );
  }
  if (meta.previewKind === "pdf") {
    return <iframe className="pdf-preview" title={meta.name} src={blobUrl} />;
  }
  return (
    <div className="preview-empty">
      <File aria-hidden="true" size={24} />
      <strong>{meta.mimeType}</strong>
      <span>{t("preview.cannotPreview", { size: formatBytes(meta.sizeBytes, locale) })}</span>
    </div>
  );
}

export function previewIcon(kind: FilePreviewKind) {
  if (kind === "text") {
    return <FileText aria-hidden="true" size={15} />;
  }
  if (kind === "image") {
    return <ImageIcon aria-hidden="true" size={15} />;
  }
  if (kind === "audio") {
    return <Music aria-hidden="true" size={15} />;
  }
  if (kind === "video") {
    return <Video aria-hidden="true" size={15} />;
  }
  if (kind === "pdf") {
    return <FileText aria-hidden="true" size={15} />;
  }
  if (kind === "directory") {
    return <Folder aria-hidden="true" size={15} />;
  }
  return <Play aria-hidden="true" size={15} />;
}

type TextPreviewMode = "rendered" | "table" | "source";
type Translate = TFunction<"translation">;

function TextPreviewPanel({
  meta,
  textPreview,
  locale
}: {
  meta: FileMeta;
  textPreview: TextPreview | null;
  locale: SupportedLocale;
}) {
  const { t } = useTranslation();
  const content = textPreview?.content ?? "";
  const descriptor = useMemo(() => describeTextPreview(meta.name, meta.mimeType), [meta.name, meta.mimeType]);
  const defaultMode = getDefaultTextPreviewMode(descriptor);
  const [mode, setMode] = useState<TextPreviewMode>(defaultMode);
  const tablePreview = useMemo(
    () =>
      descriptor.structuredKind === "table" && descriptor.delimiter
        ? parseDelimitedTablePreview(content, descriptor.delimiter, undefined, undefined, (index) =>
            t("preview.column", { index: formatLocaleNumber(index, locale) })
          )
        : null,
    [content, descriptor.delimiter, descriptor.structuredKind, locale, t]
  );
  const highlighted = useMemo(() => highlightSource(content, descriptor.language), [content, descriptor.language]);
  const availableModes = getTextPreviewModes(descriptor, tablePreview);
  const fallbackMode = availableModes[0] ?? "source";
  const resetMode = availableModes.includes(defaultMode) ? defaultMode : fallbackMode;
  const activeMode = availableModes.includes(mode) ? mode : fallbackMode;

  useEffect(() => {
    setMode(resetMode);
  }, [meta.path, resetMode]);

  return (
    <div className="text-preview-shell">
      <div className="text-preview-toolbar">
        <div className="preview-source-meta">
          <span>{descriptor.languageLabel}</span>
          {textPreview?.truncated ? <em>{t("preview.truncated")}</em> : null}
        </div>
        {availableModes.length > 1 ? (
          <div className="preview-mode-switch" aria-label={t("preview.modeAria")}>
            {availableModes.map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                className={nextMode === activeMode ? "is-active" : ""}
                aria-pressed={nextMode === activeMode}
                onClick={() => setMode(nextMode)}
              >
                {textPreviewModeLabel(nextMode, t)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {activeMode === "rendered" ? (
        <MarkdownPreview source={content} />
      ) : activeMode === "table" && tablePreview ? (
        <DelimitedTable preview={tablePreview} locale={locale} />
      ) : (
        <SourcePreview html={highlighted.html} language={highlighted.language} />
      )}
    </div>
  );
}

function MarkdownPreview({ source }: { source: string }) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          code: ({ className, children, node: _node }) => {
            const language = markdownCodeLanguage(className);
            if (!language) {
              return <code className={className}>{children}</code>;
            }

            const highlighted = highlightSource(String(children).replace(/\n$/, ""), language);
            return <code className={`hljs language-${highlighted.language}`} dangerouslySetInnerHTML={{ __html: highlighted.html }} />;
          },
          pre: ({ children, node: _node }) => <pre className="markdown-code-block">{children}</pre>
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

function DelimitedTable({ preview, locale }: { preview: DelimitedTablePreview; locale: SupportedLocale }) {
  const { t } = useTranslation();

  return (
    <div className="table-preview">
      <table>
        <thead>
          <tr>
            {preview.headers.map((header, index) => (
              <th key={`${header}-${index}`} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.truncatedRows || preview.truncatedColumns ? (
        <div className="table-preview-note">
          {t("preview.tableTruncated", {
            rows: formatLocaleNumber(preview.rows.length, locale),
            totalRows: formatLocaleNumber(preview.totalRows, locale),
            columns: formatLocaleNumber(preview.headers.length, locale),
            totalColumns: formatLocaleNumber(preview.totalColumns, locale)
          })}
        </div>
      ) : null}
    </div>
  );
}

function SourcePreview({ html, language }: { html: string; language: string }) {
  return (
    <pre className={`text-preview language-${language}`}>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

function getDefaultTextPreviewMode(descriptor: TextPreviewDescriptor): TextPreviewMode {
  if (descriptor.structuredKind === "markdown") {
    return "rendered";
  }
  if (descriptor.structuredKind === "table") {
    return "table";
  }
  return "source";
}

function getTextPreviewModes(descriptor: TextPreviewDescriptor, tablePreview: DelimitedTablePreview | null): TextPreviewMode[] {
  if (descriptor.structuredKind === "markdown") {
    return ["rendered", "source"];
  }
  if (descriptor.structuredKind === "table" && tablePreview) {
    return ["table", "source"];
  }
  return ["source"];
}

function textPreviewModeLabel(mode: TextPreviewMode, t: Translate): string {
  if (mode === "rendered") {
    return t("preview.modes.rendered");
  }
  if (mode === "table") {
    return t("preview.modes.table");
  }
  return t("preview.modes.source");
}

function markdownCodeLanguage(className: string | undefined): string | null {
  const match = /language-([\w-]+)/.exec(className ?? "");
  return match?.[1] ?? null;
}
