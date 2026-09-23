# nddPlan — Gestão de Roadmap e Capacidade

MVP navegável de um portal corporativo para planejamento trimestral, gestão de demandas, capacidade, riscos e mudanças.

## Executar



```bash
npm install
npm run dev
```
  
Para gerar a versão de produção:

```bash
npm run build
```

## Principais recursos

- Dashboard executivo com KPIs, gráficos e insights
- Roadmap em timeline e lista
- Gestão e busca de demandas
- Capacidade e alocação do time
- Simulação dinâmica de cenários e impacto
- Matriz de riscos, central de mudanças e relatórios
- Busca global com `Ctrl + K`
- Tema claro/escuro e layout responsivo

Os dados são fictícios e ficam no front-end, deixando a interface pronta para uma futura camada de serviços/API.

## Acesso ao protótipo

Entre com a conta de administrador configurada para este protótipo. Depois, o administrador pode criar usuários com os perfis **Administrador**, **Editor** e **Visualização** na página Usuários. A opção **Manter conectado neste navegador** preserva a sessão ao fechar e reabrir o navegador; sem ela, a sessão dura até fechar a aba. A ação **Sair** encerra os dois tipos de sessão.

Para usuários Editor e Visualização, o administrador seleciona os produtos permitidos. As telas de capacidade, demandas, roadmap e analytics mostram apenas os dados desses produtos. Administradores visualizam todos os produtos.

Esta autenticação é **local ao navegador**: contas e hashes de senha ficam em `localStorage`, e a sessão fica em `sessionStorage` ou `localStorage` quando a opção de permanência está marcada. As permissões controlam a interface, mas não constituem proteção de dados contra alguém com acesso ao navegador ou às ferramentas de desenvolvimento. Para uso real com vários usuários, é necessário um servidor de autenticação, armazenamento central e verificação de permissões em cada operação da API.
