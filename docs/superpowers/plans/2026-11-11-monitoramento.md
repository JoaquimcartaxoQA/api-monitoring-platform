# Plano de implementação da Plataforma de Monitoramento de APIs
**Objetivo:** consultar eventos de uma única aplicação por instalação, com acesso público agregado e detalhes protegidos.
**Referência:** consolidação aprovada em 11/11/2026 no documento de decisões da pasta pai.
**Execução:** desenvolvimento local neste chat, autorizado pelo usuário. A chamada de demonstração e sua validação com Playwright MCP serão submetidas à aprovação após a entrega.

- [x] Implementar leitor JSONL, projeção de campos, janela UTC, limites de volume e visões de paginação em memória. Verificar registros inválidos, retenção, ordem, paginação, concorrência entre consultas e indisponibilidade na suíte HTTP.
- [x] Implementar API intermediária em Node.js, sessão e controle de origem. Verificar acesso anônimo, login, logout, projeção e auditoria com PostgreSQL descartável.
- [x] Implementar interface React/TypeScript/Vite/Tailwind com estado público, autenticação, listagem, filtros, inspeção e tratamento de falhas. Atualizar a primeira página em 30 s e manter páginas históricas estáveis.
- [x] Documentar configuração e integração e disponibilizar o produtor de eventos sintético local.
- [ ] Executar chamada sintética e verificar o fluxo no navegador com Playwright MCP após aprovação. Incluir revisão visual em tela estreita.

