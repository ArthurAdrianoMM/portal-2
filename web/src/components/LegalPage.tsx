import { LEGAL } from '../content/legal';
import type { LegalId } from '../lib/route';
import { Markdown } from './Markdown';

const OTHER: Record<LegalId, LegalId> = { termos: 'privacidade', privacidade: 'termos' };

/** The Termos de uso or the Política de privacidade. */
export function LegalPage({ id }: { id: LegalId }) {
  const doc = LEGAL[id];
  const other = LEGAL[OTHER[id]];
  return (
    <article className="legal">
      <header className="legal__head">
        <p className="overline overline--gold">Atualizado em {doc.updated}</p>
        <h1>{doc.title}</h1>
        <p>{doc.intro}</p>
      </header>
      {doc.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          <Markdown text={section.text} className="prose legal__body" />
        </section>
      ))}
      <p className="legal__other">
        Veja também: <a href={`#/${OTHER[id]}`}>{other.title}</a>.
      </p>
    </article>
  );
}
