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
      {
        type: "p",
        text: "The icons beside a model’s name show what it can run, in the order of the mode pills. Hover one for its name.",
      },
      {
        type: "ul",
        items: [
          "A picture is Text → Image. A picture with a pencil is Image → Image.",
          "A frame with a play mark is Text → Video. A picture with a play mark is Image → Video. A play frame with a pencil is Video → Video.",
          "Sound bars are Text → Audio. A speech bubble is Chat.",
          "In Library and in a project’s Jobs, the icon is the one mode that run used.",
        ],
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
        text: "Reference modes, including Seedance 2.5, can run with no file attached. On Seedance, each image or video can be marked Character, Background, Object, or Style. Character sends faces and people on the face input. Background, Object, and Style are normal references, and the prompt should say what each @Image or @Video does. Seedance 2.5 also has a Task control: Auto lets the prompt decide, Edit video changes a reference clip, and Extend video continues it. Edit and Extend need a reference video, keep that clip's aspect ratio, and work best with MOV. Edit keeps the length on Auto.",
      },
      {
        type: "p",
        text: "Character is a tight headshot only. A full body, a pose, or the room marked Character sends the wrong face. Background is the empty place. Object is a prop, a body, a pose, or the outfit, and the prompt has to say which. Style is light and color, and it copies the people and the room in that frame unless the prompt forbids it. Audio has no role. Insert bindings adds one line per chip, using the chip numbers, and leaves a line that is already in the prompt. With two or more audio clips, name who speaks on every line. An offscreen voice has no face, so name it every time it speaks. A file keeps its number when its role changes. A new file takes the next number.",
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
        text: "A look is named prompt text about how things should feel: film stock, lens, light, color, era, motion. It is words only and never changes model settings; the Style reference role is an image. Look, under the prompt, opens your collection, grouped as Camera, Light, Color, Era, Motion, or Other, with starred looks first. Pick up to five. They show as numbered chips under the prompt, not as text in the box, and What the model receives shows them ahead of the prompt in chip order, each ending with a period. Remove a chip and the prompt stays as it is. Select prompt text and choose Save as look to turn it into a new look. Looks live on the profile, so every project can use them, and a project keeps its applied looks. Each run records which looks it used.",
      },
      {
        type: "p",
        text: "A gallery has a handle, the name with the spaces removed. You can edit it, and it has to be unique on the profile. Image, Video, and Audio stay reserved for file mentions. @Maya attaches the first items in that gallery, featured image first. Take, from 1 to 4, sets how many; it starts at 1. @Loft.wide attaches the item with that label. Studio turns those names into @Image, @Video, and @Audio numbers when it sends, keeps the prompt you wrote, and shows the expanded prompt under What the model receives.",
      },
      {
        type: "p",
        text: "A gallery keeps a named set of references. Gallery, on image edit and video modes, opens the same panel as Library → Galleries: the gallery you opened last, or the list of galleries when none is open yet. The panel docks on the left with the library, the peek, and Projects, and they share one width. The corner control docks that set on the left, on the right, or up from the bottom. Close it with ×, with Esc, with ⌘⇧G, or with a click outside the panel. Attach all adds the whole set to the composer. Drag one tile onto the prompt to add just that file. Drag a tile to another place in the gallery to change the order, and the order is saved with the gallery. New files sort themselves: images, video, and audio each land in their own group. An image or video starts as a character. Mark it Background, Object, or Style and it moves into backgrounds, objects, and styles. Library → Galleries lists every gallery before a mode is chosen. A gallery with more than four items shows its featured image larger. Edit and Delete are on each card. Inside a gallery, drop files or drag library tiles into the panel to add them. Click an image or a video to open a lightbox and move through those items with the arrows or a swipe that follows your finger, then click an image again for actual size. Play on a video opens that same lightbox and starts the video. Play on audio opens a small player. Select items, then Attach, to add that set to the current generation. Select items, then Remove from gallery to take them out of that gallery (the files stay in the library), or copy or move them into another gallery or a new one. In an opened set in the library, every image has a checkbox, the large one included. Tick the ones you want, then Add to gallery, New gallery, Attach, Download, or Delete acts on all of them, and each button shows the count. With nothing ticked those buttons act on the image being shown, and Add all sends the whole set in one click. Choosing a gallery keeps the list open and says how many items were added.",
      },
    ],
  },
  {
    id: "projects",
    title: "Projects, references, and jobs",
    category: "Generate",
    blocks: [
      {
        type: "p",
        text: "A project keeps a brief, numbered references, and the jobs run from it. Projects opens from the top bar and docks with the other panels. Open a project and a header sits above the composer with its name, how many references are attached, and the last run. References, Jobs, and Brief open the matching tab.",
      },
      {
        type: "p",
        text: "References are the project’s galleries and files, numbered in the order they arrived. Tick what is active, give each image a role, and the composer attaches that set up to the budget and the model’s own limits. Remove one and later numbers move up; mentions in the prompt follow.",
      },
      {
        type: "p",
        text: "The Brief’s Model picker lists the models from the Oxen catalog that take image, video, or audio references, with each model’s limits beside it. Pick one and it becomes the project model: New job and opening the project use it, and runs do not change it. Leave it unset and the last run’s model and settings come back instead. The composer’s own picker can still use another model for a single run without rewriting the project.",
      },
      {
        type: "p",
        text: "New job, in the project header, the Projects panel, the Jobs tab, and the Brief, starts a fresh run from the brief: its prompt, its looks, the active references, the project model and its saved settings, with the count back to 1×. Edits in the composer are kept as the project’s draft and come back the next time the project opens. The header badge says whether the composer is showing that draft or a new job.",
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
        text: "Library is past work, using small thumbnails. Filter by tag. Tags apply to a generation group, not each variation. Library, with its galleries, Projects, and the peek dock on the left and share one width. The corner control moves that set to the right or up from the bottom. Settings slides in from the right and stays there. The top bar stays above the panels. On a phone, Library, Projects, and Galleries open together from the menu on the left, and each one fills the screen. Settings stays on the profile icon.",
      },
      {
        type: "p",
        text: "Settings → Library sets how many groups appear on a page: 12, 24, 36, 48, or 96. The default is 36. A gallery card shows that same number of items. A group of variations counts as one item. Older work is on later pages. Type a page number in the pager and press Enter to jump there. Download page saves the current page when there is more than one.",
      },
      {
        type: "p",
        text: "Click a library image to open the peek. Esc or X closes it. Click the image, or a variation thumb, to open it full size.",
      },
      {
        type: "p",
        text: "Profiles share this account and Oxen key. Open the account menu from the profile icon to switch profiles. The current name is listed there. Edit, beside each name, changes the name in place. Library and galleries follow the active profile. Saved prompts stay on the account. Deleting a profile moves its media to another profile.",
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
        text: "There is one Delete control: on a library tile, on the bar of an opened set, on the selection bar, and on the canvas. It opens a menu with two choices and says how many items it covers. Remove from Studio takes the items out of Studio and leaves the Oxen copies. Delete everywhere also removes the files from your Oxen repo. Nothing is deleted until you pick one, and Esc closes the menu. Afterwards Studio says what happened: how many were removed, how many had no Oxen copy left, and how many Oxen could not remove. A file removed from Oxen leaves the repo’s branch, but Oxen storage stays the same, because the repo history keeps it.",
      },
      {
        type: "p",
        text: "History → Clear failed removes failed and cancelled jobs, and succeeded jobs that never saved a file. Jobs still running stay. Settings → Cleanup can do that same cleanup, rebuild missing thumbnails, or wipe this account’s Studio media. Also delete from Oxen removes the matching files from your Oxen repo. Cancelling a job in the Oxen queue does not remove a file that already succeeded.",
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
          "⌘⇧G opens and closes the gallery. It stays with a text field, and with a menu that already uses that key.",
          "⌘⇧, opens Settings. ⌘, is left for the browser.",
          "? opens this help, unless the cursor is in a text field.",
          "Esc closes help, Settings, Projects, the library, a peek, or a full-size image.",
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
        text: "Settings is in the top bar and under your avatar. It slides in from the right. The panes are API key, Models, Library, Notifications, and Cleanup.",
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
