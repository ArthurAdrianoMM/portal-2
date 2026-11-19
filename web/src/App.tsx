import { useEffect, useMemo, useState } from 'react';
import { LegalPage } from './components/LegalPage';
import { LoginPage } from './components/LoginPage';
import { OperationPage } from './components/OperationPage';
import { Sidebar } from './components/Sidebar';
import { StartPage } from './components/StartPage';
import { TopBar } from './components/TopBar';
import { LEGAL } from './content/legal';
import { searchOperations } from './lib/search';
import { buildModel, type DocModel, type OpenApiDocument } from './lib/spec';
import { API, routeHref, useConnection, useRoute } from './state';

/** The OpenAPI document the server generates from the operations. */
const SPEC_URL = `${API}/openapi.json`;

export function App() {
  const [model, setModel] = useState<DocModel | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const route = useRoute();
  const connection = useConnection();

  useEffect(() => {
    fetch(SPEC_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<OpenApiDocument>;
      })
      .then((doc) => setModel(buildModel(doc)))
      .catch(() => setLoadError(true));
  }, []);

  const results = useMemo(
    () => (model && query.trim() ? searchOperations(model.operations, query) : null),
    [model, query],
  );

  const operation = model && route.kind === 'operacao' ? model.operations.find((op) => op.id === route.id) : undefined;

  const legal = route.kind === 'documento' ? route.id : null;
  const isLogin = route.kind === 'entrar';
  useEffect(() => {
    const page = isLogin ? 'Entrar' : legal ? LEGAL[legal].title : operation?.summary;
    document.title = page ? `${page} · Portal 2` : 'Portal 2';
    window.scrollTo(0, 0);
  }, [operation, isLogin, legal]);

  if (loadError) {
    return (
      <main className="screen-message">
        <h1>Não foi possível carregar a documentação</h1>
        <p>
          O arquivo <code>openapi.json</code> não respondeu. Confira se o servidor ainda está rodando no terminal.
        </p>
      </main>
    );
  }
  if (!model) {
    return (
      <main className="screen-message" aria-busy="true">
        <p>Carregando…</p>
      </main>
    );
  }

  if (route.kind === 'entrar') {
    return (
      <LoginPage title={model.title} version={model.version} connection={connection} voltar={route.voltar} />
    );
  }

  return (
    <>
      <TopBar
        title={model.title}
        version={model.version}
        query={query}
        onQuery={setQuery}
        onSubmitQuery={() => {
          const first = results?.[0];
          if (first) location.hash = routeHref({ kind: 'operacao', id: first.id });
        }}
        connection={connection}
        route={route}
      />
      <div className="layout">
        <Sidebar model={model} route={route} results={results} connection={connection.state} />
        <main className="content">
          {legal ? (
            <LegalPage id={legal} />
          ) : operation ? (
            <OperationPage key={operation.id} model={model} operation={operation} connection={connection} />
          ) : route.kind === 'operacao' ? (
            <div className="screen-message">
              <h1>Endpoint não encontrado</h1>
              <p>
                <a href="#/">Voltar para o início</a>
              </p>
            </div>
          ) : (
            <StartPage model={model} />
          )}
        </main>
      </div>
    </>
  );
}
