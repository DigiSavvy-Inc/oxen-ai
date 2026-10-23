import { Fragment, type ReactNode } from "react";
import { gallerySections } from "../lib/gallery-sections";

type Item = {
  id: string;
  kind: "image" | "video" | "audio";
  role?: string | null;
};

type Props<T extends Item> = {
  items: readonly T[];
  gridClassName: string;
  renderItem: (item: T, index: number) => ReactNode;
};

export function GallerySections<T extends Item>(props: Props<T>) {
  const sections = gallerySections(props.items);
  if (sections.length === 0) return null;
  return (
    <div className="gallery-sections">
      {sections.map((section) => (
        <section key={section.id} className="gallery-section" aria-label={section.label}>
          <h3 className="gallery-section-title">{section.title}</h3>
          {section.note ? <p className="gallery-section-note">{section.note}</p> : null}
          <div className={props.gridClassName}>
            {section.items.map(({ item, index }) => (
              <Fragment key={item.id}>{props.renderItem(item, index)}</Fragment>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
