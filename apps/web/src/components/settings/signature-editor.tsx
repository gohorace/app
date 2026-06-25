'use client'

/**
 * SignatureEditor — paste-first rich-text editor for the agent's email
 * signature (HOR-xxx).
 *
 * The primary input is paste: the agent copies their existing Gmail/Outlook
 * signature, the editor takes the HTML, and inline `<img>` tags are stripped
 * on the way in (Gmail/Outlook embed images as `cid:` or provider-hosted
 * URLs that break on send). When images are stripped we fire a callback so
 * the parent can surface the Horace-voice prompt to paste a logo by URL
 * instead.
 *
 * Allowed manual edits: bold, italic, links, line breaks. Server-side
 * sanitisation (apps/web/src/app/api/settings/profile/route.ts) is the
 * source of truth — the editor's local restraint is convenience, not
 * security.
 */

import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Bold, Italic, Link2 } from 'lucide-react'

interface SignatureEditorProps {
  value: string
  onChange: (html: string) => void
  /** Fired when a paste contained inline `<img>` tags that we dropped. */
  onImagesStrippedFromPaste?: () => void
  placeholder?: string
}

/** Strip `<img>` tags from pasted HTML. Returns the cleaned HTML and a flag
 *  indicating whether anything was dropped (so the parent can prompt). */
function stripImages(html: string): { html: string; stripped: boolean } {
  const before = html
  const after = html.replace(/<img\b[^>]*>/gi, '')
  return { html: after, stripped: after !== before }
}

export function SignatureEditor({
  value,
  onChange,
  onImagesStrippedFromPaste,
  placeholder,
}: SignatureEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        strike: false,
        code: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
    ],
    content: value || '<p></p>',
    autofocus: false,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'signature-editor-surface', 'data-placeholder': placeholder ?? '' },
      transformPastedHTML(html) {
        const { html: cleaned, stripped } = stripImages(html)
        if (stripped) onImagesStrippedFromPaste?.()
        return cleaned
      },
    },
    onUpdate({ editor }) {
      const html = editor.isEmpty ? '' : editor.getHTML()
      onChange(html)
    },
  })

  // Rehydrate when the parent swaps the value out from under us (e.g. after
  // a Save → router.refresh re-feeds props).
  useEffect(() => {
    if (!editor) return
    const current = editor.isEmpty ? '' : editor.getHTML()
    if (current === value) return
    editor.commands.setContent(value || '<p></p>', false)
  }, [editor, value])

  return (
    <div className="signature-editor">
      <div className="signature-editor-toolbar" role="toolbar" aria-label="Signature formatting">
        <ToolbarButton
          label="Bold"
          active={editor?.isActive('bold') ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor?.isActive('italic') ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label={editor?.isActive('link') ? 'Edit link' : 'Add link'}
          active={editor?.isActive('link') ?? false}
          onClick={() => {
            if (!editor) return
            const existing = editor.getAttributes('link').href as string | undefined
            const url = window.prompt('Link URL', existing ?? 'https://')
            if (url === null) return
            if (url === '') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run()
              return
            }
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
          }}
        >
          <Link2 className="size-3.5" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
      <style jsx global>{`
        .signature-editor {
          border: 1px solid var(--border-default, hsl(var(--input)));
          border-radius: 6px;
          background: var(--bg-surface, #fff);
          overflow: hidden;
        }
        .signature-editor-toolbar {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 6px;
          border-bottom: 1px solid var(--border-subtle, rgba(140, 123, 107, 0.16));
          background: var(--bg-surface-muted, rgba(140, 123, 107, 0.04));
        }
        .signature-editor-surface {
          min-height: 132px;
          padding: 12px 14px;
          outline: none;
          font-family: var(--font-body);
          font-size: 13.5px;
          line-height: 1.55;
          color: var(--color-ink, #1a1612);
        }
        .signature-editor-surface p {
          margin: 0 0 6px;
        }
        .signature-editor-surface p:last-child {
          margin-bottom: 0;
        }
        .signature-editor-surface a {
          color: var(--color-terracotta, #c4622d);
          text-decoration: underline;
        }
        .signature-editor-surface.ProseMirror-focused {
          outline: none;
        }
        .signature-editor-surface p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--fg-tertiary, rgba(140, 123, 107, 0.7));
          pointer-events: none;
          height: 0;
        }
      `}</style>
    </div>
  )
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        borderRadius: 4,
        border: 'none',
        background: active ? 'rgba(196,98,45,0.12)' : 'transparent',
        color: active ? 'var(--color-terracotta, #c4622d)' : 'var(--color-stone, #8c7b6b)',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {children}
    </button>
  )
}
