/**
 * The Termos de uso and the Política de privacidade, linked from the login.
 * They describe what the server really does (docs/HOSTING.md); change them
 * together with it. Texts use the Markdown subset of lib/markdown.ts.
 */
import type { LegalId } from '../lib/route';

export interface LegalDocument {
  title: string;
  /** When the text last changed, as shown. */
  updated: string;
  intro: string;
  sections: { heading: string; text: string }[];
}

const UPDATED = '19 de novembro de 2026';
const ISSUES = 'https://github.com/ArthurAdrianoMM/portal-2/issues';
const SOURCE = 'https://github.com/ArthurAdrianoMM/portal-2';
/** Who answers for the hosted server, and where to reach them privately. */
const CONTROLLER = 'Arthur Adriano Mendes Machado';
const CONTACT = 'arthuradrianomm@gmail.com';
const DOMAIN = 'portal2.arthuradriano.com';

export const LEGAL: Record<LegalId, LegalDocument> = {
  termos: {
    title: 'Termos de uso',
    updated: UPDATED,
    intro:
      'O Portal 2 mostra os seus dados do Portal do Aluno do SENAI, em páginas, numa API e para assistentes de IA. Ao entrar, você aceita estes termos.',
    sections: [
      {
        heading: 'O que é',
        text: `Um projeto pessoal, de código aberto, **sem vínculo com o SENAI, a FIEB ou a TOTVS**. Ele entra no Portal do Aluno com a sua conta e só lê: nenhuma rota altera nada no portal.

Ele é mantido por ${CONTROLLER}, pessoa física.

O código está em [github.com/ArthurAdrianoMM/portal-2](${SOURCE}). Quem prefere que a senha não saia do próprio computador pode rodar o mesmo servidor em casa, com \`npx portal-2 serve\`.`,
      },
      {
        heading: 'Como usar',
        text: `- Entre só com a **sua** conta. Não use a conta de outra pessoa, mesmo com a senha dela.
- Não compartilhe o token da sua sessão: quem o tiver lê os seus dados até a sessão acabar. Se ele vazar, clique em Sair, e o token deixa de valer.
- Não use o serviço para sobrecarregar o portal, nem para coletar dados em massa.
- As regras do Portal do Aluno continuam valendo para a sua conta.`,
      },
      {
        heading: 'Sem garantias',
        text: `O serviço é gratuito e oferecido como está. Ele pode ficar fora do ar, mudar ou acabar, por exemplo quando o portal muda. Os dados vêm do portal e podem chegar incompletos ou desatualizados: **o oficial é sempre o Portal do Aluno**. Na medida em que a lei permite, o projeto não responde por decisões tomadas com base no que ele mostra.`,
      },
      {
        heading: 'Suspensão',
        text: 'Sessões e acessos que violem estes termos, ou que ponham o serviço ou o portal em risco, podem ser encerrados sem aviso.',
      },
      {
        heading: 'Mudanças e contato',
        text: `Quando estes termos mudarem, a data no topo muda junto. Dúvidas e problemas: [abra uma issue](${ISSUES}). Assuntos que envolvem os seus dados ou a sua conta: **${CONTACT}**. Estes termos seguem a lei brasileira.`,
      },
    ],
  },

  privacidade: {
    title: 'Política de privacidade',
    updated: UPDATED,
    intro: `O que o Portal 2 faz com os seus dados, de acordo com a Lei Geral de Proteção de Dados (LGPD). Em resumo: ele usa a sua senha só para entrar no portal, não guarda os seus dados acadêmicos e não tem rastreadores. Esta política vale para o servidor mantido pelo autor do projeto, em ${DOMAIN}.`,
    sections: [
      {
        heading: 'Quem é o responsável',
        text: `O controlador dos dados é **${CONTROLLER}**, pessoa física, autor do Portal 2. Para qualquer assunto sobre os seus dados, escreva para **${CONTACT}**.

Se outra pessoa hospeda o Portal 2 em outro endereço, quem responde pelos dados ali é ela, não este projeto. Quando você roda \`portal-2 serve\` no seu computador, os dados ficam com você.`,
      },
      {
        heading: 'O que passa pelo servidor',
        text: `- **Usuário e senha do portal**, para entrar no Portal do Aluno por você.
- **O que o portal responde**: notas, faltas, horários, materiais, dados pessoais e a foto do perfil. Isso passa pelo servidor só para montar a resposta ao seu pedido. Nada disso é gravado.
- **Um cookie**, \`portal2_sessao\`, com o token da sessão. Ele é necessário para você continuar logado; scripts da página não conseguem lê-lo.`,
      },
      {
        heading: 'Por que usamos os dados',
        text: `Para fazer o que você pede: entrar no Portal do Aluno com a sua conta e mostrar os seus dados (LGPD, art. 7º, V). Gravar a senha com "Lembrar de mim" depende do seu consentimento, dado ao marcar a opção (art. 7º, I). Para retirá-lo, clique em **Sair**. Os dados não são usados para nenhuma outra finalidade.`,
      },
      {
        heading: 'A senha',
        text: `A senha vai do seu navegador para o servidor e dele para o portal, e nunca aparece nos registros.

- **Sem "Lembrar de mim"**, ela fica só na memória do servidor, até você sair, passar 12 horas sem uso ou o servidor reiniciar.
- **Com "Lembrar de mim"**, ela também é gravada por 30 dias, criptografada (AES-256-GCM) com uma chave que só o token da sua sessão gera. O servidor não guarda esse token: sem ele, o arquivo não abre nada.
- Se o portal recusar a senha salva (porque você a trocou), a sessão é apagada e a senha nunca é enviada de novo.`,
      },
      {
        heading: 'O que não fazemos',
        text: `- Não guardamos notas, faltas, horários nem outros dados acadêmicos.
- Não usamos analytics, anúncios ou rastreadores, e nenhum script de terceiros roda na página.
- Não vendemos dados nem os passamos a ninguém além dos listados abaixo. Os registros do servidor têm só método, caminho, resposta e tempo de cada pedido: sem endereço IP, sem token, sem senha.`,
      },
      {
        heading: 'Com quem os dados passam',
        text: `- **Portal do Aluno (SENAI e TOTVS)**: recebe o seu login e os pedidos, como faria o seu navegador. Os dados são deles, sob as regras deles.
- **Cloudflare**, só na versão hospedada: a conexão HTTPS chega primeiro à Cloudflare, que a encaminha ao servidor por um túnel criptografado. Ela processa as requisições, incluindo o login e o endereço IP, e pode fazer isso em servidores fora do Brasil. Essa transferência é necessária para atender o seu pedido (LGPD, art. 33, IX) e segue a [política de privacidade da Cloudflare](https://www.cloudflare.com/privacypolicy/).
- **Assistentes de IA que você conectar** (Claude, ChatGPT e outros), pelo \`/mcp\` ou pelo \`portal-2 mcp\`: o que o assistente pede, como notas, faltas e dados pessoais, vai para a empresa que opera o assistente e fica sob a política de privacidade dela, não desta. O Portal 2 só responde ao que o assistente pede, e só enquanto a sessão valer. Conecte apenas assistentes em que você confia.

Quando você roda \`portal-2 serve\` no seu computador, nada disso passa pelo projeto: só você e o portal, e os assistentes que você mesmo conectar.`,
      },
      {
        heading: 'Por quanto tempo',
        text: `Uma sessão comum some ao sair, depois de 12 horas sem uso ou quando o servidor reinicia. Uma sessão lembrada some ao sair ou 30 dias depois do login. Clicar em **Sair** apaga na hora tudo o que o servidor guardou da sessão.`,
      },
      {
        heading: 'Seus direitos',
        text: `A LGPD garante a você confirmar, acessar, corrigir e apagar os seus dados, e saber com quem eles são compartilhados. Como quase nada fica guardado, o caminho mais curto é clicar em **Sair**, que apaga na hora tudo o que o servidor guardou da sessão. Para qualquer outro pedido, escreva para **${CONTACT}**. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).

O serviço não é destinado a menores de 12 anos. Se você tem entre 12 e 18 anos, use-o com o conhecimento do seu responsável.`,
      },
      {
        heading: 'Mudanças',
        text: 'Quando esta política mudar, a data no topo muda junto.',
      },
    ],
  },
};
