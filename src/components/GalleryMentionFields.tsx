type Props = {
  handle: string;
  take: number;
  onHandleChange: (value: string) => void;
  onTakeChange: (value: number) => void;
};

/** The @handle and how many items @handle attaches. Labels live on each item. */
export function GalleryMentionFields(props: Props) {
  return (
    <div className="gallery-mention-fields">
      <label className="gallery-handle-field">
        <span aria-hidden>@</span>
        <input
          className="field"
          value={props.handle}
          placeholder="Handle"
          aria-label="Gallery handle"
          spellCheck={false}
          autoCapitalize="off"
          onChange={(event) => props.onHandleChange(event.target.value.replace(/\s+/g, ""))}
        />
      </label>
      <label className="gallery-take-field">
        <span>Take</span>
        <select
          className="field"
          aria-label="Take count"
          value={props.take}
          onChange={(event) => props.onTakeChange(Number(event.target.value))}
        >
          {[1, 2, 3, 4].map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
