# Handles in an API prompt

Status: the resolver is `resolvePromptNames` in `worker/api-names.ts`. `POST /api/generate` does not call it yet; it is wired in after API tokens land. This note will be merged into the API doc.

A handle in a prompt works the way it does in the composer. `@Maya` names a slot or a gallery on your active profile. `@Maya.wide` names the file labeled `wide` in it. Studio does three things with a handle:

- **Attaches files.** `@Maya` attaches the first files of that slot or gallery, up to its take (1 to 4). A gallery's featured image is its first file. `@Maya.wide` attaches only the labeled file. A slot linked to a gallery reads that gallery's files.
- **Numbers them.** The handle in the prompt becomes the `@Image`, `@Video`, or `@Audio` numbers the model sees. Files you attach yourself in `images`, `videos`, and `audios` keep numbers 1, 2, 3… Files from handles take the next numbers. A file that is attached twice is sent once and keeps its first number.
- **Writes the note.** A slot's note is written into the prompt the first time its handle appears. A handle inside a note is followed too, up to three notes deep.

Slots come first: the open project's slots (send `projectId`), then the Everywhere slots, then galleries. The first handle wins. Only your own profile's slots and galleries are read.

The model sets the limits. A kind it doesn't take is left out. When there are too many files, takes shrink from the end of the prompt first, then whole handles are dropped from the end. A model with no reference inputs gets each note and no files, and a handle with only files stays as typed. The result lists handles that matched nothing in `missing` and files left out in `trimmed`.

A prompt with no handles is sent unchanged.

## Examples

Slot `Maya` (take 2, note `tall, short dark hair`) and gallery `Loft` (file labeled `wide`), with one image attached by hand:

```json
{ "prompt": "@Maya by the window of @Loft.wide, light from @Image1", "images": ["u/<you>/sun.png"] }
```

The model receives:

```text
@Image2 @Image3 (tall, short dark hair) by the window of @Image4, light from @Image1
```

and `images` is `[sun.png, Maya file 1, Maya file 2, Loft wide]`.

On a model with no reference inputs, `@Maya by the window of @Loft.wide` becomes:

```text
tall, short dark hair by the window of @Loft.wide
```

No files are sent. `Loft` has files and no note, so it stays as typed, and `trimmed` reads `Left @Loft.wide as typed; the model takes no files`.
