import type { ChatTurn } from "../lib/chat";

export function ChatThread({ turns, busy }: { turns: ChatTurn[]; busy: boolean }) {
  if (turns.length === 0 && !busy) {
    return (
      <div className="canvas">
        <div className="canvas-empty">
          <h2>Ask the model</h2>
          <ol>
            <li>Choose a chat model.</li>
            <li>Write a question. Drop an image or a PDF, 24MB or smaller, if the model should look at it.</li>
            <li>Send. This thread stays here until you press New.</li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas">
      <div className="chat-thread" aria-live="polite">
        {turns.map((turn, index) => (
          <article key={`${turn.role}-${index}`} className={`chat-turn is-${turn.role}`}>
            <h3>{turn.role === "user" ? "You" : "Reply"}</h3>
            {turn.images.length > 0 ? (
              <div className="chat-images">
                {turn.images.map((image) => (
                  <img key={image.url} src={image.url} alt={image.name} />
                ))}
              </div>
            ) : null}
            {turn.files.length > 0 ? (
              <p className="chat-files">{turn.files.map((file) => file.name).join(", ")}</p>
            ) : null}
            {turn.text ? <p>{turn.text}</p> : null}
          </article>
        ))}
        {busy ? <p className="chat-waiting">Waiting for a reply…</p> : null}
      </div>
    </div>
  );
}
