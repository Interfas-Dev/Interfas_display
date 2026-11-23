/**
 * Éditeur de texte riche (TipTap) de la page « message ».
 * Compilé par esbuild vers public/build/editor.js (npm run build:client).
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontSize, BackgroundColor } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';

const surface = document.getElementById('editor');
const hidden = document.getElementById('content') as HTMLInputElement | null;
const preview = document.getElementById('preview');
const toolbar = document.querySelector<HTMLElement>('.toolbar');

if (surface && hidden && toolbar) {
  const editor = new Editor({
    element: surface,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        link: false,
      }),
      TextStyle,
      Color,
      FontSize,
      BackgroundColor,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: hidden.value || '<p></p>',
    editorProps: { attributes: { class: 'message-body', 'aria-label': 'Contenu du message' } },
  });

  const sync = () => {
    const html = editor.isEmpty ? '' : editor.getHTML();
    hidden.value = html;
    if (preview) preview.innerHTML = html;
    refreshToolbar();
  };

  const chain = () => editor.chain().focus();
  const actions: Record<string, (value?: string) => void> = {
    bold: () => chain().toggleBold().run(),
    italic: () => chain().toggleItalic().run(),
    underline: () => chain().toggleUnderline().run(),
    strike: () => chain().toggleStrike().run(),
    bulletList: () => chain().toggleBulletList().run(),
    orderedList: () => chain().toggleOrderedList().run(),
    alignLeft: () => chain().setTextAlign('left').run(),
    alignCenter: () => chain().setTextAlign('center').run(),
    alignRight: () => chain().setTextAlign('right').run(),
    undo: () => chain().undo().run(),
    redo: () => chain().redo().run(),
    color: (v) => chain().setColor(v!).run(),
    highlight: (v) => chain().setBackgroundColor(v!).run(),
    clearColor: () => chain().unsetColor().unsetBackgroundColor().run(),
    fontSize: (v) => (v ? chain().setFontSize(v).run() : chain().unsetFontSize().run()),
    block: (v) => {
      if (v === 'p') chain().setParagraph().run();
      else chain().setHeading({ level: Number(v!.slice(1)) as 1 | 2 | 3 }).run();
    },
  };

  const isActive: Record<string, () => boolean> = {
    bold: () => editor.isActive('bold'),
    italic: () => editor.isActive('italic'),
    underline: () => editor.isActive('underline'),
    strike: () => editor.isActive('strike'),
    bulletList: () => editor.isActive('bulletList'),
    orderedList: () => editor.isActive('orderedList'),
    alignLeft: () => editor.isActive({ textAlign: 'left' }),
    alignCenter: () => editor.isActive({ textAlign: 'center' }),
    alignRight: () => editor.isActive({ textAlign: 'right' }),
  };

  function refreshToolbar() {
    toolbar!.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) => {
      const check = isActive[b.dataset.cmd!];
      if (check) b.setAttribute('aria-pressed', String(check()));
    });
    const block = toolbar!.querySelector<HTMLSelectElement>('select[data-cmd="block"]')!;
    block.value = [1, 2, 3].map((l) => (editor.isActive('heading', { level: l }) ? `h${l}` : '')).find(Boolean) || 'p';
    const size = toolbar!.querySelector<HTMLSelectElement>('select[data-cmd="fontSize"]')!;
    size.value = (editor.getAttributes('textStyle').fontSize as string | undefined) ?? '';
  }

  // Garde le focus (et la sélection) dans l'éditeur quand on clique un bouton.
  toolbar.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault();
  });
  toolbar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]');
    if (btn) actions[btn.dataset.cmd!]?.();
  });
  toolbar.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement | HTMLInputElement;
    if (el.dataset.cmd) actions[el.dataset.cmd]?.(el.value);
  });
  // Les couleurs s'appliquent aussi en direct pendant le choix.
  toolbar.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type === 'color' && el.dataset.cmd) actions[el.dataset.cmd]?.(el.value);
  });

  editor.on('update', sync);
  editor.on('selectionUpdate', refreshToolbar);
  toolbar.hidden = false;
  sync();
}
