import { getCards } from "../../engines/library/store";
import { cardForLink, splitWikilinks } from "../../engines/library/wikilinks";
import "./WikiText.scss";

/**
 * Note text with its Obsidian `[[links]]`: a link to a card opens that card (`onOpenCard`); any other link, or any link
 * where nothing can open a card, shows as its plain label.
 */
export function WikiText({ text, onOpenCard }: { text: string; onOpenCard?: (cardId: string) => void }) {
  const cards = getCards();
  return (
    <>
      {splitWikilinks(text).map((p, i) => {
        if ("text" in p) return p.text;
        const card = onOpenCard ? cardForLink(p.target, cards) : undefined;
        if (!card || !onOpenCard) return <span key={i}>{p.label}</span>;
        return (
          <button
            key={i} type="button" onClick={() => onOpenCard(card.id)} title={`Open the card ${card.title}`}
            className="wiki-link"
          >
            {p.label}
          </button>
        );
      })}
    </>
  );
}
