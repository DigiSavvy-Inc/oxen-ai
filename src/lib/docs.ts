export const DOC_CATEGORIES = ["Setup", "Generate", "Library", "Shortcuts", "Settings"] as const;

export type DocCategory = (typeof DOC_CATEGORIES)[number];

export type DocBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

export type DocArticle = {
  id: string;
  title: string;
  category: DocCategory;
  blocks: DocBlock[];
};

export const DOC_ARTICLES: DocArticle[] = [
  {
    id: "sign-in",
    title: "Sign in",
    category: "Setup",
    blocks: [
      {
        type: "p",
        text: "Sign in with GitHub. Access is limited to members of the configured organization and to people on the allowlist. Each person uses their own Oxen API key.",
      },
      {
        type: "p",
        text: "On a local install with no GitHub OAuth app, Continue with this machine’s GitHub uses the account already logged in on that computer. Production sends you through GitHub’s sign-in page.",
      },
    ],
  },
  {
    id: "oxen-key",
    title: "Add your Oxen API key",
    category: "Setup",
    blocks: [
      {
        type: "p",
        text: "Open Settings from your avatar, then API key. Paste the key from your Oxen account. It is saved encrypted on the server and is not shown again.",
      },
      {
        type: "p",
        text: "Generate stays unavailable until a key is saved. Replacing the key is the same paste. Removing it stops new generations for this account.",
      },
    ],
  },
  {
    id: "first-generation",
    title: "Make an image or video",
    category: "Generate",
    blocks: [
      {
        type: "p",
        text: "No mode is selected until you choose one. Pick a mode, choose a model, and describe the shot. Generate queues the job. The canvas stays on this session. Open Library for earlier work.",
      },
      {
        type: "ul",
        items: [
          "Text → Image and Image → Image make stills.",
          "Text → Video, Image → Video, and Video → Video make clips.",
          "Text → Audio makes sound from the prompt.",
          "Chat answers a question and can look at an image or a PDF.",
        ],
      },
      {
        type: "p",
        text: "A mode the current model cannot run is ghosted. Choosing a ghosted mode clears the model so you can pick one that fits.",
      },
    ],
  },
  {
    id: "models",
    title: "Models, stars, and defaults",
    category: "Generate",
    blocks: [
      {
        type: "p",
        text: "The model menu searches the live Oxen catalog. Star a model to keep it on your Oxen account. Starred models are listed first.",
      },
      {
        type: "p",
        text: "Settings → Models can set a preferred model for each mode. Those defaults start empty and stay empty until you choose them. Changing the model resets the count to 1×.",
      },
    ],
  },
  {
    id: "references",
    title: "References and mentions",
    category: "Generate",
    blocks: [
      {
        type: "p",
        text: "Drop images, video, or audio anywhere on the composer card. You can also use Add media, or attach from Library and from a saved gallery.",
      },
      {
        type: "p",
        text: "Type @Image1, @Video1, or @Audio1 to point at an attachment. The number stays editable, and dragging a chip updates which file that number means. @Image4 or @4 filters the mention menu. Enter or a click confirms it.",
      },
      {
        type: "p",
        text: "Reference modes, including Seedance 2.5, can run with no file attached. On Seedance, Scene sends a normal image or video. Character sends faces and people on the face input.",
      },
    ],
  },
  {
    id: "cost",
    title: "Count, cost, and credits",
    category: "Generate",
    blocks: [
      {
        type: "p",
        text: "Count runs from 1× to 4× and always starts at 1×. It resets to 1× when the model changes, so a previous 4× run does not carry into the next session.",
      },
      {
        type: "p",
        text: "Generate shows the estimated cost, including resolution, count, and duration. Buy Credits shows the live dollar balance and opens Oxen billing.",
      },
    ],
  },
  {
    id: "draft",
    title: "Draft mode",
    category: "Generate",
    blocks: [
      {
        type: "p",
        text: "Seedance 2.5 can preview a shot at 480p, then re-render that same shot at 1080p.",
      },
      {
        type: "ul",
        items: [
          "Check 480p draft, then generate. The preview is 480p.",
          "When it finishes, press Render 1080p on the result. That re-makes the same shot and does not ask for the prompt again.",
          "The preview stays available for 7 days. After that, Render 1080p is disabled.",
        ],
      },
    ],
  },
  {
    id: "multi-shot",
    title: "Multi-shot video",
    category: "Generate",
    blocks: [
      {
        type: "p",
        text: "Models that offer Add shot can make a video from several shots. The prompt box is shot 1.",
      },
      {
        type: "ul",
        items: [
          "Press Add shot for each following shot.",
          "Give every shot its own prompt and duration.",
          "Generate sends the shots together as one video.",
        ],
      },
    ],
  },
  {
    id: "chat",
    title: "Chat, images, and PDFs",
    category: "Generate",
    blocks: [
      {
        type: "p",
        text: "Choose Chat, pick a chat model, and send a question. Drop an image or a PDF if the model should look at it. PDFs must be 24MB or smaller.",
      },
      {
        type: "p",
        text: "The thread stays on the canvas until you press New. It is not saved in the library. Send is the same action as Generate in the other modes.",
      },
    ],
  },
  {
    id: "prompts-galleries",
    title: "Saved prompts and galleries",
    category: "Generate",
    blocks: [
      {
        type: "p",
        text: "Save prompt stores the current text. Load prompt puts a saved one back in the box. The prompt box can be resized from the handle under it.",
      },
      {
        type: "p",
        text: "Gallery, on image edit and video modes, keeps a named set of references. Attach adds that set to the composer. Library → Galleries lists every gallery before a mode is chosen. Each card shows the first image large and three rows of thumbs. Drop images, video, or audio on a card, or click the dashed box, to add files from this computer. The same box is inside an open gallery. Edit and Delete are on each card. Inside a gallery, click an image to open a lightbox and page through the set, then click the image again for actual size. Play opens video in that lightbox and audio in a small player. Select items to delete them, or copy or move them into another gallery or a new one. On a history preview, Add, Add set, and New gallery sit on the right of Click to attach. Choosing a gallery keeps the list open and says how many items were added.",
      },
    ],
  },
  {
    id: "library",
    title: "Library and history",
    category: "Library",
    blocks: [
      {
        type: "p",
        text: "Library is a slide-out of past work, using small thumbnails. Filter by tag. Tags apply to a generation group, not each variation.",
      },
      {
        type: "p",
        text: "Settings → Library sets how many groups appear on a page: 12, 24, 48, or 96. The default is 24. A group of variations counts as one item. Older work is on later pages. Type a page number in the pager and press Enter to jump there. Download page saves the current page when there is more than one.",
      },
      {
        type: "p",
        text: "Click a library image to open the peek. Esc or X closes it. Click the image, or a variation thumb, to open it full size.",
      },
      {
        type: "p",
        text: "Profiles share this account and Oxen key. The top bar shows the profile name and Switch profile. Edit, beside each name in that list, changes the name in place. Library and galleries follow the active profile. Saved prompts stay on the account. Deleting a profile moves its media to another profile.",
      },
    ],
  },
  {
    id: "delete",
    title: "Delete from Studio and Oxen",
    category: "Library",
    blocks: [
      {
        type: "p",
        text: "The small × on a library thumb removes that item from Studio. Delete on the large preview, and the Oxen control, also delete the matching playground file when Studio can find it.",
      },
      {
        type: "p",
        text: "Settings → Cleanup can delete failed jobs, rebuild missing thumbnails, or wipe this account’s Studio media. Also delete from Oxen removes matching playground files. Cancelling a job in the Oxen queue does not remove a file that already succeeded.",
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    category: "Shortcuts",
    blocks: [
      {
        type: "ul",
        items: [
          "⌘↵ generates or sends. On Windows and Linux that chord is Ctrl+Enter.",
          "⌘⇧L opens and closes the library.",
          "⌘⇧, opens Settings. ⌘, is left for the browser.",
          "? opens this help, unless the cursor is in a text field.",
          "Esc closes help, Settings, the library, a peek, or a full-size image.",
          "In the full-size view, the left and right arrow keys move between variations.",
          "While the @ mention menu is open, the arrow keys move through matches and Enter inserts one.",
        ],
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    category: "Settings",
    blocks: [
      {
        type: "p",
        text: "Settings lives under your avatar. The panes are API key, Models, Library, Notifications, and Cleanup.",
      },
      {
        type: "ul",
        items: [
          "Notifications can alert you in the open app when a job finishes, and can offer to install the studio on this device.",
          "Branding, for admins, sets the site name and logo. A blank name uses Oxen Studio and the bundled mark.",
          "Allowlist, for admins, adds GitHub accounts. A row binds to that account’s id the first time they sign in.",
        ],
      },
    ],
  },
];

function articleText(article: DocArticle): string {
  const parts = [article.title, article.category];
  for (const block of article.blocks) {
    if (block.type === "p") parts.push(block.text);
    else parts.push(...block.items);
  }
  return parts.join("\n").toLowerCase();
}

export function filterDocs(
  articles: readonly DocArticle[],
  query: string,
  category: DocCategory | "All",
): DocArticle[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return articles.filter((article) => {
    if (category !== "All" && article.category !== category) return false;
    if (words.length === 0) return true;
    const haystack = articleText(article);
    return words.every((word) => haystack.includes(word));
  });
}
